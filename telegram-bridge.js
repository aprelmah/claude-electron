const fs = require('fs')
const https = require('https')
const path = require('path')
const os = require('os')

// Instrucción de la app para las consultas que llegan por Telegram. Va como
// system prompt (--append-system-prompt), nunca concatenada al mensaje: pegada
// delante se convertía en el primer turno de la conversación y Claude Code
// titulaba la sesión con ella.
const TELEGRAM_FILE_HINT = '[Sistema: si el usuario pide un archivo, búscalo con `find ~ -name "*palabraclave*" -not -path "*/node_modules/*" 2>/dev/null` si no sabes la ruta exacta. Cuando lo encuentres, incluye al final de tu respuesta [ARCHIVO:/ruta/completa/al/archivo.ext] — solo si el archivo existe de verdad.]'

const { sanitizeChannelText } = require('./main/untrusted-input')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function _atomicWriteJsonSync(filePath, data) {
  // SEC-H1: 0o600 — telegram-sessions/state guardan sessionId enlazado a chat.
  const tmp = `${filePath}.tmp`
  const json = JSON.stringify(data, null, 2)
  fs.writeFileSync(tmp, json, { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, filePath)
  try { fs.chmodSync(filePath, 0o600) } catch {}
}

function splitByLimit(text, limit = 3500) {
  const out = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < Math.floor(limit * 0.4)) cut = limit
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.trim()) out.push(rest)
  return out
}

function normalizeAllowedUsers(input) {
  if (Array.isArray(input)) {
    return new Set(input.map((x) => String(x).trim()).filter(Boolean))
  }
  if (typeof input === 'string') {
    return new Set(input.split(/[,\s]+/g).map((x) => x.trim()).filter(Boolean))
  }
  return new Set()
}

function createAbortError() {
  const err = new Error('Request aborted')
  err.name = 'AbortError'
  return err
}

const MAX_MESSAGE_LEN = 3800

// Cuerpo multipart/form-data a mano (sin dependencias): lo que pide la API de
// Telegram para subir ficheros locales (sendVoice). Puro y exportado para test.
function buildMultipartBody(fields, fileField) {
  const boundary = '----poweragent' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  const parts = []
  for (const [name, value] of Object.entries(fields || {})) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  if (fileField) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType}\r\n\r\n`))
    parts.push(fileField.buffer)
    parts.push(Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

class TelegramStream {
  constructor(bridge, chatId, messageId) {
    this.bridge = bridge
    this.chatId = chatId
    this.messageId = messageId
    this.buffer = ''
    this.lastEditedText = ''
    this.lastEditAt = 0
    this.flushScheduled = false
    this.flushTimer = null
    this.editing = false
    this.editingPromise = null
    this.MIN_INTERVAL = 1500
    this.MIN_CHARS = 80
    this.MAX_LEN = MAX_MESSAGE_LEN
    this.closed = false
  }

  appendText(text) {
    if (!text || this.closed) return
    this.buffer += text
    this._maybeFlush()
  }

  appendStatus(line) {
    if (this.closed) return
    this.buffer += (this.buffer ? '\n' : '') + line
    this._maybeFlush(true)
  }

  _maybeFlush(force = false) {
    if (this.flushScheduled) return
    if (this.closed) return
    const now = Date.now()
    const sinceEdit = now - this.lastEditAt
    const newChars = this.buffer.length - this.lastEditedText.length
    if (force || sinceEdit >= this.MIN_INTERVAL || newChars >= this.MIN_CHARS) {
      this.flushScheduled = true
      const delay = Math.max(0, this.MIN_INTERVAL - sinceEdit)
      this.flushTimer = setTimeout(() => {
        this.flushScheduled = false
        this.flushTimer = null
        if (this.closed) return
        this._flush().catch(() => {})
      }, force ? 0 : delay)
    }
  }

  _cancelPendingFlush() {
    if (this.flushTimer) {
      try { clearTimeout(this.flushTimer) } catch {}
      this.flushTimer = null
    }
    this.flushScheduled = false
  }

  async _flush() {
    if (this.editing) return
    if (this.closed) return
    let text = this.buffer.trim()
    if (!text) return
    if (text === this.lastEditedText) return

    this.editing = true
    const work = (async () => {
      try {
        if (!this.messageId) {
          const head = text.slice(0, this.MAX_LEN)
          const sent = await this.bridge._sendMessage(this.chatId, head)
          this.messageId = sent?.message_id || null
          this.lastEditedText = head
        } else if (text.length > this.MAX_LEN) {
          const head = text.slice(0, this.MAX_LEN)
          await this.bridge._editMessage(this.chatId, this.messageId, head)
          const rest = text.slice(this.MAX_LEN)
          const newMsg = await this.bridge._sendMessage(this.chatId, rest.slice(0, this.MAX_LEN) || '...')
          this.messageId = newMsg?.message_id || this.messageId
          this.buffer = rest
          this.lastEditedText = rest.slice(0, this.MAX_LEN)
        } else {
          await this.bridge._editMessage(this.chatId, this.messageId, text)
          this.lastEditedText = text
        }
        this.lastEditAt = Date.now()
      } catch (err) {
        const desc = String(err?.description || err?.message || '')
        if (/not modified/i.test(desc)) {
          this.lastEditedText = text
        } else if (/retry after/i.test(desc) && err?.parameters?.retry_after) {
          await sleep((err.parameters.retry_after + 0.2) * 1000)
        } else {
          // silencioso: no spamear errores
        }
      } finally {
        this.editing = false
        this.editingPromise = null
      }
    })()
    this.editingPromise = work
    return work
  }

  async finalize(extra) {
    if (extra) this.buffer += (this.buffer ? '\n\n' : '') + extra
    this.closed = true
    this._cancelPendingFlush()
    // Espera a que cualquier _flush en curso termine antes de decidir
    // si enviar/editar. Sin esto, se produce una race condition donde
    // _flush y finalize ambos llaman a _sendMessage porque ven messageId=null.
    if (this.editingPromise) {
      try { await this.editingPromise } catch {}
    }
    let text = this.buffer.trim()
    if (!text) text = '(sin respuesta)'
    text = await this.bridge._extractAndSendFiles(this.chatId, text)
    try {
      if (!this.messageId) {
        const blocks = splitByLimit(text, this.MAX_LEN)
        for (const chunk of blocks) {
          const sent = await this.bridge._sendMessage(this.chatId, chunk)
          if (!this.messageId && sent?.message_id) this.messageId = sent.message_id
        }
      } else if (text.length > this.MAX_LEN) {
        const blocks = splitByLimit(text, this.MAX_LEN)
        await this.bridge._editMessage(this.chatId, this.messageId, blocks[0])
        for (let i = 1; i < blocks.length; i++) {
          await this.bridge._sendMessage(this.chatId, blocks[i])
        }
      } else if (text !== this.lastEditedText) {
        await this.bridge._editMessage(this.chatId, this.messageId, text)
      }
    } catch (err) {
      const desc = String(err?.description || err?.message || '')
      if (!/not modified/i.test(desc)) {
        try { await this.bridge._sendMessage(this.chatId, text.slice(0, this.MAX_LEN)) } catch {}
      }
    }
  }
}

class TelegramBridge {
  constructor({
    tmpDir,
    stateDir,
    onTranscribeFile,
    onMakeVoiceNote,
    onRunQuery,
    onGetActiveCli,
    onGetCwd,
    onSetCli,
    onUnlinkRelay,
    onGetLinkStatus,
    onGetTelegramModel,
    onSetTelegramModel,
    onStatus,
    onSemanticInput,
    onSemanticOutput,
    onOpenTaskSession,
    onListProjects,
    onListSessions,
    onPairingRequest
  }) {
    this.tmpDir = tmpDir
    this.stateDir = stateDir || tmpDir
    this.onTranscribeFile = onTranscribeFile
    this.onMakeVoiceNote = onMakeVoiceNote
    this.onRunQuery = onRunQuery
    this.onGetActiveCli = onGetActiveCli
    this.onGetCwd = onGetCwd
    this.onSetCli = onSetCli
    this.onUnlinkRelay = onUnlinkRelay
    this.onGetLinkStatus = onGetLinkStatus
    this.onGetTelegramModel = onGetTelegramModel
    this.onSetTelegramModel = onSetTelegramModel
    this.onStatus = onStatus
    this.onSemanticInput = onSemanticInput
    this.onSemanticOutput = onSemanticOutput
    this.onOpenTaskSession = onOpenTaskSession
    this.onPairingRequest = onPairingRequest
    this.onListProjects = onListProjects
    this.onListSessions = onListSessions
    this.lastRunByChat = new Map()
    // Último listado de /proyecto o /sesiones por chat: los botones inline
    // llevan índices (callback_data máx. 64 bytes), aquí vive el mapeo real.
    this.pendingPickers = new Map()

    this.config = null
    this.running = false
    this.loopPromise = null
    this.abortController = null
    this.offset = 0

    this.allowedUsers = new Set()
    this.activeStreams = new Map()
    this.chatQueues = new Map()

    try { fs.mkdirSync(this.stateDir, { recursive: true }) } catch {}

    this.sessionsPath = path.join(this.stateDir, 'telegram-sessions.json')
    this.statePath = path.join(this.stateDir, 'telegram-state.json')
    this._migrateLegacyStateFromTmp()
    this.sessions = this._loadSessions()
    this.offset = this._loadOffset()

    this.botUsername = ''
    this.lastError = ''
    this.lastInfo = 'Telegram desactivado'
    this.startedAt = 0
  }

  _migrateLegacyStateFromTmp() {
    if (this.tmpDir === this.stateDir) return
    for (const name of ['telegram-sessions.json', 'telegram-state.json']) {
      const legacy = path.join(this.tmpDir, name)
      const target = path.join(this.stateDir, name)
      try {
        if (fs.existsSync(legacy) && !fs.existsSync(target)) {
          fs.copyFileSync(legacy, target)
        }
      } catch {}
    }
  }

  _loadSessions() {
    try {
      if (!fs.existsSync(this.sessionsPath)) return {}
      const raw = fs.readFileSync(this.sessionsPath, 'utf-8')
      const data = JSON.parse(raw)
      return data && typeof data === 'object' ? data : {}
    } catch {
      return {}
    }
  }

  _saveSessions() {
    try {
      _atomicWriteJsonSync(this.sessionsPath, this.sessions)
    } catch {}
  }

  _loadOffset() {
    try {
      if (!fs.existsSync(this.statePath)) return 0
      const raw = fs.readFileSync(this.statePath, 'utf-8')
      const data = JSON.parse(raw)
      const v = Number(data?.offset)
      return Number.isFinite(v) && v >= 0 ? v : 0
    } catch {
      return 0
    }
  }

  _saveOffset() {
    try {
      _atomicWriteJsonSync(this.statePath, { offset: this.offset, updatedAt: Date.now() })
    } catch {}
  }

  _getSessionId(chatId, cli) {
    return this.sessions?.[String(chatId)]?.[cli] || null
  }

  _setSessionId(chatId, cli, sessionId) {
    if (!sessionId) return
    const key = String(chatId)
    this.sessions[key] = this.sessions[key] || {}
    if (this.sessions[key][cli] === sessionId) return
    this.sessions[key][cli] = sessionId
    this._saveSessions()
  }

  _clearSessions(chatId) {
    delete this.sessions[String(chatId)]
    this._saveSessions()
  }

  _getChatCwd(chatId) {
    const v = this.sessions?.[String(chatId)]?.cwd
    return typeof v === 'string' && v.trim() ? v : null
  }

  _setChatCwd(chatId, cwd) {
    if (!cwd || typeof cwd !== 'string') return
    const key = String(chatId)
    this.sessions[key] = this.sessions[key] || {}
    if (this.sessions[key].cwd === cwd) return
    this.sessions[key].cwd = cwd
    this._saveSessions()
  }

  // Olvida las conversaciones del chat pero conserva el proyecto elegido.
  _clearChatSessionIds(chatId) {
    const key = String(chatId)
    const cur = this.sessions[key]
    if (!cur) return
    const cwd = typeof cur.cwd === 'string' && cur.cwd.trim() ? cur.cwd : null
    if (cwd) this.sessions[key] = { cwd }
    else delete this.sessions[key]
    this._saveSessions()
  }

  getStatus() {
    return {
      running: this.running,
      botUsername: this.botUsername,
      lastError: this.lastError,
      lastInfo: this.lastInfo,
      activeChats: Object.keys(this.sessions),
      startedAt: this.startedAt
    }
  }

  // ── API pública para "transferir sesión app → Telegram" ──
  getFirstAllowedUserId() {
    if (!this.allowedUsers || this.allowedUsers.size === 0) return null
    return [...this.allowedUsers][0]
  }

  adoptSession(chatId, cli, sessionId) {
    if (!chatId || !sessionId) return false
    const c = (cli === 'codex') ? 'codex' : 'claude'
    this._setSessionId(chatId, c, sessionId)
    return true
  }

  getSessionId(chatId, cli) {
    if (!chatId) return null
    const c = (cli === 'codex') ? 'codex' : 'claude'
    return this._getSessionId(String(chatId), c)
  }

  async sendMessageTo(chatId, text) {
    if (!this.running) throw new Error('Telegram bridge no está corriendo')
    return this._sendMessage(chatId, text)
  }

  _emitStatus() {
    this.onStatus?.(this.getStatus())
  }

  _setError(error) {
    this.lastError = String(error || 'Error desconocido')
    this.lastInfo = 'Telegram con error'
    this._emitStatus()
  }

  async applyConfig(telegramConfig) {
    const cfg = {
      enabled: Boolean(telegramConfig?.enabled),
      botToken: typeof telegramConfig?.botToken === 'string' ? telegramConfig.botToken.trim() : '',
      allowedUsers: normalizeAllowedUsers(telegramConfig?.allowedUsers)
    }
    this.config = cfg

    if (!cfg.enabled) {
      await this.stop()
      this.lastError = ''
      this.lastInfo = 'Telegram desactivado'
      this._emitStatus()
      return { ok: true, running: false, message: this.lastInfo }
    }

    if (!cfg.botToken) {
      await this.stop()
      this._setError('Telegram activado pero falta el BOT TOKEN.')
      return { ok: false, running: false, error: this.lastError }
    }

    if (!cfg.allowedUsers.size) {
      await this.stop()
      this._setError('Telegram activado pero falta allowed users.')
      return { ok: false, running: false, error: this.lastError }
    }

    this.allowedUsers = cfg.allowedUsers

    try {
      await this.start()
      return { ok: true, running: true, message: this.lastInfo }
    } catch (err) {
      this._setError(err?.message || err)
      return { ok: false, running: false, error: this.lastError }
    }
  }

  async start() {
    await this.stop()
    if (!this.config?.enabled) return

    this.running = true
    this.lastError = ''
    this.lastInfo = 'Conectando Telegram...'
    this.startedAt = Date.now()
    this._emitStatus()

    await this._api('deleteWebhook')
    const me = await this._api('getMe')
    this.botUsername = me?.username || ''
    // Menú nativo de Telegram (botón ≡ junto al campo de texto). Best effort:
    // si falla, el bot funciona igual con comandos escritos.
    try { await this._registerCommandMenu() } catch {}
    this.lastInfo = this.botUsername ? `Telegram activo (@${this.botUsername})` : 'Telegram activo'
    this._emitStatus()

    this.loopPromise = this._pollLoop()
  }

  async stop() {
    this.running = false
    if (this.abortController) {
      try { this.abortController.abort() } catch {}
      this.abortController = null
    }
    for (const ctrl of this.activeStreams.values()) {
      try { ctrl.abort() } catch {}
    }
    this.activeStreams.clear()
    this.chatQueues.clear()
    if (this.loopPromise) {
      try { await Promise.race([this.loopPromise, sleep(1000)]) } catch {}
      this.loopPromise = null
    }
  }

  async _pollLoop() {
    while (this.running) {
      try {
        this.abortController = new AbortController()
        const updates = await this._api(
          'getUpdates',
          { offset: this.offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
          this.abortController.signal
        )
        this.abortController = null
        let advanced = false
        for (const update of updates) {
          const next = (update.update_id || 0) + 1
          if (next > this.offset) {
            this.offset = next
            advanced = true
          }
          this._handleUpdate(update).catch((err) => this._setError(err?.message || err))
        }
        if (advanced) this._saveOffset()
      } catch (err) {
        if (!this.running) break
        if (err?.name === 'AbortError') break

        if (this._isConflictError(err)) {
          const description = this._getErrorDescription(err)
          const webhookConflict = /webhook/i.test(description)
          if (webhookConflict) {
            try {
              await this._api('deleteWebhook', { drop_pending_updates: true })
            } catch {}
            this.lastError = `Telegram 409: ${description || 'conflicto con webhook'}`
            this.lastInfo = 'Reconectando Telegram (limpiando webhook)...'
            this._emitStatus()
            await sleep(1400)
            continue
          }

          this._setError(
            `Telegram 409: otro proceso usa este bot. Cierra otras instancias/bridges con este token.${description ? ` Detalle: ${description}` : ''}`
          )
          await sleep(2500)
          continue
        }

        this._setError(err?.message || err)
        await sleep(1800)
      }
    }
  }

  async _handleUpdate(update) {
    if (update?.callback_query) {
      await this._handleCallback(update.callback_query)
      return
    }
    const message = update?.message
    if (!message) return

    const chatId = message?.chat?.id
    const fromId = String(message?.from?.id || '')
    if (!chatId) return

    if (!this.allowedUsers.has(fromId)) {
      await this._handleUnauthorized(chatId, message, fromId)
      return
    }

    if (message.voice?.file_id) {
      await this._handleVoice(chatId, message.voice.file_id)
      return
    }

    if (message.photo?.length) {
      const largest = message.photo[message.photo.length - 1]
      await this._handlePhoto(chatId, largest.file_id, message.caption || '')
      return
    }

    const text = (message.text || '').trim()
    if (!text) return

    if (text.startsWith('/')) {
      await this._handleCommand(chatId, text)
      return
    }

    await this._enqueueQuery(chatId, text)
  }

  // Desconocido: con emparejamiento configurado (estilo Hermes), recibe un
  // código de 6 dígitos que el dueño aprueba en Configuración → Telegram.
  // El mismo usuario insistiendo recibe el MISMO código (el manager lo
  // garantiza), así que esto no fabrica códigos a demanda de un spammer.
  // Sin hook, o si el hook peta: rechazo legacy de siempre.
  async _handleUnauthorized(chatId, message, fromId) {
    let res = null
    if (typeof this.onPairingRequest === 'function') {
      try {
        res = await this.onPairingRequest({
          userId: fromId,
          chatId: String(chatId),
          username: message?.from?.username || '',
          firstName: message?.from?.first_name || ''
        })
      } catch { res = null }
    }
    if (res?.ok && res.code) {
      await this._sendMessage(chatId, `Código de vinculación: ${res.code}\nPide al dueño que lo apruebe en POWER-AGENT (Configuración → Telegram). Caduca en 10 minutos.`)
      return
    }
    if (res?.reason === 'rate-limited') {
      await this._sendMessage(chatId, 'Demasiadas solicitudes pendientes. Inténtalo más tarde.')
      return
    }
    await this._sendMessage(chatId, 'No autorizado. Pide que te añadan a allowed users.')
  }

  _enqueueQuery(chatId, prompt, opts) {
    // Saneado de canal (untrusted-input.js): el emisor está allowlisted, pero
    // el texto puede venir reenviado/pegado con Unicode invisible o escapes de
    // terminal, y esto acaba en un PTY con bypassPermissions. Solo limpieza;
    // sin bloqueo — quien manda aquí es Luismi.
    const scan = sanitizeChannelText(prompt)
    if (scan.findings.length) {
      try { console.warn('[telegram] entrada saneada:', scan.findings.map((f) => f.type).join(', ')) } catch {}
    }
    prompt = scan.text
    const prev = this.chatQueues.get(chatId) || Promise.resolve()
    const next = prev.catch(() => {}).then(() => this._runQuery(chatId, prompt, opts))
    this.chatQueues.set(chatId, next)
    next.finally(() => {
      if (this.chatQueues.get(chatId) === next) this.chatQueues.delete(chatId)
    })
    return next
  }

  async _runQuery(chatId, prompt, opts = {}) {
    if (!this.running) return
    // Audio va, audio viene: la consulta que entró como nota de voz responde
    // con nota de voz (si hay onMakeVoiceNote; si no, texto de siempre).
    const voiceReply = !!(opts?.voiceReply && typeof this.onMakeVoiceNote === 'function')
    const cli = (await this.onGetActiveCli?.()) || 'claude'
    const sessionId = this._getSessionId(chatId, cli)
    const promptText = String(prompt || '')
    try {
      this.onSemanticInput?.({
        chatId: String(chatId),
        cli,
        sessionId: sessionId || null,
        prompt: promptText
      })
    } catch {}

    if (this.activeStreams.has(chatId)) {
      try { this.activeStreams.get(chatId).abort() } catch {}
    }
    const abortController = new AbortController()
    this.activeStreams.set(chatId, abortController)

    const accion = voiceReply ? 'record_voice' : 'typing'
    this._sendChatAction(chatId, accion).catch(() => {})
    const typingInterval = setInterval(() => {
      this._sendChatAction(chatId, accion).catch(() => {})
    }, 4000)

    // En modo voz NO se streamea texto: se acumula y al final sale como nota
    // de voz (o como texto de fallback, entero, si la síntesis falla).
    const stream = voiceReply ? null : new TelegramStream(this, chatId, null)
    let voiceBuf = ''
    let runOk = false
    let runError = ''
    let resolvedSessionId = sessionId || null

    try {
      // Instrucción de la app, no mensaje del usuario: viaja como system prompt.
      // Pegada delante del prompt se convertía en el primer turno de la
      // conversación, y Claude Code titula la sesión con él — todas las sesiones
      // abiertas desde Telegram salían llamadas "[Sistema: si el usuario pide un
      // archivo…" y no se distinguían en el picker.
      const result = await this.onRunQuery?.({
        cli,
        prompt,
        appendSystemPrompt: TELEGRAM_FILE_HINT,
        userPrompt: prompt,
        chatId: String(chatId),
        sessionId,
        chatCwd: this._getChatCwd(chatId),
        signal: abortController.signal,
        onText: (text) => { if (voiceReply) voiceBuf += text; else stream.appendText(text) },
        onToolUse: (name) => { if (!voiceReply) stream.appendStatus(`[${name}]`) },
        onSessionId: (id) => this._setSessionId(chatId, cli, id)
      })
      if (result?.sessionId) this._setSessionId(chatId, cli, result.sessionId)
      resolvedSessionId = result?.sessionId || this._getSessionId(chatId, cli) || resolvedSessionId
      runOk = true
      clearInterval(typingInterval)
      // Pie de contexto: hace visible al instante cualquier cruce de sesiones
      // ("qué raro responde" → se ve el proyecto/sesión equivocados). Solo si
      // hay respuesta real: sobre "(sin respuesta)" no aporta y confunde.
      const footer = this._contextFooter(chatId, cli)
      if (voiceReply) {
        await this._deliverVoiceReply(chatId, voiceBuf.trim() || String(result?.text || '').trim(), footer)
      } else {
        await stream.finalize(footer && stream.buffer.trim() ? footer : undefined)
      }
    } catch (err) {
      runError = err?.message || String(err)
      clearInterval(typingInterval)
      const cierre = err?.name === 'AbortError' ? '(cancelado)' : `Error: ${err?.message || err}`
      if (voiceReply) {
        try { await this._sendMessage(chatId, cierre) } catch {}
      } else {
        await stream.finalize(cierre)
      }
    } finally {
      clearInterval(typingInterval)
      if (this.activeStreams.get(chatId) === abortController) {
        this.activeStreams.delete(chatId)
      }
      try {
        this.onSemanticOutput?.({
          chatId: String(chatId),
          cli,
          sessionId: resolvedSessionId || this._getSessionId(chatId, cli) || null,
          prompt: promptText,
          ok: runOk,
          error: runError
        })
      } catch {}
    }
  }

  // Entrega la respuesta de un turno que entró por voz: nota de voz con el
  // pie de contexto como caption; si la síntesis falla o devuelve null, el
  // texto completo de fallback (con pie). El .ogg lo borra siempre este método.
  async _deliverVoiceReply(chatId, texto, footer) {
    if (!texto) {
      try { await this._sendMessage(chatId, '(sin respuesta)') } catch {}
      return
    }
    let enviado = false
    let oggPath = null
    try {
      oggPath = await this.onMakeVoiceNote(texto)
      if (oggPath) {
        await this._sendVoiceNote(chatId, oggPath, footer || undefined)
        enviado = true
      }
    } catch (err) {
      console.warn('[telegram] nota de voz fallida, caigo a texto:', err?.message || err)
    } finally {
      if (oggPath) { try { fs.unlinkSync(oggPath) } catch {} }
    }
    if (!enviado) {
      const completo = footer ? `${texto}\n\n${footer}` : texto
      for (const parte of splitByLimit(completo, MAX_MESSAGE_LEN)) {
        try { await this._sendMessage(chatId, parte) } catch {}
      }
    }
  }

  async _sendVoiceNote(chatId, filePath, caption) {
    const buffer = fs.readFileSync(filePath)
    const fields = { chat_id: String(chatId) }
    if (caption) fields.caption = String(caption).slice(0, 1024)
    return this._apiUpload('sendVoice', fields, { name: 'voice', filename: 'nota.ogg', contentType: 'audio/ogg', buffer })
  }

  // Como _api pero multipart/form-data: la única vía para subir un fichero
  // local a la API de Telegram sin dependencias.
  async _apiUpload(method, fields, fileField) {
    const token = this.config?.botToken
    if (!token) throw new Error('Bot token no configurado.')
    const { body, contentType } = buildMultipartBody(fields, fileField)
    const data = await new Promise((resolve, reject) => {
      const target = new URL(`https://api.telegram.org/bot${token}/${method}`)
      const req = https.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname,
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': body.length }
      }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('error', reject)
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
          catch (err) { reject(err) }
        })
      })
      req.on('error', reject)
      req.end(body)
    })
    if (!data.ok) {
      const err = new Error(`Telegram ${method}: ${data.description || 'error'}`)
      err.description = data.description
      err.errorCode = data.error_code
      err.parameters = data.parameters
      throw err
    }
    return data.result
  }

  // setMyCommands puebla el botón "Menú" nativo de Telegram con los comandos.
  async _registerCommandMenu() {
    await this._api('setMyCommands', {
      commands: [
        { command: 'menu', description: 'Menú con botones' },
        { command: 'proyecto', description: 'Elegir proyecto' },
        { command: 'sesiones', description: 'Elegir conversación previa' },
        { command: 'modelo', description: 'Cambiar modelo (Telegram)' },
        { command: 'vinculo', description: 'Ver a qué está enganchado este chat' },
        { command: 'status', description: 'Estado del bridge' },
        { command: 'abrir', description: 'Abrir la sesión en el Mac' },
        { command: 'reset', description: 'Conversación nueva' },
        { command: 'desvincular', description: 'Cortar el relay PTY' },
        { command: 'cli', description: 'Cambiar CLI (claude|codex)' },
        { command: 'cancel', description: 'Cancelar respuesta en curso' },
        { command: 'help', description: 'Ayuda' }
      ]
    })
  }

  // «📁 proyecto · abc12345» — o '' si no hay nada que enseñar.
  _contextFooter(chatId, cli) {
    let proj = ''
    try {
      const cwd = this._getChatCwd(chatId)
      if (cwd) proj = path.basename(cwd)
    } catch {}
    let sid = ''
    try { sid = String(this._getSessionId(chatId, cli) || '').slice(0, 8) } catch {}
    if (proj && sid) return `📁 ${proj} · ${sid}`
    if (proj) return `📁 ${proj}`
    if (sid) return `📁 sesión ${sid}`
    return ''
  }

  async _sendChatAction(chatId, action) {
    return this._api('sendChatAction', { chat_id: chatId, action })
  }

  async _handlePhoto(chatId, fileId, caption) {
    try {
      const saveDir = path.join(os.homedir(), 'Desktop', 'Telegram')
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true })

      const fileInfo = await this._api('getFile', { file_id: fileId })
      const filePath = fileInfo?.file_path
      if (!filePath) throw new Error('No se pudo resolver file_path.')

      const url = `https://api.telegram.org/file/bot${this.config.botToken}/${filePath}`
      const buf = await this._downloadBuffer(url)

      const ext = path.extname(filePath) || '.jpg'
      const fileName = `foto-${Date.now()}${ext}`
      const localPath = path.join(saveDir, fileName)
      fs.writeFileSync(localPath, buf)

      const instruction = caption.trim()
        ? `El usuario te ha enviado una imagen (guardada en ${localPath}). Lee la imagen con tu herramienta Read y responde a esto: ${caption.trim()}`
        : `El usuario te ha enviado una imagen (guardada en ${localPath}). Lee la imagen con tu herramienta Read, descríbela brevemente y pregúntale qué quiere hacer con ella.`

      await this._enqueueQuery(chatId, instruction)
    } catch (err) {
      await this._sendMessage(chatId, `Error con la foto: ${err?.message || err}`)
    }
  }

  async _handleVoice(chatId, fileId) {
    try {
      // Audio va, audio viene: nada de mensajes de estado ni de eco de la
      // transcripción (pedido por Luismi, 2026-08-06) — el feedback mientras
      // se transcribe es la acción de chat, y la respuesta llega como nota de
      // voz desde _runQuery. Los errores sí van en texto.
      this._sendChatAction(chatId, 'typing').catch(() => {})
      const fileInfo = await this._api('getFile', { file_id: fileId })
      const filePath = fileInfo?.file_path
      if (!filePath) throw new Error('No se pudo resolver file_path de Telegram.')

      const url = `https://api.telegram.org/file/bot${this.config.botToken}/${filePath}`
      const audioBuffer = await this._downloadBuffer(url)

      const localPath = path.join(this.tmpDir, `tg-voice-${Date.now()}.ogg`)
      fs.writeFileSync(localPath, audioBuffer)

      let transcript = ''
      try {
        transcript = await this.onTranscribeFile?.(localPath)
      } finally {
        try { fs.unlinkSync(localPath) } catch {}
      }

      if (!transcript || !transcript.trim()) {
        await this._sendMessage(chatId, 'No pude extraer texto de la nota de voz.')
        return
      }

      const cleaned = transcript.trim()
      await this._enqueueQuery(chatId, cleaned, { voiceReply: true })
    } catch (err) {
      await this._sendMessage(chatId, `Error en voz: ${err?.message || err}`)
    }
  }

  async _handleCommand(chatId, rawText) {
    const text = rawText.trim()
    const lower = text.toLowerCase()

    if (lower === '/start' || lower === '/help') {
      await this._sendMessage(chatId, [
        'POWER-AGENT Telegram bridge.',
        '',
        'Comandos:',
        '/status  -> estado del bridge',
        '/proyecto -> elegir proyecto (carpeta) para este chat',
        '/sesiones -> elegir conversación previa del proyecto',
        '/cwd     -> carpeta actual',
        '/reset   -> empezar conversación nueva (olvida sesión)',
        '/vinculo -> ver a qué proyecto/sesión está enganchado este chat',
        '/salir   -> desconectar este chat del relay PTY (alias /desvincular)',
        '/cancel  -> cancelar respuesta en curso',
        '/cli claude|codex -> cambiar CLI',
        '/abrir   -> abrir en el Mac la sesión del último run programado',
        '',
        'Manda texto normal o una nota de voz para hablar con el CLI activo.'
      ].join('\n'))
      return
    }

    if (lower === '/status') {
      const activeCli = await this.onGetActiveCli?.()
      const cwd = await this.onGetCwd?.()
      const chatCwd = this._getChatCwd(chatId)
      const session = this._getSessionId(chatId, activeCli)
      await this._sendMessage(chatId, [
        `Bridge: ${this.running ? 'ON' : 'OFF'}`,
        `Bot: ${this.botUsername ? '@' + this.botUsername : '(sin username)'}`,
        `CLI: ${activeCli || 'desconocido'}`,
        `Proyecto del chat: ${chatCwd || `(el de la app: ${cwd || 'desconocido'})`}`,
        `Sesión: ${session ? session.slice(0, 8) + '…' : '(nueva)'}`
      ].join('\n'))
      return
    }

    if (lower === '/cwd') {
      const cwd = await this.onGetCwd?.()
      await this._sendMessage(chatId, `CWD: ${cwd || '(desconocido)'}`)
      return
    }

    if (lower === '/reset' || lower === '/restart') {
      this._clearChatSessionIds(chatId)
      const ctrl = this.activeStreams.get(chatId)
      if (ctrl) try { ctrl.abort() } catch {}
      await this._sendMessage(chatId, 'Conversación reseteada. Próximo mensaje empieza sesión nueva.')
      return
    }

    if (lower === '/menu' || lower === '/m') {
      // Botonera: cada botón dispara el comando equivalente (callback mnu:*).
      await this._sendMessage(chatId, 'Menú:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📁 Proyecto', callback_data: 'mnu:proyecto' }, { text: '🗂 Sesiones', callback_data: 'mnu:sesiones' }],
            [{ text: '🧠 Modelo', callback_data: 'mnu:modelo' }, { text: '🔗 Vínculo', callback_data: 'mnu:vinculo' }],
            [{ text: '📊 Estado', callback_data: 'mnu:status' }, { text: '🖥 Abrir en el Mac', callback_data: 'mnu:abrir' }],
            [{ text: '🆕 Conversación nueva', callback_data: 'mnu:reset' }, { text: '✂️ Desvincular', callback_data: 'mnu:desvincular' }]
          ]
        }
      })
      return
    }

    if (lower === '/modelo' || lower === '/model' || lower.startsWith('/modelo ') || lower.startsWith('/model ')) {
      const cli = (await this.onGetActiveCli?.()) || 'claude'
      const arg = text.split(/\s+/).slice(1).join(' ').trim()
      if (arg) {
        const model = arg.toLowerCase() === 'default' ? '' : arg
        const res = await this.onSetTelegramModel?.({ cli, model })
        if (res?.ok === false) {
          await this._sendMessage(chatId, `No pude cambiar el modelo: ${res.error || 'error'}`)
        } else {
          await this._sendMessage(chatId, `Modelo de ${cli} para Telegram: ${model || 'Default'} (aplica desde el próximo mensaje).`)
        }
        return
      }
      let current = ''
      try { current = (await this.onGetTelegramModel?.(cli)) || '' } catch {}
      if (cli !== 'claude') {
        await this._sendMessage(chatId, `Modelo actual de ${cli} para Telegram: ${current || 'Default'}. Cámbialo con /modelo <nombre> (o /modelo default).`)
        return
      }
      await this._sendMessage(chatId, `Modelo actual de claude para Telegram: ${current || 'Default'}. Elige:`, {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Default', callback_data: 'mod:default' },
            { text: 'Haiku', callback_data: 'mod:haiku' },
            { text: 'Sonnet', callback_data: 'mod:sonnet' },
            { text: 'Opus', callback_data: 'mod:opus' }
          ]]
        }
      })
      return
    }

    if (lower === '/vinculo' || lower === '/link') {
      // Radiografía del enlace del chat, para cortar mezclas desde el móvil
      // sin ir al Mac: binding PTY (si main lo conoce) + sesión persistida.
      const activeCli = (await this.onGetActiveCli?.()) || 'claude'
      let link = null
      try { link = await this.onGetLinkStatus?.({ chatId: String(chatId) }) } catch {}
      const lines = []
      if (link?.bound) {
        const proj = link.cwd ? path.basename(link.cwd) : '(proyecto desconocido)'
        lines.push(`🔗 Enlazado por relay PTY a ${proj} (${link.cli || 'claude'})`)
        if (link.sessionId) lines.push(`Sesión: ${String(link.sessionId).slice(0, 8)}`)
      } else {
        lines.push('Sin enlace de relay PTY.')
      }
      const chatCwd = this._getChatCwd(chatId)
      if (chatCwd) lines.push(`Proyecto del chat: ${path.basename(chatCwd)} (${chatCwd})`)
      const sid = this._getSessionId(chatId, activeCli)
      if (sid) lines.push(`Sesión persistida (${activeCli}): ${String(sid).slice(0, 8)}`)
      if (!link?.bound && !chatCwd && !sid) lines.push('Este chat no tiene proyecto ni sesión asociados. Usa /proyecto.')
      lines.push('', '/desvincular corta el relay PTY. /reset olvida la sesión.')
      await this._sendMessage(chatId, lines.join('\n'))
      return
    }

    if (lower === '/salir' || lower === '/unlink' || lower === '/disconnect' || lower === '/desvincular') {
      const result = await this.onUnlinkRelay?.(String(chatId))
      if (result?.ok) {
        const sync = result.sync || null
        if (result.detached) {
          if (sync?.mode === 'codex' && sync?.refreshed) {
            await this._sendMessage(chatId, 'Relay PTY desconectado. Contexto Codex recargado en la PTY de la app.')
          } else if (sync?.mode === 'codex' && sync?.ok === false) {
            await this._sendMessage(chatId, `Relay PTY desconectado, pero falló el refresco de contexto Codex: ${sync.error || 'error'}`)
          } else {
            await this._sendMessage(chatId, 'Relay PTY desconectado para este chat.')
          }
        } else {
          await this._sendMessage(chatId, 'Este chat ya estaba desconectado del relay PTY.')
        }
      } else {
        await this._sendMessage(chatId, `No se pudo desconectar: ${result?.error || 'error'}`)
      }
      return
    }

    if (lower === '/cancel' || lower === '/stop') {
      const ctrl = this.activeStreams.get(chatId)
      if (ctrl) {
        try { ctrl.abort() } catch {}
        await this._sendMessage(chatId, 'Cancelando...')
      } else {
        await this._sendMessage(chatId, 'No hay respuesta en curso.')
      }
      return
    }

    if (lower.startsWith('/cli ')) {
      const target = lower.replace('/cli', '').trim()
      if (target !== 'claude' && target !== 'codex') {
        await this._sendMessage(chatId, 'Uso: /cli claude|codex')
        return
      }
      const result = await this.onSetCli?.(target)
      if (result?.ok) {
        await this._sendMessage(chatId, `CLI cambiado a ${target}.`)
      } else {
        await this._sendMessage(chatId, `No se pudo cambiar CLI: ${result?.error || 'error'}`)
      }
      return
    }

    if (lower === '/abrir' || lower === '/sesion' || lower === '/sesión' || lower === '/continuar') {
      const last = this.lastRunByChat.get(String(chatId))
      if (!last || !last.sessionId) {
        await this._sendMessage(chatId, 'No hay sesión reciente para abrir. Espera a que termine una tarea programada.')
        return
      }
      const targetCli = last.cli === 'codex' ? 'codex' : 'claude'
      const notes = []
      try {
        const unlinkRes = await this.onUnlinkRelay?.(String(chatId))
        if (unlinkRes?.detached) notes.push('relay PTY anterior desenlazado')
      } catch {}
      try {
        const activeCli = await this.onGetActiveCli?.()
        if (activeCli && activeCli !== targetCli) {
          const switchRes = await this.onSetCli?.(targetCli)
          if (switchRes?.ok) notes.push(`CLI cambiado a ${targetCli}`)
          else notes.push(`atención: CLI activo es ${activeCli}, la sesión usa ${targetCli}`)
        }
      } catch {}
      this._setSessionId(chatId, targetCli, last.sessionId)
      let openErr = null
      try {
        const result = await this.onOpenTaskSession?.({
          sessionId: last.sessionId,
          cli: targetCli,
          cwd: last.cwd || '',
          taskName: last.taskName || '',
          chatId: String(chatId)
        })
        if (!result?.ok) openErr = result?.error || 'desconocido'
      } catch (err) {
        openErr = err?.message || String(err)
      }
      const label = last.taskName || `${last.sessionId.slice(0, 8)}…`
      const lines = [
        `Enlazado a la sesión "${label}".`,
        'Tus próximos mensajes continúan esta conversación.'
      ]
      if (notes.length) lines.push(`(${notes.join(' · ')})`)
      if (openErr) lines.push(`No abrí ventana local: ${openErr}`)
      else lines.push('Ventana abierta en el Mac.')
      await this._sendMessage(chatId, lines.join('\n'))
      return
    }

    if (lower === '/proyecto' || lower === '/proyectos') {
      let projects = []
      try { projects = (await this.onListProjects?.()) || [] } catch { projects = [] }
      const items = projects
        .map((p) => (typeof p === 'string' ? p : p?.cwd))
        .filter((p) => typeof p === 'string' && p.trim())
        .slice(0, 10)
      if (!items.length) {
        await this._sendMessage(chatId, 'No hay proyectos recientes. Abre alguno en el Mac primero.')
        return
      }
      this.pendingPickers.set(String(chatId), { type: 'project', items, ts: Date.now() })
      const keyboard = items.map((cwd, i) => [{ text: this._projectLabel(cwd, items), callback_data: `prj:${i}` }])
      await this._sendMessage(chatId, 'Elige proyecto:', { reply_markup: { inline_keyboard: keyboard } })
      return
    }

    if (lower === '/sesiones') {
      const cwd = this._getChatCwd(chatId) || (await this.onGetCwd?.()) || ''
      if (!cwd) {
        await this._sendMessage(chatId, 'No hay proyecto activo. Elige uno con /proyecto.')
        return
      }
      const cli = (await this.onGetActiveCli?.()) || 'claude'
      let rows = []
      try { rows = (await this.onListSessions?.({ cwd, cli })) || [] } catch { rows = [] }
      const items = rows.slice(0, 10).map((r) => ({
        id: r.id,
        preview: String(r.preview || '(sin contenido)').replace(/\s+/g, ' ').trim(),
        mtime: Number(r.mtime) || 0
      }))
      this.pendingPickers.set(String(chatId), { type: 'session', cli, cwd, items, ts: Date.now() })
      const keyboard = items.map((s, i) => [{ text: this._sessionLabel(s), callback_data: `ses:${i}` }])
      keyboard.push([{ text: '+ Nueva sesión', callback_data: 'ses:new' }])
      const header = items.length
        ? `Sesiones de ${path.basename(cwd)} (${cli}):`
        : `No hay sesiones previas de ${cli} en ${path.basename(cwd)}. ¿Empezamos una nueva?`
      await this._sendMessage(chatId, header, { reply_markup: { inline_keyboard: keyboard } })
      return
    }

    await this._sendMessage(chatId, 'Comando no reconocido. Usa /help.')
  }

  _projectLabel(cwd, all) {
    const base = path.basename(cwd)
    const dupes = all.filter((c) => path.basename(c) === base)
    const label = dupes.length > 1 ? `${path.basename(path.dirname(cwd))}/${base}` : base
    return label.slice(0, 48)
  }

  _sessionLabel(s) {
    let when = ''
    if (s.mtime > 0) {
      try {
        const d = new Date(s.mtime)
        when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} `
      } catch {}
    }
    return `${when}${s.preview}`.slice(0, 48)
  }

  async _handleCallback(cb) {
    const chatId = cb?.message?.chat?.id
    const fromId = String(cb?.from?.id || '')
    const data = String(cb?.data || '')
    // Siempre responder el callback para que Telegram quite el spinner del botón.
    try { await this._api('answerCallbackQuery', { callback_query_id: cb?.id }) } catch {}
    if (!chatId || !this.allowedUsers.has(fromId)) return

    const key = String(chatId)
    const picker = this.pendingPickers.get(key)

    // Botones del /menu: despachan el comando equivalente.
    if (data.startsWith('mnu:')) {
      await this._handleCommand(chatId, `/${data.slice(4)}`)
      return
    }

    // Botones de /modelo (solo claude; codex va por argumento).
    if (data.startsWith('mod:')) {
      const value = data.slice(4)
      const model = value === 'default' ? '' : value
      const res = await this.onSetTelegramModel?.({ cli: 'claude', model })
      if (res?.ok === false) {
        await this._sendMessage(chatId, `No pude cambiar el modelo: ${res.error || 'error'}`)
      } else {
        await this._sendMessage(chatId, `Modelo de claude para Telegram: ${model || 'Default'} (aplica desde el próximo mensaje).`)
      }
      return
    }

    if (data.startsWith('prj:')) {
      const idx = Number(data.slice(4))
      const cwd = picker?.type === 'project' ? picker.items[idx] : null
      if (!cwd) {
        await this._sendMessage(chatId, 'Ese listado caducó. Pide /proyecto otra vez.')
        return
      }
      this.pendingPickers.delete(key)
      // El binding de relay PTY tiene prioridad en el enrutado: si sigue vivo,
      // seguiría mandando los mensajes a la sesión antigua. Fuera.
      try { await this.onUnlinkRelay?.(key) } catch {}
      this._setChatCwd(chatId, cwd)
      this._clearChatSessionIds(chatId)
      await this._sendMessage(chatId, [
        `Proyecto: ${cwd}`,
        'Escribe y empiezas conversación nueva ahí, o /sesiones para retomar una.'
      ].join('\n'))
      return
    }

    if (data === 'ses:new') {
      this.pendingPickers.delete(key)
      try { await this.onUnlinkRelay?.(key) } catch {}
      this._clearChatSessionIds(chatId)
      const cwd = this._getChatCwd(chatId)
      await this._sendMessage(chatId, `Listo. Tu próximo mensaje empieza sesión nueva${cwd ? ` en ${path.basename(cwd)}` : ''}.`)
      return
    }

    if (data.startsWith('ses:')) {
      const idx = Number(data.slice(4))
      const item = picker?.type === 'session' ? picker.items[idx] : null
      if (!item) {
        await this._sendMessage(chatId, 'Ese listado caducó. Pide /sesiones otra vez.')
        return
      }
      this.pendingPickers.delete(key)
      try { await this.onUnlinkRelay?.(key) } catch {}
      this._setChatCwd(chatId, picker.cwd)
      this._setSessionId(chatId, picker.cli, item.id)
      await this._sendMessage(chatId, [
        `Sesión enlazada: ${item.preview.slice(0, 120)}`,
        'Tus próximos mensajes continúan esa conversación.'
      ].join('\n'))
      return
    }
  }

  async sendMessage(chatId, text) {
    return this._sendMessage(chatId, text)
  }

  async _extractAndSendFiles(chatId, text) {
    const FILE_RE = /\[ARCHIVO:([^\]]+)\]/g
    const matches = [...text.matchAll(FILE_RE)]
    if (!matches.length) return text
    const cleaned = text.replace(FILE_RE, '').replace(/\n{3,}/g, '\n\n').trim()
    for (const m of matches) {
      const rawPath = m[1].trim()
      const absPath = rawPath.startsWith('~') ? path.join(os.homedir(), rawPath.slice(1)) : rawPath
      try {
        await this._sendDocument(chatId, absPath)
      } catch (err) {
        await this._sendMessage(chatId, `No pude enviar ${path.basename(absPath)}: ${err.message}`)
      }
    }
    return cleaned || '(sin respuesta)'
  }

  async _sendDocument(chatId, filePath) {
    const token = this.config?.botToken
    if (!token) throw new Error('Bot token no configurado.')
    if (!fs.existsSync(filePath)) throw new Error(`Archivo no encontrado: ${filePath}`)
    const stat = fs.statSync(filePath)
    if (stat.size > 50 * 1024 * 1024) throw new Error(`Archivo demasiado grande (límite 50 MB): ${path.basename(filePath)}`)
    const fileData = fs.readFileSync(filePath)
    const fileName = path.basename(filePath)
    const boundary = `----TGBoundary${Date.now()}`
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([head, fileData, tail])
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/sendDocument`,
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': body.length
        }
      }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('error', reject)
        res.on('end', () => {
          let data
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { reject(new Error('Respuesta inválida')); return }
          if (!data.ok) { reject(new Error(`sendDocument: ${data.description || 'error'}`)); return }
          resolve(data.result)
        })
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  rememberRunForChat(chatId, runInfo) {
    if (!chatId || !runInfo || !runInfo.sessionId) return
    const key = String(chatId)
    this.lastRunByChat.set(key, {
      sessionId: String(runInfo.sessionId),
      cli: runInfo.cli === 'codex' ? 'codex' : 'claude',
      cwd: typeof runInfo.cwd === 'string' ? runInfo.cwd : '',
      taskName: typeof runInfo.taskName === 'string' ? runInfo.taskName : '',
      runId: typeof runInfo.runId === 'string' ? runInfo.runId : '',
      ts: Date.now()
    })
    if (this.lastRunByChat.size > 64) {
      const oldestKey = this.lastRunByChat.keys().next().value
      if (oldestKey) this.lastRunByChat.delete(oldestKey)
    }
  }

  async _sendMessage(chatId, text, extra) {
    const normalized = String(text || '').trim()
    if (!normalized) return null
    const blocks = splitByLimit(normalized, MAX_MESSAGE_LEN)
    let last = null
    for (let i = 0; i < blocks.length; i++) {
      const payload = {
        chat_id: chatId,
        text: blocks[i],
        disable_web_page_preview: true
      }
      // El teclado inline va solo en el último bloque, pegado a los botones.
      if (extra && i === blocks.length - 1) Object.assign(payload, extra)
      last = await this._api('sendMessage', payload)
    }
    return last
  }

  async _editMessage(chatId, messageId, text) {
    if (!messageId) return this._sendMessage(chatId, text)
    return this._api('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: String(text).slice(0, MAX_MESSAGE_LEN),
      disable_web_page_preview: true
    })
  }

  _getErrorDescription(err) {
    if (!err) return ''
    return String(err.description || err?.response?.description || err.message || '').trim()
  }

  _isConflictError(err) {
    const code = Number(err?.httpStatus || err?.errorCode || err?.response?.error_code || 0)
    if (code === 409) return true
    const desc = this._getErrorDescription(err).toLowerCase()
    return desc.includes('conflict') || desc.includes("can't use getupdates")
  }

  async _postJson(url, payload, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError())
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
        headers: {
          'content-type': 'application/json',
          'content-length': body.length
        }
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => {
          const status = res.statusCode || 0
          const raw = Buffer.concat(chunks).toString('utf8')
          let data = null
          try {
            data = raw ? JSON.parse(raw) : {}
          } catch (err) {
            if (status < 200 || status >= 300) {
              const httpErr = new Error(`HTTP ${status}`)
              httpErr.httpStatus = status
              httpErr.responseText = raw
              reject(httpErr)
              return
            }
            reject(new Error(`Respuesta JSON invalida: ${err?.message || err}`))
            return
          }

          if (status < 200 || status >= 300) {
            const description = data?.description || `HTTP ${status}`
            const httpErr = new Error(description)
            httpErr.httpStatus = status
            httpErr.errorCode = data?.error_code
            httpErr.description = data?.description
            httpErr.parameters = data?.parameters
            httpErr.response = data
            reject(httpErr)
            return
          }
          resolve(data || {})
        })
      })

      const onAbort = () => req.destroy(createAbortError())
      if (signal) signal.addEventListener('abort', onAbort, { once: true })

      req.on('error', reject)
      req.on('close', () => {
        if (signal) signal.removeEventListener('abort', onAbort)
      })

      req.write(body)
      req.end()
    })
  }

  async _downloadBuffer(url, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError())
        return
      }

      const target = new URL(url)
      const req = https.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'GET'
      }, (res) => {
        const status = res.statusCode || 0
        if (status < 200 || status >= 300) {
          reject(new Error(`Error descargando audio: HTTP ${status}`))
          res.resume()
          return
        }
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('error', reject)
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })

      const onAbort = () => req.destroy(createAbortError())
      if (signal) signal.addEventListener('abort', onAbort, { once: true })

      req.on('error', reject)
      req.on('close', () => {
        if (signal) signal.removeEventListener('abort', onAbort)
      })
      req.end()
    })
  }

  async _api(method, payload, signal) {
    const token = this.config?.botToken
    if (!token) throw new Error('Bot token no configurado.')

    const data = await this._postJson(`https://api.telegram.org/bot${token}/${method}`, payload || {}, signal)
    if (!data.ok) {
      const err = new Error(`Telegram ${method}: ${data.description || 'error'}`)
      err.description = data.description
      err.errorCode = data.error_code
      err.parameters = data.parameters
      throw err
    }
    return data.result
  }
}

module.exports = { TelegramBridge, buildMultipartBody }
