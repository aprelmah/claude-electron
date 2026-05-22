// Token compartido bridge ↔ cliente.
//
// Modelo:
//   - El bridge genera (si no existe) un token aleatorio de 32 bytes hex (64 chars)
//     en `~/.claude/whatsapp-bridge/.auth-token` con permisos 0600.
//   - El cliente lee el mismo archivo y manda el token en `X-Auth-Token` en cada
//     petición HTTP. Si el bridge devuelve 401, el cliente relee el archivo una
//     vez y reintenta (cubre rotación / auto-generación inicial).
//   - DEN_ROOTS: el archivo vive bajo `~/.claude/whatsapp-bridge/`, que ya está
//     permitido por main/path-sandbox.js para el cliente.
//
// Este módulo no depende de Electron; se carga tanto en el cliente Node embebido
// como en el bridge externo. Solo usa stdlib (Node 16+).

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const HEADER_NAME = 'X-Auth-Token'
const HEADER_LC = HEADER_NAME.toLowerCase()
const TOKEN_BYTES = 32
const TOKEN_HEX_LEN = TOKEN_BYTES * 2

function defaultTokenPath() {
  return path.join(os.homedir(), '.claude', 'whatsapp-bridge', '.auth-token')
}

function maskToken(tok) {
  const s = String(tok || '')
  if (!s) return '(none)'
  if (s.length < 12) return `tok=${s.slice(0, 2)}...${s.slice(-2)}`
  return `tok=${s.slice(0, 4)}...${s.slice(-4)}`
}

// Genera token nuevo y lo persiste con 0600. Si ya existe un archivo válido, lo
// devuelve sin tocar. `forceRegenerate` lo sobreescribe siempre.
function ensureToken({ tokenPath = defaultTokenPath(), forceRegenerate = false } = {}) {
  try {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
  } catch {}

  if (!forceRegenerate) {
    try {
      const existing = fs.readFileSync(tokenPath, 'utf-8').trim()
      if (existing && /^[a-f0-9]+$/i.test(existing) && existing.length >= 32) {
        // Asegura permisos 0600 aunque el archivo se haya creado con umask abierta.
        try { fs.chmodSync(tokenPath, 0o600) } catch {}
        return { token: existing, created: false, path: tokenPath }
      }
    } catch {
      // no existe → generamos
    }
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  // Atomic write: tmp + rename + chmod 0600.
  const tmp = `${tokenPath}.tmp`
  fs.writeFileSync(tmp, token + '\n', { encoding: 'utf-8', mode: 0o600 })
  try { fs.chmodSync(tmp, 0o600) } catch {}
  fs.renameSync(tmp, tokenPath)
  try { fs.chmodSync(tokenPath, 0o600) } catch {}
  return { token, created: true, path: tokenPath }
}

// Lee el token si existe. Devuelve null si no. NO genera (para el cliente).
function readToken({ tokenPath = defaultTokenPath() } = {}) {
  try {
    const raw = fs.readFileSync(tokenPath, 'utf-8').trim()
    if (!raw) return null
    if (!/^[a-f0-9]+$/i.test(raw)) return null
    if (raw.length < 32) return null
    return raw
  } catch {
    return null
  }
}

// Comparación constante en tiempo para evitar timing attacks (paranoia: el
// canal es localhost, pero el coste es trivial y el código se reutiliza).
function constantTimeEquals(a, b) {
  const A = String(a || '')
  const B = String(b || '')
  if (A.length !== B.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(A, 'utf-8'), Buffer.from(B, 'utf-8'))
  } catch {
    return false
  }
}

// Middleware Express. Si falta o no coincide → 401. Loguea token enmascarado.
function makeAuthMiddleware({ getToken, logger = console } = {}) {
  if (typeof getToken !== 'function') {
    throw new Error('makeAuthMiddleware: getToken is required')
  }
  return function authMiddleware(req, res, next) {
    const provided = req.headers[HEADER_LC] || req.headers[HEADER_NAME] || ''
    const expected = getToken()
    if (!expected) {
      logger.warn?.('[bridge-auth] no token loaded server-side; refusing all requests')
      return res.status(503).json({ error: 'Bridge auth not initialized' })
    }
    if (!provided) {
      return res.status(401).json({ error: 'Missing X-Auth-Token' })
    }
    if (!constantTimeEquals(provided, expected)) {
      logger.warn?.(`[bridge-auth] token mismatch (got ${maskToken(provided)}, want ${maskToken(expected)}) on ${req.method} ${req.path}`)
      return res.status(401).json({ error: 'Invalid X-Auth-Token' })
    }
    return next()
  }
}

// Rate limiter por ruta. Sliding window simple, in-memory. Localhost-only, no
// vale para abuso distribuido (no aplica) — vale para errores en bucle o procesos
// locales que se vuelvan locos.
//
// Config: { '/send/text': 30, '/messages': 600, default: 60 } req/min.
function makeRateLimiter({ rulesPerMinute = {}, defaultPerMinute = 60, windowMs = 60_000, logger = console } = {}) {
  const buckets = new Map() // key=route → array of timestamps (ms)
  function routeKey(req) {
    // Agrupa /send/* en un único bucket para evitar bypass con caminos similares.
    const p = req.path || ''
    if (p.startsWith('/send/')) return '/send/*'
    return p
  }
  function limitFor(key) {
    if (key in rulesPerMinute) return rulesPerMinute[key]
    return defaultPerMinute
  }
  return function rateLimit(req, res, next) {
    const key = routeKey(req)
    const limit = limitFor(key)
    const now = Date.now()
    let arr = buckets.get(key)
    if (!arr) { arr = []; buckets.set(key, arr) }
    // Drop old entries.
    const cutoff = now - windowMs
    while (arr.length && arr[0] < cutoff) arr.shift()
    if (arr.length >= limit) {
      const retryAfterMs = (arr[0] + windowMs) - now
      res.setHeader('Retry-After', Math.max(1, Math.ceil(retryAfterMs / 1000)))
      logger.warn?.(`[bridge-rate] 429 on ${key} (${arr.length}/${limit} in ${windowMs}ms)`)
      return res.status(429).json({ error: 'Rate limit exceeded', limitPerMinute: limit, route: key })
    }
    arr.push(now)
    next()
  }
}

module.exports = {
  HEADER_NAME,
  HEADER_LC,
  TOKEN_HEX_LEN,
  defaultTokenPath,
  ensureToken,
  readToken,
  maskToken,
  constantTimeEquals,
  makeAuthMiddleware,
  makeRateLimiter
}
