const { app, BrowserWindow, Menu, globalShortcut, ipcMain, nativeTheme, dialog, session, systemPreferences } = require('electron')
const pty = require('node-pty')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { TelegramBridge } = require('./telegram-bridge')

const USER_LOCAL_BIN = path.join(os.homedir(), '.local/bin')
const PYTHON39_BIN = path.join(os.homedir(), 'Library/Python/3.9/bin')
const HOMEBREW_BIN = '/usr/local/bin'
const TMP_DIR = '/tmp/claude-electron'
const WHISPER_CPP_MODEL = process.env.WHISPER_CPP_MODEL || path.join(os.homedir(), '.cache/whisper-cpp/ggml-base-q5_1.bin')
const FFMPEG_BIN = resolveCommand([
  process.env.FFMPEG_BIN,
  path.join(PYTHON39_BIN, 'ffmpeg'),
  path.join(HOMEBREW_BIN, 'ffmpeg'),
  'ffmpeg'
])
const CONFIG_FILENAME = 'claude-novak.config.json'

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// ── Per-window sessions ──
// key = webContents.id → WindowSession { win, wcId, ordinal, pty, cols, rows, cwd, activeCli, treeWatcher, treeWatcherPath, treeWatchDebounce }
const sessions = new Map()
let primaryWcId = null
let lastPrimarySnapshot = { cwd: os.homedir(), activeCli: 'claude' }
let nextOrdinal = 0
let telegramBridge = null

const DEFAULT_CONFIG = Object.freeze({
  cli: {
    defaultCli: 'claude',
    claudeBin: '',
    codexBin: '',
    whisperBin: ''
  },
  telegram: {
    enabled: false,
    botToken: '',
    allowedUsers: [],
    claudeModel: '',
    claudeEffort: '',
    codexModel: '',
    codexEffort: ''
  }
})

let appConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))

function resolveCommand(candidates) {
  for (const cmd of candidates) {
    if (!cmd) continue
    if (!cmd.includes('/')) return cmd
    if (fs.existsSync(cmd)) return cmd
  }
  return candidates.find(Boolean) || ''
}

const FALLBACK_CLAUDE_BIN = resolveCommand([
  process.env.CLAUDE_BIN,
  path.join(USER_LOCAL_BIN, 'claude'),
  'claude'
])

const FALLBACK_CODEX_BIN = resolveCommand([
  process.env.CODEX_BIN,
  path.join(USER_LOCAL_BIN, 'codex'),
  path.join(os.homedir(), '.nvm/versions/node/v24.15.0/bin/codex'),
  'codex'
])

const FALLBACK_WHISPER_BIN = resolveCommand([
  process.env.WHISPER_BIN,
  path.join(HOMEBREW_BIN, 'whisper-cli'),
  'whisper-cli'
])

const WHISPER_HALLUCINATIONS = [
  /iglesia de jesucristo/i,
  /santos de los .*ltimos d.as/i,
  /amara\.org/i,
  /subt.tulos? (realizados|por la comunidad|creados)/i,
  /subtitulado por/i,
  /^\s*\[?(m.sica|aplausos|risas|silencio|ruido)\]?\s*$/i,
  /gracias por ver/i,
  /suscr.bete/i
]

function measureMeanVolume(filePath, env) {
  return new Promise((resolve) => {
    const ff = spawn(FFMPEG_BIN, ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { env })
    let stderr = ''
    ff.stderr.on('data', (d) => { stderr += d.toString() })
    ff.on('error', () => resolve(null))
    ff.on('close', () => {
      const m = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)
      resolve(m ? parseFloat(m[1]) : null)
    })
  })
}

async function transcribeAudioFile(inputPath, env) {
  const whisperBin = getConfiguredWhisperBin()
  if (!commandExists(whisperBin, env)) throw new Error(`Whisper no disponible (${whisperBin}). Instala con: brew install whisper-cpp`)
  if (!commandExists(FFMPEG_BIN, env)) throw new Error(`ffmpeg no disponible (${FFMPEG_BIN}).`)
  if (!fs.existsSync(WHISPER_CPP_MODEL)) throw new Error(`Modelo no encontrado: ${WHISPER_CPP_MODEL}`)

  const meanDb = await measureMeanVolume(inputPath, env)
  if (meanDb !== null && meanDb < -50) {
    throw new Error('Sin audio reconocible (silencio).')
  }

  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  const wavPath = path.join(TMP_DIR, `whisper-${stamp}.wav`)
  const txtBase = path.join(TMP_DIR, `whisper-${stamp}`)
  const txtPath = `${txtBase}.txt`

  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG_BIN, ['-y', '-loglevel', 'error', '-i', inputPath, '-ac', '1', '-ar', '16000', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', wavPath], { env })
    let ffErr = ''
    ff.stderr.on('data', (d) => { ffErr += d.toString() })
    ff.on('error', reject)
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${ffErr.slice(-300)}`))
      const wp = spawn(whisperBin, ['-m', WHISPER_CPP_MODEL, '-l', 'es', '-nt', '-sns', '-nth', '0.3', '--prompt', 'Transcripción en castellano.', '-otxt', '-of', txtBase, '-f', wavPath], { env })
      let wpErr = ''
      wp.stderr.on('data', (d) => { wpErr += d.toString() })
      wp.on('error', (err) => { try { fs.unlinkSync(wavPath) } catch {} ; reject(err) })
      wp.on('close', (wcode) => {
        try { fs.unlinkSync(wavPath) } catch {}
        if (wcode !== 0) return reject(new Error(`whisper-cli exit ${wcode}: ${wpErr.slice(-300)}`))
        try {
          const text = fs.readFileSync(txtPath, 'utf-8').trim()
          try { fs.unlinkSync(txtPath) } catch {}
          if (!text) return reject(new Error('Sin voz reconocida.'))
          if (WHISPER_HALLUCINATIONS.some((re) => re.test(text))) return reject(new Error('Sin voz reconocida.'))
          resolve(text)
        } catch (err) { reject(err) }
      })
    })
  })
}

function normalizeAppConfig(raw) {
  const cli = raw?.cli || {}
  const telegram = raw?.telegram || {}

  const normalized = {
    cli: {
      defaultCli: cli.defaultCli === 'codex' ? 'codex' : 'claude',
      claudeBin: typeof cli.claudeBin === 'string' ? cli.claudeBin.trim() : '',
      codexBin: typeof cli.codexBin === 'string' ? cli.codexBin.trim() : '',
      whisperBin: typeof cli.whisperBin === 'string' ? cli.whisperBin.trim() : ''
    },
    telegram: {
      enabled: Boolean(telegram.enabled),
      botToken: typeof telegram.botToken === 'string' ? telegram.botToken.trim() : '',
      allowedUsers: [],
      claudeModel: typeof telegram.claudeModel === 'string' ? telegram.claudeModel.trim() : '',
      claudeEffort: typeof telegram.claudeEffort === 'string' ? telegram.claudeEffort.trim() : '',
      codexModel: typeof telegram.codexModel === 'string' ? telegram.codexModel.trim() : '',
      codexEffort: typeof telegram.codexEffort === 'string' ? telegram.codexEffort.trim() : ''
    }
  }

  if (Array.isArray(telegram.allowedUsers)) {
    normalized.telegram.allowedUsers = telegram.allowedUsers.map((u) => String(u).trim()).filter(Boolean)
  } else if (typeof telegram.allowedUsers === 'string') {
    normalized.telegram.allowedUsers = telegram.allowedUsers.split(/[,\s]+/g).map((u) => u.trim()).filter(Boolean)
  }
  normalized.telegram.allowedUsers = Array.from(new Set(normalized.telegram.allowedUsers))

  return normalized
}

function configFilePath() {
  return path.join(app.getPath('userData'), CONFIG_FILENAME)
}

function loadAppConfig() {
  try {
    const p = configFilePath()
    if (!fs.existsSync(p)) return normalizeAppConfig(DEFAULT_CONFIG)
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return normalizeAppConfig(raw)
  } catch {
    return normalizeAppConfig(DEFAULT_CONFIG)
  }
}

function saveAppConfig(nextConfig) {
  const normalized = normalizeAppConfig(nextConfig)
  const p = configFilePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(normalized, null, 2), 'utf-8')
  appConfig = normalized
  return normalized
}

function getConfiguredBin(cli) {
  if (cli === 'codex') return appConfig.cli.codexBin || FALLBACK_CODEX_BIN
  return appConfig.cli.claudeBin || FALLBACK_CLAUDE_BIN
}

function getConfiguredWhisperBin() {
  return appConfig.cli.whisperBin || FALLBACK_WHISPER_BIN
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

function buildFdLimitCommand(bin, args = []) {
  const parts = [shellQuote(bin), ...args.map(shellQuote)]
  const log = '/tmp/claude-novak-fd.log'
  return `echo "[$(date +%H:%M:%S)] before ulimit=$(ulimit -n) hard=$(ulimit -Hn) bin=${shellQuote(bin)}" >> ${log} 2>/dev/null; ulimit -n 65536 2>/dev/null || true; echo "[$(date +%H:%M:%S)] after  ulimit=$(ulimit -n)" >> ${log} 2>/dev/null; exec ${parts.join(' ')}`
}

function buildRuntimeEnv() {
  const extraPaths = [USER_LOCAL_BIN, PYTHON39_BIN, '/usr/local/bin']
  for (const candidate of [appConfig.cli.claudeBin, appConfig.cli.codexBin, appConfig.cli.whisperBin]) {
    if (candidate && candidate.includes('/')) extraPaths.push(path.dirname(candidate))
  }
  const mergedPath = Array.from(new Set([...extraPaths, process.env.PATH || ''])).join(':')
  return {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: process.env.LANG || 'en_US.UTF-8',
    PATH: mergedPath
  }
}

function commandExists(command, env) {
  if (!command) return false
  if (command.includes('/')) return fs.existsSync(command)
  const probe = spawnSync('/bin/bash', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], { env })
  return probe.status === 0
}

function cliMeta(cli) {
  if (cli === 'codex') return { name: 'Codex', bin: getConfiguredBin('codex'), envVar: 'CODEX_BIN' }
  return { name: 'Claude', bin: getConfiguredBin('claude'), envVar: 'CLAUDE_BIN' }
}

function ensureCliAvailable(cli) {
  const meta = cliMeta(cli)
  const env = buildRuntimeEnv()
  if (!commandExists(meta.bin, env)) {
    return {
      ok: false,
      error: `${meta.name} no está disponible (${meta.bin}). Ajusta ${meta.envVar} o instala el comando en PATH.`
    }
  }
  return { ok: true, ...meta, env }
}

// ── Session helpers ──
function getSession(wcId) {
  return sessions.get(wcId) || null
}

function getSessionByEvent(event) {
  return sessions.get(event.sender.id) || null
}

function winFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender)
}

function notifyPtyError(session, message) {
  if (!session) return
  const wc = session.win?.webContents
  if (wc && !session.win.isDestroyed()) wc.send('pty-error', message)
}

function broadcastTelegramStatus() {
  const status = telegramBridge?.getStatus() || null
  for (const s of sessions.values()) {
    if (s.win && !s.win.isDestroyed()) s.win.webContents.send('telegram-status', status)
  }
}

function updatePrimarySnapshot() {
  const s = primaryWcId != null ? sessions.get(primaryWcId) : null
  if (s) lastPrimarySnapshot = { cwd: s.cwd, activeCli: s.activeCli }
}

function getCwdSync() {
  const s = primaryWcId != null ? sessions.get(primaryWcId) : null
  if (s) return s.cwd
  return lastPrimarySnapshot.cwd
}

function getActiveCliSync() {
  const s = primaryWcId != null ? sessions.get(primaryWcId) : null
  if (s) return s.activeCli
  return lastPrimarySnapshot.activeCli
}

// ── Tree watcher per-session ──
function notifyTreeChangedFor(session, reason) {
  if (!session) return
  if (session.treeWatchDebounce) clearTimeout(session.treeWatchDebounce)
  session.treeWatchDebounce = setTimeout(() => {
    if (!sessions.has(session.wcId)) return
    if (session.win && !session.win.isDestroyed()) {
      session.win.webContents.send('tree-changed', reason)
    }
  }, 350)
}

// ── PTY per-session ──
function startPty(session, cols, rows, cwd, args = []) {
  if (!session) throw new Error('Sesión no disponible')
  if (session.pty) return session.pty
  if (cols && rows) {
    session.cols = cols
    session.rows = rows
  }
  if (cwd && fs.existsSync(cwd)) session.cwd = cwd
  const cliCheck = ensureCliAvailable(session.activeCli)
  if (!cliCheck.ok) {
    notifyPtyError(session, cliCheck.error)
    throw new Error(cliCheck.error)
  }

  let proc
  try {
    proc = pty.spawn('/bin/bash', ['-c', buildFdLimitCommand(cliCheck.bin, args)], {
      name: 'xterm-256color',
      cols: session.cols || 120,
      rows: session.rows || 35,
      cwd: session.cwd,
      env: cliCheck.env
    })
  } catch (err) {
    const msg = `No se pudo iniciar ${cliCheck.name}: ${err.message || err}`
    notifyPtyError(session, msg)
    throw new Error(msg)
  }

  proc._alive = true
  session.pty = proc
  const myWcId = session.wcId

  proc.onData((data) => {
    if (!proc._alive) return
    const s = sessions.get(myWcId)
    if (!s || !s.win || s.win.isDestroyed()) return
    s.win.webContents.send('pty-data', data)
  })

  proc.onExit(() => {
    if (proc._alive) {
      const s = sessions.get(myWcId)
      if (s && s.win && !s.win.isDestroyed()) s.win.webContents.send('pty-exit')
    }
    const s = sessions.get(myWcId)
    if (s && s.pty === proc) s.pty = null
  })

  if (session === sessions.get(primaryWcId)) updatePrimarySnapshot()
  return proc
}

function killPty(session) {
  if (!session || !session.pty) return
  session.pty._alive = false
  try { session.pty.kill() } catch {}
  session.pty = null
}

function setActiveCli(session, cli) {
  if (!session) return { ok: false, error: 'No window session' }
  if (cli !== 'claude' && cli !== 'codex') return { ok: false, error: 'Invalid CLI' }
  const check = ensureCliAvailable(cli)
  if (!check.ok) return { ok: false, error: check.error }
  if (session.activeCli === cli) return { ok: true }
  session.activeCli = cli
  killPty(session)
  if (session === sessions.get(primaryWcId)) updatePrimarySnapshot()
  return { ok: true }
}

function destroySession(wcId) {
  const s = sessions.get(wcId)
  if (!s) return
  if (s.treeWatchDebounce) { clearTimeout(s.treeWatchDebounce); s.treeWatchDebounce = null }
  if (s.treeWatcher) { try { s.treeWatcher.close() } catch {} s.treeWatcher = null }
  killPty(s)
  sessions.delete(wcId)
  if (primaryWcId === wcId) {
    // freeze snapshot
    lastPrimarySnapshot = { cwd: s.cwd, activeCli: s.activeCli }
    // reassign to any remaining session
    const next = sessions.keys().next().value
    primaryWcId = next != null ? next : null
    if (primaryWcId != null) updatePrimarySnapshot()
  }
}

// ── Window creation ──
function createWindow() {
  const ordinal = nextOrdinal++
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const wcId = win.webContents.id
  const session = {
    win,
    wcId,
    ordinal,
    pty: null,
    cols: 120,
    rows: 35,
    cwd: os.homedir(),
    activeCli: appConfig.cli.defaultCli === 'codex' ? 'codex' : 'claude',
    treeWatcher: null,
    treeWatcherPath: null,
    treeWatchDebounce: null
  }
  sessions.set(wcId, session)

  if (primaryWcId == null) {
    primaryWcId = wcId
    updatePrimarySnapshot()
  }

  win.loadFile('index.html', { query: { wid: String(ordinal) } })

  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('telegram-status', telegramBridge?.getStatus() || null)
  })

  win.on('focus', () => {
    primaryWcId = wcId
    updatePrimarySnapshot()
    notifyTreeChangedFor(session, 'focus')
  })

  win.on('closed', () => {
    destroySession(wcId)
  })

  return win
}

// ── Bridge wiring (one global bridge) ──
function initTelegramBridge() {
  telegramBridge = new TelegramBridge({
    tmpDir: TMP_DIR,
    onTranscribeFile: async (filePath) => {
      return transcribeAudioFile(filePath, buildRuntimeEnv())
    },
    onRunQuery: async (opts) => {
      const tg = appConfig.telegram || {}
      const cwd = getCwdSync()
      if (opts?.cli === 'codex') {
        return runCodexHeadless({ ...opts, cwd, model: tg.codexModel || '', effort: tg.codexEffort || '' })
      }
      const compacted = compactClaudeSessionIfNeeded({ sessionId: opts?.sessionId, prompt: opts?.prompt, cwd })
      return runClaudeHeadless({ ...opts, ...compacted, cwd, model: tg.claudeModel || '', effort: tg.claudeEffort || '' })
    },
    onGetActiveCli: async () => getActiveCliSync(),
    onGetCwd: async () => getCwdSync(),
    onSetCli: async (cli) => {
      const s = primaryWcId != null ? sessions.get(primaryWcId) : null
      if (s) return setActiveCli(s, cli)
      // decision: sin ventana primaria, persiste como defaultCli y devuelve ok
      if (cli !== 'claude' && cli !== 'codex') return { ok: false, error: 'Invalid CLI' }
      const merged = normalizeAppConfig({
        ...appConfig,
        cli: { ...appConfig.cli, defaultCli: cli }
      })
      saveAppConfig(merged)
      lastPrimarySnapshot = { ...lastPrimarySnapshot, activeCli: cli }
      return { ok: true }
    },
    onStatus: () => broadcastTelegramStatus()
  })
}

const TG_HISTORY_THRESHOLD = 30
const TG_HISTORY_KEEP = 20

function extractTurnText(obj) {
  if (!obj?.message?.content) return ''
  const content = obj.message.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block?.type === 'text' && typeof block.text === 'string') return block.text
        return ''
      })
      .join(' ')
      .trim()
  }
  return ''
}

function compactClaudeSessionIfNeeded({ sessionId, prompt, cwd }) {
  if (!sessionId) return { sessionId, prompt }
  const baseCwd = cwd || getCwdSync()
  const transcriptPath = path.join(projectDirFor(baseCwd), `${sessionId}.jsonl`)
  if (!fs.existsSync(transcriptPath)) return { sessionId: null, prompt }

  let raw
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8')
  } catch {
    return { sessionId, prompt }
  }

  const turns = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj?.type !== 'user' && obj?.type !== 'assistant') continue
    const text = extractTurnText(obj)
    if (!text) continue
    turns.push({ role: obj.type, text })
  }

  if (turns.length <= TG_HISTORY_THRESHOLD) return { sessionId, prompt }

  const recent = turns.slice(-TG_HISTORY_KEEP)
  const transcript = recent
    .map((t) => `${t.role === 'user' ? 'Usuario' : 'Asistente'}: ${t.text}`)
    .join('\n\n')

  const compactedPrompt =
    `[Contexto: conversación previa, últimos ${recent.length} turnos]\n\n` +
    transcript +
    `\n\n[Nuevo mensaje del usuario]\n${prompt}`

  return { sessionId: null, prompt: compactedPrompt }
}

function runClaudeHeadless({ prompt, sessionId, signal, onText, onToolUse, onSessionId, model, effort, cwd }) {
  const meta = cliMeta('claude')
  const env = buildRuntimeEnv()
  if (!commandExists(meta.bin, env)) {
    return Promise.reject(new Error(`Claude no disponible (${meta.bin}). Configura ${meta.envVar}.`))
  }

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions'
  ]
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  if (sessionId) args.push('--resume', sessionId)

  return new Promise((resolve, reject) => {
    let killed = false
    let child
    try {
      child = spawn('/bin/bash', ['-c', buildFdLimitCommand(meta.bin, args)], {
        cwd: cwd || getCwdSync(),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      return reject(err)
    }

    const abortHandler = () => {
      killed = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
    }
    if (signal) {
      if (signal.aborted) return abortHandler()
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    let buffer = ''
    let stderrBuf = ''
    let finalSessionId = null
    let finalText = ''
    let resultError = null

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (!obj || typeof obj !== 'object') continue

        if (obj.type === 'assistant' && obj.message?.content) {
          for (const block of obj.message.content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              onText?.(block.text)
            } else if (block?.type === 'tool_use' && block.name) {
              onToolUse?.(block.name)
            }
          }
        } else if (obj.type === 'result') {
          if (typeof obj.result === 'string') finalText = obj.result
          if (obj.is_error) resultError = obj.result || 'CLI devolvió error'
          if (obj.session_id) {
            finalSessionId = obj.session_id
            onSessionId?.(obj.session_id)
          }
        }
      }
    })

    child.stderr.on('data', (d) => { stderrBuf += d.toString() })
    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', abortHandler)
      reject(err)
    })
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abortHandler)
      if (killed) {
        const err = new Error('Cancelado')
        err.name = 'AbortError'
        return reject(err)
      }
      if (resultError) return reject(new Error(String(resultError)))
      if (code !== 0) {
        return reject(new Error(`claude exit ${code}: ${stderrBuf.slice(-500).trim() || 'sin stderr'}`))
      }
      resolve({ sessionId: finalSessionId, text: finalText })
    })
  })
}

function runCodexHeadless({ prompt, sessionId, signal, onText, onSessionId, model, effort, cwd }) {
  const meta = cliMeta('codex')
  const env = buildRuntimeEnv()
  if (!commandExists(meta.bin, env)) {
    return Promise.reject(new Error(`Codex no disponible (${meta.bin}). Configura ${meta.envVar}.`))
  }

  const baseFlags = ['--skip-git-repo-check', '--json']
  if (model) baseFlags.push('-m', model)
  if (effort) baseFlags.push('-c', `model_reasoning_effort=${effort}`)

  const args = sessionId
    ? ['exec', 'resume', sessionId, ...baseFlags, prompt]
    : ['exec', ...baseFlags, prompt]

  return new Promise((resolve, reject) => {
    let killed = false
    let child
    try {
      child = spawn('/bin/bash', ['-c', buildFdLimitCommand(meta.bin, args)], {
        cwd: cwd || getCwdSync(),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      return reject(err)
    }

    const abortHandler = () => {
      killed = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
    }
    if (signal) {
      if (signal.aborted) return abortHandler()
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    let buffer = ''
    let stderrBuf = ''
    let finalSessionId = null
    let finalText = ''

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (!obj || typeof obj !== 'object') continue

        if (obj.type === 'thread.started' && obj.thread_id) {
          finalSessionId = obj.thread_id
          onSessionId?.(obj.thread_id)
        } else if (obj.type === 'item.completed' && obj.item?.type === 'agent_message' && typeof obj.item.text === 'string') {
          finalText = obj.item.text
          onText?.(obj.item.text)
        }
      }
    })

    child.stderr.on('data', (d) => { stderrBuf += d.toString() })
    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', abortHandler)
      reject(err)
    })
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abortHandler)
      if (killed) {
        const err = new Error('Cancelado')
        err.name = 'AbortError'
        return reject(err)
      }
      if (code !== 0) {
        return reject(new Error(`codex exit ${code}: ${stderrBuf.slice(-500).trim() || 'sin stderr'}`))
      }
      resolve({ sessionId: finalSessionId, text: finalText })
    })
  })
}

// ── Application menu (Cmd+N / Cmd+W) ──
function buildAppMenu() {
  const isMac = process.platform === 'darwin'
  const template = []
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'Nueva ventana',
        accelerator: 'CmdOrCtrl+N',
        click: () => { createWindow() }
      },
      {
        label: 'Cerrar ventana',
        accelerator: 'CmdOrCtrl+W',
        click: () => { BrowserWindow.getFocusedWindow()?.close() }
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  })
  template.push({ role: 'editMenu' })
  template.push({ role: 'viewMenu' })
  template.push({ role: 'windowMenu' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Single instance lock ──
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    createWindow()
  })
}

app.whenReady().then(async () => {
  appConfig = loadAppConfig()

  // Autorizar getUserMedia (micro) y disparar prompt TCC nativo de macOS
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') return callback(true)
    callback(true)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)
  if (process.platform === 'darwin') {
    try {
      const ok = await systemPreferences.askForMediaAccess('microphone')
      console.log('[mic] askForMediaAccess →', ok)
    } catch (err) {
      console.log('[mic] askForMediaAccess error:', err?.message || err)
    }
  }

  buildAppMenu()
  initTelegramBridge()

  createWindow()

  telegramBridge.applyConfig(appConfig.telegram).catch((err) => {
    const s = primaryWcId != null ? sessions.get(primaryWcId) : null
    notifyPtyError(s, `Error iniciando Telegram bridge: ${err?.message || err}`)
  })

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused) {
      focused.isVisible() ? focused.hide() : focused.show()
      return
    }
    if (sessions.size === 0) {
      createWindow()
      return
    }
    // decision: sin foco pero con ventanas, mostrar la primera
    const first = sessions.values().next().value
    if (first?.win && !first.win.isDestroyed()) {
      first.win.isVisible() ? first.win.hide() : first.win.show()
    }
  })
})

app.on('activate', () => {
  if (sessions.size === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    globalShortcut.unregisterAll()
    telegramBridge?.stop()
    app.quit()
  }
})

app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  for (const s of sessions.values()) killPty(s)
  telegramBridge?.stop()
})

// ── PTY IPC ──
ipcMain.handle('pty-start', (event, { cols, rows, cwd }) => {
  const s = getSessionByEvent(event)
  if (!s) return null
  startPty(s, cols, rows, cwd)
  if (s === sessions.get(primaryWcId)) updatePrimarySnapshot()
  return s.cwd
})

ipcMain.on('pty-input', (event, data) => {
  const s = getSessionByEvent(event)
  s?.pty?.write(data)
})

ipcMain.on('pty-resize', (event, { cols, rows }) => {
  const s = getSessionByEvent(event)
  if (!s) return
  if (cols && rows) {
    s.cols = cols
    s.rows = rows
  }
  try { s.pty?.resize(cols, rows) } catch {}
})

ipcMain.handle('pty-restart', (event, { cwd, cols, rows } = {}) => {
  const s = getSessionByEvent(event)
  if (!s) return null
  killPty(s)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        startPty(s, cols, rows, cwd)
        if (s === sessions.get(primaryWcId)) updatePrimarySnapshot()
        resolve(s.cwd)
      } catch (err) {
        reject(err)
      }
    }, 200)
  })
})

ipcMain.handle('pty-cwd', (event) => {
  const s = getSessionByEvent(event)
  return s ? s.cwd : os.homedir()
})

// ── Audio: guarda buffer y transcribe con whisper.cpp ──
ipcMain.handle('transcribe-audio', async (event, arrayBuffer) => {
  const ts = Date.now()
  const webmPath = path.join(TMP_DIR, `audio-${ts}.webm`)
  fs.writeFileSync(webmPath, Buffer.from(arrayBuffer))
  try {
    return await transcribeAudioFile(webmPath, buildRuntimeEnv())
  } finally {
    try { fs.unlinkSync(webmPath) } catch {}
  }
})

// ── Image picker ──
ipcMain.handle('pick-image', async (event) => {
  const result = await dialog.showOpenDialog(winFromEvent(event), {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: 'Todos', extensions: ['*'] }
    ]
  })
  if (result.canceled) return []
  return result.filePaths
})

// ── File picker (cualquier archivo) ──
ipcMain.handle('pick-file', async (event) => {
  const result = await dialog.showOpenDialog(winFromEvent(event), {
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled) return []
  return result.filePaths
})

// ── Filesystem (sidebar) ──
const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '.next', '.cache', '__pycache__', '.venv', 'venv', 'dist', 'build', '.idea', '.vscode'])

ipcMain.handle('fs-read-dir', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const result = entries
      .filter(e => !IGNORE_NAMES.has(e.name) && !e.name.startsWith('._'))
      .map(e => {
        const full = path.join(dirPath, e.name)
        let size = 0
        try { if (e.isFile()) size = fs.statSync(full).size } catch {}
        return { name: e.name, path: full, isDir: e.isDirectory(), size }
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
      })
    return { ok: true, entries: result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs-pick-folder', async (event) => {
  const result = await dialog.showOpenDialog(winFromEvent(event), {
    properties: ['openDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('fs-home', () => os.homedir())

ipcMain.handle('fs-watch-dir', (event, dirPath) => {
  const s = getSessionByEvent(event)
  if (!s) return { ok: false, error: 'No window session' }
  if (s.treeWatcher) {
    try { s.treeWatcher.close() } catch {}
    s.treeWatcher = null
    s.treeWatcherPath = null
  }
  if (!dirPath) return { ok: true }
  const safeCb = () => {
    try {
      if (!sessions.has(s.wcId)) return
      notifyTreeChangedFor(s, 'fs')
    } catch {}
  }
  try {
    s.treeWatcher = fs.watch(dirPath, { recursive: true, persistent: false }, (_eventType, filename) => {
      if (!sessions.has(s.wcId)) return
      if (!filename) { safeCb(); return }
      const base = path.basename(filename)
      if (IGNORE_NAMES.has(base) || base.startsWith('._') || base === '.DS_Store') return
      safeCb()
    })
    s.treeWatcher.on('error', () => {})
    s.treeWatcherPath = dirPath
    return { ok: true, recursive: true }
  } catch (err) {
    try {
      s.treeWatcher = fs.watch(dirPath, { persistent: false }, () => safeCb())
      s.treeWatcher.on('error', () => {})
      s.treeWatcherPath = dirPath
      return { ok: true, recursive: false }
    } catch (err2) {
      return { ok: false, error: err2.message }
    }
  }
})

// ── Viewer de archivos ──
const TEXT_EXTS = new Set([
  'md','txt','json','yaml','yml','js','ts','tsx','jsx','py','sh','bash','zsh',
  'html','htm','css','scss','sass','less','xml','svg','csv','tsv','log','ini',
  'toml','env','gitignore','rs','go','java','c','cpp','h','hpp','rb','php','lua',
  'sql','vue','svelte','dockerfile','makefile','conf','plist'
])
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg'])

function fileKind(p) {
  const base = path.basename(p).toLowerCase()
  const ext = base.includes('.') ? base.split('.').pop() : base
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (TEXT_EXTS.has(ext)) return 'text'
  try {
    const fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(4096)
    const n = fs.readSync(fd, buf, 0, 4096, 0)
    fs.closeSync(fd)
    for (let i = 0; i < n; i++) if (buf[i] === 0) return 'binary'
    return 'text'
  } catch {
    return 'binary'
  }
}

ipcMain.handle('file-info', async (event, p) => {
  try {
    const stat = fs.statSync(p)
    if (stat.isDirectory()) return { ok: false, error: 'es una carpeta' }
    return {
      ok: true,
      path: p,
      size: stat.size,
      mtime: stat.mtime.getTime(),
      kind: fileKind(p),
      name: path.basename(p)
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-read', async (event, p) => {
  try {
    const kind = fileKind(p)
    if (kind === 'image' || kind === 'binary') {
      const data = fs.readFileSync(p)
      return { ok: true, kind, base64: data.toString('base64'), size: data.length }
    }
    const stat = fs.statSync(p)
    if (stat.size > 5 * 1024 * 1024) return { ok: false, error: 'Archivo demasiado grande (>5MB)' }
    const text = fs.readFileSync(p, 'utf-8')
    return { ok: true, kind, text }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-write', async (event, { path: p, text }) => {
  try {
    fs.writeFileSync(p, text, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Sesiones de Claude ──
function encodeProjectPath(p) {
  return p.replace(/\/$/, '').replace(/[\/\s]/g, '-')
}

function projectDirFor(cwd) {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(cwd))
}

ipcMain.handle('list-sessions', async (event, cwd) => {
  const dir = projectDirFor(cwd)
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))

  return files.map(f => {
    const id = f.replace(/\.jsonl$/, '')
    const fullPath = path.join(dir, f)
    let mtime = 0, size = 0, preview = '', msgCount = 0
    try {
      const stat = fs.statSync(fullPath)
      mtime = stat.mtime.getTime()
      size = stat.size
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      msgCount = lines.length
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user' && obj.message?.content) {
            const c = obj.message.content
            let text = ''
            if (typeof c === 'string') text = c
            else if (Array.isArray(c)) text = c.map(x => x.text || '').join(' ')
            text = text.replace(/<[^>]+>/g, '').trim()
            if (text && !text.startsWith('Caveat:')) {
              preview = text.slice(0, 160)
              break
            }
          }
        } catch {}
      }
    } catch {}
    return { id, mtime, size, preview: preview || '(sin contenido)', msgCount }
  }).sort((a, b) => b.mtime - a.mtime)
})

ipcMain.handle('delete-session', async (event, { cwd, sessionId }) => {
  const dir = projectDirFor(cwd)
  const file = path.join(dir, `${sessionId}.jsonl`)
  if (fs.existsSync(file)) { fs.unlinkSync(file); return true }
  return false
})

ipcMain.handle('resume-session', async (event, { sessionId, cwd, cols, rows }) => {
  const s = getSessionByEvent(event)
  if (!s) return null
  killPty(s)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        startPty(s, cols, rows, cwd, ['--resume', sessionId])
        if (s === sessions.get(primaryWcId)) updatePrimarySnapshot()
        resolve(s.cwd)
      } catch (err) {
        reject(err)
      }
    }, 200)
  })
})

ipcMain.handle('get-system-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

ipcMain.handle('get-active-cli', (event) => {
  const s = getSessionByEvent(event)
  return s ? s.activeCli : (appConfig.cli.defaultCli || 'claude')
})

ipcMain.handle('set-active-cli', (event, cli) => {
  const s = getSessionByEvent(event)
  const result = setActiveCli(s, cli)
  if (result.ok && s === sessions.get(primaryWcId)) updatePrimarySnapshot()
  return result
})

ipcMain.handle('get-app-config', () => ({ ...appConfig }))

ipcMain.handle('save-app-config', async (event, partialConfig) => {
  const previousDefault = appConfig.cli.defaultCli
  const merged = normalizeAppConfig({
    ...appConfig,
    ...partialConfig,
    cli: { ...appConfig.cli, ...(partialConfig?.cli || {}) },
    telegram: { ...appConfig.telegram, ...(partialConfig?.telegram || {}) }
  })
  saveAppConfig(merged)
  const warnings = []

  // decision: si cambió defaultCli, aplica a la ventana que guarda (compatibilidad con flujo previo)
  const s = getSessionByEvent(event)
  if (s && previousDefault !== appConfig.cli.defaultCli && s.activeCli !== appConfig.cli.defaultCli) {
    const switchResult = setActiveCli(s, appConfig.cli.defaultCli)
    if (!switchResult.ok) {
      warnings.push(`Config guardada pero no pude aplicar default CLI: ${switchResult.error}`)
    } else if (s === sessions.get(primaryWcId)) {
      updatePrimarySnapshot()
    }
  }

  let telegramResult = { ok: true, running: false }
  if (telegramBridge) telegramResult = await telegramBridge.applyConfig(appConfig.telegram)
  broadcastTelegramStatus()
  return { ok: telegramResult.ok, telegram: telegramResult, warnings, config: appConfig }
})

ipcMain.handle('get-telegram-status', () => telegramBridge?.getStatus() || null)

ipcMain.on('window-close', (event) => {
  const w = winFromEvent(event)
  if (!w) return
  // decision: hide solo si es la única ventana (preserva comportamiento previo); con múltiples, close.
  if (sessions.size > 1) w.close()
  else w.hide()
})

ipcMain.on('window-minimize', (event) => {
  winFromEvent(event)?.minimize()
})

ipcMain.on('window-toggle-pin', (event) => {
  const w = winFromEvent(event)
  if (!w) return
  w.setAlwaysOnTop(!w.isAlwaysOnTop())
})

ipcMain.handle('is-pinned', (event) => {
  return winFromEvent(event)?.isAlwaysOnTop() ?? false
})

ipcMain.on('window-new', () => {
  createWindow()
})
