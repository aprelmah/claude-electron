const fs = require('fs')
const https = require('https')
const path = require('path')
const os = require('os')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function _atomicWriteJsonSync(filePath, data) {
  const tmp = `${filePath}.tmp`
  const json = JSON.stringify(data, null, 2)
  fs.writeFileSync(tmp, json, 'utf-8')
  fs.renameSync(tmp, filePath)
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

class TelegramStream {
  constructor(bridge, chatId, messageId) {
    this.bridge = bridge
    this.chatId = chatId
    this.messageId = messageId
    this.buffer = ''
    this.lastEditedText = ''
    this.lastEditAt = 0
    this.flushScheduled = false
    this.editing = false
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
    const now = Date.now()
    const sinceEdit = now - this.lastEditAt
    const newChars = this.buffer.length - this.lastEditedText.length
    if (force || sinceEdit >= this.MIN_INTERVAL || newChars >= this.MIN_CHARS) {
      this.flushScheduled = true
      const delay = Math.max(0, this.MIN_INTERVAL - sinceEdit)
      setTimeout(() => {
        this.flushScheduled = false
        this._flush().catch(() => {})
      }, force ? 0 : delay)
    }
  }

  async _flush() {
    if (this.editing) return
    if (this.closed) return
    let text = this.buffer.trim()
    if (!text) return
    if (text === this.lastEditedText) return

    this.editing = true
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
    }
  }

  async finalize(extra) {
    if (extra) this.buffer += (this.buffer ? '\n\n' : '') + extra
    this.closed = true
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
    onRunQuery,
    onGetActiveCli,
    onGetCwd,
    onSetCli,
    onUnlinkRelay,
    onStatus
  }) {
    this.tmpDir = tmpDir
    this.stateDir = stateDir || tmpDir
    this.onTranscribeFile = onTranscribeFile
    this.onRunQuery = onRunQuery
    this.onGetActiveCli = onGetActiveCli
    this.onGetCwd = onGetCwd
    this.onSetCli = onSetCli
    this.onUnlinkRelay = onUnlinkRelay
    this.onStatus = onStatus

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
          { offset: this.offset, timeout: 30, allowed_updates: ['message'] },
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
    const message = update?.message
    if (!message) return

    const chatId = message?.chat?.id
    const fromId = String(message?.from?.id || '')
    if (!chatId) return

    if (!this.allowedUsers.has(fromId)) {
      await this._sendMessage(chatId, 'No autorizado. Pide que te añadan a allowed users.')
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

  _enqueueQuery(chatId, prompt) {
    const prev = this.chatQueues.get(chatId) || Promise.resolve()
    const next = prev.catch(() => {}).then(() => this._runQuery(chatId, prompt))
    this.chatQueues.set(chatId, next)
    next.finally(() => {
      if (this.chatQueues.get(chatId) === next) this.chatQueues.delete(chatId)
    })
    return next
  }

  async _runQuery(chatId, prompt) {
    if (!this.running) return
    const cli = (await this.onGetActiveCli?.()) || 'claude'
    const sessionId = this._getSessionId(chatId, cli)

    if (this.activeStreams.has(chatId)) {
      try { this.activeStreams.get(chatId).abort() } catch {}
    }
    const abortController = new AbortController()
    this.activeStreams.set(chatId, abortController)

    this._sendChatAction(chatId, 'typing').catch(() => {})
    const typingInterval = setInterval(() => {
      this._sendChatAction(chatId, 'typing').catch(() => {})
    }, 4000)

    const stream = new TelegramStream(this, chatId, null)

    try {
      const fileHint = '[Sistema: si el usuario pide un archivo, búscalo con `find ~ -name "*palabraclave*" -not -path "*/node_modules/*" 2>/dev/null` si no sabes la ruta exacta. Cuando lo encuentres, incluye al final de tu respuesta [ARCHIVO:/ruta/completa/al/archivo.ext] — solo si el archivo existe de verdad.]\n\n'
      const result = await this.onRunQuery?.({
        cli,
        prompt: fileHint + prompt,
        userPrompt: prompt,
        chatId: String(chatId),
        sessionId,
        signal: abortController.signal,
        onText: (text) => stream.appendText(text),
        onToolUse: (name) => stream.appendStatus(`[${name}]`),
        onSessionId: (id) => this._setSessionId(chatId, cli, id)
      })
      if (result?.sessionId) this._setSessionId(chatId, cli, result.sessionId)
      clearInterval(typingInterval)
      await stream.finalize()
    } catch (err) {
      clearInterval(typingInterval)
      if (err?.name === 'AbortError') {
        await stream.finalize('(cancelado)')
      } else {
        await stream.finalize(`Error: ${err?.message || err}`)
      }
    } finally {
      clearInterval(typingInterval)
      if (this.activeStreams.get(chatId) === abortController) {
        this.activeStreams.delete(chatId)
      }
    }
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
      await this._sendMessage(chatId, 'Transcribiendo nota de voz...')
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
      await this._sendMessage(chatId, `Voz: ${cleaned}`)
      await this._enqueueQuery(chatId, cleaned)
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
        '/cwd     -> carpeta actual',
        '/reset   -> empezar conversación nueva (olvida sesión)',
        '/salir   -> desconectar este chat del relay PTY',
        '/cancel  -> cancelar respuesta en curso',
        '/cli claude|codex -> cambiar CLI',
        '',
        'Manda texto normal o una nota de voz para hablar con el CLI activo.'
      ].join('\n'))
      return
    }

    if (lower === '/status') {
      const activeCli = await this.onGetActiveCli?.()
      const cwd = await this.onGetCwd?.()
      const session = this._getSessionId(chatId, activeCli)
      await this._sendMessage(chatId, [
        `Bridge: ${this.running ? 'ON' : 'OFF'}`,
        `Bot: ${this.botUsername ? '@' + this.botUsername : '(sin username)'}`,
        `CLI: ${activeCli || 'desconocido'}`,
        `CWD: ${cwd || '(desconocido)'}`,
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
      this._clearSessions(chatId)
      const ctrl = this.activeStreams.get(chatId)
      if (ctrl) try { ctrl.abort() } catch {}
      await this._sendMessage(chatId, 'Conversación reseteada. Próximo mensaje empieza sesión nueva.')
      return
    }

    if (lower === '/salir' || lower === '/unlink' || lower === '/disconnect') {
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

    await this._sendMessage(chatId, 'Comando no reconocido. Usa /help.')
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

  async _sendMessage(chatId, text) {
    const normalized = String(text || '').trim()
    if (!normalized) return null
    const blocks = splitByLimit(normalized, MAX_MESSAGE_LEN)
    let last = null
    for (const chunk of blocks) {
      last = await this._api('sendMessage', {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true
      })
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

module.exports = { TelegramBridge }
