'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const { atomicWriteJsonSync } = require('./atomic-writes')
const { worktreeCwdBelongsTo } = require('./session-git')
const {
  listCodexSessionFiles,
  readFirstNonEmptyLine,
  extractCodexSessionFirstPrompt,
  isReusableCodexSessionId
} = require('./claude-session-listing')

// v2 (2026-08-07): los previews dejan de ser el preámbulo inyectado de codex y las
// sesiones de los worktrees se atribuyen al proyecto — el índice v1 en disco tiene
// títulos y buckets que ya no valen.
const INDEX_VERSION = 2
const DEBOUNCE_MS = 500
const POLL_FALLBACK_MS = 60_000
// PERF-H1: debounce de writes. Antes hacíamos un atomicWrite sync por cada addOrUpdate/removeByPath,
// lo que provoca cascada en bootstrap y en ráfagas del watcher (1000+ writes). Ahora batch 250ms.
const PERSIST_DEBOUNCE_MS = 250
// PERF-H2: yield al event loop cada N entries durante bootstrap async para no bloquear cold start.
const BOOTSTRAP_YIELD_EVERY = 50

function safeStat(p) {
  try { return fs.statSync(p) } catch { return null }
}

function parseSessionMeta(filePath) {
  const firstLine = readFirstNonEmptyLine(filePath)
  if (!firstLine) return null
  let obj = null
  try { obj = JSON.parse(firstLine) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  if (String(obj.type || '') !== 'session_meta') return null
  const payload = obj.payload && typeof obj.payload === 'object' ? obj.payload : {}
  const id = String(payload.id || '').trim()
  if (!isReusableCodexSessionId(id)) return null
  const cwd = String(payload.cwd || '').trim()
  if (!cwd) return null
  return { id, cwd }
}

function createCodexSessionsIndex({ userDataDir, sessionsRoot, worktreesRoot: worktreesRootOpt } = {}) {
  if (!userDataDir) throw new Error('createCodexSessionsIndex requires userDataDir')
  const root = sessionsRoot || path.join(os.homedir(), '.codex', 'sessions')
  const indexPath = path.join(userDataDir, 'codex-sessions-index.json')
  const worktreesRoot = worktreesRootOpt || path.join(userDataDir, 'worktrees')

  let state = loadFromDisk()
  let watcher = null
  let pollTimer = null
  const debounceTimers = new Map() // path -> Timeout
  // PERF-H1: estado del debounce-global de persist.
  let dirty = false
  let persistTimer = null

  function loadFromDisk() {
    try {
      const raw = fs.readFileSync(indexPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('bad shape')
      // Los previews van cacheados aquí: un índice de otra versión se tira para
      // que el bootstrap lo regenere, en vez de arrastrar títulos malos a perpetuidad.
      if (Number(parsed.version) !== INDEX_VERSION) throw new Error('stale version')
      const byCwd = (parsed.byCwd && typeof parsed.byCwd === 'object') ? parsed.byCwd : {}
      for (const k of Object.keys(byCwd)) {
        if (!Array.isArray(byCwd[k])) byCwd[k] = []
      }
      return {
        version: INDEX_VERSION,
        lastFullScanAt: Number(parsed.lastFullScanAt) || 0,
        byCwd
      }
    } catch {
      return { version: INDEX_VERSION, lastFullScanAt: 0, byCwd: {} }
    }
  }

  function persistNow() {
    try { atomicWriteJsonSync(indexPath, state) } catch {}
    dirty = false
  }

  function persist() {
    dirty = true
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      if (dirty) persistNow()
    }, PERSIST_DEBOUNCE_MS)
    if (typeof persistTimer.unref === 'function') {
      try { persistTimer.unref() } catch {}
    }
  }

  function flush() {
    if (persistTimer) { try { clearTimeout(persistTimer) } catch {} ; persistTimer = null }
    if (dirty) persistNow()
  }

  function isEmpty() {
    return !state.lastFullScanAt && Object.keys(state.byCwd).length === 0
  }

  function findEntryByPath(rolloutPath) {
    for (const cwd of Object.keys(state.byCwd)) {
      const list = state.byCwd[cwd]
      for (let i = 0; i < list.length; i++) {
        if (list[i].path === rolloutPath) return { cwd, index: i }
      }
    }
    return null
  }

  function removeByPath(rolloutPath) {
    const found = findEntryByPath(rolloutPath)
    if (!found) return false
    const list = state.byCwd[found.cwd]
    list.splice(found.index, 1)
    if (list.length === 0) delete state.byCwd[found.cwd]
    persist()
    return true
  }

  function addOrUpdate(rolloutPath) {
    const meta = parseSessionMeta(rolloutPath)
    if (!meta) {
      // Si el archivo está vacío/incompleto pero existe, no borramos el indexado previo.
      return false
    }
    const stat = safeStat(rolloutPath)
    if (!stat) return false
    const preview = extractCodexSessionFirstPrompt(rolloutPath) || '(sin contenido)'
    const entry = {
      id: meta.id,
      path: rolloutPath,
      mtime: stat.mtime.getTime(),
      size: stat.size,
      preview,
      indexedAt: Date.now()
    }
    const prev = findEntryByPath(rolloutPath)
    if (prev) {
      const prevCwd = prev.cwd
      if (prevCwd !== meta.cwd) {
        // Mover entre cwds (no debería pasar pero por si acaso).
        state.byCwd[prevCwd].splice(prev.index, 1)
        if (state.byCwd[prevCwd].length === 0) delete state.byCwd[prevCwd]
      } else {
        state.byCwd[prevCwd][prev.index] = entry
        persist()
        return true
      }
    }
    if (!state.byCwd[meta.cwd]) state.byCwd[meta.cwd] = []
    // Reemplazar si ya existía una entry con mismo path (defensa extra).
    const list = state.byCwd[meta.cwd]
    const sameIdx = list.findIndex((e) => e.path === rolloutPath)
    if (sameIdx >= 0) list[sameIdx] = entry
    else list.push(entry)
    persist()
    return true
  }

  function yieldToEventLoop() {
    return new Promise((resolve) => setImmediate(resolve))
  }

  async function listCodexSessionFilesAsync(sessionsRoot) {
    if (!fs.existsSync(sessionsRoot)) return []
    const out = []
    let years = []
    try { years = (await fs.promises.readdir(sessionsRoot)).filter((y) => /^\d{4}$/.test(y)) } catch { return [] }
    for (const year of years) {
      const yearDir = path.join(sessionsRoot, year)
      let months = []
      try { months = (await fs.promises.readdir(yearDir)).filter((m) => /^\d{2}$/.test(m)) } catch { continue }
      for (const month of months) {
        const monthDir = path.join(yearDir, month)
        let days = []
        try { days = (await fs.promises.readdir(monthDir)).filter((d) => /^\d{2}$/.test(d)) } catch { continue }
        for (const day of days) {
          const dayDir = path.join(monthDir, day)
          let files = []
          try { files = (await fs.promises.readdir(dayDir)).filter((f) => /^rollout-.+\.jsonl$/i.test(f)) } catch { continue }
          for (const f of files) out.push(path.join(dayDir, f))
        }
      }
    }
    return out
  }

  async function bootstrap() {
    // PERF-H2: lectura del árbol con fs.promises (async real) y yield al event loop cada N entries
    // para no bloquear el cold start. Antes era 100% síncrono pese a estar marcado async.
    const files = await listCodexSessionFilesAsync(root)
    const newByCwd = {}
    let filesScanned = 0
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      filesScanned++
      const meta = parseSessionMeta(filePath)
      if (meta) {
        const stat = safeStat(filePath)
        if (stat) {
          const preview = extractCodexSessionFirstPrompt(filePath) || '(sin contenido)'
          const entry = {
            id: meta.id,
            path: filePath,
            mtime: stat.mtime.getTime(),
            size: stat.size,
            preview,
            indexedAt: Date.now()
          }
          if (!newByCwd[meta.cwd]) newByCwd[meta.cwd] = []
          newByCwd[meta.cwd].push(entry)
        }
      }
      // Yield al event loop cada BOOTSTRAP_YIELD_EVERY entries para que UI/IPC no se bloqueen.
      if ((i + 1) % BOOTSTRAP_YIELD_EVERY === 0) {
        await yieldToEventLoop()
      }
    }
    for (const cwd of Object.keys(newByCwd)) {
      newByCwd[cwd].sort((a, b) => b.mtime - a.mtime)
    }
    state = {
      version: INDEX_VERSION,
      lastFullScanAt: Date.now(),
      byCwd: newByCwd
    }
    // Bootstrap persiste inmediato (no debounce) porque es el resultado final del scan.
    persistNow()
    return { filesScanned, byCwdCount: Object.keys(newByCwd).length }
  }

  function getForCwd(cwd) {
    const target = String(cwd || '').trim()
    if (!target) return []
    const out = []
    const seen = new Set()
    for (const bucket of Object.keys(state.byCwd)) {
      // El rollout guarda el cwd donde corrió codex. Con el aislamiento git eso
      // es el worktree, no el proyecto: sin esto, las sesiones de hoy no salían
      // en el picker y la lista parecía congelada en la última sesión sin aislar.
      const mine = bucket === target
        || worktreeCwdBelongsTo({ cwd: bucket, realCwd: target, worktreesRoot })
      if (!mine) continue
      for (const entry of state.byCwd[bucket] || []) {
        if (!entry || seen.has(entry.path)) continue
        seen.add(entry.path)
        out.push(entry)
      }
    }
    // Defensa: clonar y reordenar (los inserts pueden romper el orden).
    return out.sort((a, b) => b.mtime - a.mtime)
  }

  function scheduleDebounced(rolloutPath) {
    const existing = debounceTimers.get(rolloutPath)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      debounceTimers.delete(rolloutPath)
      try {
        if (fs.existsSync(rolloutPath)) addOrUpdate(rolloutPath)
        else removeByPath(rolloutPath)
      } catch {}
    }, DEBOUNCE_MS)
    debounceTimers.set(rolloutPath, t)
  }

  function startPollFallback() {
    if (pollTimer) return
    let prevSnapshot = snapshotFiles()
    pollTimer = setInterval(() => {
      try {
        const current = snapshotFiles()
        // Detectar añadidos/modificados.
        for (const p of Object.keys(current)) {
          if (!prevSnapshot[p] || prevSnapshot[p].mtime !== current[p].mtime || prevSnapshot[p].size !== current[p].size) {
            addOrUpdate(p)
          }
        }
        // Detectar borrados.
        for (const p of Object.keys(prevSnapshot)) {
          if (!current[p]) removeByPath(p)
        }
        prevSnapshot = current
      } catch {}
    }, POLL_FALLBACK_MS)
    if (typeof pollTimer.unref === 'function') pollTimer.unref()
  }

  function snapshotFiles() {
    const out = {}
    const files = listCodexSessionFiles(root)
    for (const f of files) {
      const st = safeStat(f)
      if (!st) continue
      out[f] = { mtime: st.mtime.getTime(), size: st.size }
    }
    return out
  }

  function startWatcher() {
    if (watcher || pollTimer) return
    if (!fs.existsSync(root)) {
      try { fs.mkdirSync(root, { recursive: true }) } catch {}
    }
    try {
      watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
        if (!filename) return
        const str = String(filename)
        if (!/\.jsonl$/i.test(str)) return
        if (!/rollout-/i.test(str)) return
        const fullPath = path.join(root, str)
        scheduleDebounced(fullPath)
      })
      watcher.on('error', (err) => {
        try { watcher?.close() } catch {}
        watcher = null
        console.warn('[codex-index] watcher error, fallback to poll:', err?.message || err)
        startPollFallback()
      })
    } catch (err) {
      console.warn('[codex-index] fs.watch recursive failed, using poll:', err?.message || err)
      startPollFallback()
    }
  }

  function stopWatcher() {
    if (watcher) {
      try { watcher.close() } catch {}
      watcher = null
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    for (const t of debounceTimers.values()) {
      try { clearTimeout(t) } catch {}
    }
    debounceTimers.clear()
  }

  return {
    bootstrap,
    addOrUpdate,
    removeByPath,
    getForCwd,
    startWatcher,
    stopWatcher,
    flush,
    isEmpty,
    indexPath,
    sessionsRoot: root
  }
}

module.exports = { createCodexSessionsIndex }
