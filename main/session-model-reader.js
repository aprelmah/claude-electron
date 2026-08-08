'use strict'

// Lee el MODELO REAL con el que está corriendo una sesión, del transcript —
// nunca de la config: el usuario puede cambiarlo a mitad con /model y la config
// no se entera. Claude: último evento assistant con message.model. Codex:
// último turn_context del rollout (trae model + effort).
//
// Regla heredada del relay: lectura parcial SIEMPRE. Solo se lee la cola del
// fichero (TAIL_BYTES); un transcript de 14MB releído entero por refresco de
// tira ya tumbó el poll una vez.

const fs = require('fs')
const os = require('os')
const path = require('path')

const TAIL_BYTES = 64 * 1024

function readFileTail(filePath, maxBytes = TAIL_BYTES) {
  let fd = null
  try {
    fd = fs.openSync(filePath, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    if (len <= 0) return ''
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, start)
    return buf.toString('utf-8')
  } catch {
    return ''
  } finally {
    if (fd != null) { try { fs.closeSync(fd) } catch {} }
  }
}

// claude-haiku-4-5-20251001 → "Haiku 4.5" · claude-fable-5 → "Fable 5"
// claude-opus-4-1-20250805 → "Opus 4.1" · desconocido → id tal cual
function shortClaudeModel(modelId) {
  const id = String(modelId || '').trim()
  if (!id || id === '<synthetic>') return ''
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?$/)
  if (!m) return id
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2]
  return `${family} ${version}`
}

// Un /model en el TUI no genera turno: el cambio solo se ve en el transcript
// como user event con '<local-command-stdout>Set model to X…'. Sin leer esa
// línea, el badge se quedaba con el modelo del último turno hasta que
// escribías otra vez (bug real, pantallazo de Luismi 2026-08-08).
const MODEL_CMD_RE = /<local-command-stdout>Set model to\s+([^<]+)<\/local-command-stdout>/

function claudeEventText(obj) {
  const c = obj?.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n')
  }
  return ''
}

function modelFromLocalCommandStdout(obj) {
  if (obj?.type !== 'user') return ''
  const text = claudeEventText(obj)
  if (!text.includes('Set model to')) return ''
  const m = MODEL_CMD_RE.exec(text.replace(/\x1b\[[0-9;]*m/g, ''))
  if (!m) return ''
  // "Haiku 4.5 and saved as your default…" → "Haiku 4.5"; "Default (recommended)" → "Default"
  return m[1].split(' and saved')[0].split(' (')[0].trim()
}

// Última señal de modelo del tail, la MÁS RECIENTE de dos fuentes: un evento
// assistant con model real (se ignoran sidechains — los sub-agentes Task
// escriben con su propio modelo — y '<synthetic>', eventos de error del CLI)
// o un '/model' del TUI (su stdout trae el nombre ya corto).
function extractClaudeModelFromTail(tailText) {
  const lines = String(tailText || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj?.isSidechain === true) continue
    const cmdModel = modelFromLocalCommandStdout(obj)
    if (cmdModel) return cmdModel
    if (obj?.type !== 'assistant') continue
    const model = obj?.message?.model
    if (typeof model === 'string' && model && model !== '<synthetic>') return model
  }
  return ''
}

// Último turn_context del tail → { model, effort }. Cada turno escribe el suyo,
// así que el último refleja un cambio de modelo a mitad de sesión.
function extractCodexTurnContextFromTail(tailText) {
  const lines = String(tailText || '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj?.type !== 'turn_context') continue
    const p = obj?.payload || {}
    if (typeof p.model === 'string' && p.model) {
      return { model: p.model, effort: typeof p.effort === 'string' ? p.effort : '' }
    }
  }
  return null
}

// El sessionId de codex es UUIDv7: los primeros 48 bits (12 hex) son el ms de
// nacimiento. El rollout vive en sessions/YYYY/MM/DD/rollout-*-<id>.jsonl con
// la fecha LOCAL de ese instante; se mira también ±1 día por el borde de zona
// horaria (la carpeta se nombra al escribir, no al nacer el id).
function codexRolloutDayCandidates(sessionId) {
  const hex = String(sessionId || '').replace(/-/g, '').slice(0, 12)
  if (!/^[0-9a-f]{12}$/i.test(hex)) return []
  const ms = parseInt(hex, 16)
  if (!Number.isFinite(ms) || ms <= 0) return []
  const days = []
  for (const delta of [0, -1, 1]) {
    const d = new Date(ms + delta * 86400000)
    const y = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const da = String(d.getDate()).padStart(2, '0')
    days.push(path.join(String(y), mo, da))
  }
  return days
}

function createSessionModelReader({
  codexSessionsRoot = path.join(os.homedir(), '.codex', 'sessions'),
  cacheMax = 200
} = {}) {
  // filePath → { statKey, value } — solo se relee la cola si el fichero cambió.
  const cache = new Map()

  function remember(key, entry) {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, entry)
    if (cache.size > cacheMax) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
  }

  function cachedTailValue(filePath, extract) {
    let stat
    try { stat = fs.statSync(filePath) } catch { return null }
    const statKey = `${stat.mtimeMs}|${stat.size}`
    const hit = cache.get(filePath)
    if (hit && hit.statKey === statKey) return hit.value
    const value = extract(readFileTail(filePath))
    remember(filePath, { statKey, value })
    return value
  }

  function readClaudeSessionModel(transcriptPath) {
    if (!transcriptPath) return ''
    return cachedTailValue(transcriptPath, extractClaudeModelFromTail) || ''
  }

  function findCodexRolloutPath(sessionId) {
    const sid = String(sessionId || '').trim()
    if (!sid) return null
    const suffix = `-${sid}.jsonl`
    for (const day of codexRolloutDayCandidates(sid)) {
      const dir = path.join(codexSessionsRoot, day)
      let names
      try { names = fs.readdirSync(dir) } catch { continue }
      for (const name of names) {
        if (name.startsWith('rollout-') && name.endsWith(suffix)) {
          return path.join(dir, name)
        }
      }
    }
    return null
  }

  function readCodexSessionModel(sessionId) {
    const rollout = findCodexRolloutPath(sessionId)
    if (!rollout) return null
    return cachedTailValue(rollout, extractCodexTurnContextFromTail)
  }

  return { readClaudeSessionModel, readCodexSessionModel, findCodexRolloutPath }
}

module.exports = {
  createSessionModelReader,
  shortClaudeModel,
  extractClaudeModelFromTail,
  extractCodexTurnContextFromTail,
  codexRolloutDayCandidates,
  readFileTail
}
