// Token compartido bridge ↔ cliente (versión ESM para el bridge).
//
// El cliente Node embebido en POWER-AGENT usa el módulo CommonJS gemelo en
// `whatsapp/whatsapp-auth.js` del repo. Ambos comparten contrato:
//   - Archivo: `~/.claude/whatsapp-bridge/.auth-token` (mode 0600)
//   - 32 bytes random → hex (64 chars), validación /^[a-f0-9]+$/i con length >= 32
//   - Header: `X-Auth-Token`
//
// Cualquier cambio aquí debe replicarse en `whatsapp/whatsapp-auth.js`.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export const HEADER_NAME = 'X-Auth-Token';
export const HEADER_LC = HEADER_NAME.toLowerCase();
const TOKEN_BYTES = 32;

function defaultTokenPath() {
  return path.join(os.homedir(), '.claude', 'whatsapp-bridge', '.auth-token');
}

export function maskToken(tok) {
  const s = String(tok || '');
  if (!s) return '(none)';
  if (s.length < 12) return `tok=${s.slice(0, 2)}...${s.slice(-2)}`;
  return `tok=${s.slice(0, 4)}...${s.slice(-4)}`;
}

export function ensureToken({ tokenPath = defaultTokenPath(), forceRegenerate = false } = {}) {
  try { fs.mkdirSync(path.dirname(tokenPath), { recursive: true }); } catch {}

  if (!forceRegenerate) {
    try {
      const existing = fs.readFileSync(tokenPath, 'utf-8').trim();
      if (existing && /^[a-f0-9]+$/i.test(existing) && existing.length >= 32) {
        try { fs.chmodSync(tokenPath, 0o600); } catch {}
        return { token: existing, created: false, path: tokenPath };
      }
    } catch {
      // no existe → generamos
    }
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const tmp = `${tokenPath}.tmp`;
  fs.writeFileSync(tmp, token + '\n', { encoding: 'utf-8', mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch {}
  fs.renameSync(tmp, tokenPath);
  try { fs.chmodSync(tokenPath, 0o600); } catch {}
  return { token, created: true, path: tokenPath };
}

function constantTimeEquals(a, b) {
  const A = String(a || '');
  const B = String(b || '');
  if (A.length !== B.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(A, 'utf-8'), Buffer.from(B, 'utf-8'));
  } catch {
    return false;
  }
}

// Middleware Express. Si falta o no coincide → 401. Loguea token enmascarado.
export function makeAuthMiddleware({ getToken, logger = console } = {}) {
  if (typeof getToken !== 'function') {
    throw new Error('makeAuthMiddleware: getToken is required');
  }
  return function authMiddleware(req, res, next) {
    const provided = req.headers[HEADER_LC] || req.headers[HEADER_NAME] || '';
    const expected = getToken();
    if (!expected) {
      logger.warn?.('[bridge-auth] no token loaded server-side; refusing all requests');
      return res.status(503).json({ error: 'Bridge auth not initialized' });
    }
    if (!provided) {
      return res.status(401).json({ error: 'Missing X-Auth-Token' });
    }
    if (!constantTimeEquals(provided, expected)) {
      logger.warn?.(`[bridge-auth] token mismatch (got ${maskToken(provided)}, want ${maskToken(expected)}) on ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'Invalid X-Auth-Token' });
    }
    return next();
  };
}

// Rate limiter por ruta. Sliding window in-memory. Solo defensa local.
export function makeRateLimiter({ rulesPerMinute = {}, defaultPerMinute = 60, windowMs = 60_000, logger = console } = {}) {
  const buckets = new Map();
  function routeKey(req) {
    const p = req.path || '';
    if (p.startsWith('/send/')) return '/send/*';
    return p;
  }
  function limitFor(key) {
    if (key in rulesPerMinute) return rulesPerMinute[key];
    return defaultPerMinute;
  }
  return function rateLimit(req, res, next) {
    const key = routeKey(req);
    const limit = limitFor(key);
    const now = Date.now();
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    const cutoff = now - windowMs;
    while (arr.length && arr[0] < cutoff) arr.shift();
    if (arr.length >= limit) {
      const retryAfterMs = (arr[0] + windowMs) - now;
      res.setHeader('Retry-After', Math.max(1, Math.ceil(retryAfterMs / 1000)));
      logger.warn?.(`[bridge-rate] 429 on ${key} (${arr.length}/${limit} in ${windowMs}ms)`);
      return res.status(429).json({ error: 'Rate limit exceeded', limitPerMinute: limit, route: key });
    }
    arr.push(now);
    next();
  };
}
