// Bot de avisos de automatizaciones, SEPARADO del bridge principal de Telegram.
// Razón de existir (2026-08-06): las notificaciones de tareas programadas
// reclamaban el slot de sesión del chat (rememberRunForChat + pool oculto) y
// pisaban la conversación en curso. Este bot solo empuja avisos; el enganche
// a la sesión del run es EXPLÍCITO: botón inline «Continuar esta sesión»
// cuyo callback ejecuta onContinueSession (adopt + pool) en el bridge principal.
// El binding nunca cambia como efecto colateral de un aviso.
const fs = require('fs')
const path = require('path')
const https = require('https')
const { sanitizeChannelText } = require('./untrusted-input')

const STATE_FILE = 'telegram-notify-state.json'
const COURTESY_WINDOW_MS = 10 * 60 * 1000
// Tras pulsar «Continuar esta sesión», el chat de avisos queda conversacional
// con ESA sesión durante esta ventana (deslizante: cada mensaje la renueva).
// Pedido por Luismi 2026-08-06: una automatización puede necesitar respuesta
// suya, y el sitio natural para dársela es donde llegó el aviso.
const HOT_WINDOW_MS = 30 * 60 * 1000
const POLL_TIMEOUT_SEC = 25
const ERROR_BACKOFF_MS = 3000
const IDLE_SLEEP_MS = 25

function defaultPostJson(url, payload, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      reject(err)
      return
    }
    const target = new URL(url)
    const body = Buffer.from(JSON.stringify(payload || {}))
    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length }
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('error', reject)
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try {
          resolve(raw ? JSON.parse(raw) : {})
        } catch (err) {
          reject(new Error(`Respuesta JSON invalida: ${err?.message || err}`))
        }
      })
    })
    const onAbort = () => {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      req.destroy(err)
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', reject)
    req.on('close', () => {
      if (signal) signal.removeEventListener('abort', onAbort)
    })
    req.write(body)
    req.end()
  })
}

function createTelegramNotifyBot({
  token,
  stateDir,
  getAllowedUsers,
  onContinueSession,
  onUserReply,
  nowFn = Date.now,
  postJson = defaultPostJson
} = {}) {
  if (!token) throw new Error('notify-bot: falta token')
  const statePath = stateDir ? path.join(stateDir, STATE_FILE) : null
  const pending = new Map() // key -> { sessionId, cli, cwd, taskName, chatId }
  const lastCourtesyByChat = new Map() // chatId -> ts
  const hotByChat = new Map() // chatId -> { info, until } tras «Continuar»
  const replyChainByChat = new Map() // chatId -> Promise (serializa turnos)
  let offset = 0
  let running = false
  let seq = 0
  let loopPromise = null
  let abortCurrent = null

  try {
    if (statePath && fs.existsSync(statePath)) {
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      if (Number.isInteger(saved?.offset) && saved.offset > 0) offset = saved.offset
    }
  } catch {}

  function saveOffset() {
    if (!statePath) return
    try { fs.writeFileSync(statePath, JSON.stringify({ offset }), { mode: 0o600 }) } catch {}
  }

  async function api(method, payload) {
    const data = await postJson(`https://api.telegram.org/bot${token}/${method}`, payload || {}, abortCurrent?.signal)
    if (data && data.ok === false) {
      const err = new Error(`Telegram ${method}: ${data.description || 'error'}`)
      err.errorCode = data.error_code
      throw err
    }
    return data?.result
  }

  function isAllowed(userId) {
    let users = []
    try { users = getAllowedUsers ? getAllowedUsers() : [] } catch {}
    const list = users instanceof Set ? [...users] : Array.isArray(users) ? users : []
    return list.map((u) => String(u)).includes(String(userId))
  }

  async function sendTaskNotification({ chatId, text, session } = {}) {
    if (!chatId || !text) return { ok: false, error: 'chatId/text requeridos' }
    const payload = { chat_id: chatId, text: String(text).slice(0, 4000) }
    if (session && session.sessionId) {
      const key = `${++seq}.${Date.now().toString(36)}`
      pending.set(key, {
        sessionId: session.sessionId,
        cli: session.cli || 'claude',
        cwd: session.cwd || '',
        taskName: session.taskName || '',
        chatId
      })
      payload.reply_markup = {
        inline_keyboard: [[{ text: '▶️ Continuar esta sesión', callback_data: `cont:${key}` }]]
      }
    }
    await api('sendMessage', payload)
    return { ok: true }
  }

  async function answerCallback(cbId, text) {
    try { await api('answerCallbackQuery', { callback_query_id: cbId, text: String(text).slice(0, 190) }) } catch {}
  }

  async function handleCallback(cb) {
    const cbId = cb?.id
    const data = String(cb?.data || '')
    if (!data.startsWith('cont:')) {
      await answerCallback(cbId, 'Acción desconocida.')
      return
    }
    if (!isAllowed(cb?.from?.id)) {
      await answerCallback(cbId, 'No autorizado.')
      return
    }
    const info = pending.get(data.slice(5))
    if (!info) {
      await answerCallback(cbId, 'Aviso antiguo: la sesión ya no está disponible.')
      return
    }
    const chatId = cb?.message?.chat?.id != null ? cb.message.chat.id : info.chatId
    try {
      const res = await onContinueSession({ ...info, chatId })
      if (res && res.ok === false) {
        await answerCallback(cbId, `No pude enlazar: ${res.error || 'error'}`)
        return
      }
      pending.delete(data.slice(5))
      // Abrir ventana conversacional: a partir de aquí puede responder AQUÍ.
      hotByChat.set(String(chatId), { info: { ...info, chatId }, until: nowFn() + HOT_WINDOW_MS })
      await answerCallback(cbId, '✅ Sesión enlazada.')
      try {
        await api('sendMessage', {
          chat_id: chatId,
          text: `▶️ Sesión de «${info.taskName || 'la tarea'}» enlazada. Respóndeme AQUÍ para continuarla (ventana de 30 min; también puedes seguir en el bot principal).`
        })
      } catch {}
      // Best effort: quitar el botón para que no se pulse dos veces.
      if (cb?.message?.message_id != null && cb?.message?.chat?.id != null) {
        try {
          await api('editMessageReplyMarkup', {
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            reply_markup: { inline_keyboard: [] }
          })
        } catch {}
      }
    } catch (err) {
      await answerCallback(cbId, `No pude enlazar: ${err?.message || err}`)
    }
  }

  async function handleMessage(msg) {
    const chatId = msg?.chat?.id
    const fromId = msg?.from?.id
    if (chatId == null || !isAllowed(fromId)) return
    const key = String(chatId)
    // Saneado de canal: este texto viaja a un turno de la sesión enlazada
    // (PTY oculto o headless). Limpieza sin bloqueo, igual que el bridge.
    const text = typeof msg?.text === 'string' ? sanitizeChannelText(msg.text).text.trim() : ''

    // Ventana conversacional abierta con «Continuar» → el texto es un turno
    // de la sesión enlazada y la respuesta vuelve por ESTE chat.
    const hot = hotByChat.get(key)
    if (hot && hot.until > nowFn() && text && typeof onUserReply === 'function') {
      hot.until = nowFn() + HOT_WINDOW_MS // deslizante: hablar la renueva
      const prev = replyChainByChat.get(key) || Promise.resolve()
      const turn = prev.then(async () => {
        const typing = setInterval(() => {
          api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {})
        }, 4000)
        api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {})
        try {
          const res = await onUserReply({ chatId, text, session: { ...hot.info } })
          const out = (res && typeof res.text === 'string' && res.text.trim()) ? res.text : '(sin respuesta)'
          await api('sendMessage', { chat_id: chatId, text: out.slice(0, 4000) })
        } catch (err) {
          try { await api('sendMessage', { chat_id: chatId, text: `⚠️ ${err?.message || err}` }) } catch {}
        } finally {
          clearInterval(typing)
        }
      })
      replyChainByChat.set(key, turn.catch(() => {}))
      await turn
      return
    }

    const now = nowFn()
    const last = lastCourtesyByChat.get(key) || 0
    if (now - last < COURTESY_WINDOW_MS) return
    lastCourtesyByChat.set(key, now)
    try {
      await api('sendMessage', {
        chat_id: chatId,
        text: 'Este bot solo envía avisos de tareas. Pulsa «Continuar esta sesión» en un aviso para responder aquí, o usa el bot principal.'
      })
    } catch {}
  }

  async function handleUpdate(update) {
    if (!update) return
    if (update.callback_query) {
      await handleCallback(update.callback_query)
      return
    }
    if (update.message) await handleMessage(update.message)
  }

  async function loop() {
    while (running) {
      abortCurrent = new AbortController()
      try {
        const payload = { timeout: POLL_TIMEOUT_SEC }
        if (offset > 0) payload.offset = offset
        const data = await postJson(`https://api.telegram.org/bot${token}/getUpdates`, payload, abortCurrent.signal)
        if (data && data.ok === false) throw new Error(data.description || 'getUpdates error')
        const updates = Array.isArray(data?.result) ? data.result : []
        for (const u of updates) {
          if (Number.isInteger(u?.update_id)) offset = u.update_id + 1
          try { await handleUpdate(u) } catch (err) {
            console.warn('[telegram-notify] update falló:', err?.message || err)
          }
        }
        if (updates.length > 0) saveOffset()
        else await sleep(IDLE_SLEEP_MS)
      } catch (err) {
        if (err?.name === 'AbortError' || !running) break
        console.warn('[telegram-notify] poll falló:', err?.message || err)
        await sleep(ERROR_BACKOFF_MS)
      }
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms)
      const signal = abortCurrent?.signal
      if (signal) {
        signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
      }
    })
  }

  function start() {
    if (running) return
    running = true
    loopPromise = loop().catch((err) => {
      console.warn('[telegram-notify] loop muerto:', err?.message || err)
    })
  }

  async function stop() {
    running = false
    try { abortCurrent?.abort() } catch {}
    if (loopPromise) { try { await loopPromise } catch {} }
    loopPromise = null
  }

  return {
    get running() { return running },
    start,
    stop,
    sendTaskNotification,
    handleUpdate
  }
}

module.exports = { createTelegramNotifyBot }
