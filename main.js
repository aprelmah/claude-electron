const { app, BrowserWindow, Menu, globalShortcut, ipcMain, nativeTheme, dialog, session, systemPreferences, shell } = require('electron')
const pty = require('node-pty')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { TelegramBridge } = require('./telegram-bridge')
const { createHeadlessRunners } = require('./headless-runners')
const TaskScheduler = require('./scheduler')
const { createExecutor } = require('./scheduler/executor')
const { createSinks } = require('./scheduler/sinks')
const { createPersistence } = require('./scheduler/persistence')
const cronPresets = require('./scheduler/cron-presets')
const { createAutomationManager } = require('./automations')
const { createAutomationChat } = require('./automations/chat')
const { buildSystemPrompt: buildAutomationSystemPrompt } = require('./automations/system-prompt')

const AGENT_PATTERNS_PATH = path.join(os.homedir(), '.claude', 'skills', 'luismi', 'automation-builder', 'patterns.md')

// Keep userData at the legacy path so existing config/Telegram tokens survive the rename.
const oldUserData = path.join(app.getPath('appData'), 'CLAUDE-NOVAK')
app.setPath('userData', oldUserData)

const USER_LOCAL_BIN = path.join(os.homedir(), '.local/bin')
const PYTHON39_BIN = path.join(os.homedir(), 'Library/Python/3.9/bin')
const HOMEBREW_BIN = '/usr/local/bin'
const TMP_DIR = '/tmp/claude-electron'
const AGENT_PROPOSAL_BASE = '/tmp/poweragent-proposal'
const AGENT_PROPOSAL_POLL_MS = 1500
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
const viewerWindows = new Set()
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
  const delay = reason === 'focus' ? 200 : 800
  session.treeWatchDebounce = setTimeout(() => {
    if (!sessions.has(session.wcId)) return
    if (session.win && !session.win.isDestroyed()) {
      session.win.webContents.send('tree-changed', reason)
    }
  }, delay)
}

function isNoiseFile(base) {
  if (!base) return false
  if (base.startsWith('.')) return true
  if (base.startsWith('._')) return true
  if (base.endsWith('~')) return true
  if (base.endsWith('.swp') || base.endsWith('.swx') || base.endsWith('.tmp')) return true
  return false
}

// ── Detección de sessionId de claude (para "enviar a Telegram") ──
// Claude Code v2 crea un fichero ~/.claude/projects/<cwd-codificado>/<sessionId>.jsonl
// al iniciar (o al primer mensaje). Tomamos snapshot del directorio antes del spawn
// y miramos qué fichero nuevo apareció después.
function claudeProjectSessionsDir(cwd) {
  if (!cwd) return null
  const encoded = cwd.replace(/\//g, '-')
  return path.join(os.homedir(), '.claude', 'projects', encoded)
}

function snapshotClaudeSessions(cwd) {
  const dir = claudeProjectSessionsDir(cwd)
  if (!dir) return new Set()
  try { return new Set(fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) }
  catch { return new Set() }
}

function findNewClaudeSessionId(cwd, snapshotBefore) {
  const dir = claudeProjectSessionsDir(cwd)
  if (!dir) return null
  try {
    const now = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && !snapshotBefore.has(f))
    if (!now.length) return null
    now.sort((a, b) => {
      try { return fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs }
      catch { return 0 }
    })
    return now[0].replace(/\.jsonl$/, '')
  } catch { return null }
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

  // Snapshot ANTES del spawn solo si es claude — para capturar el sessionId que cree.
  const sessionFilesBefore = session.activeCli === 'claude'
    ? snapshotClaudeSessions(session.cwd)
    : null
  session.claudeSessionId = null

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

  // Polling corto para capturar el sessionId que claude cree en ~/.claude/projects/...
  // Intentamos durante 12s (espera prudente: el .jsonl suele aparecer en <5s).
  if (sessionFilesBefore) {
    let tries = 0
    const detect = setInterval(() => {
      tries++
      const s = sessions.get(myWcId)
      if (!s || !s.pty || s.pty !== proc) { clearInterval(detect); return }
      const sid = findNewClaudeSessionId(s.cwd, sessionFilesBefore)
      if (sid) {
        s.claudeSessionId = sid
        clearInterval(detect)
        return
      }
      if (tries >= 12) clearInterval(detect)
    }, 1000)
  }

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
    alwaysOnTop: false,
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

function openViewerWindow(filePath, hint) {
  const primary = primaryWcId != null ? sessions.get(primaryWcId)?.win : null
  let bounds = { width: 700, height: 600, x: undefined, y: undefined }
  if (primary && !primary.isDestroyed()) {
    const b = primary.getBounds()
    const offset = viewerWindows.size * 24
    if (hint && Number.isFinite(hint.x) && Number.isFinite(hint.y) && hint.width > 0 && hint.height > 0) {
      const inset = 6
      bounds = {
        width: Math.max(380, Math.round(hint.width) - inset * 2),
        height: Math.max(280, Math.round(hint.height) - inset * 2),
        x: b.x + Math.round(hint.x) + inset + offset,
        y: b.y + Math.round(hint.y) + inset + offset
      }
    } else {
      const inset = 50
      bounds = {
        width: Math.max(420, b.width - inset * 2),
        height: Math.max(320, b.height - inset * 2),
        x: b.x + inset + offset,
        y: b.y + inset + offset
      }
    }
  }
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    resizable: true,
    minimizable: true,
    alwaysOnTop: false,
    title: path.basename(filePath),
    webPreferences: {
      preload: path.join(__dirname, 'viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  viewerWindows.add(win)
  win.on('closed', () => viewerWindows.delete(win))
  win.loadFile('viewer.html')
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('viewer-init', { path: filePath })
  })
  return win
}

// ── Tasks Manager (singleton) ──
let tasksScheduler = null
let automationManager = null
let automationChat = null
let tasksManagerWin = null
let cwdHistoryCache = []
// Una ventana de chat por automation.
const chatWindows = new Map() // automationId → BrowserWindow
const chatWcToAutomation = new Map() // wcId → automationId

async function openTasksManager() {
  if (tasksManagerWin && !tasksManagerWin.isDestroyed()) {
    if (tasksManagerWin.isMinimized()) tasksManagerWin.restore()
    tasksManagerWin.show()
    tasksManagerWin.focus()
    return tasksManagerWin
  }

  // Hereda el tema actual de la ventana principal (localStorage 'claude-electron-theme').
  let initialTheme = ''
  try {
    const primary = primaryWcId != null ? sessions.get(primaryWcId)?.win : null
    if (primary && !primary.isDestroyed()) {
      const t = await primary.webContents.executeJavaScript(
        `localStorage.getItem('claude-electron-theme') || ''`, true
      )
      if (t === 'light' || t === 'dark') initialTheme = t
    }
  } catch {}
  if (initialTheme !== 'light' && initialTheme !== 'dark') {
    initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  tasksManagerWin = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: 'POWER-AGENT — Tareas programadas',
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: initialTheme === 'light' ? '#fafafd' : '#111',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'tasks-manager-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  tasksManagerWin.loadFile('tasks-manager.html', { query: { theme: initialTheme } })
  tasksManagerWin.once('ready-to-show', () => {
    if (tasksManagerWin && !tasksManagerWin.isDestroyed()) tasksManagerWin.show()
  })
  tasksManagerWin.on('closed', () => { tasksManagerWin = null })
  return tasksManagerWin
}

function broadcastToAllWindows(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try { win.webContents.send(channel, payload) } catch {}
    }
  }
}

// Emite eventos del chat solo a la ventana de chat correspondiente.
function broadcastAutomationChat(channel, payload) {
  const id = payload && payload.automationId
  if (!id) return
  const win = chatWindows.get(id)
  if (!win || win.isDestroyed()) return
  try { win.webContents.send(channel, payload) } catch {}
}

// ── Automation PTY (agente CLI vivo en xterm) ──
// Una sesión PTY por automationId, en su propia ventana.
const agentPtySessions = new Map()         // wcId → AgentPtySession
const agentPtyWindowByAutomation = new Map() // automationId → BrowserWindow

const ANSI_RE = /\x1B\[[0-9;?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[@-Z\\-_]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g
const AGENT_BUFFER_MAX = 200_000
const AGENT_BOOT_DELAY_MS = 3500

function stripAnsi(s) {
  if (!s) return ''
  return s.replace(ANSI_RE, '')
}

// Quita line-wrapping del terminal: claude code repinta líneas con \r y a veces
// inserta saltos suaves. También quita caracteres de "box drawing" del TUI para no
// confundir los matches.
function flattenTerminal(s) {
  if (!s) return ''
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Box drawing y separadores típicos del TUI
    .replace(/[─-╿▀-▟■-◿]/g, ' ')
}

function extractAgentBlocks(buffer) {
  const clean = flattenTerminal(stripAnsi(buffer))

  // Variante 1: tags XML estilo Anthropic, tolerante a espacios internos.
  const xmlGrab = (tag) => {
    const re = new RegExp(`<\\s*${tag}\\s*>([\\s\\S]*?)<\\s*/\\s*${tag}\\s*>`, 'i')
    const m = clean.match(re)
    return m ? m[1].trim() : null
  }

  let script = xmlGrab('SCRIPT')
  let plist = xmlGrab('PLIST')
  let description = xmlGrab('DESCRIPCION') || xmlGrab('DESCRIPTION')

  // Variante 2 (fallback): code fences markdown con lenguaje pista.
  // ```bash / ```sh / ```shell → SCRIPT
  // ```xml / ```plist → PLIST
  if (!script || !plist) {
    const fenceRe = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g
    let m
    while ((m = fenceRe.exec(clean)) !== null) {
      const lang = (m[1] || '').toLowerCase()
      const body = m[2] || ''
      if (!script && /^(bash|sh|shell|zsh)$/i.test(lang) && body.includes('#!/')) {
        script = body.trim()
      } else if (!plist && /^(xml|plist)$/i.test(lang) && body.includes('<plist')) {
        plist = body.trim()
      }
    }
  }

  // Validación: descarta solo lo claramente placeholder.
  // SCRIPT real: tiene shebang + algo de contenido.
  // PLIST real: tiene cabecera xml + cierre /plist.
  const isRealScript = (text) => {
    if (!text || text.length < 40) return false
    if (!text.includes('#!')) return false
    return true
  }
  const isRealPlist = (text) => {
    if (!text || text.length < 80) return false
    if (!/<\?xml|<plist/i.test(text)) return false
    if (!/<\/plist>/i.test(text)) return false
    return true
  }
  const isRealDescription = (text) => {
    if (!text || text.length < 10) return false
    return true
  }

  if (!isRealScript(script)) script = null
  if (!isRealPlist(plist)) plist = null
  if (!isRealDescription(description)) description = null

  // El botón "Aplicar al borrador" solo debe aparecer cuando tenemos una propuesta
  // sustancial — al menos SCRIPT y PLIST juntos. Solo descripción no dispara.
  // Esto evita que un placeholder corto de descripción que pase por encima del filtro
  // (ej. "descripción refinada y precisa" del propio bootstrap si reaparece en pantalla)
  // accione el botón.
  if (!script || !plist) return null
  return { script, plist, description }
}

function blocksEqual(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.script === b.script && a.plist === b.plist && a.description === b.description
}

// ── Propuesta vía filesystem (source of truth) ──
// Claude Code v2 oculta los bloques largos en su TUI (los procesa como tool_use
// internos) → el stream PTY nunca contiene el script/plist literales. Solución:
// pedirle que escriba los archivos a disco con su Write tool. POWER-AGENT pollea
// el directorio y, cuando aparece el "READY", lee y emite blocks-detected.
function proposalPaths(automationId) {
  const dir = path.join(AGENT_PROPOSAL_BASE, automationId)
  return {
    dir,
    script: path.join(dir, 'script.sh'),
    plist: path.join(dir, 'plist.plist'),
    description: path.join(dir, 'description.txt'),
    ready: path.join(dir, 'READY')
  }
}

function ensureProposalDir(automationId) {
  const p = proposalPaths(automationId)
  try { fs.mkdirSync(p.dir, { recursive: true }) } catch {}
  // Limpia residuos de iteraciones anteriores para que la próxima propuesta empiece limpia.
  for (const f of [p.script, p.plist, p.description, p.ready]) {
    try { fs.unlinkSync(f) } catch {}
  }
  return p
}

function clearProposalFromDisk(automationId) {
  const p = proposalPaths(automationId)
  for (const f of [p.script, p.plist, p.description, p.ready]) {
    try { fs.unlinkSync(f) } catch {}
  }
}

function readProposalFromDisk(automationId) {
  const p = proposalPaths(automationId)
  try {
    if (!fs.existsSync(p.ready)) return null
    if (!fs.existsSync(p.script) || !fs.existsSync(p.plist)) return null
    const script = fs.readFileSync(p.script, 'utf8')
    const plist = fs.readFileSync(p.plist, 'utf8')
    let description = ''
    try { description = fs.readFileSync(p.description, 'utf8') } catch {}
    // Validación: shebang en script, cierre </plist> en plist.
    if (!script || !script.includes('#!')) return null
    if (!plist || !/<plist[\s>]/i.test(plist) || !/<\/plist>/i.test(plist)) return null
    return {
      script: script.trim(),
      plist: plist.trim(),
      description: description.trim() || null
    }
  } catch {
    return null
  }
}

function buildAgentBootstrapPrompt(automation) {
  const hasDraft = !!(automation.generatedScript || automation.generatedPlist)
  const isInstalled = automation.status === 'installed'
  const scheduleStr = (() => {
    try { return JSON.stringify(automation.schedule || null) } catch { return 'null' }
  })()
  const lines = []

  // Contexto mínimo — sin script todavía, para que el agente NO se ponga a analizar sin permiso.
  lines.push('Eres un agente integrado en POWER-AGENT, una app de macOS para crear y gestionar automatizaciones (script bash + plist launchd). Hablas con el usuario que está creando o modificando UNA automatización concreta. El usuario NO es técnico: no sabe bash, no sabe launchd, no lee XML. Tu trabajo es traducir lo que pide a un script + plist correctos y entregarlos.')
  lines.push('')
  lines.push('Datos de la automatización (solo contexto, NO analices todavía):')
  lines.push(`- Nombre: ${automation.name || '(sin nombre)'}`)
  lines.push(`- Slug: ${automation.slug || '(pendiente)'}`)
  lines.push(`- Status: ${automation.status || 'draft'}${isInstalled ? ' (YA instalada y corriendo en launchd)' : ''}`)
  lines.push(`- Schedule: ${scheduleStr}`)
  lines.push(`- Descripción guardada: ${automation.description ? automation.description : '(vacía)'}`)
  lines.push(`- ¿Tiene script generado?: ${hasDraft ? 'sí' : 'no'}`)
  if (automation.scriptPath) lines.push(`- Ruta del script: ${automation.scriptPath}`)
  if (automation.plistPath) lines.push(`- Ruta del plist: ${automation.plistPath}`)
  if (automation.logPath) lines.push(`- Ruta del log: ${automation.logPath}`)
  lines.push('')

  lines.push('REGLAS ESTRICTAS DE COMPORTAMIENTO:')
  lines.push('')
  lines.push('1) LEE LA DESCRIPCIÓN GUARDADA antes de hablar. Está más arriba. Es lo que el usuario ya te dijo. NUNCA preguntes algo que ya está dicho ahí (si la descripción dice "borra capturas del escritorio" → NO preguntes "¿qué borro? ¿de dónde?" — eso es insultante).')
  lines.push('')
  if (hasDraft) {
    lines.push('2) Esta automatización YA EXISTE (tiene script). USA TU READ tool para abrir el script (ruta arriba) ANTES de tu primer mensaje. Necesitas contexto del estado actual para ayudar bien. Luego pregúntale qué quiere cambiar o qué problema tiene.')
    lines.push('')
    lines.push('3) Tu PRIMER mensaje: una línea reconociendo qué hace ahora la automatización + una pregunta concreta sobre qué quiere cambiar. Ejemplo: "Ahora borra X cada Y. ¿Qué quieres ajustar?"')
  } else {
    lines.push('2) Esta automatización es NUEVA (sin script). Trabaja sobre la descripción guardada.')
    lines.push('')
    lines.push('3) Tu PRIMER mensaje: dos partes en una sola frase corta.')
    lines.push('   a) Confirma con tus palabras lo que has entendido de la descripción (1 línea).')
    lines.push('   b) Lista SOLO los huecos imprescindibles que falten para generar el script (carpeta exacta si no la dijo, hora exacta si solo dijo "cada día", si quiere notificación Telegram cuando termine, etc).')
    lines.push('   Ejemplo bueno: "Entiendo: borrar las capturas del Escritorio cada día. Necesito 2 cosas: ¿a qué hora? ¿te aviso por Telegram?"')
    lines.push('   Ejemplo MALO: "¿Qué quieres que hagamos? ¿Dónde están las capturas? ¿A dónde las muevo?" (eso es lo que la descripción ya te dijo).')
  }
  lines.push('')
  lines.push('4) Pregunta lo MÍNIMO. Si la descripción ya da suficiente info para generar algo razonable con defaults sensatos (ej. hora 07:00 si dice "cada día por la mañana"), úsalos y propón directamente sin preguntar más. El usuario es no técnico y se cansa rápido.')
  lines.push('5) ENTREGA DE LA PROPUESTA — léelo bien, esto es lo único que importa:')
  lines.push('   Cuando tengas la info mínima (o el usuario diga "venga", "hazlo", "tira" o equivalente), debes ENTREGAR la propuesta ESCRIBIENDO 4 ARCHIVOS a disco con tu herramienta Write (no por chat, no como bloques en pantalla — directamente al filesystem):')
  const pp = proposalPaths(automation.id || 'UNKNOWN')
  lines.push(`     a) ${pp.script}`)
  lines.push('        → script bash completo y funcional. PRIMERA línea: #!/bin/bash (o #!/usr/bin/env bash). Sin truncar, sin "...", sin placeholders.')
  lines.push(`     b) ${pp.plist}`)
  lines.push('        → plist launchd completo. Debe contener cabecera <?xml ...?>, <plist ...> y cierre </plist>. Sin truncar.')
  lines.push(`     c) ${pp.description}`)
  lines.push('        → 1–2 frases en castellano describiendo qué hace la automatización.')
  lines.push(`     d) ${pp.ready}`)
  lines.push('        → archivo VACÍO. Escríbelo SOLO después de los otros tres. Es la señal "ya está".')
  lines.push('   Reglas:')
  lines.push('   - Usa exactamente esas rutas. No las cambies, no inventes otras.')
  lines.push('   - Escribe primero los 3 con contenido, ÚLTIMO el READY.')
  lines.push('   - NO pegues el script ni el plist en el chat — solo escríbelos. POWER-AGENT los detectará por filesystem y mostrará el botón "Aplicar al borrador" en su UI (botón verde brillante arriba a la derecha).')
  lines.push('   - NO necesitas pedir permiso para Write — la app tiene bypassPermissions activo.')
  lines.push('   - Si quieres iterar (cambiar versión), simplemente reescribe los 3 archivos de contenido y vuelve a crear el READY. El polling lo detectará.')
  lines.push('   - Después de escribir los 4 archivos, di solo una frase al usuario: "Listo, pulsa el botón verde \\"Aplicar al borrador\\" arriba para guardarlo." Nada más. No expliques qué hiciste — el usuario revisará al aplicar.')
  lines.push('')
  lines.push('6) Reglas técnicas DURAS para el contenido — están al final de este prompt. CÚMPLELAS todas. En particular: Telegram (si el usuario lo pide o la descripción lo menciona), lockfile, trap, logs, plist válido.')
  lines.push('7) Tono: español de España, directo, sin rollos, sin "perfecto" ni "claro" ni "por supuesto". Frases cortas. Tratamiento de tú (no "usted").')
  lines.push('')
  // Reglas técnicas de contenido — mismas que usa el generador headless original.
  // Cubre Telegram, lockfile, trap, NAS QNAP, plist launchd, idempotencia, secrets.
  // Nota: las "Reglas de salida" del system-prompt (bloques XML) NO aplican aquí —
  // tú entregas por filesystem (rutas indicadas arriba). Ignora ese bloque del prompt.
  lines.push('═══ REGLAS TÉCNICAS DE CONTENIDO (NO NEGOCIABLES) ═══')
  lines.push('')
  try {
    lines.push(buildAutomationSystemPrompt({ patternsPath: AGENT_PATTERNS_PATH }))
  } catch (err) {
    lines.push('[no se pudo cargar system-prompt: ' + (err && err.message ? err.message : err) + ']')
  }
  lines.push('')
  lines.push('═══ FIN REGLAS TÉCNICAS ═══')
  lines.push('')
  lines.push('IMPORTANTE sobre el formato de salida: el system-prompt de arriba menciona "tres bloques <SCRIPT>...</SCRIPT>, <PLIST>...</PLIST>, <EXPLANATION>...". ESO NO APLICA AQUÍ. Tú entregas escribiendo los 4 archivos en las rutas que te di arriba (script.sh, plist.plist, description.txt, READY). NO emitas bloques XML en el chat.')
  lines.push('')
  if (hasDraft) {
    lines.push('AHORA: lee el script actual con tu Read tool. Luego escribe tu primer mensaje siguiendo la regla 3.')
  } else {
    lines.push('AHORA: escribe tu primer mensaje siguiendo la regla 3. NO preguntes lo que la descripción ya dice.')
  }
  return lines.join('\n')
}

function startAgentPty(session) {
  if (!session) throw new Error('Sesión agente no disponible')
  if (session.pty) return session.pty
  const cliCheck = ensureCliAvailable(session.activeCli)
  if (!cliCheck.ok) {
    if (session.win && !session.win.isDestroyed()) {
      session.win.webContents.send('automation-pty:error', { error: cliCheck.error })
    }
    throw new Error(cliCheck.error)
  }

  let proc
  try {
    proc = pty.spawn('/bin/bash', ['-c', buildFdLimitCommand(cliCheck.bin, [])], {
      name: 'xterm-256color',
      cols: session.cols || 120,
      rows: session.rows || 35,
      cwd: session.cwd || os.homedir(),
      env: cliCheck.env
    })
  } catch (err) {
    const msg = `No se pudo iniciar ${cliCheck.name}: ${err.message || err}`
    if (session.win && !session.win.isDestroyed()) {
      session.win.webContents.send('automation-pty:error', { error: msg })
    }
    throw new Error(msg)
  }

  proc._alive = true
  session.pty = proc
  session.buffer = ''
  session.lastBlocks = null
  // detectFromOffset: hasta que esté seteado, no buscamos bloques.
  // Se setea ~4.5s después de inyectar el bootstrap, para que el ECO en pantalla
  // de las etiquetas literales (<SCRIPT> etc) que el bootstrap menciona NO se
  // confunda con bloques reales emitidos por el CLI.
  session.detectFromOffset = session.bootstrapPrompt ? null : 0
  const myWcId = session.wcId

  // Polling del filesystem: vía principal de detección de propuesta.
  // Claude Code v2 oculta los bloques en el TUI pero su Write tool sí escribe
  // a disco aunque no se vea nada en pantalla. Pollea cada 1.5s.
  if (session.proposalPollId) { try { clearInterval(session.proposalPollId) } catch {} }
  session.proposalPollId = setInterval(() => {
    const s = agentPtySessions.get(myWcId)
    if (!s || !s.win || s.win.isDestroyed()) return
    const found = readProposalFromDisk(s.automationId)
    if (!found) return
    if (blocksEqual(found, s.lastBlocks)) return
    s.lastBlocks = found
    console.log('[automation-pty] proposal detected on disk:',
      found.description ? 'DESC(' + found.description.length + ')' : '-',
      found.script ? 'SCRIPT(' + found.script.length + ')' : '-',
      found.plist ? 'PLIST(' + found.plist.length + ')' : '-')
    try { s.win.webContents.send('automation-pty:blocks-detected', { blocks: found }) } catch {}
  }, AGENT_PROPOSAL_POLL_MS)

  proc.onData((data) => {
    if (!proc._alive) return
    const s = agentPtySessions.get(myWcId)
    if (!s || !s.win || s.win.isDestroyed()) return
    const text = typeof data === 'string' ? data : data.toString('utf8')
    s.win.webContents.send('automation-pty:data', text)
    // Buffer ring.
    s.buffer = (s.buffer + text).slice(-AGENT_BUFFER_MAX)
    if (s.detectFromOffset == null) return
    // Trunca lo previo al offset.
    const tail = s.buffer.length > s.detectFromOffset
      ? s.buffer.slice(s.detectFromOffset)
      : ''
    const blocks = extractAgentBlocks(tail)
    if (blocks && !blocksEqual(blocks, s.lastBlocks)) {
      s.lastBlocks = blocks
      console.log('[automation-pty] blocks detected:',
        blocks.description ? 'DESC(' + blocks.description.length + ')' : '-',
        blocks.script ? 'SCRIPT(' + blocks.script.length + ')' : '-',
        blocks.plist ? 'PLIST(' + blocks.plist.length + ')' : '-')
      s.win.webContents.send('automation-pty:blocks-detected', { blocks })
    } else if (!blocks) {
      // Heurística de diagnóstico: si el tail menciona "SCRIPT" o "PLIST" o "DESCRIPCION"
      // pero el parser no extrajo nada, log mínimo para ver qué está llegando.
      const flat = flattenTerminal(stripAnsi(tail))
      if (/<\s*SCRIPT|<\s*PLIST|<\s*DESCRIPCION|```bash|```xml/i.test(flat)) {
        const idx = flat.search(/<\s*SCRIPT|<\s*PLIST|<\s*DESCRIPCION|```bash|```xml/i)
        const sample = flat.slice(Math.max(0, idx - 40), idx + 200)
        console.log('[automation-pty] potential blocks but no match. Sample:', JSON.stringify(sample))
      }
    }
  })

  proc.onExit(() => {
    if (proc._alive) {
      const s = agentPtySessions.get(myWcId)
      if (s && s.win && !s.win.isDestroyed()) s.win.webContents.send('automation-pty:exit')
    }
    const s = agentPtySessions.get(myWcId)
    if (s && s.pty === proc) s.pty = null
  })

  // Inyecta contexto inicial al CLI cuando esté listo.
  // Usa bracketed paste para que los \n del prompt no se interpreten como Enter (que enviaría
  // cada línea como mensaje separado al chat del CLI).
  if (session.bootstrapPrompt && !session.bootstrapInjected) {
    session.bootstrapInjected = true
    setTimeout(() => {
      if (!proc._alive) return
      try {
        const BP_START = '\x1b[200~'
        const BP_END = '\x1b[201~'
        proc.write(BP_START + session.bootstrapPrompt + BP_END)
        // Pequeño delay y luego Enter para enviar.
        setTimeout(() => {
          if (proc._alive) { try { proc.write('\r') } catch {} }
        }, 150)
        // Tras un margen para que el ECO en pantalla del bootstrap termine, abrimos
        // la detección de bloques desde el offset actual del buffer.
        setTimeout(() => {
          const s = agentPtySessions.get(myWcId)
          if (s) s.detectFromOffset = s.buffer.length
        }, 4500)
      } catch {}
    }, AGENT_BOOT_DELAY_MS)
  }

  return proc
}

function killAgentPty(session) {
  if (!session) return
  if (session.proposalPollId) {
    try { clearInterval(session.proposalPollId) } catch {}
    session.proposalPollId = null
  }
  if (!session.pty) return
  session.pty._alive = false
  try { session.pty.kill() } catch {}
  session.pty = null
}

async function openAutomationPtyWindow(automationId) {
  if (!automationId) return null
  if (!automationManager) return null
  const automation = await automationManager.get(automationId)
  if (!automation) return null

  const existing = agentPtyWindowByAutomation.get(automationId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  // Preparar directorio de propuestas a disco (limpia residuos previos).
  ensureProposalDir(automationId)

  let initialTheme = ''
  try {
    const primary = primaryWcId != null ? sessions.get(primaryWcId)?.win : null
    if (primary && !primary.isDestroyed()) {
      const t = await primary.webContents.executeJavaScript(
        `localStorage.getItem('claude-electron-theme') || ''`, true
      )
      if (t === 'light' || t === 'dark') initialTheme = t
    }
  } catch {}
  if (initialTheme !== 'light' && initialTheme !== 'dark') {
    initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  const win = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 560,
    minHeight: 380,
    title: 'Agente — ' + (automation.name || automation.slug || 'POWER-AGENT'),
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: initialTheme === 'light' ? '#f7f7fa' : '#1a1a1d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'automation-pty-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--automation-id=${automationId}`]
    }
  })

  const wcId = win.webContents.id
  const session = {
    win,
    wcId,
    automationId,
    activeCli: appConfig.cli.defaultCli === 'codex' ? 'codex' : 'claude',
    cols: 120,
    rows: 35,
    cwd: os.homedir(),
    pty: null,
    buffer: '',
    lastBlocks: null,
    bootstrapPrompt: buildAgentBootstrapPrompt(automation),
    bootstrapInjected: false
  }
  agentPtySessions.set(wcId, session)
  agentPtyWindowByAutomation.set(automationId, win)

  win.loadFile('automation-pty.html', { query: { theme: initialTheme, aid: automationId } })
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show() })
  win.on('closed', () => {
    const s = agentPtySessions.get(wcId)
    if (s) killAgentPty(s)
    agentPtySessions.delete(wcId)
    if (agentPtyWindowByAutomation.get(automationId) === win) {
      agentPtyWindowByAutomation.delete(automationId)
    }
  })
  return win
}

async function openAutomationChatWindow(automationId) {
  if (!automationId) return null
  if (!automationManager) return null
  const automation = await automationManager.get(automationId)
  if (!automation) return null

  const existing = chatWindows.get(automationId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  // Tema heredado.
  let initialTheme = ''
  try {
    const primary = primaryWcId != null ? sessions.get(primaryWcId)?.win : null
    if (primary && !primary.isDestroyed()) {
      const t = await primary.webContents.executeJavaScript(
        `localStorage.getItem('claude-electron-theme') || ''`, true
      )
      if (t === 'light' || t === 'dark') initialTheme = t
    }
  } catch {}
  if (initialTheme !== 'light' && initialTheme !== 'dark') {
    initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  const win = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 420,
    minHeight: 480,
    title: 'Agente — ' + (automation.name || automation.slug || 'POWER-AGENT'),
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: initialTheme === 'light' ? '#f7f7fa' : '#1a1a1d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'automation-chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--automation-id=${automationId}`]
    }
  })
  chatWindows.set(automationId, win)
  const wcId = win.webContents.id
  chatWcToAutomation.set(wcId, automationId)
  win.loadFile('automation-chat.html', { query: { theme: initialTheme, aid: automationId } })
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show() })
  win.on('closed', () => {
    if (chatWindows.get(automationId) === win) chatWindows.delete(automationId)
    chatWcToAutomation.delete(wcId)
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

const { runClaudeHeadless, runCodexHeadless } = createHeadlessRunners({
  cliMeta,
  buildRuntimeEnv,
  commandExists,
  buildFdLimitCommand,
  getCwdSync
})

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

  try {
    const persistence = createPersistence({ userDataDir: app.getPath('userData') })
    const executor = createExecutor({ runClaudeHeadless, runCodexHeadless, appConfig })
    const sinks = createSinks({ telegramBridge, broadcastToAllWindows })
    tasksScheduler = new TaskScheduler({ executor, sinks, persistence, broadcast: broadcastToAllWindows })
    tasksScheduler.persistence = persistence
    await tasksScheduler.init()
  } catch (err) {
    console.error('[tasks] scheduler init failed:', err?.message || err)
    tasksScheduler = null
  }

  try {
    automationManager = createAutomationManager({
      userDataDir: app.getPath('userData'),
      runClaudeHeadless,
      appConfig,
      telegramBridge,
      broadcast: broadcastToAllWindows
    })
    await automationManager.init()
  } catch (e) {
    console.error('[automations] init failed:', e)
    automationManager = null
  }

  if (automationManager) {
    try {
      automationChat = createAutomationChat({
        runClaudeHeadless,
        runCodexHeadless,
        persistence: automationManager._persistence,
        automationManager,
        broadcast: broadcastAutomationChat,
        userDataDir: app.getPath('userData')
      })
    } catch (e) {
      console.error('[automation-chat] init failed:', e)
      automationChat = null
    }
  }

  globalShortcut.register('CommandOrControl+Shift+T', () => openTasksManager())

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
  for (const s of agentPtySessions.values()) killAgentPty(s)
  telegramBridge?.stop()
  try { tasksScheduler?.destroy() } catch {}
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
      const parts = filename.split('/')
      for (const part of parts) {
        if (IGNORE_NAMES.has(part) || isNoiseFile(part)) return
      }
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

// ── Transferir sesión activa de la ventana a Telegram ──
ipcMain.handle('app:can-send-to-telegram', (event) => {
  const s = sessions.get(event.sender.id)
  if (!s) return { ok: false, reason: 'no-session' }
  if (s.activeCli !== 'claude') return { ok: false, reason: 'not-claude' }
  if (!s.claudeSessionId) return { ok: false, reason: 'no-session-id' }
  if (!telegramBridge) return { ok: false, reason: 'bridge-not-init' }
  const status = telegramBridge.getStatus()
  if (!status.running) return { ok: false, reason: 'bridge-not-running' }
  if (!telegramBridge.getFirstAllowedUserId()) return { ok: false, reason: 'no-allowed-user' }
  return { ok: true, sessionId: s.claudeSessionId, cwd: s.cwd }
})

ipcMain.handle('app:send-session-to-telegram', async (event) => {
  const s = sessions.get(event.sender.id)
  if (!s) return { ok: false, error: 'No hay sesión asociada a esta ventana' }
  if (s.activeCli !== 'claude') return { ok: false, error: 'Solo claude soportado (esta ventana usa ' + s.activeCli + ')' }
  if (!s.claudeSessionId) return { ok: false, error: 'No se detectó el sessionId de claude. Habla con él al menos un mensaje y vuelve a intentarlo.' }
  if (!telegramBridge) return { ok: false, error: 'Telegram bridge no inicializado' }
  const status = telegramBridge.getStatus()
  if (!status.running) return { ok: false, error: 'Telegram bridge no está corriendo (actívalo en Configuración).' }
  const chatId = telegramBridge.getFirstAllowedUserId()
  if (!chatId) return { ok: false, error: 'No hay usuarios autorizados en Telegram (configúralos en Configuración).' }

  try {
    telegramBridge.adoptSession(chatId, 'claude', s.claudeSessionId)
    const cwdShort = path.basename(s.cwd || os.homedir())
    const sidShort = s.claudeSessionId.slice(0, 8)
    const text = [
      '📱 Sesión de claude movida a Telegram',
      `📂 Carpeta: ${cwdShort}`,
      `🆔 ${sidShort}…`,
      '',
      'Escríbeme cuando quieras y continuamos donde lo dejaste.'
    ].join('\n')
    await telegramBridge.sendMessageTo(chatId, text)
    // Mata el PTY local para evitar pisar el .jsonl con la sesión que ahora vive en Telegram.
    killPty(s)
    try { s.win?.webContents.send('pty-transferred-to-telegram', { sessionId: s.claudeSessionId, chatId }) } catch {}
    return { ok: true, sessionId: s.claudeSessionId, chatId }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

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

ipcMain.handle('viewer-open', (_event, arg) => {
  const filePath = typeof arg === 'string' ? arg : arg?.path
  const hint = (arg && typeof arg === 'object') ? arg.hint : null
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'Invalid path' }
  openViewerWindow(filePath, hint)
  return { ok: true }
})

ipcMain.on('viewer-inject-to-active', (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return
  if (primaryWcId == null) return
  const s = sessions.get(primaryWcId)
  if (!s || !s.win || s.win.isDestroyed()) return
  s.win.webContents.send('inject-path', filePath)
})

ipcMain.on('viewer-close-self', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) win.close()
})

ipcMain.on('viewer-minimize-self', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) win.minimize()
})

// ── Tasks Manager IPC ──
ipcMain.handle('tasks-manager:open', async () => {
  await openTasksManager()
  return { ok: true }
})

function assertScheduler() {
  if (!tasksScheduler) throw new Error('Scheduler no inicializado')
  return tasksScheduler
}

ipcMain.handle('tasks:list', async () => {
  if (!tasksScheduler) return []
  return tasksScheduler.persistence.loadTasks()
})

ipcMain.handle('tasks:get', async (_event, { id }) => {
  if (!tasksScheduler) return null
  return tasksScheduler.persistence.getTask(id)
})

ipcMain.handle('tasks:create', async (_event, data) => {
  return assertScheduler().upsertTask(data)
})

ipcMain.handle('tasks:update', async (_event, { id, patch }) => {
  const sched = assertScheduler()
  const current = await sched.persistence.getTask(id)
  if (!current) throw new Error('Tarea no encontrada')
  return sched.upsertTask({ ...current, ...patch, id })
})

ipcMain.handle('tasks:delete', async (_event, { id }) => {
  await assertScheduler().deleteTask(id)
  return { ok: true }
})

ipcMain.handle('tasks:toggle', async (_event, { id, enabled }) => {
  return assertScheduler().toggle(id, enabled)
})

ipcMain.handle('tasks:run-now', async (_event, { id }) => {
  const sched = assertScheduler()
  const runId = require('crypto').randomUUID()
  // disparar en background; no esperar a que termine
  Promise.resolve().then(() => sched.runNow(id)).catch((err) => {
    console.error('[tasks:run-now] error:', err?.message || err)
  })
  return { ok: true, runId }
})

ipcMain.handle('tasks:cancel', async (_event, { id }) => {
  assertScheduler().cancel(id)
  return { ok: true }
})

ipcMain.handle('tasks:get-runs', async (_event, payload = {}) => {
  if (!tasksScheduler) return []
  const { taskId, limit = 100 } = payload
  return tasksScheduler.persistence.getRuns({ taskId, limit })
})

ipcMain.handle('tasks:validate-cron', async (_event, { expr }) => {
  if (!tasksScheduler) return { ok: false, error: 'Scheduler no listo' }
  return tasksScheduler.validateCron(expr)
})

ipcMain.handle('tasks:list-cwds', async () => {
  let history = []
  try {
    if (tasksScheduler) history = await tasksScheduler.persistence.loadCwdHistory()
  } catch {}
  const liveCwds = []
  for (const s of sessions.values()) {
    if (s?.cwd) liveCwds.push(s.cwd)
  }
  const all = Array.from(new Set([...(Array.isArray(history) ? history : []), ...liveCwds]))
  if (!all.length) return [os.homedir()]
  return all
})

ipcMain.handle('tasks:get-cron-presets', () => cronPresets)

ipcMain.handle('tasks:pick-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || tasksManagerWin
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory']
  })
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true }
  return { path: result.filePaths[0], canceled: false }
})

ipcMain.handle('tasks:get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

ipcMain.handle('tasks:get-telegram-configured', () => {
  const tg = appConfig?.telegram || {}
  return !!(tg.botToken && Array.isArray(tg.allowedUsers) && tg.allowedUsers.length)
})

ipcMain.handle('tasks:get-default-model-effort', () => {
  const tg = appConfig?.telegram || {}
  return {
    claude: { model: tg.claudeModel || '', effort: tg.claudeEffort || '' },
    codex: { model: tg.codexModel || '', effort: tg.codexEffort || '' }
  }
})

ipcMain.handle('tasks:window-close', () => {
  if (tasksManagerWin && !tasksManagerWin.isDestroyed()) tasksManagerWin.close()
  return { ok: true }
})

ipcMain.handle('tasks:window-minimize', () => {
  if (tasksManagerWin && !tasksManagerWin.isDestroyed()) tasksManagerWin.minimize()
  return { ok: true }
})

// ── Automations IPC ──
function automationsNotReady() {
  return { ok: false, error: 'AutomationManager no inicializado' }
}

ipcMain.handle('automations:list', async () => {
  try {
    if (!automationManager) return []
    return await automationManager.list()
  } catch (err) {
    console.error('[automations:list] error:', err?.message || err)
    return []
  }
})

ipcMain.handle('automations:get', async (_e, { id } = {}) => {
  try {
    if (!automationManager) return null
    return await automationManager.get(id)
  } catch (err) {
    console.error('[automations:get] error:', err?.message || err)
    return null
  }
})

ipcMain.handle('automations:generate-draft', async (_e, payload = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.generateDraft(payload)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:regenerate', async (_e, { id, patch } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.regenerate(id, patch || {})
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:update-draft', async (_e, { id, scriptText, plistText } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.updateDraft(id, { scriptText, plistText })
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:install', async (_e, { id, force } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.install(id, { force: !!force })
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:shellcheck-status', async () => {
  if (!automationManager) return { available: false, path: null, installHint: 'brew install shellcheck' }
  try {
    return await automationManager.getShellcheckStatus()
  } catch {
    return { available: false, path: null, installHint: 'brew install shellcheck' }
  }
})

ipcMain.handle('automations:lint', async (_e, { id } = {}) => {
  if (!automationManager) return { ok: false, error: 'AutomationManager no inicializado' }
  try {
    return await automationManager.lintAutomation(id)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:uninstall', async (_e, { id } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.uninstall(id)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:run-once', async (_e, { id } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.runOnce(id)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:read-log', async (_e, { id, opts } = {}) => {
  if (!automationManager) return { ok: false, error: 'AutomationManager no inicializado', content: '' }
  try {
    const content = await automationManager.readLog(id, opts || {})
    return { ok: true, content }
  } catch (err) {
    return { ok: false, error: err?.message || String(err), content: '' }
  }
})

ipcMain.handle('automations:create-draft-shell', async (_e, payload = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.createDraftShell(payload || {})
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:remove', async (_e, { id } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    const res = await automationManager.remove(id)
    // Limpieza: ventana PTY + ventana chat + persistencia de chat.
    const pw = agentPtyWindowByAutomation.get(id)
    if (pw && !pw.isDestroyed()) { try { pw.close() } catch {} }
    const w = chatWindows.get(id)
    if (w && !w.isDestroyed()) { try { w.close() } catch {} }
    if (automationChat) { try { await automationChat.deleteChat(id) } catch {} }
    return res
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:pause', async (_e, { id } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.pause(id)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:resume', async (_e, { id } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.resume(id)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automations:get-running', async () => {
  if (!automationManager) return []
  try {
    return await automationManager.getRunningIds()
  } catch (err) {
    console.error('[automations:get-running] error:', err?.message || err)
    return []
  }
})

ipcMain.handle('automations:stop-run', async (_e, { id } = {}) => {
  if (!automationManager) return automationsNotReady()
  try {
    return await automationManager.stopRun(id)
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('shell:reveal-in-finder', async (_e, { path: target } = {}) => {
  try {
    if (!target) return { ok: false, error: 'path requerido' }
    shell.showItemInFolder(target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// ── Automation chat IPC ──
// El handler "automation-chat:open" ahora abre la ventana PTY (agente CLI vivo).
// La antigua ventana de burbujas queda accesible solo si se llamara directamente
// a openAutomationChatWindow desde código (no expuesto vía IPC).
ipcMain.handle('automation-chat:open', async (_e, { automationId } = {}) => {
  if (!automationId) return { ok: false, error: 'automationId requerido' }
  const win = await openAutomationPtyWindow(automationId)
  return win ? { ok: true } : { ok: false, error: 'No se pudo abrir el agente' }
})

// ── Automation PTY IPC ──
function getAgentSessionByEvent(event) {
  return agentPtySessions.get(event.sender.id) || null
}

ipcMain.handle('automation-pty:init', async (event) => {
  const s = getAgentSessionByEvent(event)
  if (!s) return { automationId: null }
  let automation = null
  try { automation = await automationManager?.get(s.automationId) } catch {}
  return { automationId: s.automationId, automation, cli: s.activeCli }
})

ipcMain.handle('automation-pty:start', (event, { cols, rows } = {}) => {
  const s = getAgentSessionByEvent(event)
  if (!s) return { ok: false, error: 'No agent session' }
  if (cols && rows) { s.cols = cols; s.rows = rows }
  try {
    startAgentPty(s)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.on('automation-pty:write', (event, data) => {
  const s = getAgentSessionByEvent(event)
  if (!s || !s.pty) return
  try { s.pty.write(data) } catch {}
})

ipcMain.on('automation-pty:resize', (event, { cols, rows } = {}) => {
  const s = getAgentSessionByEvent(event)
  if (!s) return
  if (cols && rows) { s.cols = cols; s.rows = rows }
  try { s.pty?.resize(cols, rows) } catch {}
})

ipcMain.handle('automation-pty:restart', (event, { cols, rows } = {}) => {
  const s = getAgentSessionByEvent(event)
  if (!s) return { ok: false, error: 'No agent session' }
  killAgentPty(s)
  s.buffer = ''
  s.lastBlocks = null
  s.bootstrapInjected = false
  s.detectFromOffset = null
  ensureProposalDir(s.automationId)
  if (cols && rows) { s.cols = cols; s.rows = rows }
  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        startAgentPty(s)
        resolve({ ok: true })
      } catch (err) {
        resolve({ ok: false, error: err?.message || String(err) })
      }
    }, 200)
  })
})

ipcMain.on('automation-pty:close-self', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender)
  if (w && !w.isDestroyed()) w.close()
})

ipcMain.on('automation-pty:minimize-self', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender)
  if (w && !w.isDestroyed()) w.minimize()
})

ipcMain.handle('automation-pty:set-cli', (event, { cli } = {}) => {
  const s = getAgentSessionByEvent(event)
  if (!s) return { ok: false, error: 'No agent session' }
  if (cli !== 'claude' && cli !== 'codex') return { ok: false, error: 'CLI inválido' }
  if (s.activeCli === cli) return { ok: true, cli }
  const check = ensureCliAvailable(cli)
  if (!check.ok) return { ok: false, error: check.error }
  // Mata PTY actual, reinicia con el nuevo CLI.
  killAgentPty(s)
  s.activeCli = cli
  s.buffer = ''
  s.lastBlocks = null
  s.bootstrapInjected = false
  s.detectFromOffset = null
  ensureProposalDir(s.automationId)
  try {
    startAgentPty(s)
    return { ok: true, cli }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

function buildExtractPrompt(transcript) {
  return [
    'Eres un EXTRACTOR ESTRICTO. Recibes la transcripción (con posibles artefactos de TUI) de una conversación entre un usuario y un asistente que estaban diseñando una automatización macOS (script bash + plist launchd).',
    'Tu única tarea: localizar la PROPUESTA FINAL y devolver UN ÚNICO objeto JSON. NADA más. Sin markdown, sin explicación, sin code fences.',
    '',
    'Forma EXACTA del JSON:',
    '{"description": string, "script": string, "plist": string}',
    '',
    'Reglas:',
    '- description: una o dos frases en castellano describiendo qué hace la automatización.',
    '- script: contenido COMPLETO del script bash. Debe empezar por "#!" (shebang). No truncar.',
    '- plist: contenido COMPLETO del plist launchd, con cabecera <?xml ... ?> y cierre </plist>. No truncar.',
    '- Si en la conversación hay varias versiones, usa la ÚLTIMA versión completa.',
    '- Si NO hay propuesta completa (falta script o plist o están incompletos), devuelve EXACTAMENTE: {"error": "razón corta"}',
    '- NO inventes contenido. NO completes lo que no esté en la transcripción.',
    '- Tu respuesta debe ser PARSEABLE por JSON.parse() sin pre-procesado.',
    '',
    '--- TRANSCRIPCIÓN ---',
    transcript,
    '--- FIN TRANSCRIPCIÓN ---',
    '',
    'Devuelve ahora SOLO el JSON.'
  ].join('\n')
}

function parseExtractorJson(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'respuesta vacía' }
  let text = raw.trim()
  // Quita posibles fences ```json ... ``` por si el modelo se pone listillo.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) text = fenceMatch[1].trim()
  // Si hay texto extra, intenta aislar el primer objeto JSON balanceado.
  if (!text.startsWith('{')) {
    const i = text.indexOf('{')
    if (i >= 0) text = text.slice(i)
  }
  let obj
  try { obj = JSON.parse(text) } catch (e) {
    // Intento de rescate: tomar desde la primera { hasta la última }
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try { obj = JSON.parse(text.slice(first, last + 1)) } catch {}
    }
    if (!obj) return { ok: false, error: 'JSON no parseable: ' + (e?.message || e) }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'JSON inválido' }
  if (typeof obj.error === 'string' && obj.error.trim()) return { ok: false, error: obj.error.trim() }
  const blocks = {
    description: typeof obj.description === 'string' ? obj.description.trim() : '',
    script: typeof obj.script === 'string' ? obj.script : '',
    plist: typeof obj.plist === 'string' ? obj.plist : ''
  }
  if (!blocks.script || !blocks.script.includes('#!')) {
    return { ok: false, error: 'script ausente o sin shebang' }
  }
  if (!blocks.plist || !/<plist/i.test(blocks.plist) || !/<\/plist>/i.test(blocks.plist)) {
    return { ok: false, error: 'plist ausente o sin cierre' }
  }
  return { ok: true, blocks }
}

ipcMain.handle('automation-pty:extract', async (event, { runner } = {}) => {
  const s = getAgentSessionByEvent(event)
  if (!s) return { ok: false, error: 'No agent session' }

  // Vía rápida: si la propuesta ya está en disco (Write tool del agente),
  // úsala directamente sin necesidad de invocar headless.
  const fromDisk = readProposalFromDisk(s.automationId)
  if (fromDisk) {
    return {
      ok: true,
      blocks: {
        description: fromDisk.description || '',
        script: fromDisk.script || '',
        plist: fromDisk.plist || ''
      },
      source: 'disk'
    }
  }

  const raw = s.buffer || ''
  if (!raw.trim()) return { ok: false, error: 'Buffer vacío — todavía no hay conversación' }

  // Limpia y limita el tamaño que mandamos al headless.
  const clean = flattenTerminal(stripAnsi(raw))
  // Quédate con los últimos 80k chars: la propuesta final estará al final.
  const transcript = clean.length > 80000 ? clean.slice(-80000) : clean

  const useRunner = runner === 'codex' ? 'codex' : 'claude'
  const prompt = buildExtractPrompt(transcript)

  let result
  try {
    if (useRunner === 'codex') {
      const check = ensureCliAvailable('codex')
      if (!check.ok) {
        // Fallback automático a claude.
        const checkC = ensureCliAvailable('claude')
        if (!checkC.ok) return { ok: false, error: check.error + ' / ' + checkC.error }
        result = await runClaudeHeadless({ prompt, cwd: s.cwd })
      } else {
        result = await runCodexHeadless({ prompt, cwd: s.cwd })
      }
    } else {
      const check = ensureCliAvailable('claude')
      if (!check.ok) {
        const checkX = ensureCliAvailable('codex')
        if (!checkX.ok) return { ok: false, error: check.error + ' / ' + checkX.error }
        result = await runCodexHeadless({ prompt, cwd: s.cwd })
      } else {
        result = await runClaudeHeadless({ prompt, cwd: s.cwd })
      }
    }
  } catch (err) {
    return { ok: false, error: 'Headless falló: ' + (err?.message || String(err)) }
  }

  const parsed = parseExtractorJson(result?.text || '')
  if (!parsed.ok) return parsed
  return { ok: true, blocks: parsed.blocks }
})

// Pull desde el renderer: ¿hay propuesta lista en disco para este agente?
// El renderer pollea esto cada 1.5s y enciende el botón "Aplicar al borrador".
ipcMain.handle('automation-pty:check-proposal', (event) => {
  const s = getAgentSessionByEvent(event)
  if (!s || !s.automationId) return { available: false }
  const found = readProposalFromDisk(s.automationId)
  if (!found) return { available: false }
  return { available: true, blocks: found, automationId: s.automationId }
})

ipcMain.handle('automation-pty:apply-blocks', async (_event, { automationId, blocks } = {}) => {
  if (!automationManager) return automationsNotReady()
  if (!automationId || !blocks) return { ok: false, error: 'payload requerido' }
  try {
    const patch = {}
    if (typeof blocks.script === 'string' && blocks.script.trim()) patch.scriptText = blocks.script
    if (typeof blocks.plist === 'string' && blocks.plist.trim()) patch.plistText = blocks.plist
    if (typeof blocks.description === 'string' && blocks.description.trim()) patch.description = blocks.description
    if (!Object.keys(patch).length) return { ok: false, error: 'bloques vacíos' }
    const res = await automationManager.updateDraft(automationId, patch)
    if (res && res.ok === false) return res
    // Aplicado OK → limpia archivos en disco para que la próxima propuesta empiece limpia
    // y el polling no reemita el mismo bloque indefinidamente.
    clearProposalFromDisk(automationId)
    // Reset lastBlocks de las sesiones abiertas para esa automation, por si vuelve a
    // generarse exactamente la misma propuesta y queremos volver a mostrar el botón.
    for (const s of agentPtySessions.values()) {
      if (s && s.automationId === automationId) s.lastBlocks = null
    }
    return {
      ok: true,
      automation: res?.automation || res,
      reinstalled: !!res?.reinstalled,
      reinstallError: res?.reinstallError || null,
      needsReinstall: !!res?.needsReinstall
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automation-chat:init', (event) => {
  const aid = chatWcToAutomation.get(event.sender.id) || null
  return { automationId: aid }
})

ipcMain.handle('automation-chat:get-history', async (_e, { automationId, provider } = {}) => {
  if (!automationChat || !automationId) return []
  try { return await automationChat.getHistory(automationId, { provider }) }
  catch (err) { console.error('[automation-chat:get-history]', err?.message || err); return [] }
})

ipcMain.handle('automation-chat:send', async (_e, { automationId, content, opts } = {}) => {
  if (!automationChat) return { ok: false, error: 'Chat no inicializado' }
  try {
    const safeOpts = (opts && typeof opts === 'object') ? { ...opts } : {}
    if (typeof safeOpts.provider !== 'string') safeOpts.provider = ''
    if (typeof safeOpts.model !== 'string') safeOpts.model = ''
    if (typeof safeOpts.effort !== 'string') safeOpts.effort = ''
    const res = await automationChat.sendMessage(automationId, content, safeOpts)
    if (res && res.ok === false) {
      return { ok: false, error: res.error, providerError: true, provider: res.provider, messageId: res.messageId }
    }
    return { ok: true, messageId: res.messageId, provider: res.provider }
  } catch (err) {
    // Salvaguarda: no relanzar al renderer, devolver providerError.
    return { ok: false, providerError: true, error: err?.message || String(err) }
  }
})

ipcMain.handle('automation-chat:switch-provider', async (_e, { automationId, toProvider, withSummary } = {}) => {
  if (!automationChat || !automationId) return { ok: false, error: 'Chat no inicializado' }
  try {
    const res = await automationChat.switchProvider(automationId, { toProvider, withSummary: !!withSummary })
    return res
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automation-chat:clear-thread', async (_e, { automationId, provider } = {}) => {
  if (!automationChat || !automationId) return { ok: false, error: 'Chat no inicializado' }
  try {
    return await automationChat.clearThread(automationId, { provider })
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automation-chat:retry-last', async (_e, { automationId, opts } = {}) => {
  if (!automationChat || !automationId) return { ok: false, error: 'Chat no inicializado' }
  try {
    const prefs = await automationChat.getPreferences(automationId)
    const last = await automationChat.getLastUserMessage(automationId, { provider: prefs.provider })
    if (!last) return { ok: false, error: 'Sin mensaje previo del usuario para reintentar' }
    const safeOpts = (opts && typeof opts === 'object') ? { ...opts } : {}
    safeOpts.provider = prefs.provider
    if (typeof safeOpts.model !== 'string') safeOpts.model = prefs.model || ''
    if (typeof safeOpts.effort !== 'string') safeOpts.effort = prefs.effort || ''
    const res = await automationChat.sendMessage(automationId, last, safeOpts)
    if (res && res.ok === false) {
      return { ok: false, error: res.error, providerError: true, provider: res.provider, messageId: res.messageId }
    }
    return { ok: true, messageId: res.messageId, provider: res.provider }
  } catch (err) {
    return { ok: false, providerError: true, error: err?.message || String(err) }
  }
})

ipcMain.handle('automation-chat:get-preferences', async (_e, { automationId } = {}) => {
  if (!automationChat || !automationId) return { provider: 'claude', model: '', effort: '' }
  try { return await automationChat.getPreferences(automationId) }
  catch (err) {
    console.error('[automation-chat:get-preferences]', err?.message || err)
    return { provider: 'claude', model: '', effort: '' }
  }
})

ipcMain.handle('automation-chat:set-preferences', async (_e, { automationId, provider, model, effort } = {}) => {
  if (!automationChat || !automationId) return { ok: false, error: 'Chat no inicializado' }
  try {
    const res = await automationChat.setPreferences(automationId, { provider, model, effort })
    return { ok: true, ...res }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automation-chat:apply-changes', async (_e, payload = {}) => {
  if (!automationChat) return { ok: false, error: 'Chat no inicializado' }
  const { automationId, script, plist, alsoReinstall } = payload
  try {
    if (alsoReinstall) {
      return await automationChat.applyAndReinstall(automationId, { script, plist })
    }
    return await automationChat.applyProposedChanges(automationId, { script, plist })
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('automation-chat:window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) win.close()
  return { ok: true }
})

ipcMain.handle('automation-chat:window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) win.minimize()
  return { ok: true }
})
