'use strict'

const fs = require('fs')
const path = require('path')
const { atomicWriteJsonSync } = require('./atomic-writes')

function createClaudeSessionsIndex({ userDataDir }) {
  if (!userDataDir) throw new Error('createClaudeSessionsIndex requires userDataDir')
  const filePath = path.join(userDataDir, 'claude-sessions-index.json')

  let cache = null
  // PERF-H7: debounce de writes. Antes hacíamos un atomicWrite sync por cada set(),
  // lo que provoca cascada en el primer listado (1000+ writes). Ahora batch 250ms.
  let dirty = false
  let persistTimer = null
  const PERSIST_DEBOUNCE_MS = 250

  function read() {
    if (cache) return cache
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        cache = {}
      } else {
        cache = parsed
      }
    } catch {
      cache = {}
    }
    return cache
  }

  function persistNow() {
    try { atomicWriteJsonSync(filePath, cache || {}) } catch {}
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

  function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null
    return {
      preview: typeof entry.preview === 'string' ? entry.preview : '',
      msgCount: Number.isFinite(entry.msgCount) ? Number(entry.msgCount) : null,
      mtime: Number.isFinite(entry.mtime) ? Number(entry.mtime) : 0,
      size: Number.isFinite(entry.size) ? Number(entry.size) : 0,
      updatedAt: Number.isFinite(entry.updatedAt) ? Number(entry.updatedAt) : Date.now()
    }
  }

  function get(cwd, sessionId) {
    const c = String(cwd || '').trim()
    const s = String(sessionId || '').trim()
    if (!c || !s) return null
    const data = read()
    const bucket = data[c]
    if (!bucket || typeof bucket !== 'object') return null
    const raw = bucket[s]
    if (!raw) return null
    return normalizeEntry(raw)
  }

  function set(cwd, sessionId, entry) {
    const c = String(cwd || '').trim()
    const s = String(sessionId || '').trim()
    if (!c || !s) return
    const normalized = normalizeEntry({ ...entry, updatedAt: Date.now() })
    if (!normalized) return
    const data = read()
    if (!data[c] || typeof data[c] !== 'object') data[c] = {}
    data[c][s] = normalized
    persist()
  }

  function getForCwd(cwd) {
    const c = String(cwd || '').trim()
    if (!c) return {}
    const data = read()
    const bucket = data[c]
    if (!bucket || typeof bucket !== 'object') return {}
    const out = {}
    for (const [sid, raw] of Object.entries(bucket)) {
      const norm = normalizeEntry(raw)
      if (norm) out[sid] = norm
    }
    return out
  }

  function removeForCwd(cwd) {
    const c = String(cwd || '').trim()
    if (!c) return
    const data = read()
    if (data[c]) {
      delete data[c]
      persist()
    }
  }

  function removeSession(cwd, sessionId) {
    const c = String(cwd || '').trim()
    const s = String(sessionId || '').trim()
    if (!c || !s) return
    const data = read()
    const bucket = data[c]
    if (!bucket || typeof bucket !== 'object') return
    if (bucket[s]) {
      delete bucket[s]
      if (Object.keys(bucket).length === 0) delete data[c]
      persist()
    }
  }

  function clear() {
    cache = {}
    persist()
  }

  return {
    get,
    set,
    getForCwd,
    removeForCwd,
    removeSession,
    clear,
    flush,
    filePath
  }
}

module.exports = { createClaudeSessionsIndex }
