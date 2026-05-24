'use strict'

const fs = require('fs')

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

module.exports = {
  looksRemotePath,
  resolveExistingDir
}
