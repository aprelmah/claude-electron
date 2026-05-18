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
const ESCALATION_WINDOW_MS = 5 * 60_000

const MEDIA_PROTOCOL = 'wa-media'

function nowTs() { return Math.floor(Date.now() / 1000) }

function safeRead(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

function safeWrite(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('[whatsapp] state write failed:', err?.message || err)
    return false
  }
}

function loadConfig() {
  const raw = safeRead(CONFIG_PATH) || {}
  return {
    autoReply: raw.autoReply !== false,
    authorizedNumbers: Array.isArray(raw.authorizedNumbers) ? raw.authorizedNumbers.map(String) : [],
    claudePath: raw.claudePath || path.join(os.homedir(), '.local/bin/claude'),
    ownerNumber: raw.ownerNumber || '',
    maxHistory: Number.isFinite(raw.maxHistory) ? raw.maxHistory : 20,
    personaPath: raw.personaPath || path.join(BRIDGE_DIR, 'persona.md')
  }
}

function saveConfig(next) {
  const current = loadConfig()
  const merged = { ...current, ...next }
  fs.mkdirSync(BRIDGE_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

function jidToNumber(jid) {
  if (!jid) return ''
  return String(jid).split('@')[0].replace(/\D/g, '')
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

function bridgeFetch(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : null
    const headers = {}
    if (payload) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = payload.length
    }
    const req = http.request({
      host: '127.0.0.1',
      port: 3031,
      method,
      path: urlPath,
      headers,
      timeout: 30000
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

  function loadPersona() {
    try { personaText = fs.readFileSync(config.personaPath, 'utf-8') }
    catch { personaText = '' }
  }

  function loadState() {
    const data = safeRead(STATE_PATH)
    chats = new Map()
    if (!data || !Array.isArray(data.chats)) return
    for (const c of data.chats) {
      if (!c || !c.jid) continue
      chats.set(c.jid, {
        jid: c.jid,
        displayNumber: c.displayNumber || jidToNumber(c.jid),
        mode: c.mode === 'manual' ? 'manual' : 'auto',
        unread: Number(c.unread) || 0,
        history: Array.isArray(c.history) ? c.history.slice(-HISTORY_MAX) : [],
        lastActivity: Number(c.lastActivity) || 0,
        escalatedUntil: Number(c.escalatedUntil) || 0
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
        displayNumber: jidToNumber(jid),
        mode: 'auto',
        unread: 0,
        history: [],
        lastActivity: 0,
        escalatedUntil: 0
      }
      chats.set(jid, c)
    }
    return c
  }

  function isAuthorized(jid) {
    const num = jidToNumber(jid)
    if (!num) return false
    if (!config.authorizedNumbers || !config.authorizedNumbers.length) return true
    return config.authorizedNumbers.includes(num)
  }

  function pushHistory(chat, msg) {
    chat.history.push(msg)
    if (chat.history.length > HISTORY_MAX) {
      chat.history = chat.history.slice(-HISTORY_MAX)
    }
    chat.lastActivity = msg.timestamp || nowTs()
    markDirty()
  }

  function emitNewMessage(jid, msg) {
    emitter.emit('new-message', { jid, message: decorateMessage(msg) })
    emitter.emit('chat-updated', { jid })
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
    const msg = {
      id: raw.id,
      from: jid,
      fromMe: Boolean(raw.fromMe),
      timestamp: Number(raw.timestamp) || nowTs(),
      type: raw.type || 'text',
      body: raw.body || '',
      mediaPath: raw.mediaPath || null
    }

    // Hand-over automático: si Luismi escribe desde otro lado, pasa a manual.
    if (msg.fromMe) {
      chat.mode = 'manual'
      pushHistory(chat, msg)
      emitNewMessage(jid, msg)
      return
    }

    chat.unread = (chat.unread || 0) + 1
    pushHistory(chat, msg)
    emitNewMessage(jid, msg)

    // Decisión auto-respuesta
    if (!config.autoReply) return
    if (chat.mode !== 'auto') return
    if (chat.escalatedUntil && Date.now() < chat.escalatedUntil) return

    // Tipos no soportados → escalar 5min
    if (msg.type === 'image' || msg.type === 'video' || msg.type === 'document' || msg.type === 'sticker') {
      chat.escalatedUntil = Date.now() + ESCALATION_WINDOW_MS
      chat.mode = 'manual'
      markDirty()
      emitter.emit('chat-updated', { jid })
      return
    }

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
        env: typeof buildRuntimeEnv === 'function' ? buildRuntimeEnv() : process.env
      })
      if (!text || !text.trim()) return
      await sendText(jid, text.trim(), { changeModeToManual: false, internal: true })
    } catch (err) {
      console.error('[whatsapp] auto-reply error:', err?.message || err)
    }
  }

  async function sendText(jid, text, opts = {}) {
    const { changeModeToManual = true, internal = false } = opts
    const targetJid = numberToJid(jid)
    try {
      const res = await bridgeFetch('POST', '/send/text', { to: targetJid, message: text })
      const chat = ensureChat(targetJid)
      const msg = {
        id: res?.id || `local-${Date.now()}`,
        from: targetJid,
        fromMe: true,
        timestamp: nowTs(),
        type: 'text',
        body: text,
        mediaPath: null
      }
      pushHistory(chat, msg)
      if (changeModeToManual && !internal) {
        chat.mode = 'manual'
        markDirty()
      }
      emitNewMessage(targetJid, msg)
      return { ok: true, id: msg.id }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  }

  async function sendMedia(jid, filePath, kind, extras = {}) {
    const targetJid = numberToJid(jid)
    if (!fs.existsSync(filePath)) return { ok: false, error: `Archivo no existe: ${filePath}` }
    let endpoint = ''
    let payload = { to: targetJid }
    const buf = fs.readFileSync(filePath)
    const base64 = buf.toString('base64')
    const filename = path.basename(filePath)
    const mimeGuess = guessMime(filePath, kind)
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
        mediaPath: filePath
      }
      pushHistory(chat, msg)
      chat.mode = 'manual'
      markDirty()
      emitNewMessage(targetJid, msg)
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
    emitter.emit('chat-updated', { jid: targetJid })
    return { ok: true, mode: chat.mode }
  }

  function markRead(jid) {
    const targetJid = numberToJid(jid)
    const chat = ensureChat(targetJid)
    chat.unread = 0
    markDirty()
    emitter.emit('chat-updated', { jid: targetJid })
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
      autoReply: config.autoReply
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
    // Limpia inbox al arrancar para no procesar viejos.
    bridgeFetch('DELETE', '/messages').catch(() => {})
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
    persistState()
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
