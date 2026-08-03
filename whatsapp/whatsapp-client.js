const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const { EventEmitter } = require('events')
const { runClaudePersona, buildPrompt } = require('./whatsapp-auto-reply')
const { readToken, HEADER_NAME, defaultTokenPath } = require('./whatsapp-auth')
const {
  loadKbIndex, loadKbCards, buildSelectorPrompt, parseSelectorResponse,
  verifyGroundedReply, buildGroundedPromptPrefix, nextClarifyState,
  SELECTOR_SYSTEM, KB_ANSWER_RULES, SMALLTALK_RULES, CLARIFY_RULES
} = require('./whatsapp-kb')

const BRIDGE_URL = 'http://127.0.0.1:3031'
const BRIDGE_DIR = path.join(os.homedir(), '.claude', 'whatsapp-bridge')
const CONFIG_PATH = path.join(BRIDGE_DIR, 'config.json')
const STATE_PATH = path.join(BRIDGE_DIR, 'state.json')
const KB_DIR = path.join(BRIDGE_DIR, 'kb')
const KB_AUDIT_PATH = path.join(BRIDGE_DIR, 'kb-audit.jsonl')

// Distingue "nunca hubo KB" (instalación sin fichas) de "la KB se ha roto".
// En strict, lo segundo escala; lo primero sigue con la persona libre.
function kbDirExists() {
  try { return fs.statSync(KB_DIR).isDirectory() } catch { return false }
}
const MEDIA_DIR = path.join(BRIDGE_DIR, 'media')
const AUTH_TOKEN_PATH = defaultTokenPath()
const POLL_MS = 1500
const STATUS_POLL_MS = 5000
const STATE_FLUSH_MS = 5000
const HISTORY_MAX = 200
const MEDIA_ESCALATION_SECS = 300 // 5 min en manual tras adjunto de cliente
const MAX_PARALLEL_REPLIES = 3
const PERSONA_RELOAD_DEBOUNCE_MS = 500
const ESCALATION_SWEEP_MS = 60_000 // 1 min: revierte chats escalados-vencidos a auto
const MAX_QUEUE_PER_JID = 5 // cola por JID: si se llena, escalamos a manual
const KB_ACTIVE_TTL_SECS = 1800 // 30 min: la conversación sigue "dentro" de la ficha activa
const CLAUDE_UNAVAILABLE_NOTIFY_MS = 10 * 60_000 // anti-spam del aviso al cliente
const BRIDGE_TIMEOUT_DEFAULT_MS = 30_000
const BRIDGE_TIMEOUT_LARGE_MS = 60_000
const BRIDGE_LARGE_PAYLOAD_BYTES = 1_000_000

const MEDIA_PROTOCOL = 'wa-media'
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const AUTO_REPLY_FALLBACK_TEXT = 'Recibido. Te responde Luismi en breve.'
// Solo bloqueamos insultos directos a persona, no tacos coloquiales generales:
// "joder" o "mierda" son normales en castellano de España y bloquearlos cortaría
// respuestas legítimas. Sí cortamos cualquier insulto que ataque al cliente.
const TOXIC_REPLY_PATTERNS = [
  /\bgilipollas?\b/i,
  /\bidiot[ao]s?\b/i,
  /\bimbecil(?:es)?\b/i,
  /\bestupid[oa]s?\b/i,
  /\bsubnormal(?:es)?\b/i,
  /\bcapull[oa]s?\b/i,
  /\bpringad[oa]s?\b/i,
  /\bpayas[oa]s?\b/i
]

function nowTs() { return Math.floor(Date.now() / 1000) }

function safeRead(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

function safeWrite(p, obj) {
  // Write atómico: escribimos a .tmp y renombramos. Si crash a mitad, el .tmp
  // queda huérfano pero el archivo original sigue íntegro.
  const tmp = `${p}.tmp`
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8')
    fs.renameSync(tmp, p)
    return true
  } catch (err) {
    console.error('[whatsapp] state write failed:', err?.message || err)
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch {}
    return false
  }
}

function cleanModel(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function cleanEffort(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return VALID_EFFORTS.has(s) ? s : ''
}

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    autoReply: src.autoReply !== false,
    authorizedNumbers: Array.isArray(src.authorizedNumbers) ? src.authorizedNumbers.map(String) : [],
    claudePath: src.claudePath || path.join(os.homedir(), '.local/bin/claude'),
    ownerNumber: src.ownerNumber || '',
    maxHistory: Number.isFinite(src.maxHistory) ? src.maxHistory : 20,
    personaPath: src.personaPath || path.join(BRIDGE_DIR, 'persona.md'),
    model: cleanModel(src.model),
    effort: cleanEffort(src.effort),
    // Mantiene handover por defecto para mensajes escritos desde otro dispositivo.
    handoverOnFromMe: src.handoverOnFromMe !== false,
    // KB: 'strict' (default) = si hay fichas en kb/, el bot solo resuelve lo que
    // esté en ellas; 'off' desactiva la KB y vuelve a la persona libre.
    kbMode: src.kbMode === 'off' ? 'off' : 'strict',
    kbAnswerModel: cleanModel(src.kbAnswerModel) || 'sonnet',
    kbEscalateText: (typeof src.kbEscalateText === 'string' && src.kbEscalateText.trim())
      ? src.kbEscalateText.trim()
      : 'Esto lo tengo que mirar bien. Le paso tu consulta a Luismi y te contesta en breve 👍'
  }
}

function loadConfig() {
  return normalizeConfig(safeRead(CONFIG_PATH) || {})
}

function saveConfig(next) {
  const current = loadConfig()
  const merged = normalizeConfig({ ...current, ...(next || {}) })
  safeWrite(CONFIG_PATH, merged)
  return merged
}

function jidServer(jid) {
  if (!jid) return ''
  const idx = String(jid).indexOf('@')
  if (idx < 0) return ''
  return String(jid).slice(idx + 1).toLowerCase()
}

function isGroupJid(jid) {
  return jidServer(jid) === 'g.us'
}

function isLidJid(jid) {
  const server = jidServer(jid)
  return server === 'lid' || server === 'hosted.lid'
}

function isPnJid(jid) {
  const server = jidServer(jid)
  return server === 's.whatsapp.net' || server === 'c.us'
}

function jidToNumber(jid) {
  if (!jid) return ''
  if (!isPnJid(jid)) return ''
  const local = (String(jid).split('@')[0] || '').split(':')[0]
  const digits = local.replace(/\D/g, '')
  return digits || ''
}

function jidLocalId(jid) {
  if (!jid) return ''
  return (String(jid).split('@')[0] || '').split(':')[0]
}

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '')
}

function sanitizePhoneForJid(jid, phone) {
  const s = String(phone || '').trim()
  if (!s) return ''
  if (isGroupJid(jid)) return ''
  if (isLidJid(jid)) {
    const local = digitsOnly(jidLocalId(jid))
    if (local && digitsOnly(s) === local) return ''
  }
  if (!isLidJid(jid) && !isPnJid(jid)) return ''
  return s
}

function deriveDisplayNumber(jid, currentDisplayNumber) {
  if (isGroupJid(jid)) return jidLocalId(jid) || String(currentDisplayNumber || '').trim() || String(jid || '')
  const fromJid = jidToNumber(jid)
  if (fromJid) return fromJid
  const fromStored = String(currentDisplayNumber || '').trim()
  if (fromStored) return fromStored
  return jidLocalId(jid) || String(jid || '')
}

function normalizeForModeration(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function sanitizeAutoReplyText(text) {
  // Los saltos de línea se PRESERVAN: la KB responde con pasos numerados y
  // aplastarlos a una sola línea destruye justo lo que la ficha existe para
  // entregar. Se colapsan espacios/tabs dentro de cada línea y las líneas en
  // blanco de más. La moderación sigue viendo el texto en una línea, para que
  // un salto por medio no esquive un patrón tóxico.
  const compact = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!compact) return ''
  const normalized = normalizeForModeration(compact)
  if (TOXIC_REPLY_PATTERNS.some((rx) => rx.test(normalized))) return ''
  return compact
}

function numberToJid(num) {
  if (!num) return ''
  if (String(num).includes('@')) return String(num)
  return `${String(num).replace(/\D/g, '')}@s.whatsapp.net`
}

function mediaUrlFor(mediaPath) {
  if (!mediaPath) return null
  const base = path.basename(mediaPath)
  return `${MEDIA_PROTOCOL}://${base}`
}

function decorateMessage(msg) {
  if (!msg) return msg
  return { ...msg, mediaUrl: mediaUrlFor(msg.mediaPath) }
}

function messageSignature(msg) {
  if (!msg) return ''
  // nowTs guarda timestamps en segundos: la mínima granularidad real de dedupe es 1s.
  // Subir a milisegundos rompería compatibilidad con state.json existente. Mensajes
  // distintos enviados dentro del mismo segundo con el mismo cuerpo se consideran
  // duplicados (escenario muy poco probable con clientes reales).
  const t = Number(msg.timestamp) || 0
  const bucket = t > 9_999_999_999 ? Math.floor(t / 1000) : t
  const body = String(msg.body || '').trim().toLowerCase()
  const media = String(msg.mediaPath || '')
  return `${msg.fromMe ? '1' : '0'}|${msg.type || 'text'}|${bucket}|${body}|${media}`
}

function parseDataUrlBase64(value) {
  if (typeof value !== 'string') return null
  const m = value.match(/^data:([^;,]+);base64,(.+)$/i)
  if (!m) return null
  return { mimetype: m[1], base64: m[2] }
}

// Token cacheado en memoria. Si el bridge devuelve 401 lo relemos del disco una
// sola vez y reintentamos. Esto cubre:
//   - Primer arranque del bridge (genera token nuevo después del primer fetch).
//   - Rotación manual (usuario borra el archivo y el bridge regenera).
let cachedAuthToken = null
let cachedAuthMtime = 0
let authErrorReported = false

function loadAuthTokenFromDisk() {
  try {
    const stat = fs.statSync(AUTH_TOKEN_PATH)
    cachedAuthMtime = stat.mtimeMs || 0
  } catch {
    cachedAuthMtime = 0
  }
  cachedAuthToken = readToken({ tokenPath: AUTH_TOKEN_PATH })
  return cachedAuthToken
}

function getAuthToken({ forceReload = false } = {}) {
  if (forceReload || !cachedAuthToken) return loadAuthTokenFromDisk()
  return cachedAuthToken
}

function bridgeFetchOnce(method, urlPath, body, { token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : null
    const headers = {}
    if (payload) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = payload.length
    }
    if (token) headers[HEADER_NAME] = token
    // Subimos timeout para payloads grandes (envíos de media en base64).
    const timeout = payload && payload.length > BRIDGE_LARGE_PAYLOAD_BYTES
      ? BRIDGE_TIMEOUT_LARGE_MS
      : BRIDGE_TIMEOUT_DEFAULT_MS
    const req = http.request({
      host: '127.0.0.1',
      port: 3031,
      method,
      path: urlPath,
      headers,
      timeout
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        let data = null
        try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`bridge ${method} ${urlPath} → ${res.statusCode}: ${data?.error || text?.slice(0, 200)}`)
          err.status = res.statusCode
          err.body = data
          return reject(err)
        }
        resolve(data)
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('bridge timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

// Wrapper público: inyecta token y maneja 401 con un único retry tras re-leer
// el token del disco. Si vuelve a fallar, propaga el error.
function bridgeFetch(method, urlPath, body) {
  return (async () => {
    const tok = getAuthToken()
    try {
      return await bridgeFetchOnce(method, urlPath, body, { token: tok })
    } catch (err) {
      if (err && err.status === 401) {
        // Reintenta una vez tras releer del disco (token puede haberse generado
        // por el bridge justo después del primer fetch, o rotado).
        const fresh = getAuthToken({ forceReload: true })
        if (fresh && fresh !== tok) {
          try {
            return await bridgeFetchOnce(method, urlPath, body, { token: fresh })
          } catch (err2) {
            if (err2 && err2.status === 401) throw markAuthError(err2)
            throw err2
          }
        }
        throw markAuthError(err)
      }
      throw err
    }
  })()
}

// Reintento para envíos automáticos (bot) cuando el mensaje llega justo en una
// ventana de reconexión del bridge (Baileys reconecta solo cada cierto tiempo;
// el /send/text que cae ahí da 503 "No listo" y se perdía sin más — bug real
// 2026-08-02: cliente sin respuesta y "escribiendo…" colgado 60s en el panel).
// Envíos manuales (Luismi desde el panel) NO pasan por aquí: fallan al momento
// para que él lo vea y reintente a mano, con feedback inmediato.
// OJO: /send/text NO es idempotente. Solo se reintenta cuando consta que el
// mensaje NO salió; ante la duda se abandona, porque un duplicado le llega al
// cliente y eso es peor que un mensaje perdido.
//   - 503: el bridge contesta "No listo" ANTES de llamar a sendMessage → seguro.
//   - ECONNREFUSED/EHOSTUNREACH/ENOTFOUND: ni se abrió la conexión → seguro.
//   - 500: el catch del bridge envuelve al propio sendMessage, y Baileys lanza
//     "Timed Out" en el ack cuando el mensaje YA ha salido por el socket →
//     ambiguo, no se reintenta.
//   - 'bridge timeout' del cliente (30s): con humanize el bridge quema hasta 7s
//     antes de enviar, así que un envío lento pero entregado cae aquí → ambiguo.
//   - 401/400/429: reintentar no los arregla.
const SAFE_RESEND_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND'])

function isSafeToResend(err) {
  if (!err) return false
  if (err.status) return err.status === 503
  return SAFE_RESEND_CODES.has(err.code)
}

function bridgeFetchWithRetry(method, urlPath, body, { retries = 2, delaysMs = [4000, 8000] } = {}) {
  return (async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await bridgeFetch(method, urlPath, body)
      } catch (err) {
        if (!isSafeToResend(err) || attempt === retries) throw err
        await new Promise((r) => setTimeout(r, delaysMs[attempt] ?? 8000))
      }
    }
  })()
}

function markAuthError(err) {
  err.bridgeAuthError = true
  return err
}

function createWhatsAppClient({ transcribeAudio, buildRuntimeEnv, onAutoReplySent } = {}) {
  const emitter = new EventEmitter()
  let config = loadConfig()
  let chats = new Map() // jid → chat
  let lastStatus = null
  let pollTimer = null
  let statusTimer = null
  let flushTimer = null
  let dirty = false
  let stopped = false
  let pollBackoffMs = POLL_MS
  let claudeBin = config.claudePath
  let claudeAvailable = true
  let lastClaudeUnavailableNotifyByJid = new Map() // jid → ts ms del último aviso
  let escalationSweepTimer = null
  let personaText = ''
  let personaWatcher = null
  let personaWatchedPath = ''
  let personaReloadTimer = null
  // Cola por JID: respuestas al MISMO cliente se serializan; entre clientes,
  // hasta MAX_PARALLEL_REPLIES en vuelo (semáforo global).
  const inflightByJid = new Map()
  const queueLenByJid = new Map() // jid → nº mensajes en vuelo+pendientes para ese JID
  let inflightCount = 0
  const inflightWaiters = []
  let autoReplyEpoch = 0

  function emitAutoReplySent(payload) {
    if (typeof onAutoReplySent !== 'function') return
    try { onAutoReplySent(payload || {}) } catch {}
  }

  function checkClaudeBinary() {
    try {
      fs.accessSync(claudeBin, fs.constants.X_OK)
      claudeAvailable = true
    } catch (err) {
      claudeAvailable = false
      // console.error puede no llegar a stderr en Electron empaquetado, pero el
      // proceso main de Electron sí redirige a ~/Library/Logs si está configurado.
      // En el peor caso, este log es visible vía `npm run dev`.
      console.error(`[wa-client] claude binary not executable: ${claudeBin} (${err?.message || err})`)
    }
    return claudeAvailable
  }

  function acquireSlot() {
    return new Promise((resolve) => {
      if (inflightCount < MAX_PARALLEL_REPLIES) {
        inflightCount += 1
        resolve()
      } else {
        inflightWaiters.push(resolve)
      }
    })
  }

  function releaseSlot() {
    if (inflightWaiters.length) {
      // Pasamos el slot directamente: count no cambia.
      const next = inflightWaiters.shift()
      next()
    } else {
      inflightCount = Math.max(0, inflightCount - 1)
    }
  }

  function stopPersonaWatcher() {
    if (personaReloadTimer) { clearTimeout(personaReloadTimer); personaReloadTimer = null }
    if (personaWatcher) {
      try { personaWatcher.close() } catch {}
      personaWatcher = null
      personaWatchedPath = ''
    }
  }

  function reloadPersonaFromDisk() {
    try {
      personaText = fs.readFileSync(config.personaPath, 'utf-8')
      console.log('[whatsapp] persona reloaded from disk')
    } catch {
      personaText = ''
    }
  }

  function startPersonaWatcher() {
    stopPersonaWatcher()
    const target = config.personaPath
    if (!target) return
    try {
      personaWatcher = fs.watch(target, () => {
        if (personaReloadTimer) clearTimeout(personaReloadTimer)
        personaReloadTimer = setTimeout(() => {
          personaReloadTimer = null
          reloadPersonaFromDisk()
          // Si el archivo fue borrado y recreado, fs.watch puede dejar de notificar.
          // Re-armamos el watcher para sobrevivir a editores que escriben con rename.
          if (!fs.existsSync(target)) {
            try { personaWatcher && personaWatcher.close() } catch {}
            personaWatcher = null
          }
          if (!personaWatcher) startPersonaWatcher()
        }, PERSONA_RELOAD_DEBOUNCE_MS)
      })
      personaWatchedPath = target
      personaWatcher.on('error', () => {
        // El watcher puede romperse en algunos sistemas; lo recreamos.
        stopPersonaWatcher()
        setTimeout(() => { if (!stopped) startPersonaWatcher() }, 1000)
      })
    } catch {
      // Si el archivo no existe aún, reintentamos al cabo de un segundo.
      setTimeout(() => { if (!stopped && !personaWatcher) startPersonaWatcher() }, 1000)
    }
  }

  function loadPersona() {
    try { personaText = fs.readFileSync(config.personaPath, 'utf-8') }
    catch { personaText = '' }
    if (personaWatchedPath !== config.personaPath) startPersonaWatcher()
  }

  function loadState() {
    const data = safeRead(STATE_PATH)
    chats = new Map()
    if (!data || !Array.isArray(data.chats)) return
    let normalized = false
    for (const c of data.chats) {
      if (!c || !c.jid) continue
      const isGroup = typeof c.isGroup === 'boolean' ? c.isGroup : isGroupJid(c.jid)
      const safePhone = sanitizePhoneForJid(c.jid, c.phoneNumber)
      const displayNumber = deriveDisplayNumber(c.jid, c.displayNumber)
      const persistedMode = c.mode === 'manual' ? 'manual' : 'auto'
      const persistedEscalatedUntil = Number(c.escalatedUntil) || 0
      const persistedEscalationReason = c.escalationReason === 'media' || c.escalationReason === 'user'
        ? c.escalationReason
        : (persistedMode === 'manual' ? 'user' : null)
      const nextMode = isGroup ? 'manual' : persistedMode
      const nextEscalatedUntil = isGroup ? 0 : persistedEscalatedUntil
      const nextEscalationReason = isGroup ? 'user' : persistedEscalationReason
      if (
        safePhone !== (c.phoneNumber || '') ||
        displayNumber !== (c.displayNumber || '') ||
        isGroup !== Boolean(c.isGroup) ||
        nextMode !== persistedMode ||
        nextEscalatedUntil !== persistedEscalatedUntil ||
        nextEscalationReason !== persistedEscalationReason
      ) {
        normalized = true
      }
      chats.set(c.jid, {
        jid: c.jid,
        displayNumber,
        // Identidad mejorada: nombre del contacto / pushName y número real (si se pudo resolver).
        displayName: typeof c.displayName === 'string' ? c.displayName : '',
        phoneNumber: safePhone,
        mode: nextMode,
        unread: Number(c.unread) || 0,
        history: Array.isArray(c.history) ? c.history.slice(-HISTORY_MAX) : [],
        lastActivity: Number(c.lastActivity) || 0,
        escalatedUntil: nextEscalatedUntil,
        // Origen del manual. Migración: chats antiguos sin flag → 'user' (más seguro,
        // así no revertimos chats que Luismi puso manual a propósito antes del fix).
        escalationReason: nextEscalationReason,
        isGroup
      })
    }
    if (normalized) markDirty()
  }

  function persistState() {
    if (!dirty) return
    const out = { chats: Array.from(chats.values()) }
    if (safeWrite(STATE_PATH, out)) dirty = false
  }

  function markDirty() {
    dirty = true
  }

  function ensureChat(jid) {
    let c = chats.get(jid)
    if (!c) {
      const groupChat = isGroupJid(jid)
      c = {
        jid,
        displayNumber: deriveDisplayNumber(jid, ''),
        displayName: '',
        phoneNumber: '',
        mode: groupChat ? 'manual' : 'auto',
        unread: 0,
        history: [],
        lastActivity: 0,
        escalatedUntil: 0,
        escalationReason: groupChat ? 'user' : null,
        isGroup: groupChat
      }
      chats.set(jid, c)
    }
    return c
  }

function isAuthorized(jid) {
    // Grupos: los JIDs `@g.us` no tienen número de teléfono asociado y no caben
    // en la allowlist individual. Si Luismi quiere bloquear un grupo concreto lo
    // hará por otra vía (mute, salir del grupo).
    if (isGroupJid(jid)) return true
    if (!config.authorizedNumbers || !config.authorizedNumbers.length) return true
    const num = jidToNumber(jid)
    const lidDigits = digitsOnly(jidLocalId(jid))
    return (num && config.authorizedNumbers.includes(num)) || (lidDigits && config.authorizedNumbers.includes(lidDigits))
  }

  function pushHistory(chat, msg) {
    if (!chat || !msg) return false
    if (msg.id && chat.history.some((m) => m && m.id === msg.id)) return false
    const sig = messageSignature(msg)
    if (sig && chat.history.some((m) => messageSignature(m) === sig)) return false
    chat.history.push(msg)
    if (chat.history.length > HISTORY_MAX) {
      chat.history = chat.history.slice(-HISTORY_MAX)
    }
    chat.lastActivity = msg.timestamp || nowTs()
    markDirty()
    return true
  }

  function summarizeChat(jid) {
    const c = chats.get(jid)
    if (!c) return { jid }
    const last = c.history.length ? c.history[c.history.length - 1] : null
    return {
      jid: c.jid,
      displayNumber: c.displayNumber,
      displayName: c.displayName || '',
      phoneNumber: c.phoneNumber || '',
      mode: c.mode,
      unread: c.unread || 0,
      lastActivity: c.lastActivity || 0,
      isGroup: c.isGroup || false,
      lastMessage: last ? {
        body: last.body, type: last.type, timestamp: last.timestamp, fromMe: last.fromMe
      } : null
    }
  }

  function emitNewMessage(jid, msg) {
    emitter.emit('new-message', { jid, message: decorateMessage(msg) })
    emitter.emit('chat-updated', summarizeChat(jid))
  }

  function emitStatus(status) {
    if (status === lastStatus) return
    lastStatus = status
    emitter.emit('status-changed', status)
  }

  async function pollStatus() {
    try {
      const data = await bridgeFetch('GET', '/status')
      emitStatus(data?.status || 'disconnected')
    } catch {
      emitStatus('disconnected')
    }
  }

  async function pollMessages() {
    if (stopped) return
    try {
      const data = await bridgeFetch('GET', '/messages?unreadOnly=true')
      const list = Array.isArray(data?.messages) ? data.messages : []
      pollBackoffMs = POLL_MS
      for (const raw of list) {
        await handleIncoming(raw)
      }
    } catch (err) {
      if (err && err.bridgeAuthError) {
        handleBridgeAuthError(err)
      }
      // backoff exponencial hasta 30s
      pollBackoffMs = Math.min(pollBackoffMs * 2, 30_000)
      if (pollBackoffMs >= 8000 && pollBackoffMs % 8000 < POLL_MS) {
        console.error('[whatsapp] poll error:', err?.message || err)
      }
    } finally {
      if (!stopped) {
        pollTimer = setTimeout(pollMessages, pollBackoffMs)
        pollTimer.unref?.()
      }
    }
  }

  function handleBridgeAuthError(err) {
    // Si el bridge nos rechaza por token persistentemente, desactivamos auto-reply
    // en memoria (sin tocar config en disco) para que Claude no intente responder
    // y emitimos un evento que el renderer puede mostrar.
    if (authErrorReported) return
    authErrorReported = true
    if (config.autoReply !== false) autoReplyEpoch += 1
    config.autoReply = false
    console.error('[whatsapp] bridge rechaza X-Auth-Token persistentemente; auto-reply desactivado hasta reinicio.', err?.message || err)
    try { emitter.emit('bridge-auth-error', { message: err?.message || 'auth error', at: Date.now() }) } catch {}
  }

  // Ventana de agrupación: la gente escribe en varias líneas/mensajes seguidos.
  // Acumulamos hasta un silencio del remitente y respondemos UNA sola vez a
  // todo el bloque (un turno de claude, una respuesta).
  // Rango 4-8s (feedback Luismi 2026-08-02, dos rondas): primero bajado de 11s
  // (se notaba lento con el pipeline de KB encima), luego se detectó que un
  // valor FIJO es el patrón más delator de todos — "cada cuántos segundos
  // contesta, no parece aleatorio, eso canta". Cada ráfaga recalcula un valor
  // nuevo al azar, nunca el mismo número de segundos dos veces.
  const AGGREGATE_SILENCE_MIN_MS = 4_000
  const AGGREGATE_SILENCE_MAX_MS = 8_000
  function nextAggregateSilenceMs() {
    return AGGREGATE_SILENCE_MIN_MS + Math.random() * (AGGREGATE_SILENCE_MAX_MS - AGGREGATE_SILENCE_MIN_MS)
  }
  const pendingByJid = new Map() // jid → { msgs: [], timer, epoch }

  function flushPending(jid) {
    const batch = pendingByJid.get(jid)
    pendingByJid.delete(jid)
    if (!batch || !batch.msgs.length) return
    if (!canAutoReplyNow(jid, batch.epoch)) return
    const chat = chats.get(jid)
    if (!chat) return

    // Cap de cola por JID: con agregación una ráfaga colapsa en un turno, pero el
    // techo sigue: si el modelo va lento y se apilan turnos, escalamos a manual.
    const pending = queueLenByJid.get(jid) || 0
    if (pending >= MAX_QUEUE_PER_JID) {
      chat.mode = 'manual'
      chat.escalationReason = 'user'
      markDirty()
      console.warn(`[wa-client] cola saturada para ${jid} (${pending} pendientes); escalado a manual`)
      emitter.emit('chat-updated', summarizeChat(jid))
      return
    }

    queueLenByJid.set(jid, pending + 1)
    const prev = inflightByJid.get(jid) || Promise.resolve()
    const next = prev.then(() => acquireSlot().then(() => respondTo(jid, batch.msgs, batch.epoch))).catch(() => {})
    const tracked = next.finally(() => {
      releaseSlot()
      const cur = queueLenByJid.get(jid) || 0
      if (cur <= 1) queueLenByJid.delete(jid)
      else queueLenByJid.set(jid, cur - 1)
      if (inflightByJid.get(jid) === tracked) inflightByJid.delete(jid)
    })
    inflightByJid.set(jid, tracked)
  }

  async function handleIncoming(raw) {
    if (!raw || !raw.from) return
    const jid = raw.from
    if (!isAuthorized(jid)) return // allowlist estricta

    const chat = ensureChat(jid)
    // Enriquecer identidad si el bridge nos pasa nombre/numero.
    // Orden de preferencia para mostrar: displayName → phoneNumber → displayNumber/JID.
    // Para grupos, raw.displayName viene del bridge como alias de chat (subject si está
    // disponible), mientras participantName identifica al autor del mensaje.
    if (raw.displayName && raw.displayName !== chat.displayName) { chat.displayName = String(raw.displayName); markDirty() }
    const safeIncomingPhone = sanitizePhoneForJid(jid, raw.phoneNumber)
    if (safeIncomingPhone && safeIncomingPhone !== chat.phoneNumber) { chat.phoneNumber = safeIncomingPhone; markDirty() }
    if (!safeIncomingPhone && chat.phoneNumber && isGroupJid(jid)) { chat.phoneNumber = ''; markDirty() }
    const msg = {
      id: raw.id,
      from: jid,
      fromMe: Boolean(raw.fromMe),
      timestamp: Number(raw.timestamp) || nowTs(),
      type: raw.type || 'text',
      body: raw.body || '',
      mediaPath: raw.mediaPath || null,
      source: raw.source || null,
      participant: raw.participant || null,
      participantName: raw.participantName || null,
      isGroup: Boolean(raw.isGroup),
      quotedMsg: raw.quotedMsg || null
    }

    // Grupos: nunca auto-reply, siempre manual. Persistimos historial y emitimos
    // pero no entramos en la lógica de hand-over ni de auto-reply.
    if (isGroupJid(jid)) {
      let modeFixed = false
      if (chat.mode !== 'manual') { chat.mode = 'manual'; modeFixed = true }
      if (chat.escalatedUntil) { chat.escalatedUntil = 0; modeFixed = true }
      if (chat.escalationReason !== 'user') { chat.escalationReason = 'user'; modeFixed = true }
      if (modeFixed) markDirty()

      if (msg.fromMe) {
        const added = pushHistory(chat, msg)
        if (added) emitNewMessage(jid, msg)
        else if (modeFixed) emitter.emit('chat-updated', summarizeChat(jid))
        return
      }
      const added = pushHistory(chat, msg)
      if (!added) {
        if (modeFixed) emitter.emit('chat-updated', summarizeChat(jid))
        return
      }
      chat.unread = (chat.unread || 0) + 1
      emitNewMessage(jid, msg)
      return
    }

    // Hand-over automático: si Luismi escribe desde otro lado, pasa a manual.
    if (msg.fromMe) {
      if (config.handoverOnFromMe) {
        chat.mode = 'manual'
        chat.escalationReason = 'user'
      }
      const added = pushHistory(chat, msg)
      if (added) emitNewMessage(jid, msg)
      return
    }

    const added = pushHistory(chat, msg)
    if (!added) return
    chat.unread = (chat.unread || 0) + 1
    emitNewMessage(jid, msg)

    if (!config.autoReply) return

    // Multimedia entrante (no audio) escala 5 min a manual. Audio sigue el flujo normal.
    const isEscalatingMedia = msg.type === 'image' || msg.type === 'video' || msg.type === 'document' || msg.type === 'sticker'
    if (isEscalatingMedia) {
      chat.mode = 'manual'
      chat.escalatedUntil = nowTs() + MEDIA_ESCALATION_SECS
      chat.escalationReason = 'media'
      markDirty()
      emitter.emit('chat-updated', summarizeChat(jid))
      return
    }

    // Si la escalada multimedia sigue vigente, no respondemos.
    if (chat.escalatedUntil && chat.escalatedUntil > nowTs()) return

    // Escalada ya vencida sobre texto entrante: volvemos a auto automáticamente.
    if (chat.mode === 'manual' && chat.escalatedUntil && chat.escalatedUntil <= nowTs() && chat.escalationReason === 'media') {
      chat.mode = 'auto'
      chat.escalatedUntil = 0
      chat.escalationReason = null
      markDirty()
      emitter.emit('chat-updated', summarizeChat(jid))
    }

    if (chat.mode !== 'auto') return

    // Acumular en la ventana de agrupación; el timer se reinicia con cada mensaje
    // del remitente y flushPending encola UN turno con todo el bloque.
    let batch = pendingByJid.get(jid)
    if (!batch) {
      batch = { msgs: [], timer: null, epoch: autoReplyEpoch }
      pendingByJid.set(jid, batch)
    }
    batch.msgs.push(msg)
    if (batch.timer) clearTimeout(batch.timer)
    batch.timer = setTimeout(() => flushPending(jid), nextAggregateSilenceMs())
    batch.timer.unref?.()
  }

  function canAutoReplyNow(jid, epoch) {
    const chat = chats.get(jid)
    if (!chat) return false
    if (!config.autoReply) return false
    if (epoch !== autoReplyEpoch) return false
    if (chat.mode !== 'auto') return false
    return true
  }

  function appendKbAudit(entry) {
    try {
      fs.appendFileSync(KB_AUDIT_PATH, JSON.stringify(entry) + '\n')
    } catch {}
  }

  // Escalada al humano: mensaje honesto fijo + chat a manual. Es el fail-safe de
  // TODO el modo KB: sin ficha, selector raro, verificación fallida o error → aquí.
  // notifyCustomer:false deja el chat escalado pero SIN avisar al cliente. Se usa
  // cuando el kill switch se pulsó con el turno en vuelo: el bot está silenciado,
  // así que el error interno no puede convertirse en un mensaje saliente.
  async function escalateToHuman(jid, chat, reason, { notifyCustomer = true } = {}) {
    chat.mode = 'manual'
    chat.escalationReason = 'user'
    chat.kbActive = null
    chat.kbClarify = null
    markDirty()
    emitter.emit('chat-updated', summarizeChat(jid))
    if (!notifyCustomer) return null
    const sent = await sendText(jid, config.kbEscalateText, { changeModeToManual: false, internal: true, source: 'claude' })
    emitAutoReplySent({ jid, ok: !!sent?.ok, mode: 'kb-escalado', reason, text: config.kbEscalateText, error: sent?.error || '' })
    return sent
  }

  // Pipeline KB: selector (haiku, índice) → respuesta anclada SOLO a las fichas
  // elegidas (kbAnswerModel) → verificación del marcador [KB:id] → envío.
  // Con "ficha activa": si el chat ya está resolviendo una ficha, los mensajes
  // siguientes van directos a ella (guía por pasos multi-turno) sin re-clasificar.
  async function respondFromKb({ jid, chat, msgs, promptBody, epoch, kbIndex }) {
    const audit = { ts: new Date().toISOString(), jid, msg: promptBody.slice(0, 400) }
    const batchIds = new Set(msgs.map((m) => m.id).filter(Boolean))
    const historyForPrompt = chat.history.filter((h) => !h || !batchIds.has(h.id))
    const runEnv = typeof buildRuntimeEnv === 'function' ? buildRuntimeEnv() : process.env
    const persona = personaText || 'Eres el asistente de Luismi por WhatsApp. Castellano de España, frases cortas.'

    // Devuelve 'sent' | 'ninguna' | 'cancelado' | 'escalated'
    const answerFromCards = async (ids) => {
      const cards = loadKbCards(KB_DIR, kbIndex, ids)
      if (!cards) { audit.mode = 'kb-escalado'; audit.reason = 'fichas-ilegibles'; await escalateToHuman(jid, chat, 'fichas-ilegibles'); return 'escalated' }
      const raw = await runClaudePersona({
        claudeBin,
        systemPrompt: persona + KB_ANSWER_RULES,
        prompt: buildGroundedPromptPrefix(cards) + buildPrompt({ displayNumber: chat.displayNumber, history: historyForPrompt, body: promptBody, maxHistory: config.maxHistory }),
        env: runEnv,
        model: config.kbAnswerModel || 'sonnet',
        timeoutMs: 90_000
      })
      if (!canAutoReplyNow(jid, epoch)) { audit.mode = 'cancelado'; return 'cancelado' }
      const verdict = verifyGroundedReply(raw, ids)
      audit.verdict = { ok: verdict.ok, reason: verdict.reason || '', ficha: verdict.usedId || '' }
      if (!verdict.ok) {
        if (verdict.reason === 'ninguna') return 'ninguna'
        audit.mode = 'kb-escalado'
        await escalateToHuman(jid, chat, verdict.reason || 'verificacion')
        return 'escalated'
      }
      const safe = sanitizeAutoReplyText(verdict.clean)
      if (!safe) { audit.mode = 'kb-escalado'; audit.reason = 'sanitize'; await escalateToHuman(jid, chat, 'sanitize'); return 'escalated' }
      const sent = await sendText(jid, safe, { changeModeToManual: false, internal: true, source: 'claude' })
      chat.kbActive = { ids: [verdict.usedId], since: nowTs() }
      chat.kbClarify = null // resuelto de verdad: se acabó cualquier ronda de aclaración pendiente
      markDirty()
      audit.mode = 'kb'
      audit.respuesta = safe.slice(0, 400)
      emitAutoReplySent({ jid, ok: !!sent?.ok, mode: 'kb', ficha: verdict.usedId, text: safe, error: sent?.error || '' })
      return 'sent'
    }

    try {
      // 1) Ficha activa vigente → seguir guiando por esa ficha.
      const activeIds = (chat.kbActive && Array.isArray(chat.kbActive.ids) && (nowTs() - (chat.kbActive.since || 0)) < KB_ACTIVE_TTL_SECS)
        ? chat.kbActive.ids.filter((id) => kbIndex.some((e) => e.id === id))
        : []
      if (activeIds.length) {
        audit.fichaActiva = activeIds
        const r = await answerFromCards(activeIds)
        if (r !== 'ninguna') return
        // [KB:ninguna] con ficha activa = cambio de tema o soluciones agotadas → re-clasificar.
        chat.kbActive = null
        markDirty()
      }

      // 2) Selector contra el índice completo (con historial: un mensaje vago
      // puede aclararse solo con el contexto de turnos anteriores).
      const selRaw = await runClaudePersona({
        claudeBin,
        systemPrompt: SELECTOR_SYSTEM,
        prompt: buildSelectorPrompt({ index: kbIndex, message: promptBody, history: historyForPrompt }),
        env: runEnv,
        model: 'haiku',
        timeoutMs: 30_000
      })
      const sel = parseSelectorResponse(selRaw, kbIndex.map((e) => e.id))
      audit.selector = sel
      if (!canAutoReplyNow(jid, epoch)) { audit.mode = 'cancelado'; return }

      if (sel.tipo === 'vago') {
        // Toca el tema de alguna ficha pero sin detalle: UNA pregunta de
        // aclaración antes de rendirnos (mensajes tipo "tengo un problema con
        // la batería" van a ser el caso más común, no la excepción — feedback
        // real de Luismi 2026-08-02). Tope de 1 intento: si sigue vago tras
        // preguntar, se escala de verdad.
        const { shouldAsk, next } = nextClarifyState(chat.kbClarify, nowTs())
        if (!shouldAsk) {
          audit.mode = 'kb-escalado'
          audit.reason = 'vago-agotado'
          await escalateToHuman(jid, chat, 'vago-agotado')
          return
        }
        chat.kbClarify = next
        markDirty()
        const text = await runClaudePersona({
          claudeBin,
          systemPrompt: persona + CLARIFY_RULES,
          prompt: buildPrompt({ displayNumber: chat.displayNumber, history: historyForPrompt, body: promptBody, maxHistory: config.maxHistory }),
          env: runEnv,
          model: config.model || 'haiku',
          effort: config.effort || ''
        })
        if (!canAutoReplyNow(jid, epoch)) { audit.mode = 'cancelado'; return }
        const safe = sanitizeAutoReplyText(text)
        if (!safe) { audit.mode = 'kb-escalado'; audit.reason = 'sanitize'; await escalateToHuman(jid, chat, 'sanitize'); return }
        const sent = await sendText(jid, safe, { changeModeToManual: false, internal: true, source: 'claude' })
        audit.mode = 'vago'
        emitAutoReplySent({ jid, ok: !!sent?.ok, mode: 'vago', text: safe, error: sent?.error || '' })
        return
      }

      if (sel.tipo === 'smalltalk') {
        const text = await runClaudePersona({
          claudeBin,
          systemPrompt: persona + SMALLTALK_RULES,
          prompt: buildPrompt({ displayNumber: chat.displayNumber, history: historyForPrompt, body: promptBody, maxHistory: config.maxHistory }),
          env: runEnv,
          model: config.model || 'haiku',
          effort: config.effort || ''
        })
        if (!canAutoReplyNow(jid, epoch)) { audit.mode = 'cancelado'; return }
        const safe = sanitizeAutoReplyText(text)
        if (!safe) { audit.mode = 'kb-escalado'; audit.reason = 'sanitize'; await escalateToHuman(jid, chat, 'sanitize'); return }
        const sent = await sendText(jid, safe, { changeModeToManual: false, internal: true, source: 'claude' })
        audit.mode = 'smalltalk'
        emitAutoReplySent({ jid, ok: !!sent?.ok, mode: 'smalltalk', text: safe, error: sent?.error || '' })
        return
      }

      if (sel.tipo !== 'kb') {
        audit.mode = 'kb-escalado'
        audit.reason = 'sin-ficha'
        await escalateToHuman(jid, chat, 'sin-ficha')
        return
      }

      const r = await answerFromCards(sel.ids)
      if (r === 'ninguna') {
        // La ficha elegida por el selector no cubre el caso según el modelo de respuesta.
        audit.mode = 'kb-escalado'
        audit.reason = 'kb-ninguna'
        await escalateToHuman(jid, chat, 'kb-ninguna')
      }
    } catch (err) {
      console.error('[whatsapp] KB error:', err?.message || err)
      audit.mode = 'kb-escalado'
      audit.reason = 'error:' + (err?.message || String(err)).slice(0, 120)
      // El kill switch se vuelve a mirar aquí: si Luismi pulsó BOT OFF mientras
      // el turno estaba en vuelo, el fallo posterior no puede colar un mensaje
      // al cliente. El chat sí se pasa a manual, que es lo que toca tras un error.
      const notifyCustomer = canAutoReplyNow(jid, epoch)
      if (!notifyCustomer) audit.mode = 'cancelado'
      try { await escalateToHuman(jid, chat, 'error', { notifyCustomer }) } catch {}
    } finally {
      appendKbAudit(audit)
    }
  }

  // msgs: bloque de mensajes agregados por la ventana de silencio (1..N, en orden).
  async function respondTo(jid, msgs, epoch) {
    const chat = chats.get(jid)
    if (!chat) return
    if (!canAutoReplyNow(jid, epoch)) return

    // Pre-check: si el binario claude no está disponible, no intentamos spawn.
    // Avisamos al cliente UNA vez cada CLAUDE_UNAVAILABLE_NOTIFY_MS (anti-spam) y
    // silenciamos los siguientes. Así el cliente sabe que estamos "k.o." sin que
    // Luismi reciba 30 mensajes idénticos.
    if (!claudeAvailable) {
      const nowMs = Date.now()
      const last = lastClaudeUnavailableNotifyByJid.get(jid) || 0
      if (nowMs - last >= CLAUDE_UNAVAILABLE_NOTIFY_MS) {
        lastClaudeUnavailableNotifyByJid.set(jid, nowMs)
        try {
          await sendText(jid, '[Auto-reply deshabilitado: CLI claude no disponible. Configúralo en Ajustes.]', { changeModeToManual: false, internal: true, source: 'claude' })
        } catch {}
      }
      return
    }

    // Cada mensaje del bloque se convierte en una línea; los audios se transcriben.
    const parts = []
    for (const m of msgs) {
      let part = m.body
      if (m.type === 'audio') {
        if (m.mediaPath && typeof transcribeAudio === 'function') {
          try {
            const text = await transcribeAudio(m.mediaPath)
            part = text || '[Audio del cliente, sin transcripción disponible]'
          } catch (err) {
            console.error('[whatsapp] transcripción falló:', err?.message || err)
            part = '[Audio del cliente, sin transcripción disponible]'
          }
        } else {
          part = '[Audio del cliente, sin transcripción disponible]'
        }
      }
      if (part && part.trim()) parts.push(part.trim())
    }
    const promptBody = parts.join('\n')

    if (!promptBody) return
    if (!canAutoReplyNow(jid, epoch)) return

    // ── Modo KB: si hay fichas, el bot SOLO resuelve lo que esté en ellas ──
    if (config.kbMode !== 'off') {
      let kbIndex = []
      try { kbIndex = loadKbIndex(KB_DIR) } catch {}
      if (kbIndex.length) {
        await respondFromKb({ jid, chat, msgs, promptBody, epoch, kbIndex })
        return
      }
      // Sin fichas legibles. Si el directorio kb/ EXISTE, la KB estaba montada y
      // algo se ha roto (borrada, renombrada, permisos, frontmatter inválido):
      // en strict eso se escala, NO se cae a la persona libre. El modo existe
      // precisamente para que el bot no invente pasos, precios ni plazos.
      // Si kb/ no existe es una instalación sin KB: se sigue como siempre.
      if (kbDirExists()) {
        console.warn('[whatsapp] kbMode strict: kb/ existe pero no hay fichas legibles → escalada a humano')
        try { await escalateToHuman(jid, chat, 'kb-ilegible') } catch {}
        return
      }
    }

    try {
      const text = await runClaudePersona({
        claudeBin,
        systemPrompt: personaText || 'Eres el asistente de Luismi por WhatsApp. Castellano de España, frases cortas.',
        prompt: buildPrompt({
          displayNumber: chat.displayNumber,
          // Fuera del historial los mensajes del propio bloque (van como mensaje
          // actual). Filtrar por id, no por posición: con ráfagas, "el último del
          // array" no es necesariamente el que estamos respondiendo.
          history: (() => {
            const batchIds = new Set(msgs.map((m) => m.id).filter(Boolean))
            return chat.history.filter((h) => !h || !batchIds.has(h.id))
          })(),
          body: promptBody,
          maxHistory: config.maxHistory
        }),
        env: typeof buildRuntimeEnv === 'function' ? buildRuntimeEnv() : process.env,
        model: config.model || '',
        effort: config.effort || ''
      })
      if (!canAutoReplyNow(jid, epoch)) return
      const safeReply = sanitizeAutoReplyText(text)
      if (!safeReply) {
        console.warn('[whatsapp] auto-reply bloqueado por tono agresivo; se usa fallback y se pasa a manual')
        chat.mode = 'manual'
        markDirty()
        emitter.emit('chat-updated', summarizeChat(jid))
        const sent = await sendText(jid, AUTO_REPLY_FALLBACK_TEXT, { changeModeToManual: false, internal: true, source: 'claude' })
        emitAutoReplySent({
          jid,
          ok: !!sent?.ok,
          mode: 'fallback',
          reason: 'sanitize',
          text: AUTO_REPLY_FALLBACK_TEXT,
          error: sent?.error || ''
        })
        return
      }
      const sent = await sendText(jid, safeReply, { changeModeToManual: false, internal: true, source: 'claude' })
      emitAutoReplySent({
        jid,
        ok: !!sent?.ok,
        mode: 'reply',
        text: safeReply,
        error: sent?.error || ''
      })
    } catch (err) {
      console.error('[whatsapp] auto-reply error:', err?.message || err)
      // Fallback defensivo: evita que el cliente se quede sin respuesta si falla Claude.
      try {
        const sent = await sendText(jid, AUTO_REPLY_FALLBACK_TEXT, { changeModeToManual: false, internal: true, source: 'claude' })
        emitAutoReplySent({
          jid,
          ok: !!sent?.ok,
          mode: 'fallback',
          reason: 'error',
          text: AUTO_REPLY_FALLBACK_TEXT,
          error: sent?.error || (err?.message || String(err))
        })
      } catch {}
    }
  }

  async function sendText(jid, text, opts = {}) {
    const { changeModeToManual = true, internal = false, source = 'luismi', quotedId = null } = opts
    const targetJid = numberToJid(jid)
    try {
      const payload = { to: targetJid, message: text }
      if (quotedId) payload.quotedId = quotedId
      // Solo las respuestas automáticas se humanizan (read receipt + typing con
      // jitter en el bridge); los envíos manuales del panel son Luismi real.
      if (internal) payload.humanize = true
      const res = internal
        ? await bridgeFetchWithRetry('POST', '/send/text', payload)
        : await bridgeFetch('POST', '/send/text', payload)
      const chat = ensureChat(targetJid)
      const msg = {
        id: res?.id || `local-${Date.now()}`,
        from: targetJid,
        fromMe: true,
        timestamp: nowTs(),
        type: 'text',
        body: text,
        mediaPath: null,
        source
      }
      const added = pushHistory(chat, msg)
      if (changeModeToManual && !internal) {
        chat.mode = 'manual'
        markDirty()
      }
      if (added) emitNewMessage(targetJid, msg)
      return { ok: true, id: msg.id }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  }

  async function sendMedia(jid, filePath, kind, extras = {}) {
    const targetJid = numberToJid(jid)
    let endpoint = ''
    let payload = { to: targetJid }
    const input = String(filePath || '')
    const inline = parseDataUrlBase64(input)
    let base64 = ''
    let filename = ''
    let mimeGuess = ''
    let mediaPathForHistory = null

    if (inline) {
      base64 = inline.base64
      mimeGuess = inline.mimetype || guessMime('', kind)
      filename = `${kind}-${Date.now()}`
    } else {
      if (!fs.existsSync(filePath)) return { ok: false, error: `Archivo no existe: ${filePath}` }
      const buf = fs.readFileSync(filePath)
      base64 = buf.toString('base64')
      filename = path.basename(filePath)
      mimeGuess = guessMime(filePath, kind)
      mediaPathForHistory = filePath
    }

    if (kind === 'image') {
      endpoint = '/send/image'
      payload = { ...payload, base64, mimetype: mimeGuess, caption: extras.caption || '' }
    } else if (kind === 'audio') {
      endpoint = '/send/audio'
      payload = { ...payload, base64, mimetype: mimeGuess, ptt: extras.ptt !== false }
    } else if (kind === 'video') {
      endpoint = '/send/video'
      payload = { ...payload, base64, mimetype: mimeGuess, caption: extras.caption || '' }
    } else if (kind === 'document') {
      endpoint = '/send/document'
      payload = { ...payload, base64, mimetype: mimeGuess, filename, caption: extras.caption || '' }
    } else {
      return { ok: false, error: `Tipo no soportado: ${kind}` }
    }

    try {
      const res = await bridgeFetch('POST', endpoint, payload)
      const chat = ensureChat(targetJid)
      const msg = {
        id: res?.id || `local-${Date.now()}`,
        from: targetJid,
        fromMe: true,
        timestamp: nowTs(),
        type: kind,
        body: extras.caption || filename,
        mediaPath: mediaPathForHistory
      }
      const added = pushHistory(chat, msg)
      chat.mode = 'manual'
      markDirty()
      if (added) emitNewMessage(targetJid, msg)
      return { ok: true, id: msg.id }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  }

  async function requestPhone(jid, opts = {}) {
    const { changeModeToManual = true } = opts || {}
    const targetJid = numberToJid(jid)
    try {
      const res = await bridgeFetch('POST', '/send/request-phone', { to: targetJid })
      const chat = ensureChat(targetJid)
      const msg = {
        id: res?.id || `local-${Date.now()}`,
        from: targetJid,
        fromMe: true,
        timestamp: nowTs(),
        type: 'text',
        body: '[Solicitud de teléfono enviada]',
        mediaPath: null
      }
      const added = pushHistory(chat, msg)
      if (changeModeToManual) {
        chat.mode = 'manual'
        markDirty()
      }
      if (added) emitNewMessage(targetJid, msg)
      return { ok: true, id: msg.id }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  }

  function guessMime(filePath, kind) {
    const ext = (path.extname(filePath) || '').toLowerCase()
    const map = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp',
      '.mp4': 'video/mp4', '.mov': 'video/quicktime',
      '.ogg': 'audio/ogg; codecs=opus', '.opus': 'audio/ogg; codecs=opus',
      '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
      '.pdf': 'application/pdf'
    }
    if (map[ext]) return map[ext]
    if (kind === 'image') return 'image/jpeg'
    if (kind === 'audio') return 'audio/ogg; codecs=opus'
    if (kind === 'video') return 'video/mp4'
    return 'application/octet-stream'
  }

  function setMode(jid, mode) {
    const targetJid = numberToJid(jid)
    const chat = ensureChat(targetJid)

    if (isGroupJid(targetJid)) {
      const changed = chat.mode !== 'manual' || chat.escalatedUntil !== 0 || chat.escalationReason !== 'user'
      chat.mode = 'manual'
      chat.escalatedUntil = 0
      chat.escalationReason = 'user'
      if (changed) markDirty()
      emitter.emit('chat-updated', summarizeChat(targetJid))
      return { ok: true, mode: 'manual', fixed: true }
    }

    chat.mode = mode === 'manual' ? 'manual' : 'auto'
    if (chat.mode === 'auto') {
      chat.escalatedUntil = 0
      chat.escalationReason = null
    } else {
      // Manual puesto explícitamente por el usuario: el sweep NUNCA debe revertirlo.
      chat.escalationReason = 'user'
    }
    markDirty()
    emitter.emit('chat-updated', summarizeChat(targetJid))
    return { ok: true, mode: chat.mode }
  }

  function setAllIndividualChatsAuto() {
    let changed = 0
    let totalIndividual = 0
    for (const chat of chats.values()) {
      if (!chat || !chat.jid) continue

      if (isGroupJid(chat.jid)) {
        const groupChanged = chat.mode !== 'manual' || chat.escalatedUntil !== 0 || chat.escalationReason !== 'user'
        if (groupChanged) {
          chat.mode = 'manual'
          chat.escalatedUntil = 0
          chat.escalationReason = 'user'
          markDirty()
          emitter.emit('chat-updated', summarizeChat(chat.jid))
        }
        continue
      }

      totalIndividual += 1
      const chatChanged = chat.mode !== 'auto' || chat.escalatedUntil !== 0 || chat.escalationReason !== null
      if (!chatChanged) continue

      chat.mode = 'auto'
      chat.escalatedUntil = 0
      chat.escalationReason = null
      markDirty()
      changed += 1
      emitter.emit('chat-updated', summarizeChat(chat.jid))
    }
    return { ok: true, changed, totalIndividual }
  }

  function markRead(jid) {
    const targetJid = numberToJid(jid)
    const chat = ensureChat(targetJid)
    chat.unread = 0
    markDirty()
    emitter.emit('chat-updated', summarizeChat(targetJid))
    return { ok: true }
  }

  function getChats() {
    return Array.from(chats.values())
      .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
      .map((c) => {
        const last = c.history.length ? c.history[c.history.length - 1] : null
        return {
          jid: c.jid,
          displayNumber: c.displayNumber,
          displayName: c.displayName || '',
          phoneNumber: c.phoneNumber || '',
          mode: c.mode,
          unread: c.unread || 0,
          lastActivity: c.lastActivity || 0,
          isGroup: c.isGroup || false,
          lastMessage: last ? {
            body: last.body,
            type: last.type,
            timestamp: last.timestamp,
            fromMe: last.fromMe
          } : null
        }
      })
  }

  function getHistory(jid, { limit = 100 } = {}) {
    const targetJid = numberToJid(jid)
    const chat = chats.get(targetJid)
    if (!chat) return []
    const list = chat.history.slice(-limit)
    return list.map(decorateMessage)
  }

  async function getStatus() {
    let connected = false
    let qrPresent = false
    try {
      const data = await bridgeFetch('GET', '/status')
      connected = data?.status === 'ready'
      qrPresent = data?.status === 'qr'
      emitStatus(data?.status || 'disconnected')
    } catch {
      emitStatus('disconnected')
    }
    return {
      connected,
      qrPresent,
      status: lastStatus,
      ownerNumber: config.ownerNumber,
      authorizedNumbers: config.authorizedNumbers.slice(),
      autoReply: config.autoReply,
      model: config.model || '',
      effort: config.effort || ''
    }
  }

  async function getQr() {
    try {
      const data = await bridgeFetch('GET', '/qr')
      return { qr: data?.qr || null, qrAscii: data?.qrAscii || null, status: data?.status || lastStatus }
    } catch (err) {
      return { qr: null, qrAscii: null, status: 'disconnected', error: err?.message }
    }
  }

  function getConfig() {
    return { ...config }
  }

  function updateConfig(next) {
    const prevAutoReply = config.autoReply !== false
    // Merge sobre la config EN MEMORIA, no sobre la del disco. handleBridgeAuthError
    // apaga autoReply solo en memoria; con el merge desde disco, guardar cualquier
    // cosa del modal (modelo, persona, allowlist) resucitaba el bot.
    config = saveConfig({ ...config, ...(next || {}) })
    const nextAutoReply = config.autoReply !== false
    if (prevAutoReply && !nextAutoReply) autoReplyEpoch += 1
    // Si el operador vuelve a encender el bot, el kill switch de auth tiene que
    // poder dispararse otra vez; si no, authErrorReported lo deja mudo para siempre.
    if (!prevAutoReply && nextAutoReply) authErrorReported = false
    claudeBin = config.claudePath
    checkClaudeBinary()
    loadPersona()
    emitter.emit('chat-updated', { jid: null }) // refresh global
    return config
  }

  function sweepEscalations() {
    const now = nowTs()
    let changed = false
    for (const chat of chats.values()) {
      // Solo revertir escaladas multimedia vencidas. Manual puesto por el usuario
      // (escalationReason='user') nunca se toca: Luismi decide cuándo volver a auto.
      if (chat.mode === 'manual' && chat.escalationReason === 'media' && chat.escalatedUntil && chat.escalatedUntil <= now) {
        chat.mode = 'auto'
        chat.escalatedUntil = 0
        chat.escalationReason = null
        markDirty()
        changed = true
        console.log(`[wa-client] sweep: chat ${chat.jid} revertido a auto (escalada multimedia vencida)`)
        emitter.emit('chat-updated', summarizeChat(chat.jid))
      }
    }
    if (changed) persistState()
  }

  function start() {
    if (!stopped && pollTimer) return // ya activo
    stopped = false
    pollBackoffMs = POLL_MS
    authErrorReported = false
    fs.mkdirSync(BRIDGE_DIR, { recursive: true })
    // Carga token de auth (si existe). Si no existe, el primer fetch fallará con
    // 401 y el bridge debería generarlo; el siguiente intento lo encontrará en
    // disco. Si el bridge no está corriendo, los fetch fallan por conexión.
    loadAuthTokenFromDisk()
    if (!cachedAuthToken) {
      console.warn('[whatsapp] no auth token in disk at', AUTH_TOKEN_PATH, '— se intentará releer tras el primer fetch')
    }
    config = loadConfig()
    claudeBin = config.claudePath
    checkClaudeBinary()
    loadPersona()
    loadState()
    // No vaciamos el inbox al arrancar: si la app estaba cerrada y llegaron
    // mensajes, queremos procesarlos. El dedupe por id+firma evita repetir.
    pollStatus().catch(() => {})
    pollTimer = setTimeout(pollMessages, 250)
    pollTimer.unref?.()
    statusTimer = setInterval(() => pollStatus().catch(() => {}), STATUS_POLL_MS)
    statusTimer.unref?.()
    flushTimer = setInterval(persistState, STATE_FLUSH_MS)
    flushTimer.unref?.()
    escalationSweepTimer = setInterval(sweepEscalations, ESCALATION_SWEEP_MS)
    escalationSweepTimer.unref?.()
  }

  function stop() {
    stopped = true
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null }
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
    if (escalationSweepTimer) { clearInterval(escalationSweepTimer); escalationSweepTimer = null }
    for (const b of pendingByJid.values()) { if (b.timer) clearTimeout(b.timer) }
    pendingByJid.clear()
    stopPersonaWatcher()
    persistState()
  }

  // Flush de estado en SIGINT/SIGTERM. Sólo registramos una vez por proceso
  // aunque se creen múltiples clientes.
  if (!process._waSignalHandlersRegistered) {
    const flushAndForget = () => { try { persistState() } catch {} }
    process.once('SIGINT', flushAndForget)
    process.once('SIGTERM', flushAndForget)
    process._waSignalHandlersRegistered = true
  }

  return {
    on: (ev, cb) => emitter.on(ev, cb),
    off: (ev, cb) => emitter.off(ev, cb),
    start,
    stop,
    getStatus,
    getQr,
    getChats,
    getHistory,
    sendText,
    sendMedia,
    requestPhone,
    setMode,
    setAllIndividualChatsAuto,
    markRead,
    getConfig,
    updateConfig,
    get mediaDir() { return MEDIA_DIR },
    get mediaProtocol() { return MEDIA_PROTOCOL }
  }
}

module.exports = {
  createWhatsAppClient,
  MEDIA_DIR,
  MEDIA_PROTOCOL,
  BRIDGE_DIR,
  CONFIG_PATH,
  STATE_PATH,
  __private: {
    jidServer,
    isGroupJid,
    isLidJid,
    isPnJid,
    jidToNumber,
    jidLocalId,
    sanitizePhoneForJid,
    deriveDisplayNumber,
    isSafeToResend,
    bridgeFetchWithRetry,
    sanitizeAutoReplyText,
    kbDirExists
  }
}
