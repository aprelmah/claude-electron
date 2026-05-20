const { app, BrowserWindow, Menu, globalShortcut, ipcMain, nativeTheme, dialog, session, systemPreferences, shell, clipboard, protocol, Notification } = require('electron')
const pty = require('node-pty')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { atomicWriteJsonSync, atomicWriteFileSync } = require('./main/atomic-writes')
const { isPathSafe, isValidSessionId } = require('./main/path-sandbox')
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
let createWhatsAppClient = null
let WA_MEDIA_DIR = path.join(os.homedir(), '.claude', 'whatsapp-bridge', 'media')
let WA_MEDIA_PROTOCOL = 'wa-media'
let WA_CONFIG_PATH = path.join(os.homedir(), '.claude', 'whatsapp-bridge', 'config.json')
let whatsappModuleLoadError = null
try {
  ({
    createWhatsAppClient,
    MEDIA_DIR: WA_MEDIA_DIR,
    MEDIA_PROTOCOL: WA_MEDIA_PROTOCOL,
    CONFIG_PATH: WA_CONFIG_PATH
  } = require('./whatsapp/whatsapp-client'))
} catch (err) {
  whatsappModuleLoadError = err
  console.error('[whatsapp] module load failed:', err?.message || err)
}

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
const CODEX_HOME_DIR = path.join(os.homedir(), '.codex')
const CODEX_HISTORY_PATH = path.join(CODEX_HOME_DIR, 'history.jsonl')
const CODEX_SESSION_INDEX_PATH = path.join(CODEX_HOME_DIR, 'session_index.jsonl')
const CODEX_STATE_DB_PATH = path.join(CODEX_HOME_DIR, 'state_5.sqlite')
const WHISPER_CPP_MODEL = process.env.WHISPER_CPP_MODEL || path.join(os.homedir(), '.cache/whisper-cpp/ggml-base-q5_1.bin')
const FFMPEG_BIN = resolveCommand([
  process.env.FFMPEG_BIN,
  path.join(PYTHON39_BIN, 'ffmpeg'),
  path.join(HOMEBREW_BIN, 'ffmpeg'),
  'ffmpeg'
])
const CONFIG_FILENAME = 'claude-novak.config.json'

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// ── PERF telemetry (flag-gated, no overhead when OFF) ──
const PERF = process.env.POWERAGENT_PERF === '1'
const perfPtyLastInputByWc = PERF ? new Map() : null // wcId -> { t0, bytes }
const perfWatchCounters = PERF ? { events: 0, graphActive: 0, treeChanged: 0 } : null
if (PERF) {
  setInterval(() => {
    const c = perfWatchCounters
    if (c.events || c.graphActive || c.treeChanged) {
      console.log(`[PERF watch] events=${c.events} graph:file-active=${c.graphActive} tree-changed=${c.treeChanged}`)
      c.events = 0; c.graphActive = 0; c.treeChanged = 0
    }
  }, 5000).unref?.()
  console.log('[PERF] telemetry enabled (POWERAGENT_PERF=1)')
}

// ── PTY load-aware graph throttling ──
const PTY_GRAPH_LOAD_WINDOW_MS = 1000
const PTY_GRAPH_HIGH_EVENTS_PER_SEC = 60
const PTY_GRAPH_HIGH_HOLD_MS = 5000
const GRAPH_FILE_ACTIVE_MIN_MS_NORMAL = 120
const GRAPH_FILE_ACTIVE_MIN_MS_BUSY = 1200
const GRAPH_REFRESH_MIN_MS_NORMAL = 320
const GRAPH_REFRESH_MIN_MS_BUSY = 1800

// ── Per-window sessions ──
// key = webContents.id → WindowSession { win, wcId, ordinal, pty, cols, rows, cwd, activeCli, treeWatcher, treeWatcherPath, treeWatchDebounce }
const sessions = new Map()
const telegramRelayByChat = new Map() // chatId(string) -> wcId(number)
const viewerWindows = new Set()
let primaryWcId = null
let lastPrimarySnapshot = { cwd: os.homedir(), activeCli: 'claude' }
let nextOrdinal = 0
let telegramBridge = null
let whatsappClient = null
let whatsappReachable = false
let whatsappRetryTimer = null

function trackPtyLoadForGraph(session) {
  if (!session) return
  const now = Date.now()
  if (!session.ptyLoadWindowStartAt || (now - session.ptyLoadWindowStartAt) > PTY_GRAPH_LOAD_WINDOW_MS) {
    session.ptyLoadWindowStartAt = now
    session.ptyLoadEvents = 0
  }
  session.ptyLoadEvents += 1
  const elapsed = Math.max(1, now - session.ptyLoadWindowStartAt)
  if (elapsed < 200) return
  const rate = (session.ptyLoadEvents * 1000) / elapsed
  if (rate >= PTY_GRAPH_HIGH_EVENTS_PER_SEC) {
    session.ptyHighLoadUntil = Math.max(Number(session.ptyHighLoadUntil || 0), now + PTY_GRAPH_HIGH_HOLD_MS)
  }
}

function isPtyGraphLoadHigh(session, now = Date.now()) {
  return Number(session?.ptyHighLoadUntil || 0) > now
}

function markGraphCacheDirtyByPath(changedPath) {
  const full = String(changedPath || '')
  if (!full) return
  for (const s of sessions.values()) {
    const root = s?.graphCacheRoot
    if (!root) continue
    if (full === root || full.startsWith(root + path.sep)) s.graphCacheDirty = true
  }
}

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

function resolveLatestNvmNodeBinDir() {
  const root = path.join(os.homedir(), '.nvm', 'versions', 'node')
  try {
    const versions = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^v\d+/.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    if (!versions.length) return ''
    const binDir = path.join(root, versions[versions.length - 1], 'bin')
    return fs.existsSync(binDir) ? binDir : ''
  } catch {
    return ''
  }
}

const LATEST_NVM_NODE_BIN = resolveLatestNvmNodeBinDir()
const LATEST_NVM_CODEX_BIN = LATEST_NVM_NODE_BIN ? path.join(LATEST_NVM_NODE_BIN, 'codex') : ''

const FALLBACK_CLAUDE_BIN = resolveCommand([
  process.env.CLAUDE_BIN,
  path.join(USER_LOCAL_BIN, 'claude'),
  'claude'
])

const FALLBACK_CODEX_BIN = resolveCommand([
  process.env.CODEX_BIN,
  LATEST_NVM_CODEX_BIN,
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
  atomicWriteJsonSync(p, normalized)
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
  const baseEnv = { ...process.env }
  // Forzamos color en los CLI embebidos aunque la app herede NO_COLOR del entorno.
  delete baseEnv.NO_COLOR
  if (baseEnv.CLICOLOR === '0') delete baseEnv.CLICOLOR
  if (baseEnv.CLICOLOR_FORCE === '0') delete baseEnv.CLICOLOR_FORCE
  if (baseEnv.FORCE_COLOR === '0') delete baseEnv.FORCE_COLOR

  const extraPaths = [USER_LOCAL_BIN, PYTHON39_BIN, '/usr/local/bin']
  if (LATEST_NVM_NODE_BIN) extraPaths.push(LATEST_NVM_NODE_BIN)
  for (const candidate of [appConfig.cli.claudeBin, appConfig.cli.codexBin, appConfig.cli.whisperBin]) {
    if (candidate && candidate.includes('/')) extraPaths.push(path.dirname(candidate))
  }
  const mergedPath = Array.from(new Set([...extraPaths, process.env.PATH || ''])).join(':')
  return {
    ...baseEnv,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
    FORCE_COLOR: '1',
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

// Roots permitidos para IPC handlers de FS: cwds vivos + userData + ~/.claude/.
// Se evalúa por petición (la lista de cwds cambia con cada ventana abierta).
function allowedFsRoots() {
  const roots = new Set()
  roots.add(path.join(os.homedir(), '.claude'))
  roots.add(path.join(os.homedir(), '.codex'))
  try { roots.add(app.getPath('userData')) } catch {}
  try { roots.add(TMP_DIR) } catch {}
  try { roots.add(WA_MEDIA_DIR) } catch {}
  for (const s of sessions.values()) {
    if (s && typeof s.cwd === 'string' && s.cwd) roots.add(s.cwd)
  }
  if (lastPrimarySnapshot && lastPrimarySnapshot.cwd) roots.add(lastPrimarySnapshot.cwd)
  return Array.from(roots)
}

function assertSafeFsPath(p) {
  if (!isPathSafe(p, allowedFsRoots())) {
    const err = new Error('Path not allowed')
    err.code = 'EPATH_NOT_ALLOWED'
    throw err
  }
}

// Wrapper para handlers nuevos/tocados. El resto (95) sigue con su patrón actual;
// migración incremental para no introducir regresiones de retorno.
function safeIpcHandle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args)
    } catch (err) {
      console.error(`[ipc:${channel}]`, err?.message || err)
      return { ok: false, error: err?.message || String(err) }
    }
  })
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

function countConfiguredTelegramUsers(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean).length
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/g)
      .map((v) => v.trim())
      .filter(Boolean)
      .length
  }
  return 0
}

function inferWhatsappBridgeState(payload) {
  if (!payload || typeof payload !== 'object') return 'disconnected'
  const rawState = String(payload.state || payload.status || '').toLowerCase()
  if (payload.error) return 'error'
  if (
    payload.ready === true ||
    payload.connected === true ||
    rawState === 'ready' ||
    rawState === 'connected' ||
    rawState === 'open' ||
    rawState.includes('ready') ||
    rawState.includes('connect')
  ) {
    return 'ready'
  }
  if (
    payload.connected === false ||
    rawState === 'disconnected' ||
    rawState === 'closed' ||
    rawState.includes('disconnect') ||
    rawState.includes('close')
  ) {
    return 'disconnected'
  }
  return 'disconnected'
}

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        let json = null
        if (body.trim()) {
          try { json = JSON.parse(body) } catch {}
        }
        resolve({ statusCode: Number(res.statusCode || 0), json, raw: body })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

async function collectWhatsappBridgeHealth() {
  try {
    const { statusCode, json, raw } = await httpGetJson('http://127.0.0.1:3031/status', 2000)
    if (statusCode >= 400) {
      return {
        state: 'error',
        statusCode,
        detail: `HTTP ${statusCode}${raw ? ` · ${raw.slice(0, 120)}` : ''}`
      }
    }
    const state = inferWhatsappBridgeState(json)
    const detail = json?.message || json?.status || json?.state || (state === 'ready' ? 'ready' : 'disconnected')
    return { state, statusCode, detail: String(detail || '').slice(0, 180) }
  } catch (err) {
    const code = String(err?.code || '')
    const message = err?.message || String(err)
    if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
      return { state: 'disconnected', statusCode: 0, detail: message }
    }
    return { state: 'error', statusCode: 0, detail: message }
  }
}

function collectLaunchdHealth() {
  try {
    const run = spawnSync('launchctl', ['list'], { encoding: 'utf8' })
    if (run.error) {
      return { state: 'error', count: 0, detail: run.error.message || 'launchctl error' }
    }
    const stdout = String(run.stdout || '')
    const stderr = String(run.stderr || '').trim()
    if (run.status !== 0) {
      return {
        state: 'error',
        count: 0,
        detail: `launchctl exit ${run.status}${stderr ? ` · ${stderr.slice(0, 140)}` : ''}`
      }
    }
    const count = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\bcom\.luismi([.\-]|$)/.test(line))
      .length
    return { state: 'ok', count, detail: count > 0 ? `${count} jobs activos` : 'Sin jobs com.luismi activos' }
  } catch (err) {
    return { state: 'error', count: 0, detail: err?.message || String(err) }
  }
}

function collectSchedulerHealth() {
  if (!tasksScheduler) {
    return { state: 'error', activeJobs: 0, runningJobs: 0, detail: 'TaskScheduler no inicializado' }
  }
  const activeJobs = Number(tasksScheduler.jobs?.size || 0)
  const runningJobs = Number(tasksScheduler.activeRuns?.size || 0)
  return {
    state: 'ok',
    activeJobs,
    runningJobs,
    detail: runningJobs > 0
      ? `${activeJobs} jobs activos · ${runningJobs} ejecutándose`
      : `${activeJobs} jobs activos`
  }
}

function collectPtyHealth(session) {
  const current = session || (primaryWcId != null ? sessions.get(primaryWcId) : null)
  const cli = current?.activeCli === 'codex' ? 'codex' : 'claude'
  const cliCheck = ensureCliAvailable(cli)
  if (!cliCheck.ok) {
    return { state: 'error', cli, detail: cliCheck.error }
  }
  if (!current) return { state: 'stopped', cli, detail: 'Sin sesión activa' }
  if (current.pty) return { state: 'active', cli, detail: 'PTY en ejecución' }
  return { state: 'stopped', cli, detail: 'PTY detenido' }
}

function collectTelegramHealth() {
  const cfg = appConfig?.telegram || {}
  const enabled = !!cfg.enabled
  const hasToken = typeof cfg.botToken === 'string' && cfg.botToken.trim().length > 0
  const usersCount = countConfiguredTelegramUsers(cfg.allowedUsers)
  const status = telegramBridge?.getStatus() || null
  if (!enabled || !hasToken || usersCount === 0) {
    return {
      state: 'unconfigured',
      running: false,
      detail: 'Sin configurar',
      botUsername: status?.botUsername || '',
      activeChats: Number(status?.activeChats?.length || 0)
    }
  }
  if (status?.lastError) {
    return {
      state: status.running ? 'linked' : 'error',
      running: !!status.running,
      detail: status.lastError,
      botUsername: status?.botUsername || '',
      activeChats: Number(status?.activeChats?.length || 0)
    }
  }
  if (status?.running) {
    return {
      state: 'linked',
      running: true,
      detail: status?.lastInfo || 'Telegram activo',
      botUsername: status?.botUsername || '',
      activeChats: Number(status?.activeChats?.length || 0)
    }
  }
  return {
    state: 'disconnected',
    running: false,
    detail: status?.lastInfo || 'Bridge detenido',
    botUsername: status?.botUsername || '',
    activeChats: Number(status?.activeChats?.length || 0)
  }
}

async function collectHealthSnapshot(session) {
  const pty = collectPtyHealth(session)
  const telegram = collectTelegramHealth()
  const whatsapp = await collectWhatsappBridgeHealth()
  const launchd = collectLaunchdHealth()
  const scheduler = collectSchedulerHealth()
  const hasError = (
    pty.state === 'error' ||
    telegram.state === 'error' ||
    whatsapp.state === 'error' ||
    launchd.state === 'error' ||
    scheduler.state === 'error'
  )
  return {
    ts: Date.now(),
    global: { state: hasError ? 'error' : 'ok' },
    pty,
    telegram,
    whatsapp,
    launchd,
    scheduler
  }
}

// ── Tree watcher per-session ──
function notifyTreeChangedFor(session, reason) {
  if (!session) return
  if (session.treeWatchDebounce) clearTimeout(session.treeWatchDebounce)
  const baseDelay = reason === 'focus' ? 200 : 800
  const delay = isPtyGraphLoadHigh(session) ? Math.max(baseDelay, 1800) : baseDelay
  session.treeWatchDebounce = setTimeout(() => {
    if (!sessions.has(session.wcId)) return
    if (session.win && !session.win.isDestroyed()) {
      if (PERF) perfWatchCounters.treeChanged++
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

function normalizeProjectKey(raw) {
  return String(raw || '')
    .replace(/^\/+/, '')
    .replace(/[\/\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function resolveClaudeProjectDir(cwd) {
  if (!cwd) return null
  const root = path.join(os.homedir(), '.claude', 'projects')
  const trimmed = String(cwd).replace(/\/$/, '')
  const candidates = Array.from(new Set([
    projectDirFor(trimmed),
    path.join(root, trimmed.replace(/\//g, '-')),
    path.join(root, trimmed.replace(/[\/\s_]+/g, '-'))
  ]))

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c
    } catch {}
  }

  // Fallback robusto: iguala por clave normalizada (espacios/_/- equivalentes).
  try {
    const wanted = normalizeProjectKey(trimmed)
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (normalizeProjectKey(e.name) === wanted) return path.join(root, e.name)
    }
  } catch {}

  return candidates[0]
}

// ── Detección de sessionId de claude (para "enviar a Telegram") ──
// Claude Code v2 crea un fichero ~/.claude/projects/<cwd-codificado>/<sessionId>.jsonl
// al iniciar (o al primer mensaje). Tomamos snapshot del directorio antes del spawn
// y miramos qué fichero nuevo/tocado apareció después.
function claudeProjectSessionsDir(cwd) {
  if (!cwd) return null
  // Resolver con compatibilidad para variaciones históricas del codificado.
  return resolveClaudeProjectDir(cwd)
}

function listClaudeSessionFilesWithMtime(cwd) {
  const dir = claudeProjectSessionsDir(cwd)
  if (!dir) return []
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const p = path.join(dir, f)
        let mtimeMs = 0
        try { mtimeMs = fs.statSync(p).mtimeMs } catch {}
        return { file: f, sessionId: f.replace(/\.jsonl$/, ''), mtimeMs }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  } catch {
    return []
  }
}

function snapshotClaudeSessions(cwd) {
  const snap = new Map()
  for (const row of listClaudeSessionFilesWithMtime(cwd)) snap.set(row.file, row.mtimeMs)
  return snap
}

function findUpdatedOrNewClaudeSessionId(cwd, snapshotBefore) {
  if (!snapshotBefore) return null
  const rows = listClaudeSessionFilesWithMtime(cwd)
  for (const row of rows) {
    const prevMtime = snapshotBefore.get(row.file)
    if (prevMtime == null) return row.sessionId
    if (row.mtimeMs > prevMtime) return row.sessionId
  }
  return null
}

function snapshotClaudeSessionMeta(cwd) {
  const dir = claudeProjectSessionsDir(cwd)
  const snap = new Map()
  if (!dir) return snap
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue
      const p = path.join(dir, file)
      try {
        const st = fs.statSync(p)
        snap.set(file, { size: st.size, mtimeMs: st.mtimeMs })
      } catch {}
    }
  } catch {}
  return snap
}

function pickRelayTranscriptCandidate(cwd, beforeMeta, preferredSessionId) {
  const dir = claudeProjectSessionsDir(cwd)
  if (!dir) return null
  const rows = listClaudeSessionFilesWithMtime(cwd)
  if (rows.length === 0) return null

  const preferredFile = preferredSessionId ? `${preferredSessionId}.jsonl` : null
  const isChanged = (row) => {
    const before = beforeMeta.get(row.file)
    return !before || row.mtimeMs > before.mtimeMs
  }

  if (preferredFile) {
    const changedPreferred = rows.find((r) => r.file === preferredFile && isChanged(r))
    if (changedPreferred) {
      return { ...changedPreferred, filePath: path.join(dir, changedPreferred.file), before: beforeMeta.get(changedPreferred.file) || null }
    }
  }

  const changedAny = rows.find((r) => isChanged(r))
  if (changedAny) {
    return { ...changedAny, filePath: path.join(dir, changedAny.file), before: beforeMeta.get(changedAny.file) || null }
  }

  if (preferredFile) {
    const preferred = rows.find((r) => r.file === preferredFile)
    if (preferred) {
      return { ...preferred, filePath: path.join(dir, preferred.file), before: beforeMeta.get(preferred.file) || null }
    }
  }

  const latest = rows[0]
  return latest ? { ...latest, filePath: path.join(dir, latest.file), before: beforeMeta.get(latest.file) || null } : null
}

function extractAssistantTextFromTranscript(transcriptPath, offsetBytes = 0) {
  try {
    const rawBuf = fs.readFileSync(transcriptPath)
    if (!rawBuf || rawBuf.length === 0) return { text: '', sawAssistant: false, sawEndTurn: false }

    const start = Math.max(0, Math.min(offsetBytes || 0, rawBuf.length))
    let slice = rawBuf.slice(start).toString('utf8')
    if (start > 0) {
      // Si arrancamos en mitad de línea JSON, descarta hasta el siguiente \n.
      const firstNl = slice.indexOf('\n')
      slice = firstNl === -1 ? '' : slice.slice(firstNl + 1)
    }
    if (!slice.trim()) return { text: '', sawAssistant: false, sawEndTurn: false }

    let lastAssistantText = ''
    let sawAssistant = false
    let sawEndTurn = false
    const lines = slice.split('\n')
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      let obj
      try { obj = JSON.parse(line) } catch { continue }
      if (obj?.type !== 'assistant') continue
      sawAssistant = true
      const text = extractTurnText(obj)
      if (text) lastAssistantText = text
      if (obj?.message?.stop_reason === 'end_turn') sawEndTurn = true
    }
    return { text: lastAssistantText, sawAssistant, sawEndTurn }
  } catch {
    return { text: '', sawAssistant: false, sawEndTurn: false }
  }
}

function cleanRelayFallbackText(raw, cli = 'claude') {
  const clean = flattenTerminal(stripAnsi(String(raw || '')))
  if (!clean) return ''
  return clean
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const t = line.trim()
      if (!t) return false
      if (/^(\*+\s*(Brewed|Sauteed|Cogitated)\b)/i.test(t)) return false
      if (/^bypass permissions on\b/i.test(t)) return false
      if (/^\$0\.0000\b/.test(t)) return false
      if (/^\/model\b/i.test(t)) return false
      if (/^Claude Code v/i.test(t)) return false
      if (/^Haiku\b/i.test(t)) return false
      if (cli === 'codex' && /^OpenAI Codex\b/i.test(t)) return false
      if (cli === 'codex' && /^model:\s*/i.test(t)) return false
      if (/^\s*[›>]\s*$/.test(t)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function relayThroughPty(session, prompt, { onText, signal, mode } = {}) {
  if (!session?.pty || !session?.cwd) return null
  const targetCli = mode || session.activeCli
  if (targetCli !== 'claude' && targetCli !== 'codex') return null
  if (session.activeCli !== targetCli) return null
  if (session.relayActive) return null
  const message = String(prompt || '').trim()
  if (!message) return null

  const beforeMeta = targetCli === 'claude' ? snapshotClaudeSessionMeta(session.cwd) : null
  const latest = targetCli === 'claude' ? listClaudeSessionFilesWithMtime(session.cwd)[0] : null
  const preferredSessionId = targetCli === 'claude'
    ? (session.claudeSessionId || latest?.sessionId || null)
    : null
  if (targetCli === 'claude' && !session.claudeSessionId && preferredSessionId) session.claudeSessionId = preferredSessionId

  session.relayActive = true

  return new Promise((resolve, reject) => {
    const MAX_WAIT_MS = 120000
    const WAIT_FIRST_OUTPUT_MS = 25000
    const SILENCE_MS = targetCli === 'codex' ? 3200 : 2200
    const ECHO_SKIP_MS = 700
    const FORCE_FINAL_TEXT_MS = 15000
    const FORCE_END_RELAY_MS = 45000
    const MAX_CAPTURE_CHARS = 180000

    const startedAt = Date.now()
    let lastDataAt = startedAt
    let sawAnyOutput = false
    let capture = ''
    let finalized = false
    let silenceTimer = null
    let firstOutputTimer = null
    let maxTimer = null

    const finishErr = (err) => {
      cleanup()
      reject(err)
    }

    const finishOk = (text, sid) => {
      cleanup()
      const finalText = String(text || '').trim()
      if (!finalText) {
        const err = new Error('Relay empty response')
        err.name = 'RelayEmpty'
        reject(err)
        return
      }
      onText?.(finalText)
      resolve({ sessionId: sid || session.claudeSessionId || preferredSessionId || null, text: finalText })
    }

    const armSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(checkForFinish, SILENCE_MS)
    }

    const buildRelayResult = () => {
      if (targetCli !== 'claude') {
        return { sid: null, fromTranscript: { text: '', sawAssistant: false, sawEndTurn: false } }
      }
      const candidate = pickRelayTranscriptCandidate(session.cwd, beforeMeta, session.claudeSessionId || preferredSessionId)
      let fromTranscript = { text: '', sawAssistant: false, sawEndTurn: false }
      let sid = session.claudeSessionId || preferredSessionId || null
      if (candidate) {
        sid = candidate.sessionId || sid
        const offset = candidate.before?.size || 0
        fromTranscript = extractAssistantTextFromTranscript(candidate.filePath, offset)
        if (!fromTranscript.text) {
          // Rescate: última respuesta del transcript completo.
          fromTranscript = extractAssistantTextFromTranscript(candidate.filePath, 0)
        }
      }
      if (sid) session.claudeSessionId = sid
      return { sid, fromTranscript }
    }

    const checkForFinish = () => {
      if (finalized) return
      if (!session?.pty) {
        const err = new Error('PTY no disponible')
        err.name = 'RelayPtyClosed'
        finishErr(err)
        return
      }
      const now = Date.now()
      if (now - lastDataAt < SILENCE_MS - 40) {
        armSilenceTimer()
        return
      }

      const elapsed = now - startedAt
      const { sid, fromTranscript } = buildRelayResult()
      const text = String(fromTranscript.text || '').trim()
      if (targetCli === 'codex') {
        const fallbackText = cleanRelayFallbackText(capture, 'codex')
        if (fallbackText && elapsed >= 1200) {
          finishOk(fallbackText, sid)
          return
        }
        if (elapsed >= FORCE_END_RELAY_MS) {
          if (!fallbackText) {
            const err = new Error('Relay empty response')
            err.name = 'RelayEmpty'
            finishErr(err)
            return
          }
          finishOk(fallbackText, sid)
          return
        }
        armSilenceTimer()
        return
      }
      if (fromTranscript.sawEndTurn) {
        finishOk(text, sid)
        return
      }
      if (text && elapsed >= FORCE_FINAL_TEXT_MS) {
        finishOk(text, sid)
        return
      }
      if (elapsed >= FORCE_END_RELAY_MS) {
        const fallbackText = text || cleanRelayFallbackText(capture, 'claude')
        finishOk(fallbackText, sid)
        return
      }
      armSilenceTimer()
    }

    const onAbort = () => {
      try { session.pty?.write('\u0003') } catch {}
      const err = new Error('Request aborted')
      err.name = 'AbortError'
      finishErr(err)
    }

    const cleanup = () => {
      if (finalized) return
      finalized = true
      if (silenceTimer) clearTimeout(silenceTimer)
      if (firstOutputTimer) clearTimeout(firstOutputTimer)
      if (maxTimer) clearTimeout(maxTimer)
      if (signal) signal.removeEventListener('abort', onAbort)
      if (session) {
        session.relayActive = false
        session.relayListener = null
        session.relayCancel = null
      }
    }

    session.relayListener = (chunk) => {
      if (finalized) return
      const raw = typeof chunk === 'string' ? chunk : String(chunk || '')
      if (!raw) return
      sawAnyOutput = true
      lastDataAt = Date.now()
      if (firstOutputTimer) {
        clearTimeout(firstOutputTimer)
        firstOutputTimer = null
      }
      if (lastDataAt - startedAt > ECHO_SKIP_MS) {
        capture += raw
        if (capture.length > MAX_CAPTURE_CHARS) capture = capture.slice(-MAX_CAPTURE_CHARS)
      }
      armSilenceTimer()
    }

    session.relayCancel = (err) => {
      if (finalized) return
      const relayErr = err instanceof Error ? err : new Error(String(err || 'Relay canceled'))
      relayErr.name = relayErr.name || 'RelayCanceled'
      finishErr(relayErr)
    }

    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    firstOutputTimer = setTimeout(() => {
      if (finalized || sawAnyOutput) return
      const err = new Error('Relay no output')
      err.name = 'RelayNoOutput'
      finishErr(err)
    }, WAIT_FIRST_OUTPUT_MS)

    maxTimer = setTimeout(() => {
      const err = new Error('Relay timeout')
      err.name = 'RelayTimeout'
      finishErr(err)
    }, MAX_WAIT_MS)

    armSilenceTimer()
    try { session.pty.write(message + '\r') } catch (err) { finishErr(err); return }
  })
}

function canRelayTelegramToPty(session, expectedCli = null) {
  if (!session?.pty) return false
  if (expectedCli && session.activeCli !== expectedCli) return false
  if (!expectedCli && session.activeCli !== 'claude' && session.activeCli !== 'codex') return false
  if (session.relayActive) return false
  return true
}

function normalizeTelegramChatKey(chatId) {
  if (chatId == null) return ''
  const key = String(chatId).trim()
  return key || ''
}

function getRelayBindingForChat(chatId) {
  const key = normalizeTelegramChatKey(chatId)
  if (!key) return { chatId: '', bound: false, wcId: null, session: null }
  const wcId = telegramRelayByChat.get(key)
  if (wcId == null) return { chatId: key, bound: false, wcId: null, session: null }
  const session = sessions.get(wcId) || null
  if (!session) {
    telegramRelayByChat.delete(key)
    return { chatId: key, bound: false, wcId: null, session: null }
  }
  return { chatId: key, bound: true, wcId, session }
}

function getRelayBindingForSession(session, preferredChatId = null) {
  if (!session?.wcId) return { linked: false, chatId: null }
  const preferredKey = normalizeTelegramChatKey(preferredChatId)
  if (preferredKey && telegramRelayByChat.get(preferredKey) === session.wcId) {
    return { linked: true, chatId: preferredKey }
  }
  for (const [chatId, boundWcId] of telegramRelayByChat.entries()) {
    if (boundWcId === session.wcId) return { linked: true, chatId: String(chatId) }
  }
  return { linked: false, chatId: null }
}

function describeRelayUnavailable(session, requiredCli = null) {
  if (!session) return 'la ventana enlazada ya no existe'
  if (!session.pty) return 'el PTY de esa ventana no está iniciado'
  if (requiredCli && session.activeCli !== requiredCli) {
    return `esa ventana está en ${session.activeCli}, no en ${requiredCli}`
  }
  if (session.activeCli !== 'claude' && session.activeCli !== 'codex') {
    return `esa ventana usa un CLI no soportado (${session.activeCli})`
  }
  if (session.relayActive) return 'esa ventana está ocupada con otra petición'
  return 'falló la lectura de respuesta del PTY'
}

function pickRelaySession(expectedCli = null) {
  const primary = primaryWcId != null ? sessions.get(primaryWcId) : null
  if (canRelayTelegramToPty(primary, expectedCli)) return primary
  for (const s of sessions.values()) {
    if (canRelayTelegramToPty(s, expectedCli)) return s
  }
  return null
}

function bindRelaySessionToTelegramChat(chatId, session) {
  const key = normalizeTelegramChatKey(chatId)
  if (!key || !session?.wcId) return
  unbindRelaySessionsByWcId(session.wcId)
  telegramRelayByChat.set(key, session.wcId)
}

function unbindRelaySessionForTelegramChat(chatId) {
  const key = normalizeTelegramChatKey(chatId)
  if (!key) return false
  return telegramRelayByChat.delete(key)
}

function unbindRelaySessionsByWcId(wcId) {
  for (const [chatId, boundWcId] of telegramRelayByChat.entries()) {
    if (boundWcId === wcId) telegramRelayByChat.delete(chatId)
  }
}

function pickRelaySessionForChat(chatId, allowFallback = true, expectedCli = null) {
  const binding = getRelayBindingForChat(chatId)
  if (binding.bound) {
    if (canRelayTelegramToPty(binding.session, expectedCli)) return binding.session
    return allowFallback ? pickRelaySession(expectedCli) : null
  }
  return allowFallback ? pickRelaySession(expectedCli) : null
}

async function syncSessionContextAfterTelegramDetach(session, chatId, cliHint = null) {
  if (!session) return { ok: false, refreshed: false, reason: 'no-session' }
  const targetCli = (cliHint === 'codex' || cliHint === 'claude')
    ? cliHint
    : (session.activeCli === 'codex' ? 'codex' : 'claude')
  const key = normalizeTelegramChatKey(chatId)

  if (targetCli === 'codex') {
    const codexSessionId = telegramBridge?.getSessionId?.(key, 'codex') || null
    if (!codexSessionId) {
      return { ok: true, refreshed: false, mode: 'codex', reason: 'no-session-id' }
    }
    try {
      killPty(session)
      await new Promise((resolve) => setTimeout(resolve, 180))
      startPty(session, session.cols, session.rows, session.cwd, ['resume', codexSessionId])
      if (session === sessions.get(primaryWcId)) updatePrimarySnapshot()
      return { ok: true, refreshed: true, mode: 'codex', sessionId: codexSessionId }
    } catch (err) {
      return {
        ok: false,
        refreshed: false,
        mode: 'codex',
        sessionId: codexSessionId,
        error: err?.message || String(err)
      }
    }
  }

  const claudeSid = session.claudeSessionId || telegramBridge?.getSessionId?.(key, 'claude') || null
  if (!session.claudeSessionId && claudeSid) session.claudeSessionId = claudeSid
  return { ok: true, refreshed: !!claudeSid, mode: 'claude', sessionId: claudeSid || null }
}

// ── PTY per-session ──
function startPty(session, cols, rows, cwd, args = []) {
  if (!session) throw new Error('Sesión no disponible')
  if (session.pty) return session.pty
  session.ptyStartedAt = Date.now()
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
  if (session.activeCli === 'claude') {
    session.claudeSessionId = extractClaudeResumeId(args)
  } else if (session.activeCli === 'codex') {
    session.codexSessionId = extractCodexResumeId(args)
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

  // Poll continuo para capturar el sessionId que claude cree/actualice en ~/.claude/projects/...
  // Sigue hasta detectarlo o hasta que el PTY muera.
  if (sessionFilesBefore) {
    const detect = setInterval(() => {
      const s = sessions.get(myWcId)
      if (!s || !s.pty || s.pty !== proc) { clearInterval(detect); return }
      if (s.claudeSessionId) { clearInterval(detect); return }
      const sid = findUpdatedOrNewClaudeSessionId(s.cwd, sessionFilesBefore)
      if (sid) {
        s.claudeSessionId = sid
        clearInterval(detect)
      }
    }, 2000)
  }

  proc.onData((data) => {
    if (!proc._alive) return
    const s = sessions.get(myWcId)
    if (s) trackPtyLoadForGraph(s)
    if (s?.relayListener) {
      try { s.relayListener(data) } catch {}
    }
    if (s) s.lastPtyDataAt = Date.now()
    if (PERF && s) {
      const last = perfPtyLastInputByWc.get(s.wcId)
      if (last && (Date.now() - last.t0) < 2000) {
        const dt = Date.now() - last.t0
        const outBytes = (typeof data === 'string') ? Buffer.byteLength(data) : (data?.length || 0)
        console.log(`[PERF pty] in→out=${dt}ms inBytes=${last.bytes} outBytes=${outBytes} wc=${s.wcId}`)
        perfPtyLastInputByWc.delete(s.wcId)
      }
    }
    if (!s || !s.win || s.win.isDestroyed()) return
    // Mantener siempre espejo local: aunque Telegram esté en relay activo,
    // la ventana principal sigue mostrando el stream real de la PTY.
    s.win.webContents.send('pty-data', data)
  })

  proc.onExit(() => {
    if (proc._alive) {
      const s = sessions.get(myWcId)
      if (s && s.win && !s.win.isDestroyed()) s.win.webContents.send('pty-exit')
    }
    const s = sessions.get(myWcId)
    if (s && s.pty === proc) {
      if (typeof s.relayCancel === 'function') {
        const err = new Error('PTY cerrado')
        err.name = 'RelayPtyClosed'
        try { s.relayCancel(err) } catch {}
      }
      s.pty = null
      s.relayActive = false
      s.relayListener = null
      s.relayCancel = null
      s.ptyLoadWindowStartAt = 0
      s.ptyLoadEvents = 0
      s.ptyHighLoadUntil = 0
    }
  })

  if (session === sessions.get(primaryWcId)) updatePrimarySnapshot()
  return proc
}

function killPty(session) {
  if (!session || !session.pty) return
  if (typeof session.relayCancel === 'function') {
    const err = new Error('PTY reiniciado')
    err.name = 'RelayPtyClosed'
    try { session.relayCancel(err) } catch {}
  }
  session.pty._alive = false
  try { session.pty.kill() } catch {}
  session.pty = null
  session.relayActive = false
  session.relayListener = null
  session.relayCancel = null
  session.ptyLoadWindowStartAt = 0
  session.ptyLoadEvents = 0
  session.ptyHighLoadUntil = 0
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
  const metaPrefix = `${wcId}|`
  for (const key of currentSessionMetaCache.keys()) {
    if (String(key).startsWith(metaPrefix)) currentSessionMetaCache.delete(key)
  }
  if (s.treeWatchDebounce) { clearTimeout(s.treeWatchDebounce); s.treeWatchDebounce = null }
  if (s.treeWatcher) { try { s.treeWatcher.close() } catch {} s.treeWatcher = null }
  killPty(s)
  unbindRelaySessionsByWcId(wcId)
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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: appConfig?.ui?.theme === 'light' ? '#fafafd' : '#1a1a1f',
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
    claudeSessionId: null,
    codexSessionId: null,
    ptyStartedAt: 0,
    relayActive: false,
    relayListener: null,
    relayCancel: null,
    lastRelayInputWarnAt: 0,
    lastPtyDataAt: 0,
    lastLocalInputAt: 0,
    ptyLoadWindowStartAt: 0,
    ptyLoadEvents: 0,
    ptyHighLoadUntil: 0,
    treeWatcher: null,
    treeWatcherPath: null,
    treeWatchDebounce: null,
    graphCacheRoot: '',
    graphCacheDirty: true,
    graphCacheBuiltAt: 0,
    graphCacheResult: null,
    graphFileActiveLastAt: 0,
    graphFileActiveLastPath: ''
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
    stateDir: app.getPath('userData'),
    onTranscribeFile: async (filePath) => {
      return transcribeAudioFile(filePath, buildRuntimeEnv())
    },
    onRunQuery: async (opts) => {
      const tg = appConfig.telegram || {}
      const cwd = getCwdSync()
      const binding = getRelayBindingForChat(opts?.chatId)
      const boundCli = binding.bound ? binding.session?.activeCli : null
      const targetCli = (boundCli === 'claude' || boundCli === 'codex')
        ? boundCli
        : (opts?.cli === 'codex' ? 'codex' : 'claude')

      if (targetCli === 'codex') {
        // Codex por Telegram se mantiene en ruta headless estable (resume por thread_id).
        // El relay PTY en Codex puede no delimitar fin de turno de forma consistente y provocar latencia/doble respuesta.
        return runCodexHeadless({ ...opts, cli: 'codex', cwd, model: tg.codexModel || '', effort: tg.codexEffort || '' })
      }

      const relaySession = pickRelaySessionForChat(opts?.chatId, !binding.bound, 'claude')
      if (relaySession) {
        try {
          const relayResult = await relayThroughPty(relaySession, opts?.userPrompt || opts?.prompt, {
            onText: opts?.onText,
            signal: opts?.signal,
            mode: 'claude'
          })
          if (relayResult) return relayResult
        } catch (err) {
          if (err?.name === 'AbortError') throw err
          if (binding.bound) {
            throw new Error(`Relay PTY enlazado falló: ${describeRelayUnavailable(binding.session, 'claude')}.`)
          }
          console.warn('[telegram-relay] PTY relay falló, usando fallback headless:', err?.name || err?.message || err)
        }
      }
      if (binding.bound) {
        throw new Error(`La sesión enlazada de Telegram no está disponible: ${describeRelayUnavailable(binding.session, 'claude')}.`)
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
    onUnlinkRelay: async (chatId) => {
      const key = normalizeTelegramChatKey(chatId)
      if (!key) return { ok: false, linked: false, error: 'Chat inválido' }
      const binding = getRelayBindingForChat(key)
      const detached = unbindRelaySessionForTelegramChat(key)
      if (detached) broadcastTelegramStatus()
      const sync = binding.bound
        ? await syncSessionContextAfterTelegramDetach(binding.session, key, binding.session?.activeCli)
        : { ok: true, refreshed: false, reason: 'no-bound-session' }
      return { ok: true, linked: false, detached, chatId: key, sync }
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

let codexHistoryCache = { key: '', rows: [] }
let codexSessionIndexCache = { key: '', byId: new Map() }
let codexStateThreadCache = new Map()
let codexStateDbCacheKey = ''
const CLAUDE_TITLE_CACHE_MAX = 600
const claudeSessionTitleCache = new Map()
const SESSION_META_CACHE_MAX = 300
const currentSessionMetaCache = new Map()

function statCacheKey(stat) {
  if (!stat) return ''
  return `${Number(stat.mtimeMs || 0)}:${Number(stat.size || 0)}`
}

function safeStat(filePath) {
  try { return fs.statSync(filePath) } catch { return null }
}

function rememberClaudeSessionTitle(filePath, entry) {
  if (!filePath || !entry) return
  if (claudeSessionTitleCache.has(filePath)) claudeSessionTitleCache.delete(filePath)
  claudeSessionTitleCache.set(filePath, entry)
  if (claudeSessionTitleCache.size > CLAUDE_TITLE_CACHE_MAX) {
    const oldest = claudeSessionTitleCache.keys().next().value
    if (oldest) claudeSessionTitleCache.delete(oldest)
  }
}

function forgetClaudeSessionTitle(filePath) {
  if (!filePath) return
  claudeSessionTitleCache.delete(filePath)
}

function rememberSessionMeta(cacheKey, entry) {
  if (!cacheKey || !entry) return
  if (currentSessionMetaCache.has(cacheKey)) currentSessionMetaCache.delete(cacheKey)
  currentSessionMetaCache.set(cacheKey, entry)
  if (currentSessionMetaCache.size > SESSION_META_CACHE_MAX) {
    const oldest = currentSessionMetaCache.keys().next().value
    if (oldest) currentSessionMetaCache.delete(oldest)
  }
}

function fileCacheKey(filePath) {
  return statCacheKey(safeStat(filePath))
}

function clipText(text, max = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function loadCodexHistoryRows() {
  const key = fileCacheKey(CODEX_HISTORY_PATH)
  if (!key) return []
  if (codexHistoryCache.key === key) return codexHistoryCache.rows

  let rows = []
  try {
    const raw = fs.readFileSync(CODEX_HISTORY_PATH, 'utf-8')
    rows = raw
      .split('\n')
      .map((line) => {
        if (!line.trim()) return null
        try {
          const obj = JSON.parse(line)
          const sessionId = typeof obj?.session_id === 'string' ? obj.session_id.trim() : ''
          const ts = Number(obj?.ts)
          const tsMs = Number.isFinite(ts) ? ts * 1000 : 0
          const text = typeof obj?.text === 'string' ? clipText(obj.text, 220) : ''
          if (!sessionId) return null
          return { sessionId, tsMs, text }
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {}

  if (rows.length > 5000) rows = rows.slice(-5000)
  codexHistoryCache = { key, rows }
  return rows
}

function loadCodexSessionIndexMap() {
  const key = fileCacheKey(CODEX_SESSION_INDEX_PATH)
  if (!key) return new Map()
  if (codexSessionIndexCache.key === key) return codexSessionIndexCache.byId

  const byId = new Map()
  try {
    const raw = fs.readFileSync(CODEX_SESSION_INDEX_PATH, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        const id = typeof obj?.id === 'string' ? obj.id.trim() : ''
        const title = clipText(obj?.thread_name || obj?.title || obj?.preview || '', 220)
        if (id && title) byId.set(id, title)
      } catch {}
    }
  } catch {}

  codexSessionIndexCache = { key, byId }
  return byId
}

function escapeSqlLiteral(text) {
  return String(text || '').replace(/'/g, "''")
}

function readCodexStateThreadMeta(threadId) {
  const id = String(threadId || '').trim()
  if (!id) return null
  const dbKey = fileCacheKey(CODEX_STATE_DB_PATH)
  if (!dbKey) return null
  if (codexStateDbCacheKey !== dbKey) {
    codexStateDbCacheKey = dbKey
    codexStateThreadCache = new Map()
  }
  if (codexStateThreadCache.has(id)) return codexStateThreadCache.get(id)

  const sql = `select json_object('title', coalesce(title,''), 'cwd', coalesce(cwd,'')) from threads where id='${escapeSqlLiteral(id)}' order by updated_at desc limit 1;`
  let meta = null
  try {
    const out = spawnSync('sqlite3', [CODEX_STATE_DB_PATH, sql], {
      encoding: 'utf8',
      timeout: 1200,
      maxBuffer: 1024 * 256
    })
    if (!out.error && out.status === 0) {
      const line = String(out.stdout || '').trim().split('\n')[0] || ''
      if (line.startsWith('{')) {
        const obj = JSON.parse(line)
        meta = {
          title: clipText(obj?.title || '', 220),
          cwd: String(obj?.cwd || '').trim()
        }
      }
    }
  } catch {}

  codexStateThreadCache.set(id, meta)
  if (codexStateThreadCache.size > 500) {
    const oldest = codexStateThreadCache.keys().next().value
    if (oldest) codexStateThreadCache.delete(oldest)
  }
  return meta
}

function extractCodexResumeId(args) {
  if (!Array.isArray(args) || args.length < 2) return null
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === 'resume' && args[i + 1]) return String(args[i + 1]).trim()
  }
  return null
}

function extractClaudeResumeId(args) {
  if (!Array.isArray(args) || args.length < 2) return null
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--resume' && args[i + 1]) return String(args[i + 1]).trim()
  }
  return null
}

function guessCodexSessionFromHistory(session) {
  const rows = loadCodexHistoryRows()
  if (!rows.length) return null

  const sinceMs = Math.max(
    Number(session?.ptyStartedAt || 0),
    Number(session?.lastLocalInputAt || 0) - 1500
  )

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (!row?.sessionId) continue
    if (sinceMs > 0 && row.tsMs > 0 && row.tsMs + 2000 < sinceMs) continue
    return row
  }

  return rows[rows.length - 1] || null
}

function readClaudeSessionTitle(cwd, sessionId) {
  const _perfT0 = PERF ? Date.now() : 0
  const sid = String(sessionId || '').trim()
  if (!sid) return { title: '', path: null, statKey: '' }
  const dir = resolveClaudeProjectDir(cwd)
  const file = dir ? path.join(dir, `${sid}.jsonl`) : null
  if (!file) {
    return { title: '', path: null, statKey: '' }
  }

  const stat = safeStat(file)
  if (!stat) {
    if (file) forgetClaudeSessionTitle(file)
    return { title: '', path: file, statKey: '' }
  }

  const nextStatKey = statCacheKey(stat)
  const cached = claudeSessionTitleCache.get(file)
  if (cached && cached.statKey === nextStatKey) {
    if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] readClaudeSessionTitle=${dt}ms (cached-stat)`) }
    return { title: cached.title || '', path: file, statKey: nextStatKey }
  }
  // El título viene del primer turno de usuario y suele ser estable.
  // Si el archivo solo crece (append), evitamos releer todo el JSONL.
  if (cached && cached.title && Number(stat.size || 0) > Number(cached.size || 0)) {
    rememberClaudeSessionTitle(file, {
      title: cached.title,
      statKey: nextStatKey,
      mtimeMs: Number(stat.mtimeMs || 0),
      size: Number(stat.size || 0)
    })
    if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] readClaudeSessionTitle=${dt}ms (cached-append)`) }
    return { title: cached.title || '', path: file, statKey: nextStatKey }
  }

  let title = ''
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj?.type !== 'user') continue
        const text = extractTurnText(obj).replace(/<[^>]+>/g, '').trim()
        if (text && !text.startsWith('Caveat:')) {
          title = clipText(text)
          break
        }
      } catch {}
    }
  } catch {}
  rememberClaudeSessionTitle(file, {
    title,
    statKey: nextStatKey,
    mtimeMs: Number(stat?.mtimeMs || 0),
    size: Number(stat?.size || 0)
  })
  if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] readClaudeSessionTitle=${dt}ms (read size=${Number(stat?.size || 0)})`) }
  return { title, path: file, statKey: nextStatKey }
}

function buildCurrentSessionMeta(session) {
  const _perfT0 = PERF ? Date.now() : 0
  const cli = session?.activeCli === 'codex' ? 'codex' : 'claude'
  const cwd = session?.cwd || os.homedir()
  const wcId = Number(session?.wcId || 0)

  if (cli === 'claude') {
    let sessionId = session?.claudeSessionId || null
    if (!sessionId) {
      const latest = listClaudeSessionFilesWithMtime(cwd)[0]
      if (latest?.sessionId) {
        sessionId = latest.sessionId
        session.claudeSessionId = sessionId
      }
    }
    const info = readClaudeSessionTitle(cwd, sessionId)
    const cacheKey = `${wcId}|claude|${cwd}|${sessionId || ''}`
    const sourceKey = `${info.statKey || ''}|${sessionId || ''}`
    const cachedMeta = currentSessionMetaCache.get(cacheKey)
    if (cachedMeta && cachedMeta.sourceKey === sourceKey) {
      if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] buildCurrentSessionMeta(claude)=${dt}ms (cache-hit)`) }
      return cachedMeta.meta
    }
    const nextMeta = {
      cli,
      cwd,
      sessionId: sessionId || null,
      title: info.title || '(sin título)',
      path: info.path || null
    }
    rememberSessionMeta(cacheKey, { sourceKey, meta: nextMeta })
    if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] buildCurrentSessionMeta(claude)=${dt}ms`) }
    return nextMeta
  }

  let sessionId = session?.codexSessionId || null
  let fallbackTitle = ''
  if (!sessionId) {
    const guess = guessCodexSessionFromHistory(session)
    if (guess?.sessionId) {
      sessionId = guess.sessionId
      session.codexSessionId = sessionId
      fallbackTitle = guess.text || ''
    }
  }

  const historyKey = fileCacheKey(CODEX_HISTORY_PATH)
  const indexKey = fileCacheKey(CODEX_SESSION_INDEX_PATH)
  const stateDbKey = fileCacheKey(CODEX_STATE_DB_PATH)
  const cacheKey = `${wcId}|codex|${cwd}|${sessionId || ''}`
  const sourceKey = `${historyKey}|${indexKey}|${stateDbKey}|${sessionId || ''}`
  const cachedMeta = currentSessionMetaCache.get(cacheKey)
  if (cachedMeta && cachedMeta.sourceKey === sourceKey) {
    if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] buildCurrentSessionMeta(codex)=${dt}ms (cache-hit)`) }
    return cachedMeta.meta
  }

  const stateMeta = sessionId ? readCodexStateThreadMeta(sessionId) : null
  const indexTitle = sessionId ? (loadCodexSessionIndexMap().get(sessionId) || '') : ''
  const title = clipText(stateMeta?.title || indexTitle || fallbackTitle, 160) || '(sin título)'
  const nextMeta = {
    cli,
    cwd,
    sessionId: sessionId || null,
    title,
    path: null
  }
  rememberSessionMeta(cacheKey, { sourceKey, meta: nextMeta })
  if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] buildCurrentSessionMeta(codex)=${dt}ms`) }
  return nextMeta
}

function resolveSessionIdForRelay(session) {
  if (!session) return null
  const cli = session.activeCli === 'codex' ? 'codex' : 'claude'
  if (cli === 'claude') {
    if (session.claudeSessionId) return session.claudeSessionId
    const latest = listClaudeSessionFilesWithMtime(session.cwd)[0]
    if (latest?.sessionId) {
      session.claudeSessionId = latest.sessionId
      return latest.sessionId
    }
    return null
  }
  if (session.codexSessionId) return session.codexSessionId
  const guess = guessCodexSessionFromHistory(session)
  if (guess?.sessionId) {
    session.codexSessionId = guess.sessionId
    return guess.sessionId
  }
  return null
}

function escapeForCompactedPrompt(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function compactClaudeSessionIfNeeded({ sessionId, prompt, cwd }) {
  if (!sessionId) return { sessionId, prompt }
  const baseCwd = cwd || getCwdSync()
  const transcriptPath = path.join(projectDirFor(baseCwd), `${sessionId}.jsonl`)
  if (!fs.existsSync(transcriptPath)) return { sessionId, prompt }

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
    .map((t) => `${t.role === 'user' ? 'Usuario' : 'Asistente'}: ${escapeForCompactedPrompt(t.text)}`)
    .join('\n\n')

  const compactedPrompt =
    `[Contexto: conversación previa, últimos ${recent.length} turnos]\n\n` +
    transcript +
    `\n\n[Nuevo mensaje del usuario]\n${escapeForCompactedPrompt(prompt)}`

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

  // ── WhatsApp bridge client ──
  if (createWhatsAppClient) {
    try {
      fs.mkdirSync(WA_MEDIA_DIR, { recursive: true })
      protocol.registerFileProtocol(WA_MEDIA_PROTOCOL, (request, callback) => {
        try {
          const u = new URL(request.url)
          const name = decodeURIComponent(u.hostname || u.pathname.replace(/^\/+/, ''))
          const safe = path.basename(name)
          callback({ path: path.join(WA_MEDIA_DIR, safe) })
        } catch {
          callback({ error: -6 })
        }
      })
    } catch (err) {
      console.error('[whatsapp] protocol register failed:', err?.message || err)
    }

    whatsappClient = createWhatsAppClient({
      buildRuntimeEnv,
      transcribeAudio: (mediaPath) => transcribeAudioFile(mediaPath, buildRuntimeEnv())
    })
    whatsappClient.on('new-message', (payload) => broadcastToAllWindows('whatsapp:new-message', payload))
    whatsappClient.on('chat-updated', (payload) => broadcastToAllWindows('whatsapp:chat-updated', payload))
    whatsappClient.on('status-changed', (status) => {
      whatsappReachable = status !== 'disconnected'
      broadcastToAllWindows('whatsapp:status-changed', status)
    })

    whatsappClient.on('new-message', (payload) => {
      try {
        const message = payload && (payload.message || payload)
        if (!message || message.fromMe === true) return
        const mainFocused = BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w !== whatsappWindow && w.isFocused())
        const waFocused = !!(whatsappWindow && !whatsappWindow.isDestroyed() && whatsappWindow.isFocused())
        if (waFocused || mainFocused) return
        const jid = (payload && payload.jid) || message.from || ''
        let chat = payload && payload.chat
        if (!chat && jid) {
          try { chat = (whatsappClient.getChats() || []).find(c => c && c.jid === jid) || null } catch {}
        }
        const title = (chat && (chat.displayName || chat.displayNumber)) ||
                      message.pushName ||
                      jid ||
                      'WhatsApp'
        const bodyType = {
          audio: 'Mensaje de voz',
          image: 'Imagen',
          video: 'Vídeo',
          document: 'Documento',
          sticker: 'Sticker'
        }[message.type] || ''
        const body = (message.body && String(message.body).slice(0, 140)) || bodyType || 'Mensaje nuevo'
        if (!Notification.isSupported()) return
        const n = new Notification({ title: String(title), body, silent: false })
        n.on('click', () => {
          try { global.__openWhatsappWindow && global.__openWhatsappWindow() } catch {}
        })
        n.show()
      } catch (err) {
        console.warn('[whatsapp] native notification failed:', err?.message || err)
      }
    })

    let waBadgeTimer = null
    function refreshWaBadge() {
      if (waBadgeTimer) return
      waBadgeTimer = setTimeout(() => {
        waBadgeTimer = null
        try {
          if (!whatsappClient || typeof app.setBadgeCount !== 'function') return
          const list = whatsappClient.getChats() || []
          const total = list.reduce((acc, c) => acc + (Number(c && c.unread) || 0), 0)
          app.setBadgeCount(total > 0 ? total : 0)
        } catch {}
      }, 300)
      waBadgeTimer.unref?.()
    }
    whatsappClient.on('new-message', refreshWaBadge)
    whatsappClient.on('chat-updated', refreshWaBadge)
    global.__waRefreshBadge = refreshWaBadge

    function pingBridge() {
      return new Promise((resolve, reject) => {
        const req = require('http').request({
          host: '127.0.0.1', port: 3031, method: 'GET', path: '/status', timeout: 3000
        }, (res) => {
          res.resume()
          if (res.statusCode >= 200 && res.statusCode < 300) resolve()
          else reject(new Error(`status ${res.statusCode}`))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(new Error('timeout')) })
        req.end()
      })
    }
    async function tryStartWhatsapp() {
      try {
        await pingBridge()
        whatsappReachable = true
        whatsappClient.start()
        console.log('[whatsapp] bridge reachable, client started')
      } catch (err) {
        whatsappReachable = false
        console.warn('[whatsapp] bridge not reachable, retrying in 10s:', err?.message || err)
        whatsappRetryTimer = setTimeout(tryStartWhatsapp, 10_000)
        whatsappRetryTimer.unref?.()
      }
    }
    tryStartWhatsapp()
  } else {
    whatsappReachable = false
    console.warn('[whatsapp] disabled: module unavailable', whatsappModuleLoadError?.message || '')
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
  try { whatsappClient?.stop() } catch {}
  if (whatsappRetryTimer) { clearTimeout(whatsappRetryTimer); whatsappRetryTimer = null }
  try { if (typeof app.setBadgeCount === 'function') app.setBadgeCount(0) } catch {}
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
  if (s?.relayActive) {
    const now = Date.now()
    if (!s.lastRelayInputWarnAt || (now - s.lastRelayInputWarnAt) > 1500) {
      s.lastRelayInputWarnAt = now
      try {
        s.win?.webContents?.send('pty-busy', 'Relay activo: Telegram está usando esta sesión ahora.')
      } catch {}
    }
    return
  }
  if (s) s.lastLocalInputAt = Date.now()
  if (PERF && s) {
    perfPtyLastInputByWc.set(s.wcId, { t0: Date.now(), bytes: (typeof data === 'string') ? Buffer.byteLength(data) : (data?.length || 0) })
  }
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

safeIpcHandle('fs-read-dir', async (event, dirPath) => {
  assertSafeFsPath(dirPath)
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
})

function computeProjectGraph(rootPath) {
  if (!rootPath) return { ok: false, error: 'no rootPath' }

  const SKIP = new Set(['.DS_Store', '.git', 'node_modules', '.next', '.cache',
    '__pycache__', '.venv', 'venv', 'dist', 'build', '.idea', '.vscode', 'coverage'])
  const BIN_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.dmg', '.app', '.zip', '.tar', '.gz', '.pdf', '.ttf', '.woff', '.woff2',
    '.eot', '.mp3', '.mp4', '.wav', '.ogg', '.db', '.sqlite'])

  const MAX_GRAPH_FILES = 20000
  const MAX_GRAPH_DIRS = 12000
  const allFiles = []
  const allDirs = []
  const dirSet = new Set()
  const fileMtime = new Map()

  function addDir(p) {
    if (!p || dirSet.has(p)) return
    dirSet.add(p)
    allDirs.push(p)
  }

  function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (allFiles.length > MAX_GRAPH_FILES || allDirs.length > MAX_GRAPH_DIRS) return
      // Alineado con árbol lateral: solo saltar carpetas/archivos explícitamente ignorados.
      if (SKIP.has(e.name) || e.name.startsWith('._')) continue
      if (typeof e.isSymbolicLink === 'function' && e.isSymbolicLink()) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        addDir(full)
        walk(full)
      } else if (e.isFile()) {
        allFiles.push(full)
        try { fileMtime.set(full, fs.statSync(full).mtimeMs || 0) } catch { fileMtime.set(full, 0) }
      }
    }
  }

  addDir(rootPath)
  walk(rootPath)

  if (allFiles.length > MAX_GRAPH_FILES) {
    return { ok: false, error: `Proyecto demasiado grande: ${allFiles.length} archivos (máx ${MAX_GRAPH_FILES})` }
  }
  if (allDirs.length > MAX_GRAPH_DIRS) {
    return { ok: false, error: `Proyecto demasiado grande: ${allDirs.length} carpetas (máx ${MAX_GRAPH_DIRS})` }
  }

  const fileByBasename = new Map()
  const fileByBasenameMany = new Map()
  const fileByRelNoExt = new Map()
  const goDirAnyFile = new Map()
  const goDirsByBase = new Map()
  for (const f of allFiles) {
    const base = path.basename(f, path.extname(f)).toLowerCase()
    if (!fileByBasename.has(base)) fileByBasename.set(base, f)
    if (!fileByBasenameMany.has(base)) fileByBasenameMany.set(base, [])
    fileByBasenameMany.get(base).push(f)
    const rel = path.relative(rootPath, f).replace(/\\/g, '/')
    const relNoExt = rel.replace(/\.[^/.]+$/, '').toLowerCase()
    if (!fileByRelNoExt.has(relNoExt)) fileByRelNoExt.set(relNoExt, f)
    if (relNoExt.endsWith('/__init__')) {
      const asPkg = relNoExt.slice(0, -'/__init__'.length)
      if (asPkg && !fileByRelNoExt.has(asPkg)) fileByRelNoExt.set(asPkg, f)
    }
    if (path.extname(f).toLowerCase() === '.go') {
      const dir = path.dirname(f)
      if (!goDirAnyFile.has(dir)) goDirAnyFile.set(dir, f)
      const baseDir = path.basename(dir).toLowerCase()
      if (!goDirsByBase.has(baseDir)) goDirsByBase.set(baseDir, [])
      goDirsByBase.get(baseDir).push(dir)
    }
  }

  const allFilesSet = new Set(allFiles)
  const edges = []

  const pickFirstByExt = (arr, preferred = []) => {
    if (!Array.isArray(arr) || arr.length === 0) return null
    for (const ext of preferred) {
      const hit = arr.find((p) => path.extname(p).toLowerCase() === ext)
      if (hit) return hit
    }
    return arr[0]
  }

  const resolveModuleLike = (name, preferredExt = []) => {
    const raw = String(name || '').trim()
    if (!raw) return null
    const asPath = raw.replace(/\./g, '/').toLowerCase()
    if (fileByRelNoExt.has(asPath)) return fileByRelNoExt.get(asPath)
    const relHit = fileByRelNoExt.get(raw.toLowerCase())
    if (relHit) return relHit
    const tail = asPath.split('/').pop()
    return pickFirstByExt(fileByBasenameMany.get(tail), preferredExt)
  }

  const addEdge = (source, target) => {
    if (!source || !target || source === target) return
    if (!allFilesSet.has(source) || !allFilesSet.has(target)) return
    edges.push({ source, target })
  }

  let goModuleName = ''
  try {
    const goModPath = path.join(rootPath, 'go.mod')
    if (fs.existsSync(goModPath)) {
      const goMod = fs.readFileSync(goModPath, 'utf8')
      const mm = goMod.match(/^\s*module\s+([^\s]+)\s*$/m)
      if (mm && mm[1]) goModuleName = mm[1].trim()
    }
  } catch {}

  const resolveGoImportPath = (sourcePath, importPath) => {
    const imp = String(importPath || '').trim()
    if (!imp) return null
    if (imp.startsWith('.')) {
      const rel = path.resolve(path.dirname(sourcePath), imp)
      const goFile = goDirAnyFile.get(rel)
      if (goFile) return goFile
      const base = path.basename(rel).toLowerCase()
      const dirs = goDirsByBase.get(base)
      return dirs && dirs.length ? goDirAnyFile.get(dirs[0]) : null
    }
    if (goModuleName && (imp === goModuleName || imp.startsWith(`${goModuleName}/`))) {
      const tail = imp === goModuleName ? '' : imp.slice(goModuleName.length + 1)
      const localDir = path.join(rootPath, tail)
      const goFile = goDirAnyFile.get(localDir)
      if (goFile) return goFile
      const base = path.basename(localDir).toLowerCase()
      const dirs = goDirsByBase.get(base)
      return dirs && dirs.length ? goDirAnyFile.get(dirs[0]) : null
    }
    const tail = imp.split('/').pop()?.toLowerCase()
    if (!tail) return null
    const dirs = goDirsByBase.get(tail)
    if (!dirs || !dirs.length) return null
    return goDirAnyFile.get(dirs[0]) || null
  }

  for (const filePath of allFiles) {
    let content
    try { if (fs.statSync(filePath).size > 2 * 1024 * 1024) continue } catch { continue }
    const ext = path.extname(filePath).toLowerCase()
    if (BIN_EXTS.has(ext)) continue
    try { content = fs.readFileSync(filePath, 'utf8') } catch { continue }

    if (ext === '.md') {
      const re = /\[\[([^\]|#]+?)(?:[|#][^\]]+)?\]\]/g
      let m
      while ((m = re.exec(content)) !== null) {
        const target = m[1].trim().toLowerCase()
        const targetFile = fileByBasename.get(target) ||
          fileByBasename.get(target.split('/').pop())
        if (targetFile && targetFile !== filePath) {
          addEdge(filePath, targetFile)
        }
      }
    }

    if (['.js', '.ts', '.mjs', '.cjs'].includes(ext)) {
      const re = /(?:import\s+(?:[^'"]+?\s+from\s+)?|require\s*\(\s*)['"](\.[^'"]+)['"]/g
      let m
      while ((m = re.exec(content)) !== null) {
        let targetFile = path.resolve(path.dirname(filePath), m[1])
        if (!path.extname(targetFile)) {
          for (const tryExt of ['.js', '.ts', '.mjs', '/index.js', '/index.ts']) {
            if (allFilesSet.has(targetFile + tryExt)) {
              targetFile = targetFile + tryExt
              break
            }
          }
        }
        if (allFilesSet.has(targetFile) && targetFile !== filePath) {
          addEdge(filePath, targetFile)
        }
      }
    }

    if (ext === '.py') {
      const relDir = path.dirname(path.relative(rootPath, filePath)).replace(/\\/g, '/')
      const relParts = relDir === '.' ? [] : relDir.split('/').filter(Boolean)

      const resolvePyImport = (specRaw) => {
        const spec = String(specRaw || '').trim()
        if (!spec) return null
        const dm = spec.match(/^(\.+)(.*)$/)
        if (!dm) return resolveModuleLike(spec, ['.py'])
        const dots = dm[1].length
        const rest = (dm[2] || '').replace(/^\./, '')
        const up = Math.max(0, dots - 1)
        const base = relParts.slice(0, Math.max(0, relParts.length - up))
        const restParts = rest ? rest.split('.').filter(Boolean) : []
        const relNoExt = [...base, ...restParts].join('/').toLowerCase()
        if (!relNoExt) return null
        return fileByRelNoExt.get(relNoExt) || resolveModuleLike(relNoExt, ['.py'])
      }

      const reFrom = /^\s*from\s+([A-Za-z_][\w\.]*|\.+[\w\.]*)\s+import\s+([A-Za-z_][\w\s,.*]*)/gm
      let mFrom
      while ((mFrom = reFrom.exec(content)) !== null) {
        const fromSpec = mFrom[1].trim()
        const imported = mFrom[2]
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/i)[0].trim())
          .filter(Boolean)

        const direct = resolvePyImport(fromSpec)
        if (direct) addEdge(filePath, direct)
        for (const name of imported) {
          if (name === '*') continue
          const combo = `${fromSpec}.${name}`
          const target = resolvePyImport(combo)
          if (target) addEdge(filePath, target)
        }
      }

      const reImport = /^\s*import\s+([A-Za-z_][\w\.\s,]*)/gm
      let mImport
      while ((mImport = reImport.exec(content)) !== null) {
        const mods = mImport[1]
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/i)[0].trim())
          .filter(Boolean)
        for (const mod of mods) {
          const target = resolveModuleLike(mod, ['.py'])
          if (target) addEdge(filePath, target)
        }
      }
    }

    if (ext === '.php') {
      const tryResolvePhpPath = (rawTarget) => {
        let p = String(rawTarget || '').trim()
        if (!p) return null
        p = p.replace(/^__DIR__\s*\.\s*/, '').replace(/^dirname\(__FILE__\)\s*\.\s*/, '')
        p = p.replace(/^['"]|['"]$/g, '')
        if (!p) return null
        let candidate = p.startsWith('/')
          ? path.resolve(rootPath, `.${p}`)
          : path.resolve(path.dirname(filePath), p)
        if (allFilesSet.has(candidate)) return candidate
        if (!path.extname(candidate)) {
          for (const extra of ['.php', '.inc.php', '/index.php']) {
            if (allFilesSet.has(candidate + extra)) return candidate + extra
          }
        }
        const tail = path.basename(candidate, path.extname(candidate)).toLowerCase()
        return pickFirstByExt(fileByBasenameMany.get(tail), ['.php'])
      }

      const reIncQuoted = /\b(?:include|include_once|require|require_once)\s*(?:\(\s*)?["']([^"']+)["']/gi
      let mi
      while ((mi = reIncQuoted.exec(content)) !== null) {
        const target = tryResolvePhpPath(mi[1])
        if (target) addEdge(filePath, target)
      }
      const reIncDir = /\b(?:include|include_once|require|require_once)\s*(?:\(\s*)?(?:__DIR__|dirname\(__FILE__\))\s*\.\s*["']([^"']+)["']/gi
      while ((mi = reIncDir.exec(content)) !== null) {
        const target = tryResolvePhpPath(mi[1])
        if (target) addEdge(filePath, target)
      }
    }

    if (ext === '.go') {
      const parseImportChunk = (chunk) => {
        const reQ = /"([^"]+)"/g
        let mq
        while ((mq = reQ.exec(chunk)) !== null) {
          const imp = mq[1]
          const target = resolveGoImportPath(filePath, imp)
          if (target) addEdge(filePath, target)
        }
      }

      const reBlock = /\bimport\s*\(([\s\S]*?)\)/gm
      let mb
      while ((mb = reBlock.exec(content)) !== null) parseImportChunk(mb[1] || '')

      const reSingle = /^\s*import\s+(?:[._A-Za-z][\w]*\s+)?"([^"]+)"/gm
      let ms
      while ((ms = reSingle.exec(content)) !== null) {
        const target = resolveGoImportPath(filePath, ms[1])
        if (target) addEdge(filePath, target)
      }
    }
  }

  const edgeSet = new Set()
  const uniqueEdges = edges.filter(e => {
    const key = [e.source, e.target].sort().join('|||')
    if (edgeSet.has(key)) return false
    edgeSet.add(key)
    return true
  })
  // F-hier: marca explícita de referencias (vs parent-child).
  for (const e of uniqueEdges) e.kind = 'reference'

  const connectionCount = new Map(allFiles.map(f => [f, 0]))
  for (const e of uniqueEdges) {
    connectionCount.set(e.source, (connectionCount.get(e.source) || 0) + 1)
    connectionCount.set(e.target, (connectionCount.get(e.target) || 0) + 1)
  }

  // F-hier: metadata jerárquica. parentId = carpeta contenedora si está en dirSet.
  // depth = nº de separadores entre root y el nodo (0 para root, 1 para hijos directos).
  const computeHier = (p, isRoot) => {
    if (isRoot || p === rootPath) return { parentId: null, depth: 0 }
    const parent = path.dirname(p)
    const parentId = dirSet.has(parent) ? parent : null
    let depth = 1
    if (rootPath && p.startsWith(rootPath + path.sep)) {
      const rel = p.slice(rootPath.length + 1)
      depth = rel.split(path.sep).length
    }
    return { parentId, depth }
  }

  const nodes = allFiles.map(f => {
    const { parentId, depth } = computeHier(f, false)
    return {
      id: f,
      label: path.basename(f),
      path: f,
      connections: connectionCount.get(f) || 0,
      mtimeMs: Number(fileMtime.get(f) || 0),
      parentId,
      depth
    }
  })

  const dirs = allDirs.map((d) => {
    const isRoot = d === rootPath
    const { parentId, depth } = computeHier(d, isRoot)
    return {
      id: d,
      label: path.basename(d) || d,
      path: d,
      type: 'folder',
      isRoot,
      connections: 0,
      parentId,
      depth
    }
  })

  return { ok: true, nodes, edges: uniqueEdges, dirs }
}

function normalizeGraphRootPath(rootPath) {
  const raw = String(rootPath || '').trim()
  if (!raw) return ''
  try { return path.resolve(raw) } catch { return raw }
}

function computeProjectGraphForSession(session, rootPath) {
  const root = normalizeGraphRootPath(rootPath)
  if (!root) return { ok: false, error: 'no rootPath' }
  if (!session) return computeProjectGraph(root)

  if (session.graphCacheRoot !== root) {
    session.graphCacheRoot = root
    session.graphCacheDirty = true
  }

  const now = Date.now()
  const isBusy = isPtyGraphLoadHigh(session, now)
  const minRebuildMs = isBusy ? GRAPH_REFRESH_MIN_MS_BUSY : GRAPH_REFRESH_MIN_MS_NORMAL
  const hasCache = session.graphCacheResult != null
  if (hasCache && !session.graphCacheDirty) {
    if ((now - Number(session.graphCacheBuiltAt || 0)) < minRebuildMs) {
      return session.graphCacheResult
    }
  }

  const result = computeProjectGraph(root)
  session.graphCacheResult = result
  session.graphCacheBuiltAt = now
  session.graphCacheDirty = false
  return result
}

ipcMain.handle('sidebar:get-graph', (event, rootPath) => {
  const s = getSessionByEvent(event)
  return computeProjectGraphForSession(s, rootPath)
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
  if (!dirPath) {
    s.graphCacheRoot = ''
    s.graphCacheDirty = true
    s.graphCacheResult = null
    s.graphCacheBuiltAt = 0
    return { ok: true }
  }
  if (!isPathSafe(dirPath, allowedFsRoots())) {
    return { ok: false, error: 'Path not allowed' }
  }
  s.graphCacheRoot = normalizeGraphRootPath(dirPath)
  s.graphCacheDirty = true
  const safeCb = () => {
    try {
      if (!sessions.has(s.wcId)) return
      s.graphCacheDirty = true
      notifyTreeChangedFor(s, 'fs')
    } catch {}
  }
  try {
    s.treeWatcher = fs.watch(dirPath, { recursive: true, persistent: false }, (_eventType, filename) => {
      if (!sessions.has(s.wcId)) return
      if (PERF) perfWatchCounters.events++
      if (!filename) { safeCb(); return }
      const parts = filename.split('/')
      const base = parts[parts.length - 1]

      // Siempre ignorar directorios pesados y archivos swap/tmp
      if (parts.some(p => IGNORE_NAMES.has(p))) return
      if (!base || base.endsWith('~') || base.endsWith('.swp') || base.endsWith('.swx') || base.endsWith('.tmp')) return

      // Pulso del grafo: incluye .claude/memory y cualquier archivo no-ruido
      const fullPath = path.join(dirPath, filename)
      markGraphCacheDirtyByPath(fullPath)
      if (s.win && !s.win.isDestroyed()) {
        const now = Date.now()
        const isBusy = isPtyGraphLoadHigh(s, now)
        const minGap = isBusy ? GRAPH_FILE_ACTIVE_MIN_MS_BUSY : GRAPH_FILE_ACTIVE_MIN_MS_NORMAL
        const lastAt = Number(s.graphFileActiveLastAt || 0)
        const lastPath = String(s.graphFileActiveLastPath || '')
        if ((now - lastAt) >= minGap || lastPath !== fullPath) {
          if (PERF) perfWatchCounters.graphActive++
          s.graphFileActiveLastAt = now
          s.graphFileActiveLastPath = fullPath
          s.win.webContents.send('graph:file-active', fullPath)
        }
      }

      // tree-changed: solo archivos visibles (sin directorios punto)
      if (parts.some(p => p.startsWith('.') || p.startsWith('._'))) return
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

safeIpcHandle('file-info', async (event, p) => {
  assertSafeFsPath(p)
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
})

safeIpcHandle('file-read', async (event, p) => {
  assertSafeFsPath(p)
  const kind = fileKind(p)
  if (kind === 'image' || kind === 'binary') {
    const data = fs.readFileSync(p)
    return { ok: true, kind, base64: data.toString('base64'), size: data.length }
  }
  const stat = fs.statSync(p)
  if (stat.size > 5 * 1024 * 1024) return { ok: false, error: 'Archivo demasiado grande (>5MB)' }
  const text = fs.readFileSync(p, 'utf-8')
  return { ok: true, kind, text }
})

safeIpcHandle('file-write', async (event, { path: p, text }) => {
  assertSafeFsPath(p)
  if (typeof text !== 'string') throw new Error('text must be string')
  atomicWriteFileSync(p, text, 'utf-8')
  markGraphCacheDirtyByPath(p)
  event.sender.send('graph:file-active', p)
  return { ok: true }
})

// ── Sesiones de Claude ──
function encodeProjectPath(p) {
  return p.replace(/\/$/, '').replace(/[\/\s]/g, '-')
}

function projectDirFor(cwd) {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(cwd))
}

ipcMain.handle('list-sessions', async (event, cwd) => {
  const dir = resolveClaudeProjectDir(cwd)
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
          if (obj.type === 'user') {
            const text = extractTurnText(obj).replace(/<[^>]+>/g, '').trim()
            if (text && !text.startsWith('Caveat:')) {
              preview = text.slice(0, 160)
              break
            }
          }
        } catch {}
      }
    } catch {}
    return { id, mtime, size, preview: preview || '(sin contenido)', msgCount, path: fullPath }
  }).sort((a, b) => b.mtime - a.mtime)
})

ipcMain.handle('delete-session', async (event, { cwd, sessionId }) => {
  if (!isValidSessionId(sessionId)) return false
  const dir = resolveClaudeProjectDir(cwd)
  if (!dir) return false
  const claudeRoot = path.join(os.homedir(), '.claude', 'projects')
  if (!isPathSafe(dir, [claudeRoot])) return false
  const file = path.join(dir, `${sessionId}.jsonl`)
  if (!isPathSafe(file, [claudeRoot])) return false
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    forgetClaudeSessionTitle(file)
    return true
  }
  return false
})

ipcMain.handle('update-session-title', async (_event, { cwd, sessionId, title }) => {
  try {
    const nextTitle = String(title || '').trim()
    if (!nextTitle) return { ok: false, error: 'El título no puede estar vacío.' }
    if (!isValidSessionId(sessionId)) return { ok: false, error: 'sessionId inválido.' }

    const dir = resolveClaudeProjectDir(cwd)
    if (!dir) return { ok: false, error: 'No encontré la carpeta de la sesión.' }
    const claudeRoot = path.join(os.homedir(), '.claude', 'projects')
    if (!isPathSafe(dir, [claudeRoot])) return { ok: false, error: 'Path not allowed' }
    const file = path.join(dir, `${sessionId}.jsonl`)
    if (!isPathSafe(file, [claudeRoot])) return { ok: false, error: 'Path not allowed' }
    if (!fs.existsSync(file)) return { ok: false, error: 'No encontré el archivo de sesión.' }

    const raw = fs.readFileSync(file, 'utf-8')
    const hadTrailingNl = raw.endsWith('\n')
    const lines = raw.split('\n')
    let updated = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      let obj
      try { obj = JSON.parse(line) } catch { continue }
      if (obj?.type !== 'user' || !obj?.message) continue

      const currentText = extractTurnText(obj).replace(/<[^>]+>/g, '').trim()
      if (!currentText || currentText.startsWith('Caveat:')) continue

      const content = obj.message.content
      if (typeof content === 'string') {
        obj.message.content = nextTitle
      } else if (Array.isArray(content)) {
        let replaced = false
        const nextContent = content.map((block) => {
          if (!replaced && block && typeof block === 'object' && block.type === 'text') {
            replaced = true
            return { ...block, text: nextTitle }
          }
          return block
        })
        if (!replaced) nextContent.unshift({ type: 'text', text: nextTitle })
        obj.message.content = nextContent
      } else {
        obj.message.content = nextTitle
      }

      lines[i] = JSON.stringify(obj)
      updated = true
      break
    }

    if (!updated) {
      return { ok: false, error: 'No encontré un mensaje de usuario para renombrar en esta sesión.' }
    }

    const out = lines.join('\n')
    const finalText = hadTrailingNl ? (out.endsWith('\n') ? out : `${out}\n`) : out
    atomicWriteFileSync(file, finalText, 'utf-8')
    let stat = null
    try { stat = fs.statSync(file) } catch {}
    rememberClaudeSessionTitle(file, {
      title: clipText(nextTitle),
      statKey: statCacheKey(stat),
      mtimeMs: Number(stat?.mtimeMs || 0),
      size: Number(stat?.size || 0)
    })
    return { ok: true, title: nextTitle, path: file }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
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

ipcMain.handle('get-current-session-meta', (event) => {
  const s = getSessionByEvent(event)
  if (!s) {
    return { cli: appConfig.cli.defaultCli || 'claude', cwd: os.homedir(), sessionId: null, title: '(sin sesión)' }
  }
  return buildCurrentSessionMeta(s)
})

ipcMain.handle('clipboard-write-text', (_event, text) => {
  const value = String(text || '')
  if (!value.trim()) return false
  try {
    clipboard.writeText(value)
    return true
  } catch {
    return false
  }
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

ipcMain.handle('health:get', async (event) => {
  const s = getSessionByEvent(event) || (primaryWcId != null ? sessions.get(primaryWcId) : null)
  return collectHealthSnapshot(s)
})

// ── Transferir sesión activa de la ventana a Telegram ──
ipcMain.handle('app:can-send-to-telegram', (event) => {
  const s = sessions.get(event.sender.id)
  if (!s) return { ok: false, reason: 'no-session', linked: false, chatId: null, relayActive: false }
  const preferredChatId = telegramBridge?.getFirstAllowedUserId?.() || null
  const binding = getRelayBindingForSession(s, preferredChatId)
  const linkedChatId = binding.chatId || (preferredChatId == null ? null : String(preferredChatId))
  const withLink = (payload) => ({ ...payload, linked: binding.linked, chatId: linkedChatId, relayActive: !!s.relayActive, cli: s.activeCli })

  if (s.activeCli !== 'claude' && s.activeCli !== 'codex') return withLink({ ok: false, reason: 'not-supported-cli' })
  const sessionId = resolveSessionIdForRelay(s)
  if (s.activeCli === 'claude' && !sessionId) return withLink({ ok: false, reason: 'no-session-id' })
  if (!telegramBridge) return withLink({ ok: false, reason: 'bridge-not-init' })
  const status = telegramBridge.getStatus()
  if (!status.running) return withLink({ ok: false, reason: 'bridge-not-running' })
  if (!preferredChatId) return withLink({ ok: false, reason: 'no-allowed-user' })
  return withLink({ ok: true, sessionId: sessionId || null, cwd: s.cwd })
})

ipcMain.handle('app:send-session-to-telegram', async (event) => {
  const s = sessions.get(event.sender.id)
  if (!s) return { ok: false, error: 'No hay sesión asociada a esta ventana' }
  if (s.activeCli !== 'claude' && s.activeCli !== 'codex') {
    return { ok: false, error: 'CLI no soportado para relay Telegram (usa claude o codex).' }
  }
  const resolvedSessionId = resolveSessionIdForRelay(s)
  if (s.activeCli === 'claude' && !resolvedSessionId) {
    return { ok: false, error: 'No se detectó el sessionId de claude. Habla con él al menos un mensaje y vuelve a intentarlo.' }
  }
  if (!telegramBridge) return { ok: false, error: 'Telegram bridge no inicializado' }
  const status = telegramBridge.getStatus()
  if (!status.running) return { ok: false, error: 'Telegram bridge no está corriendo (actívalo en Configuración).' }
  const chatId = telegramBridge.getFirstAllowedUserId()
  if (!chatId) return { ok: false, error: 'No hay usuarios autorizados en Telegram (configúralos en Configuración).' }
  const currentSessionId = resolvedSessionId || null

  try {
    if (s.activeCli === 'claude' && s.claudeSessionId) {
      telegramBridge.adoptSession(chatId, 'claude', s.claudeSessionId)
    } else if (s.activeCli === 'codex' && currentSessionId) {
      s.codexSessionId = currentSessionId
      telegramBridge.adoptSession(chatId, 'codex', currentSessionId)
    }
    bindRelaySessionToTelegramChat(chatId, s)
    broadcastTelegramStatus()
    const cwdShort = path.basename(s.cwd || os.homedir())
    const cliLabel = s.activeCli === 'codex' ? 'Codex' : 'Claude'
    const lines = [
      `📱 Sesión de ${cliLabel} conectada a Telegram`,
      `📂 Carpeta: ${cwdShort}`,
    ]
    if (currentSessionId) {
      lines.push(`🆔 ${String(currentSessionId).slice(0, 8)}…`)
    }
    lines.push('', 'Desde ahora, cuando escribas al bot, usará esta sesión viva del PTY.')
    const text = lines.join('\n')
    await telegramBridge.sendMessageTo(chatId, text)
    // Mantener PTY vivo: Telegram usa relay directo sobre esta sesión (sin --resume por turno).
    try { s.win?.webContents.send('pty-transferred-to-telegram', { sessionId: currentSessionId, chatId }) } catch {}
    return { ok: true, sessionId: currentSessionId, chatId: String(chatId), linked: true, cli: s.activeCli }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('app:disconnect-session-from-telegram', async (event) => {
  const s = sessions.get(event.sender.id)
  if (!s) return { ok: false, error: 'No hay sesión asociada a esta ventana', linked: false }

  const preferredChatId = telegramBridge?.getFirstAllowedUserId?.() || null
  const binding = getRelayBindingForSession(s, preferredChatId)
  if (!binding.linked) return { ok: false, error: 'Esta ventana no está enlazada a Telegram.', linked: false }

  const chatId = binding.chatId || (preferredChatId == null ? null : String(preferredChatId))
  let detached = false
  if (chatId) detached = unbindRelaySessionForTelegramChat(chatId)
  if (!detached) {
    const before = telegramRelayByChat.size
    unbindRelaySessionsByWcId(s.wcId)
    detached = telegramRelayByChat.size !== before
  }

  if (detached) {
    broadcastTelegramStatus()
    const sync = await syncSessionContextAfterTelegramDetach(s, chatId, s.activeCli)
    if (chatId && telegramBridge?.getStatus()?.running) {
      const cliLabel = s.activeCli === 'codex' ? 'Codex' : 'Claude'
      try { await telegramBridge.sendMessageTo(chatId, `🔌 Sesión de ${cliLabel} desconectada del relay PTY.`) } catch {}
    }
    return {
      ok: true,
      linked: false,
      detached: true,
      chatId: chatId || null,
      cli: s.activeCli,
      sync
    }
  }

  return {
    ok: true,
    linked: false,
    detached: false,
    chatId: chatId || null,
    cli: s.activeCli,
    sync: { ok: true, refreshed: false, reason: 'already-detached' }
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

ipcMain.on('window-toggle-maximize', (event) => {
  const w = winFromEvent(event)
  if (!w) return
  w.isMaximized() ? w.unmaximize() : w.maximize()
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

let graphWindowData = null

ipcMain.handle('graph-window:open', (event, payload = {}) => {
  const {
    nodes, edges, dirs, mode, activeTypes, forces, ui, structureActiveTypes,
    selfFetch, rootPath
  } = payload || {}
  let cwd = null
  const payloadRoot = (typeof rootPath === 'string' && rootPath.trim()) ? rootPath.trim() : null
  if (payloadRoot) {
    cwd = payloadRoot
  } else {
    try {
      const s = getSessionByEvent(event)
      cwd = s ? s.cwd : null
    } catch { cwd = null }
    if (!cwd) cwd = getCwdSync() || os.homedir()
  }
  try {
    if (!cwd || !fs.existsSync(cwd)) cwd = getCwdSync() || os.homedir()
  } catch {
    cwd = getCwdSync() || os.homedir()
  }
  if (selfFetch) {
    // La ventana standalone se autosirve: no precargamos nodos/edges.
    graphWindowData = {
      nodes: [],
      edges: [],
      dirs: [],
      mode: mode || 'refs',
      activeTypes: activeTypes || null,
      structureActiveTypes: structureActiveTypes || null,
      forces: forces || null,
      ui: ui || null,
      cwd: cwd || '',
      selfFetch: true
    }
  } else {
    graphWindowData = {
      nodes: nodes || [],
      edges: edges || [],
      dirs: dirs || [],
      mode: mode || 'refs',
      activeTypes: activeTypes || null,
      structureActiveTypes: structureActiveTypes || null,
      forces: forces || null,
      ui: ui || null,
      cwd: cwd || '',
      selfFetch: false
    }
  }
  const win = new BrowserWindow({
    width: 1200, height: 800,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: '#1a1a1f',
    resizable: true, minimizable: true,
    title: 'POWER-AGENT — Grafo',
    webPreferences: {
      preload: path.join(__dirname, 'graph-window-preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  })
  win.loadFile('graph-window.html')
  win.on('closed', () => { graphWindowData = null })
  return true
})

ipcMain.handle('graph-window:get-data', () => graphWindowData || { nodes: [], edges: [], dirs: [] })

// Ventana WhatsApp independiente. Si ya existe, la trae al frente.
let whatsappWindow = null
const WA_WIN_BOUNDS_FILE = path.join(app.getPath('userData'), 'whatsapp-window-bounds.json')

function loadWhatsappBounds() {
  try {
    const raw = fs.readFileSync(WA_WIN_BOUNDS_FILE, 'utf-8')
    const b = JSON.parse(raw)
    if (b && Number.isFinite(b.width) && Number.isFinite(b.height)) return b
  } catch {}
  return null
}

function saveWhatsappBounds(win) {
  if (!win || win.isDestroyed()) return
  try {
    const b = win.getBounds()
    atomicWriteJsonSync(WA_WIN_BOUNDS_FILE, { x: b.x, y: b.y, width: b.width, height: b.height })
  } catch {}
}

ipcMain.handle('whatsapp-window:open', () => {
  if (whatsappWindow && !whatsappWindow.isDestroyed()) {
    if (whatsappWindow.isMinimized()) whatsappWindow.restore()
    whatsappWindow.show()
    whatsappWindow.focus()
    return { ok: true, reused: true }
  }
  const saved = loadWhatsappBounds()
  const opts = {
    width: (saved && saved.width) || 980,
    height: (saved && saved.height) || 720,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 13 },
    title: 'POWER-AGENT — WhatsApp',
    backgroundColor: '#1a1a1f',
    webPreferences: {
      preload: path.join(__dirname, 'whatsapp-window-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  }
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    opts.x = saved.x
    opts.y = saved.y
  }
  whatsappWindow = new BrowserWindow(opts)
  whatsappWindow.loadFile('whatsapp-window.html')
  const flush = () => saveWhatsappBounds(whatsappWindow)
  whatsappWindow.on('resize', flush)
  whatsappWindow.on('move', flush)
  whatsappWindow.on('close', flush)
  whatsappWindow.on('closed', () => { whatsappWindow = null })
  return { ok: true, reused: false }
})

global.__openWhatsappWindow = () => {
  try {
    if (whatsappWindow && !whatsappWindow.isDestroyed()) {
      if (whatsappWindow.isMinimized()) whatsappWindow.restore()
      whatsappWindow.show()
      whatsappWindow.focus()
      return
    }
    const saved = loadWhatsappBounds()
    const opts = {
      width: (saved && saved.width) || 980,
      height: (saved && saved.height) || 720,
      minWidth: 640,
      minHeight: 480,
      resizable: true,
      frame: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 13 },
      title: 'POWER-AGENT — WhatsApp',
      backgroundColor: '#1a1a1f',
      webPreferences: {
        preload: path.join(__dirname, 'whatsapp-window-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      opts.x = saved.x
      opts.y = saved.y
    }
    whatsappWindow = new BrowserWindow(opts)
    whatsappWindow.loadFile('whatsapp-window.html')
    const flush = () => saveWhatsappBounds(whatsappWindow)
    whatsappWindow.on('resize', flush)
    whatsappWindow.on('move', flush)
    whatsappWindow.on('close', flush)
    whatsappWindow.on('closed', () => { whatsappWindow = null })
  } catch (err) {
    console.warn('[whatsapp] open from notification failed:', err?.message || err)
  }
}

ipcMain.handle('graph-window:fetch-graph', (_event, rootPathArg) => {
  let root = (typeof rootPathArg === 'string' && rootPathArg) ? rootPathArg : null
  if (!root) root = getCwdSync() || null
  if (!root) return { ok: false, error: 'No hay carpeta activa para calcular el grafo' }
  try {
    if (!fs.existsSync(root)) return { ok: false, error: `La ruta no existe: ${root}` }
  } catch (err) { return { ok: false, error: err.message } }
  try {
    const result = computeProjectGraph(root)
    if (result && result.ok) result.cwd = root
    return result
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('viewer-open', (_event, arg) => {
  const filePath = typeof arg === 'string' ? arg : arg?.path
  const hint = (arg && typeof arg === 'object') ? arg.hint : null
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'Invalid path' }
  if (!isPathSafe(filePath, allowedFsRoots())) return { ok: false, error: 'Path not allowed' }
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

// ── WhatsApp IPC ──
function requireWhatsapp() {
  if (!whatsappClient) {
    const detail = whatsappModuleLoadError?.message
      ? ` (${whatsappModuleLoadError.message})`
      : ''
    throw new Error(`WhatsApp client no inicializado${detail}`)
  }
  return whatsappClient
}

ipcMain.handle('whatsapp:status', async () => {
  if (!whatsappClient) {
    return {
      connected: false,
      qrPresent: false,
      reachable: false,
      ownerNumber: '',
      authorizedNumbers: [],
      autoReply: false,
      error: whatsappModuleLoadError?.message || null
    }
  }
  try {
    const s = await whatsappClient.getStatus()
    return { ...s, reachable: whatsappReachable }
  } catch (err) {
    return { connected: false, qrPresent: false, reachable: false, error: err?.message }
  }
})

ipcMain.handle('whatsapp:get-qr', async () => {
  if (!whatsappClient) return { qr: null }
  try { return await whatsappClient.getQr() } catch (err) { return { qr: null, error: err?.message } }
})

ipcMain.handle('whatsapp:get-chats', () => {
  if (!whatsappClient) return []
  try { return whatsappClient.getChats() } catch { return [] }
})

ipcMain.handle('whatsapp:get-history', (_e, jid, opts = {}) => {
  if (!whatsappClient) return []
  try { return whatsappClient.getHistory(jid, opts || {}) } catch { return [] }
})

ipcMain.handle('whatsapp:send-text', async (_e, jid, text, opts) => {
  try { return await requireWhatsapp().sendText(jid, text, opts || {}) }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('whatsapp:send-image', async (_e, jid, filePath, caption) => {
  try { return await requireWhatsapp().sendMedia(jid, filePath, 'image', { caption: caption || '' }) }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('whatsapp:send-audio', async (_e, jid, filePath, ptt) => {
  try { return await requireWhatsapp().sendMedia(jid, filePath, 'audio', { ptt: ptt !== false }) }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('whatsapp:send-document', async (_e, jid, filePath, caption) => {
  try { return await requireWhatsapp().sendMedia(jid, filePath, 'document', { caption: caption || '' }) }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('whatsapp:request-phone', async (_e, jid) => {
  try { return await requireWhatsapp().requestPhone(jid, { changeModeToManual: true }) }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('whatsapp:set-mode', (_e, jid, mode) => {
  try { return requireWhatsapp().setMode(jid, mode) }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('whatsapp:mark-read', (_e, jid) => {
  try { return requireWhatsapp().markRead(jid) }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('whatsapp:get-config', () => {
  try { return requireWhatsapp().getConfig() }
  catch { try { return JSON.parse(fs.readFileSync(WA_CONFIG_PATH, 'utf-8')) } catch { return {} } }
})

// Whitelist: solo campos seguros editables desde el renderer. claudePath/personaPath
// quedan fijados por el bridge para evitar RCE vía override desde un XSS.
const WA_SAFE_CONFIG_FIELDS = new Set([
  'autoReply',
  'authorizedNumbers',
  'ownerNumber',
  'maxHistory',
  'model',
  'effort',
  'handoverOnFromMe'
])

ipcMain.handle('whatsapp:save-config', (_e, partial) => {
  try {
    const sanitized = {}
    if (partial && typeof partial === 'object') {
      for (const k of Object.keys(partial)) {
        if (WA_SAFE_CONFIG_FIELDS.has(k)) sanitized[k] = partial[k]
      }
    }
    return { ok: true, config: requireWhatsapp().updateConfig(sanitized) }
  } catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('whatsapp:transcribe-audio', async (_e, mediaPath) => {
  if (!mediaPath || !fs.existsSync(mediaPath)) return { ok: false, error: 'archivo no existe' }
  if (!isPathSafe(mediaPath, [WA_MEDIA_DIR, TMP_DIR])) return { ok: false, error: 'Path not allowed' }
  try {
    const text = await transcribeAudioFile(mediaPath, buildRuntimeEnv())
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('whatsapp:get-persona', () => {
  const personaPath = path.join(os.homedir(), '.claude', 'whatsapp-bridge', 'persona.md')
  const personaRoot = path.join(os.homedir(), '.claude', 'whatsapp-bridge')
  try {
    let resolved = personaPath
    try {
      const cfg = whatsappClient?.getConfig?.()
      if (cfg && typeof cfg.personaPath === 'string' && cfg.personaPath.trim()) {
        const candidate = cfg.personaPath.trim()
        if (isPathSafe(candidate, [personaRoot])) resolved = candidate
      }
    } catch {}
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `No existe: ${resolved}`, path: resolved }
    }
    const text = fs.readFileSync(resolved, 'utf-8')
    const stat = fs.statSync(resolved)
    return { ok: true, text, path: resolved, mtime: stat.mtimeMs }
  } catch (err) {
    return { ok: false, error: err?.message || String(err), path: personaPath }
  }
})

ipcMain.handle('whatsapp:save-persona', (_e, text) => {
  const personaPath = path.join(os.homedir(), '.claude', 'whatsapp-bridge', 'persona.md')
  const personaRoot = path.join(os.homedir(), '.claude', 'whatsapp-bridge')
  try {
    let resolved = personaPath
    try {
      const cfg = whatsappClient?.getConfig?.()
      if (cfg && typeof cfg.personaPath === 'string' && cfg.personaPath.trim()) {
        const candidate = cfg.personaPath.trim()
        if (isPathSafe(candidate, [personaRoot])) resolved = candidate
      }
    } catch {}
    if (typeof text !== 'string') return { ok: false, error: 'Texto inválido' }
    atomicWriteFileSync(resolved, text, 'utf-8')
    const stat = fs.statSync(resolved)
    return { ok: true, path: resolved, mtime: stat.mtimeMs }
  } catch (err) {
    return { ok: false, error: err?.message || String(err), path: personaPath }
  }
})
