'use strict'

const fs = require('fs')
const path = require('path')
const { atomicWriteJsonSync } = require('./atomic-writes')

const RECENT_CWDS_MAX = 10

function createRecentCwds({ userDataDir }) {
  if (!userDataDir) throw new Error('createRecentCwds requires userDataDir')
  const filePath = path.join(userDataDir, 'recent-cwds.json')

  function read() {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((entry) => entry && typeof entry.cwd === 'string' && entry.cwd)
    } catch {
      return []
    }
  }

  function write(entries) {
    try {
      atomicWriteJsonSync(filePath, entries)
    } catch {}
  }

  function exists(cwd) {
    try { return fs.statSync(cwd).isDirectory() }
    catch (err) {
      // En app empaquetada macOS faltan permisos TCC para Desktop/Documents/etc.
      // statSync da EACCES/EPERM aunque la carpeta exista. No la podamos por eso.
      if (err && (err.code === 'EACCES' || err.code === 'EPERM')) return true
      return false
    }
  }

  function list({ pruneMissing = false } = {}) {
    // pruneMissing por defecto en false: statSync síncrono cuelga el main process
    // sobre paths SMB/NAS que no responden. La validación dura se delega al spawn.
    let entries = read()
    if (pruneMissing) {
      const filtered = entries.filter((e) => exists(e.cwd))
      if (filtered.length !== entries.length) {
        entries = filtered
        write(entries)
      }
    }
    return entries
  }

  function push(cwd) {
    const trimmed = String(cwd || '').trim()
    if (!trimmed) return list()
    const normalized = path.resolve(trimmed)
    const now = Date.now()
    const current = read().filter((e) => e.cwd !== normalized)
    current.unshift({ cwd: normalized, lastUsedAt: now })
    const capped = current.slice(0, RECENT_CWDS_MAX)
    write(capped)
    return capped
  }

  function remove(cwd) {
    const trimmed = String(cwd || '').trim()
    if (!trimmed) return list()
    const normalized = path.resolve(trimmed)
    const next = read().filter((e) => e.cwd !== normalized)
    write(next)
    return next
  }

  function clear() {
    write([])
    return []
  }

  return { list, push, remove, clear, filePath }
}

module.exports = { createRecentCwds, RECENT_CWDS_MAX }
