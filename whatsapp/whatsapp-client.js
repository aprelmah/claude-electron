const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const { EventEmitter } = require('events')
const { runClaudePersona, buildPrompt } = require('./whatsapp-auto-reply')

const BRIDGE_URL = 'http://127.0.0.1:3031'
const BRIDGE_DIR = path.join(os.homedir(), '.claude', 'whatsapp-bridge')
const CONFIG_PATH = path.join(BRIDGE_DIR, 'config.json')
const STATE_PATH = path.join(BRIDGE_DIR, 'state.json')
const MEDIA_DIR = path.join(BRIDGE_DIR, 'media')
const POLL_MS = 1500
const STATUS_POLL_MS = 5000
const STATE_FLUSH_MS = 5000
const HISTORY_MAX = 200
const MEDIA_ESCALATION_SECS = 300 // 5 min en manual tras adjunto de cliente
const MAX_PARALLEL_REPLIES = 3
const PERSONA_RELOAD_DEBOUNCE_MS = 500
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
    handoverOnFromMe: src.handoverOnFromMe !== false
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

function jidToNumber(jid) {
  if (!jid) return ''
  const s = String(jid)
  // @lid es un identificador enmascarado de WhatsApp, no teléfono real.
  if (s.endsWith('@lid')) return ''
  return s.split('@')[0].replace(/\D/g, '')
}

function jidLocalId(jid) {
  if (!jid) return ''
  return String(jid).split('@')[0] || ''
}

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '')
}

function sanitizePhoneForJid(jid, phone) {
  const s = String(phone || '').trim()
  if (!s) return ''
  if (String(jid || '').endsWith('@lid')) {
    const local = digitsOnly(jidLocalId(jid))
    if (local && digitsOnly(s) === local) return ''
  }
  return s
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
  const compact = String(text || '').replace(/\s+/g, ' ').trim()
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

function bridgeFetch(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : null
    const headers = {}
    if (payload) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = payload.length
    }
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

function createWhatsAppClient({ transcribeAudio, buildRuntimeEnv } = {}) {
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
  let personaText = ''
  let personaWatcher = null
  let personaWatchedPath = ''
  let personaReloadTimer = null
  // Cola por JID: respuestas al MISMO cliente se serializan; entre clientes,
  // hasta MAX_PARALLEL_REPLIES en vuelo (semáforo global).
  const inflightByJid = new Map()
  let inflightCount = 0
  const inflightWaiters = []

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
    for (const c of data.chats) {
      if (!c || !c.jid) continue
      const safePhone = sanitizePhoneForJid(c.jid, c.phoneNumber)
      chats.set(c.jid, {
        jid: c.jid,
        displayNumber: c.displayNumber || jidToNumber(c.jid) || jidLocalId(c.jid),
        // Identidad mejorada: nombre del contacto / pushName y número real (si se pudo resolver).
        displayName: typeof c.displayName === 'string' ? c.displayName : '',
        phoneNumber: safePhone,
        mode: c.mode === 'manual' ? 'manual' : 'auto',
        unread: Number(c.unread) || 0,
        history: Array.isArray(c.history) ? c.history.slice(-HISTORY_MAX) : [],
        lastActivity: Number(c.lastActivity) || 0,
        escalatedUntil: Number(c.escalatedUntil) || 0,
        isGroup: typeof c.isGroup === 'boolean' ? c.isGroup : String(c.jid).endsWith('@g.us')
      })
    }
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
      c = {
        jid,
        displayNumber: jidToNumber(jid) || jidLocalId(jid),
        displayName: '',
        phoneNumber: '',
        mode: 'auto',
        unread: 0,
        history: [],
        lastActivity: 0,
        escalatedUntil: 0,
        isGroup: jid.endsWith('@g.us')
      }
      chats.set(jid, c)
    }
    return c
  }

function isAuthorized(jid) {
    // Grupos: los JIDs `@g.us` no tienen número de teléfono asociado y no caben
    // en la allowlist individual. Si Luismi quiere bloquear un grupo concreto lo
    // hará por otra vía (mute, salir del grupo).
    if (jid && String(jid).endsWith('@g.us')) return true
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

  async function handleIncoming(raw) {
    if (!raw || !raw.from) return
    const jid = raw.from
    if (!isAuthorized(jid)) return // allowlist estricta

    const chat = ensureChat(jid)
    // Enriquecer identidad si el bridge nos pasa nombre/numero.
    // Orden de preferencia para mostrar: displayName → phoneNumber → displayNumber/JID.
    if (raw.displayName && raw.displayName !== chat.displayName) { chat.displayName = String(raw.displayName); markDirty() }
    const safeIncomingPhone = sanitizePhoneForJid(jid, raw.phoneNumber)
    if (safeIncomingPhone && safeIncomingPhone !== chat.phoneNumber) { chat.phoneNumber = safeIncomingPhone; markDirty() }
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
    if (jid.endsWith('@g.us')) {
      if (msg.fromMe) {
        const added = pushHistory(chat, msg)
        if (added) emitNewMessage(jid, msg)
        return
      }
      const added = pushHistory(chat, msg)
      if (!added) return
      chat.unread = (chat.unread || 0) + 1
      emitNewMessage(jid, msg)
      return
    }

    // Hand-over automático: si Luismi escribe desde otro lado, pasa a manual.
    if (msg.fromMe) {
      if (config.handoverOnFromMe) chat.mode = 'manual'
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
      markDirty()
      emitter.emit('chat-updated', summarizeChat(jid))
      return
    }

    // Si la escalada multimedia sigue vigente, no respondemos.
    if (chat.escalatedUntil && chat.escalatedUntil > nowTs()) return

    // Escalada ya vencida sobre texto entrante: volvemos a auto automáticamente.
    if (chat.mode === 'manual' && chat.escalatedUntil && chat.escalatedUntil <= nowTs()) {
      chat.mode = 'auto'
      chat.escalatedUntil = 0
      markDirty()
      emitter.emit('chat-updated', summarizeChat(jid))
    }

    if (chat.mode !== 'auto') return

    // Serializamos por JID y respetamos semáforo global. Fire-and-forget para no
    // bloquear el poll: el siguiente cliente puede entrar en paralelo.
    const prev = inflightByJid.get(jid) || Promise.resolve()
    const next = prev.then(() => acquireSlot().then(() => respondTo(jid, msg))).catch(() => {})
    const tracked = next.finally(() => {
      releaseSlot()
      if (inflightByJid.get(jid) === tracked) inflightByJid.delete(jid)
    })
    inflightByJid.set(jid, tracked)
  }

  async function respondTo(jid, msg) {
    const chat = chats.get(jid)
    if (!chat) return

    let promptBody = msg.body
    if (msg.type === 'audio') {
      if (msg.mediaPath && typeof transcribeAudio === 'function') {
        try {
          const text = await transcribeAudio(msg.mediaPath)
          promptBody = text || '[Audio del cliente, sin transcripción disponible]'
        } catch (err) {
          console.error('[whatsapp] transcripción falló:', err?.message || err)
          promptBody = '[Audio del cliente, sin transcripción disponible]'
        }
      } else {
        promptBody = '[Audio del cliente, sin transcripción disponible]'
      }
    }

    if (!promptBody || !promptBody.trim()) return

    try {
      const text = await runClaudePersona({
        claudeBin,
        systemPrompt: personaText || 'Eres el asistente de Luismi por WhatsApp. Castellano de España, frases cortas.',
        prompt: buildPrompt({
          displayNumber: chat.displayNumber,
          history: chat.history.slice(0, -1), // sin el último, que es el mensaje recién recibido
          body: promptBody,
          maxHistory: config.maxHistory
        }),
        env: typeof buildRuntimeEnv === 'function' ? buildRuntimeEnv() : process.env,
        model: config.model || '',
        effort: config.effort || ''
      })
      const safeReply = sanitizeAutoReplyText(text)
      if (!safeReply) {
        console.warn('[whatsapp] auto-reply bloqueado por tono agresivo; se usa fallback y se pasa a manual')
        chat.mode = 'manual'
        markDirty()
        emitter.emit('chat-updated', summarizeChat(jid))
        await sendText(jid, AUTO_REPLY_FALLBACK_TEXT, { changeModeToManual: false, internal: true, source: 'claude' })
        return
      }
      await sendText(jid, safeReply, { changeModeToManual: false, internal: true, source: 'claude' })
    } catch (err) {
      console.error('[whatsapp] auto-reply error:', err?.message || err)
      // Fallback defensivo: evita que el cliente se quede sin respuesta si falla Claude.
      try {
        await sendText(jid, AUTO_REPLY_FALLBACK_TEXT, { changeModeToManual: false, internal: true, source: 'claude' })
      } catch {}
    }
  }

  async function sendText(jid, text, opts = {}) {
    const { changeModeToManual = true, internal = false, source = 'luismi', quotedId = null } = opts
    const targetJid = numberToJid(jid)
    try {
      const payload = { to: targetJid, message: text }
      if (quotedId) payload.quotedId = quotedId
      const res = await bridgeFetch('POST', '/send/text', payload)
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
    chat.mode = mode === 'manual' ? 'manual' : 'auto'
    if (chat.mode === 'auto') chat.escalatedUntil = 0
    markDirty()
    emitter.emit('chat-updated', summarizeChat(targetJid))
    return { ok: true, mode: chat.mode }
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
      return { qr: data?.qr || null, status: data?.status || lastStatus }
    } catch (err) {
      return { qr: null, status: 'disconnected', error: err?.message }
    }
  }

  function getConfig() {
    return { ...config }
  }

  function updateConfig(next) {
    config = saveConfig(next || {})
    claudeBin = config.claudePath
    loadPersona()
    emitter.emit('chat-updated', { jid: null }) // refresh global
    return config
  }

  function start() {
    if (!stopped && pollTimer) return // ya activo
    stopped = false
    pollBackoffMs = POLL_MS
    fs.mkdirSync(BRIDGE_DIR, { recursive: true })
    config = loadConfig()
    claudeBin = config.claudePath
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
  }

  function stop() {
    stopped = true
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null }
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
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
  STATE_PATH
}
