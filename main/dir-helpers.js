'use strict'

const fs = require('fs')
const os = require('os')

function looksRemotePath(value) {
  if (!value || typeof value !== 'string') return false
  if (value.startsWith('/Volumes/')) return true
  if (value.startsWith('//') || value.startsWith('\\\\')) return true
  return false
}

function resolveExistingDir(inputPath) {
  const value = typeof inputPath === 'string' ? inputPath.trim() : ''
  if (!value) return ''
  if (looksRemotePath(value)) return value
  try {
    const stat = fs.statSync(value)
    return stat.isDirectory() ? value : ''
  } catch {
    return ''
  }
}

// Electron 43 cambió el origen por defecto de los diálogos a ~/Descargas.
// Los selectores de carpeta deben partir de algo útil: el path sugerido si
// existe, y si no el home.
function pickerStartDir(candidate, homedir = os.homedir()) {
  return resolveExistingDir(candidate) || homedir
}

module.exports = {
  looksRemotePath,
  resolveExistingDir,
  pickerStartDir
}
