'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const { atomicWriteJsonSync } = require('./atomic-writes')
const {
  listCodexSessionFiles,
  readFirstNonEmptyLine,
  extractCodexSessionFirstPrompt,
  isReusableCodexSessionId
} = require('./claude-session-listing')

const INDEX_VERSION = 1
const DEBOUNCE_MS = 500
const POLL_FALLBACK_MS = 60_000

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

function createCodexSessionsIndex({ userDataDir, sessionsRoot } = {}) {
  if (!userDataDir) throw new Error('createCodexSessionsIndex requires userDataDir')
  const root = sessionsRoot || path.join(os.homedir(), '.codex', 'sessions')
  const indexPath = path.join(userDataDir, 'codex-sessions-index.json')

  let state = loadFromDisk()
  let watcher = null
  let pollTimer = null
  const debounceTimers = new Map() // path -> Timeout

  function loadFromDisk() {
    try {
      const raw = fs.readFileSync(indexPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('bad shape')
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

  function persist() {
    try { atomicWriteJsonSync(indexPath, state) } catch {}
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

  async function bootstrap() {
    const files = listCodexSessionFiles(root)
    const newByCwd = {}
    let filesScanned = 0
    for (const filePath of files) {
      filesScanned++
      const meta = parseSessionMeta(filePath)
      if (!meta) continue
      const stat = safeStat(filePath)
      if (!stat) continue
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
    for (const cwd of Object.keys(newByCwd)) {
      newByCwd[cwd].sort((a, b) => b.mtime - a.mtime)
    }
    state = {
      version: INDEX_VERSION,
      lastFullScanAt: Date.now(),
      byCwd: newByCwd
    }
    persist()
    return { filesScanned, byCwdCount: Object.keys(newByCwd).length }
  }

  function getForCwd(cwd) {
    const target = String(cwd || '').trim()
    if (!target) return []
    const list = state.byCwd[target]
    if (!Array.isArray(list) || list.length === 0) return []
    // Defensa: clonar y reordenar (los inserts pueden romper el orden).
    return list.slice().sort((a, b) => b.mtime - a.mtime)
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
    isEmpty,
    indexPath,
    sessionsRoot: root
  }
}

module.exports = { createCodexSessionsIndex }
