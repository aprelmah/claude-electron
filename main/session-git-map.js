// main/session-git-map.js
// Registro persistente sessionId (Claude) -> worktree/rama de git-por-sesión.
// Permite recuperar en qué worktree quedó cada sesión tras reinicio de la app,
// y mapear un worktree borrado a mano a su cwd real (para el sweep de huérfanos).
// Mismo patrón de debounce que main/claude-sessions-index.js: escritura en
// memoria inmediata, persistencia a disco batched 250ms, flush() para forzar.
'use strict'

const fs = require('fs')

const PERSIST_DEBOUNCE_MS = 250

function createSessionGitMap({ filePath, atomicWriteJsonSync } = {}) {
  if (!filePath) throw new Error('createSessionGitMap requiere filePath')
  if (typeof atomicWriteJsonSync !== 'function') {
    throw new Error('createSessionGitMap requiere atomicWriteJsonSync')
  }

  let cache = null
  let dirty = false
  let persistTimer = null

  function emptyState() {
    return { version: 1, sessions: {} }
  }

  function read() {
    if (cache) return cache
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          !parsed.sessions || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) {
        cache = emptyState()
      } else {
        cache = { version: 1, sessions: parsed.sessions }
      }
    } catch {
      cache = emptyState()
    }
    return cache
  }

  function persistNow() {
    try { atomicWriteJsonSync(filePath, cache || emptyState()) } catch {}
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

  function recordActive({ claudeSessionId, realCwd, branch, worktreePath } = {}) {
    const id = String(claudeSessionId || '').trim()
    if (!id) return
    const data = read()
    data.sessions[id] = {
      realCwd: String(realCwd || ''),
      branch: String(branch || ''),
      worktreePath: String(worktreePath || ''),
      active: true,
      updatedAt: Date.now()
    }
    persist()
  }

  function markFinalized(claudeSessionId) {
    const id = String(claudeSessionId || '').trim()
    if (!id) return
    const data = read()
    const entry = data.sessions[id]
    if (!entry) return
    entry.active = false
    entry.updatedAt = Date.now()
    persist()
  }

  function lookupBySessionId(claudeSessionId) {
    const id = String(claudeSessionId || '').trim()
    if (!id) return null
    const data = read()
    return data.sessions[id] || null
  }

  function lookupByWorktreePath(worktreePath) {
    const target = String(worktreePath || '').trim()
    if (!target) return null
    const data = read()
    for (const entry of Object.values(data.sessions)) {
      if (entry.worktreePath === target) return entry
    }
    return null
  }

  function listActiveForCwd(realCwd) {
    const cwd = String(realCwd || '').trim()
    if (!cwd) return []
    const data = read()
    return Object.values(data.sessions).filter((entry) => entry.active && entry.realCwd === cwd)
  }

  function all() {
    return read().sessions
  }

  return {
    recordActive,
    markFinalized,
    lookupBySessionId,
    lookupByWorktreePath,
    listActiveForCwd,
    all,
    flush,
    filePath
  }
}

module.exports = { createSessionGitMap }
