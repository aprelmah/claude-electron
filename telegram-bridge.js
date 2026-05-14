const fs = require('fs')
const https = require('https')
const path = require('path')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stripAnsi(text) {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
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

class TelegramBridge {
  constructor({
    tmpDir,
    onTerminalInput,
    onTranscribeFile,
    onGetActiveCli,
    onGetCwd,
    onRestartTerminal,
    onSetCli,
    onStatus
  }) {
    this.tmpDir = tmpDir
    this.onTerminalInput = onTerminalInput
    this.onTranscribeFile = onTranscribeFile
    this.onGetActiveCli = onGetActiveCli
    this.onGetCwd = onGetCwd
    this.onRestartTerminal = onRestartTerminal
    this.onSetCli = onSetCli
    this.onStatus = onStatus

    this.config = null
    this.running = false
    this.loopPromise = null
    this.abortController = null
    this.offset = 0

    this.activeChats = new Set()
    this.allowedUsers = new Set()
    this.buffers = new Map()
    this.flushTimer = null

    this.botUsername = ''
    this.lastError = ''
    this.lastInfo = 'Telegram desactivado'
    this.startedAt = 0
  }

  getStatus() {
    return {
      running: this.running,
      botUsername: this.botUsername,
      lastError: this.lastError,
      lastInfo: this.lastInfo,
      activeChats: Array.from(this.activeChats),
      startedAt: this.startedAt
    }
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
    this.activeChats.clear()
    this.buffers.clear()
    this.offset = 0
    this._emitStatus()

    // Si el bot venia de webhook, desactiva webhook para long polling.
    await this._api('deleteWebhook', { drop_pending_updates: true })
    const me = await this._api('getMe')
    this.botUsername = me?.username || ''
    this.lastInfo = this.botUsername ? `Telegram activo (@${this.botUsername})` : 'Telegram activo'
    this._emitStatus()

    this.loopPromise = this._pollLoop()
  }

  async stop() {
    this.running = false
    this.botUsername = this.botUsername || ''
    if (this.abortController) {
      try { this.abortController.abort() } catch {}
      this.abortController = null
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.loopPromise) {
      try { await Promise.race([this.loopPromise, sleep(1000)]) } catch {}
      this.loopPromise = null
    }
  }

  pushTerminalData(data) {
    if (!this.running || !this.activeChats.size) return
    const clean = stripAnsi(String(data || '')).replace(/\r/g, '')
    if (!clean.trim()) return

    for (const chatId of this.activeChats) {
      const merged = (this.buffers.get(chatId) || '') + clean
      this.buffers.set(chatId, merged.slice(-12000))
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        this._flushBuffers().catch((err) => this._setError(err?.message || err))
      }, 1200)
    }
  }

  async _flushBuffers() {
    if (!this.running || !this.buffers.size) return
    const jobs = []
    for (const [chatId, text] of this.buffers.entries()) {
      this.buffers.delete(chatId)
      const trimmed = text.trim()
      if (!trimmed) continue
      const blocks = splitByLimit(trimmed, 3500)
      for (const chunk of blocks) {
        jobs.push(this._sendMessage(chatId, chunk))
      }
    }
    for (const job of jobs) await job
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
        for (const update of updates) {
          this.offset = Math.max(this.offset, (update.update_id || 0) + 1)
          await this._handleUpdate(update)
        }
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

    this.activeChats.add(chatId)
    this.lastInfo = `Telegram activo (${this.activeChats.size} chat(s) conectados)`
    this._emitStatus()

    if (message.voice?.file_id) {
      await this._handleVoice(chatId, message.voice.file_id)
      return
    }

    const text = (message.text || '').trim()
    if (!text) return

    if (text.startsWith('/')) {
      await this._handleCommand(chatId, text)
      return
    }

    await this.onTerminalInput?.(`${text}\n`)
    await this._sendMessage(chatId, 'OK. Enviado al terminal.')
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

      await this.onTerminalInput?.(`${transcript.trim()}\n`)
      await this._sendMessage(chatId, `Voz -> texto:\n${transcript.trim()}`)
    } catch (err) {
      await this._sendMessage(chatId, `Error en voz: ${err?.message || err}`)
    }
  }

  async _handleCommand(chatId, rawText) {
    const text = rawText.trim()
    const lower = text.toLowerCase()

    if (lower === '/start' || lower === '/help') {
      await this._sendMessage(chatId, [
        'CLAUDE-NOVAK Telegram bridge activo.',
        '',
        'Comandos:',
        '/status  -> estado del bridge',
        '/cwd     -> carpeta actual',
        '/restart -> reiniciar terminal',
        '/cli claude|codex -> cambiar CLI',
        '',
        'Tambien puedes mandar texto normal o una nota de voz.'
      ].join('\n'))
      return
    }

    if (lower === '/status') {
      const activeCli = await this.onGetActiveCli?.()
      const cwd = await this.onGetCwd?.()
      await this._sendMessage(chatId, [
        `Bridge: ${this.running ? 'ON' : 'OFF'}`,
        `Bot: ${this.botUsername ? '@' + this.botUsername : '(sin username)'}`,
        `CLI: ${activeCli || 'desconocido'}`,
        `CWD: ${cwd || '(desconocido)'}`,
        `Chats conectados: ${this.activeChats.size}`
      ].join('\n'))
      return
    }

    if (lower === '/cwd') {
      const cwd = await this.onGetCwd?.()
      await this._sendMessage(chatId, `CWD: ${cwd || '(desconocido)'}`)
      return
    }

    if (lower === '/restart') {
      try {
        await this.onRestartTerminal?.()
        await this._sendMessage(chatId, 'Terminal reiniciado.')
      } catch (err) {
        await this._sendMessage(chatId, `Error reiniciando: ${err?.message || err}`)
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
        await this.onRestartTerminal?.()
        await this._sendMessage(chatId, `CLI cambiado a ${target}.`)
      } else {
        await this._sendMessage(chatId, `No se pudo cambiar CLI: ${result?.error || 'error'}`)
      }
      return
    }

    await this._sendMessage(chatId, 'Comando no reconocido. Usa /help.')
  }

  async _sendMessage(chatId, text) {
    const normalized = String(text || '').trim()
    if (!normalized) return
    await this._api('sendMessage', {
      chat_id: chatId,
      text: normalized,
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
      throw new Error(`Telegram ${method}: ${data.description || 'error'}`)
    }
    return data.result
  }
}

module.exports = { TelegramBridge }
