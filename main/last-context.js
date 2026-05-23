'use strict'

const fs = require('fs')
const path = require('path')
const { atomicWriteJsonSync } = require('./atomic-writes')

const ALLOWED_CLI = new Set(['claude', 'codex'])
const SESSION_ID_REGEX = /^[a-zA-Z0-9._:-]+$/

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const cwd = typeof raw.cwd === 'string' ? raw.cwd.trim() : ''
  if (!cwd) return null
  const cli = ALLOWED_CLI.has(raw.cli) ? raw.cli : 'claude'
  const sid = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : ''
  const sessionId = sid && SESSION_ID_REGEX.test(sid) ? sid : null
  const updatedAt = Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : Date.now()
  return { cwd, cli, sessionId, updatedAt }
}

function createLastContext({ userDataDir }) {
  if (!userDataDir) throw new Error('createLastContext requires userDataDir')
  const filePath = path.join(userDataDir, 'last-context.json')

  function readAll() {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return {}
      const out = {}
      for (const [key, val] of Object.entries(parsed)) {
        const entry = sanitizeEntry(val)
        if (entry) out[String(key)] = entry
      }
      return out
    } catch {
      return {}
    }
  }

  function writeAll(map) {
    try { atomicWriteJsonSync(filePath, map) } catch {}
  }

  function get(wcId) {
    const key = String(wcId || '').trim()
    if (!key) return null
    const all = readAll()
    return all[key] || null
  }

  function set(wcId, partial) {
    const key = String(wcId || '').trim()
    if (!key) return null
    const all = readAll()
    const prev = all[key] || {}
    const merged = sanitizeEntry({
      cwd: partial?.cwd ?? prev.cwd,
      cli: partial?.cli ?? prev.cli,
      sessionId: partial?.sessionId ?? prev.sessionId ?? null,
      updatedAt: Date.now()
    })
    if (!merged) return null
    all[key] = merged
    writeAll(all)
    return merged
  }

  function remove(wcId) {
    const key = String(wcId || '').trim()
    if (!key) return
    const all = readAll()
    if (!(key in all)) return
    delete all[key]
    writeAll(all)
  }

  function mostRecent() {
    const all = readAll()
    let best = null
    for (const entry of Object.values(all)) {
      if (!best || entry.updatedAt > best.updatedAt) best = entry
    }
    return best
  }

  return { get, set, remove, mostRecent, filePath }
}

module.exports = { createLastContext }
