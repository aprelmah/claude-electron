const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const pty = require('node-pty')
const { WebSocketServer } = require('ws')

const DEFAULT_LAN_WS_PORT = 9999
const MIN_LAN_PORT = 1024
const MAX_LAN_PORT = 65534
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 35

function clampLanPort(rawPort) {
  const n = Number.parseInt(String(rawPort || ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_LAN_WS_PORT
  if (n < MIN_LAN_PORT) return MIN_LAN_PORT
  if (n > MAX_LAN_PORT) return MAX_LAN_PORT
  return n
}

function normalizeRemoteIp(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (text.startsWith('::ffff:')) return text.slice(7)
  if (text === '::1') return '127.0.0.1'
  return text
}

function isPrivateIPv4(ip) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10))
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false
  if (parts[0] === 10) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return false
}

function pickLanIPv4() {
  const nets = os.networkInterfaces()
  const privateCandidates = []
  const publicCandidates = []
  for (const entries of Object.values(nets || {})) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue
      const addr = String(entry.address || '').trim()
      if (!addr) continue
      if (isPrivateIPv4(addr)) privateCandidates.push(addr)
      else publicCandidates.push(addr)
    }
  }
  return privateCandidates[0] || publicCandidates[0] || '127.0.0.1'
}

function parseJsonMessage(raw) {
  try {
    return JSON.parse(String(raw || ''))
  } catch {
    return null
  }
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== 1) return
  try { ws.send(JSON.stringify(payload)) } catch {}
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

function buildDefaultExec(bin, args = []) {
  const cmd = [shellQuote(bin), ...args.map(shellQuote)].join(' ')
  return `exec ${cmd}`
}

function createLanWsServer(options = {}) {
  const getSessionConfig = typeof options.getSessionConfig === 'function'
    ? options.getSessionConfig
    : (() => ({ cli: 'claude', cwd: os.homedir(), bin: 'claude', env: { ...process.env }, args: [] }))
  const transcribeAudio = typeof options.transcribeAudio === 'function' ? options.transcribeAudio : null
  const logger = typeof options.logger === 'function' ? options.logger : (() => {})
  const buildExecCommand = typeof options.buildExecCommand === 'function' ? options.buildExecCommand : buildDefaultExec

  let wsServer = null
  let httpServer = null
  let running = false
  let port = DEFAULT_LAN_WS_PORT
  let httpPort = DEFAULT_LAN_WS_PORT + 1
  let lanIp = '127.0.0.1'
  let clientHtmlPath = options.clientHtmlPath || ''

  const sessions = new Map()

  function listSessions() {
    return Array.from(sessions.values())
      .map((s) => ({
        id: s.id,
        ip: s.ip,
        cli: s.cli,
        cwd: s.cwd,
        connectedAt: s.connectedAt
      }))
      .sort((a, b) => a.connectedAt - b.connectedAt)
  }

  function killSessionPty(session) {
    if (!session?.ptyProcess) return
    try { session.ptyProcess._alive = false } catch {}
    try { session.ptyProcess.kill() } catch {}
    session.ptyProcess = null
  }

  function closeSession(sessionId, reason = 'closed') {
    const session = sessions.get(String(sessionId || ''))
    if (!session) return false
    sessions.delete(session.id)
    killSessionPty(session)
    safeSend(session.ws, { type: 'status', state: reason, sessionId: session.id })
    try { session.ws.close(1000, reason) } catch {}
    logger(`[lan] session closed ${session.id} (${reason})`)
    return true
  }

  function closeAllSessions(reason = 'server-stopped') {
    for (const id of Array.from(sessions.keys())) {
      closeSession(id, reason)
    }
  }

  async function handleAudioMessage(session, payload) {
    const base64 = typeof payload?.data === 'string' ? payload.data.trim() : ''
    if (!base64) {
      safeSend(session.ws, { type: 'status', state: 'error', message: 'audio payload vacío', sessionId: session.id })
      return
    }
    if (!transcribeAudio) {
      safeSend(session.ws, { type: 'status', state: 'error', message: 'transcripción no disponible', sessionId: session.id })
      return
    }

    const audioFilePath = path.join('/tmp', `wa-audio-${session.id}-${Date.now()}.webm`)
    safeSend(session.ws, { type: 'status', state: 'transcribing', sessionId: session.id })
    try {
      fs.writeFileSync(audioFilePath, Buffer.from(base64, 'base64'))
      const transcript = String(await transcribeAudio(audioFilePath)).trim()
      if (!transcript) throw new Error('Transcripción vacía')
      safeSend(session.ws, { type: 'transcript', text: transcript, sessionId: session.id })
      if (session.ptyProcess?._alive) {
        const toWrite = transcript.endsWith('\n') ? transcript : `${transcript}\n`
        session.ptyProcess.write(toWrite)
      }
    } catch (err) {
      safeSend(session.ws, {
        type: 'status',
        state: 'error',
        sessionId: session.id,
        message: err?.message || String(err)
      })
    } finally {
      try { fs.unlinkSync(audioFilePath) } catch {}
    }
  }

  function onClientMessage(session, raw) {
    if (!raw) return
    const payload = parseJsonMessage(raw)
    if (!payload || typeof payload !== 'object') {
      safeSend(session.ws, { type: 'status', state: 'error', sessionId: session.id, message: 'mensaje inválido' })
      return
    }

    const msgType = String(payload.type || '').trim()
    if (msgType === 'input') {
      if (session.ptyProcess?._alive && typeof payload.data === 'string') {
        try { session.ptyProcess.write(payload.data) } catch {}
      }
      return
    }

    if (msgType === 'resize') {
      const cols = Math.max(20, Number.parseInt(payload.cols, 10) || DEFAULT_COLS)
      const rows = Math.max(10, Number.parseInt(payload.rows, 10) || DEFAULT_ROWS)
      session.cols = cols
      session.rows = rows
      if (session.ptyProcess?._alive) {
        try { session.ptyProcess.resize(cols, rows) } catch {}
      }
      return
    }

    if (msgType === 'audio') {
      session.audioQueue = (session.audioQueue || Promise.resolve())
        .then(() => handleAudioMessage(session, payload))
        .catch(() => {})
      return
    }

    safeSend(session.ws, { type: 'status', state: 'error', sessionId: session.id, message: `tipo no soportado: ${msgType}` })
  }

  function createPtyForSession(session, config) {
    const bin = String(config?.bin || '').trim()
    if (!bin) throw new Error('No hay binario CLI configurado')
    const args = Array.isArray(config?.args) ? config.args : []
    const execCommand = buildExecCommand(bin, args)
    return pty.spawn('/bin/bash', ['-c', execCommand], {
      name: 'xterm-256color',
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      env: config?.env || { ...process.env }
    })
  }

  function onWsConnection(ws, req) {
    let defaults = null
    try {
      defaults = getSessionConfig() || {}
    } catch (err) {
      safeSend(ws, {
        type: 'status',
        state: 'error',
        message: err?.message || String(err)
      })
      try { ws.close(1011, 'session-config-error') } catch {}
      return
    }
    const session = {
      id: crypto.randomUUID(),
      ws,
      ip: normalizeRemoteIp(req?.socket?.remoteAddress),
      cli: defaults.cli === 'codex' ? 'codex' : 'claude',
      cwd: String(defaults.cwd || os.homedir()),
      connectedAt: Date.now(),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      ptyProcess: null,
      audioQueue: Promise.resolve()
    }

    let ptyProcess = null
    try {
      ptyProcess = createPtyForSession(session, defaults)
    } catch (err) {
      safeSend(ws, {
        type: 'status',
        state: 'error',
        message: `no se pudo iniciar PTY remoto: ${err?.message || err}`
      })
      try { ws.close(1011, 'pty-start-failed') } catch {}
      return
    }

    session.ptyProcess = ptyProcess
    try { ptyProcess._alive = true } catch {}
    sessions.set(session.id, session)

    safeSend(ws, {
      type: 'status',
      state: 'connected',
      sessionId: session.id,
      cli: session.cli,
      cwd: session.cwd,
      connectedAt: session.connectedAt
    })

    ptyProcess.onData((data) => {
      if (!ptyProcess._alive) return
      safeSend(ws, { type: 'output', data: String(data), sessionId: session.id })
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      safeSend(ws, {
        type: 'status',
        state: 'pty-exit',
        sessionId: session.id,
        exitCode,
        signal
      })
      if (sessions.get(session.id)?.ptyProcess === ptyProcess) {
        sessions.get(session.id).ptyProcess = null
      }
    })

    ws.on('message', (raw) => onClientMessage(session, raw))
    ws.on('close', () => {
      if (!sessions.has(session.id)) return
      sessions.delete(session.id)
      killSessionPty(session)
      logger(`[lan] session disconnected ${session.id}`)
    })
    ws.on('error', () => {
      if (!sessions.has(session.id)) return
      sessions.delete(session.id)
      killSessionPty(session)
    })

    logger(`[lan] session connected ${session.id} from ${session.ip || 'unknown'}`)
  }

  function startHttpServer() {
    if (!clientHtmlPath || !fs.existsSync(clientHtmlPath)) {
      throw new Error(`Cliente LAN no encontrado: ${clientHtmlPath || '(vacío)'}`)
    }
    httpServer = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1')
      if (u.pathname === '/' || u.pathname === '/lan-client.html') {
        try {
          const html = fs.readFileSync(clientHtmlPath, 'utf8')
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(html)
        } catch (err) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(err?.message || String(err))
        }
        return
      }
      if (u.pathname === '/status') {
        const body = JSON.stringify({ ok: true, running, port, httpPort, ip: lanIp, sessions: listSessions() })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
    })
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        httpServer?.off('error', onError)
        reject(err)
      }
      httpServer.once('error', onError)
      httpServer.listen(httpPort, '0.0.0.0', () => {
        httpServer?.off('error', onError)
        resolve()
      })
    })
  }

  async function start(opts = {}) {
    const nextPort = clampLanPort(opts?.port ?? port)
    const nextHtmlPath = String(opts?.clientHtmlPath || clientHtmlPath || '').trim()
    if (!nextHtmlPath) throw new Error('Ruta de cliente LAN no configurada')

    if (running) await stop()

    port = nextPort
    httpPort = port + 1
    clientHtmlPath = nextHtmlPath
    lanIp = pickLanIPv4()

    wsServer = new WebSocketServer({ port, host: '0.0.0.0' })
    wsServer.on('connection', onWsConnection)

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        wsServer?.off('error', onError)
        reject(err)
      }
      wsServer.once('error', onError)
      wsServer.once('listening', () => {
        wsServer?.off('error', onError)
        resolve()
      })
    })

    try {
      await startHttpServer()
    } catch (err) {
      try { wsServer.close() } catch {}
      wsServer = null
      throw err
    }

    running = true
    logger(`[lan] ws server started on ${lanIp}:${port}`)
    return {
      ok: true,
      running,
      ip: lanIp,
      port,
      httpPort,
      clientUrl: `http://${lanIp}:${httpPort}/lan-client.html?host=${encodeURIComponent(lanIp)}&port=${port}`
    }
  }

  async function stop() {
    closeAllSessions('server-stopped')

    const wsToClose = wsServer
    const httpToClose = httpServer
    wsServer = null
    httpServer = null

    await Promise.all([
      new Promise((resolve) => {
        if (!wsToClose) return resolve()
        try { wsToClose.close(() => resolve()) } catch { resolve() }
      }),
      new Promise((resolve) => {
        if (!httpToClose) return resolve()
        try { httpToClose.close(() => resolve()) } catch { resolve() }
      })
    ])

    running = false
    logger('[lan] ws server stopped')
    return { ok: true, running: false }
  }

  function getStatus() {
    return {
      running,
      ip: lanIp,
      port,
      httpPort,
      clientUrl: `http://${lanIp}:${httpPort}/lan-client.html?host=${encodeURIComponent(lanIp)}&port=${port}`,
      sessions: listSessions()
    }
  }

  return {
    start,
    stop,
    listSessions,
    closeSession,
    getStatus,
    isRunning: () => running
  }
}

module.exports = {
  createLanWsServer,
  clampLanPort,
  pickLanIPv4,
  DEFAULT_LAN_WS_PORT
}
