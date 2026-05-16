'use strict'

const { execFile } = require('child_process')
const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')

const CANDIDATES = [
  '/opt/homebrew/bin/shellcheck',
  '/usr/local/bin/shellcheck'
]

let _cachedBin = undefined

async function findShellcheck() {
  if (_cachedBin !== undefined) return _cachedBin
  for (const c of CANDIDATES) {
    try {
      await fsp.access(c, fs.constants.X_OK)
      _cachedBin = c
      return c
    } catch {}
  }
  const found = await new Promise((resolve) => {
    execFile('/bin/bash', ['-lc', 'command -v shellcheck'], (err, stdout) => {
      if (err) return resolve(null)
      const p = String(stdout || '').trim()
      resolve(p || null)
    })
  })
  _cachedBin = found
  return found
}

function _resetCacheForTests() {
  _cachedBin = undefined
}

async function lintScript(scriptText) {
  const bin = await findShellcheck()
  if (!bin) {
    return { available: false, errors: [], warnings: [], raw: '', hasIssues: false }
  }
  const tmpPath = path.join(os.tmpdir(), `poweragent-lint-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sh`)
  try {
    await fsp.writeFile(tmpPath, String(scriptText || ''), 'utf-8')
  } catch (err) {
    return { available: true, errors: [], warnings: [], raw: `(no se pudo escribir tmp: ${err.message})`, hasIssues: false }
  }
  return new Promise((resolve) => {
    execFile(
      bin,
      ['--shell=bash', '--format=json', '--severity=warning', tmpPath],
      { maxBuffer: 4 * 1024 * 1024 },
      (_err, stdout) => {
        let issues = []
        try {
          const parsed = JSON.parse(stdout || '[]')
          if (Array.isArray(parsed)) issues = parsed
        } catch { issues = [] }
        fsp.unlink(tmpPath).catch(() => {})
        const errors = issues.filter((i) => i && i.level === 'error')
        const warnings = issues.filter((i) => i && i.level === 'warning')
        const raw = issues
          .map((i) => `[${i.level}] línea ${i.line}: SC${i.code} ${i.message}`)
          .join('\n')
        resolve({
          available: true,
          errors,
          warnings,
          raw,
          hasIssues: errors.length > 0
        })
      }
    )
  })
}

module.exports = { findShellcheck, lintScript, _resetCacheForTests }
