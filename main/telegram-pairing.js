'use strict'

// Emparejamiento por código de un solo uso para Telegram (patrón de Hermes
// Agent): un chat desconocido recibe un código de 6 dígitos y el dueño lo
// aprueba en Configuración → Telegram; la allowlist deja de rellenarse a mano.
//
// Los códigos pendientes viven SOLO en memoria: reiniciar la app los caduca
// todos, que es el comportamiento seguro. La aprobación se persiste fuera
// (telegram.allowedUsers vía el flujo normal de config).

const crypto = require('crypto')

const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_PENDING = 5

function createPairingManager({
  ttlMs = DEFAULT_TTL_MS,
  maxPending = DEFAULT_MAX_PENDING,
  now = Date.now,
  randomInt = crypto.randomInt
} = {}) {
  // code -> { code, userId, chatId, username, firstName, requestedAt, expiresAt }
  const pending = new Map()

  function pruneExpired(ts) {
    for (const [code, entry] of pending) {
      if (entry.expiresAt <= ts) pending.delete(code)
    }
  }

  function findByUser(userId) {
    for (const entry of pending.values()) {
      if (entry.userId === userId) return entry
    }
    return null
  }

  function generateCode() {
    for (let i = 0; i < 100; i++) {
      const code = String(randomInt(0, 1000000)).padStart(6, '0')
      if (!pending.has(code)) return code
    }
    return null
  }

  function requestPairing({ userId, chatId, username, firstName } = {}) {
    const uid = String(userId || '').trim()
    if (!uid) return { ok: false, reason: 'bad-user' }
    const ts = now()
    pruneExpired(ts)
    const existing = findByUser(uid)
    if (existing) return { ok: true, code: existing.code, expiresAt: existing.expiresAt, created: false }
    if (pending.size >= maxPending) return { ok: false, reason: 'rate-limited' }
    const code = generateCode()
    if (!code) return { ok: false, reason: 'no-code' }
    const entry = {
      code,
      userId: uid,
      chatId: chatId != null && chatId !== '' ? String(chatId) : '',
      username: typeof username === 'string' ? username : '',
      firstName: typeof firstName === 'string' ? firstName : '',
      requestedAt: ts,
      expiresAt: ts + ttlMs
    }
    pending.set(code, entry)
    return { ok: true, code, expiresAt: entry.expiresAt, created: true }
  }

  function approve(code) {
    pruneExpired(now())
    const entry = pending.get(String(code || '').trim())
    if (!entry) return { ok: false, reason: 'not-found' }
    pending.delete(entry.code)
    return { ok: true, userId: entry.userId, chatId: entry.chatId, username: entry.username, firstName: entry.firstName }
  }

  function reject(code) {
    const removed = pending.delete(String(code || '').trim())
    return removed ? { ok: true } : { ok: false, reason: 'not-found' }
  }

  function listPending() {
    pruneExpired(now())
    return [...pending.values()].map((e) => ({ ...e }))
  }

  return { requestPairing, approve, reject, listPending }
}

module.exports = { createPairingManager, DEFAULT_TTL_MS, DEFAULT_MAX_PENDING }
