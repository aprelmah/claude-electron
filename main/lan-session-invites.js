'use strict'

const crypto = require('crypto')
const path = require('path')

const DEFAULT_TTL_MS = 10 * 60 * 1000
const MAX_TTL_MS = 30 * 60 * 1000
const DEFAULT_MAX_USES = 3

function trim(value, max = 300) {
  const text = String(value == null ? '' : value).trim()
  return text.length > max ? text.slice(0, max) : text
}

function normalizeCli(value) {
  const cli = trim(value, 20).toLowerCase()
  return cli === 'codex' ? 'codex' : (cli === 'claude' ? 'claude' : '')
}

function normalizeSessionId(value) {
  const sessionId = trim(value, 220)
  return /^[a-zA-Z0-9._:-]+$/.test(sessionId) ? sessionId : ''
}

function normalizeCwd(value) {
  const cwd = trim(value, 4000)
  if (!cwd || cwd.includes('\u0000') || !path.isAbsolute(cwd)) return ''
  return path.resolve(cwd)
}

function isSafeInviteToken(value) {
  return /^[A-Za-z0-9_-]{40,120}$/.test(String(value || ''))
}

function normalizeTtl(value, fallback = DEFAULT_TTL_MS) {
  const ttl = Number(value)
  if (!Number.isFinite(ttl)) return fallback
  return Math.max(30 * 1000, Math.min(Math.floor(ttl), MAX_TTL_MS))
}

function normalizeMaxUses(value) {
  const uses = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(uses)) return DEFAULT_MAX_USES
  return Math.max(1, Math.min(uses, 10))
}

function createLanSessionInvites(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const randomBytes = typeof options.randomBytes === 'function'
    ? options.randomBytes
    : (size) => crypto.randomBytes(size)
  const entries = new Map()

  function create({ cwd, sessionId, cli, label, ttlMs, maxUses } = {}) {
    const normalizedCwd = normalizeCwd(cwd)
    const normalizedSessionId = normalizeSessionId(sessionId)
    const normalizedCli = normalizeCli(cli)
    if (!normalizedCwd) throw new Error('La carpeta de la sesión no es válida.')
    if (!normalizedSessionId) throw new Error('El ID de sesión no es válido.')
    if (!normalizedCli) throw new Error('El CLI de la sesión no es válido.')

    let token = ''
    do {
      token = Buffer.from(randomBytes(32)).toString('base64url')
    } while (!token || entries.has(token))

    const createdAt = Number(now()) || Date.now()
    const expiresAt = createdAt + normalizeTtl(ttlMs)
    const entry = {
      cwd: normalizedCwd,
      sessionId: normalizedSessionId,
      cli: normalizedCli,
      label: trim(label, 180) || 'Sesión compartida',
      createdAt,
      expiresAt,
      uses: 0,
      maxUses: normalizeMaxUses(maxUses)
    }
    entries.set(token, entry)
    return { token, expiresAt, maxUses: entry.maxUses }
  }

  function claim(token) {
    const key = trim(token, 200)
    if (!isSafeInviteToken(key)) return null
    const entry = entries.get(key)
    const currentTime = Number(now()) || Date.now()
    if (!entry) return null
    if (entry.expiresAt <= currentTime || entry.uses >= entry.maxUses) {
      entries.delete(key)
      return null
    }
    entry.uses += 1
    if (entry.uses >= entry.maxUses) entries.delete(key)
    return {
      cwd: entry.cwd,
      sessionId: entry.sessionId,
      cli: entry.cli,
      label: entry.label,
      expiresAt: entry.expiresAt,
      usesRemaining: Math.max(0, entry.maxUses - entry.uses)
    }
  }

  function revoke(token) {
    return entries.delete(trim(token, 200))
  }

  function clear() {
    entries.clear()
  }

  return {
    create,
    claim,
    revoke,
    clear,
    size: () => entries.size
  }
}

module.exports = {
  createLanSessionInvites,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  DEFAULT_MAX_USES,
  __test__: {
    normalizeCwd,
    normalizeSessionId,
    normalizeCli
  }
}
