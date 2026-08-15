'use strict'

// Preferencia "esta carpeta lleva conocimiento (Casos/Fichas)", por proyecto.
// El conocimiento vive físicamente en la carpeta (CLAUDE.md + kb/), así que la
// preferencia se ata al cwd y no al perfil: el mismo perfil en otra carpeta no
// tiene esas fichas. Default ON = comportamiento histórico (todas lo tenían).

const fs = require('fs')
const path = require('path')
const { atomicWriteJsonSync } = require('./atomic-writes')

const KB_PREFS_VERSION = 1
const KB_PREFS_DEFAULT = true

function normalizeCwd(cwd) {
  const trimmed = String(cwd || '').trim()
  if (!trimmed) return ''
  return path.resolve(trimmed)
}

function createKbPrefs({ userDataDir }) {
  if (!userDataDir) throw new Error('createKbPrefs requires userDataDir')
  const filePath = path.join(userDataDir, 'kb-prefs.json')

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (!parsed || typeof parsed !== 'object') return {}
      if (parsed.version !== KB_PREFS_VERSION) return {}
      const byCwd = parsed.byCwd
      if (!byCwd || typeof byCwd !== 'object') return {}
      const out = {}
      for (const [key, value] of Object.entries(byCwd)) {
        if (typeof value === 'boolean') out[key] = value
      }
      return out
    } catch {
      return {}
    }
  }

  function write(byCwd) {
    try {
      atomicWriteJsonSync(filePath, { version: KB_PREFS_VERSION, byCwd })
    } catch {}
  }

  function get(cwd) {
    const key = normalizeCwd(cwd)
    if (!key) return KB_PREFS_DEFAULT
    const byCwd = read()
    return typeof byCwd[key] === 'boolean' ? byCwd[key] : KB_PREFS_DEFAULT
  }

  function set(cwd, enabled) {
    const key = normalizeCwd(cwd)
    const value = Boolean(enabled)
    if (!key) return KB_PREFS_DEFAULT
    const byCwd = read()
    if (value === KB_PREFS_DEFAULT) delete byCwd[key]
    else byCwd[key] = value
    write(byCwd)
    return value
  }

  function all() {
    return read()
  }

  return { get, set, all, filePath }
}

module.exports = { createKbPrefs, normalizeCwd, KB_PREFS_VERSION, KB_PREFS_DEFAULT }
