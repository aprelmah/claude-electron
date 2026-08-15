const { app, BrowserWindow, Menu, globalShortcut, ipcMain, nativeTheme, dialog, session, systemPreferences, shell, clipboard, protocol, net, webContents } = require('electron')
const pty = require('node-pty')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { atomicWriteJsonSync, atomicWriteFileSync, atomicWriteFileAsync } = require('./main/atomic-writes')
const { SAFE_CLI, SAFE_TELEGRAM, SAFE_LAN, pick, pickDropped } = require('./main/app-config-allowlists')
const { decideLanServerAction } = require('./main/lan-server-action')
const { createLanTunnelManager } = require('./main/lan-tunnel')
const { isPathSafe, isValidSessionId } = require('./main/path-sandbox')
const { createSemanticLogger } = require('./main/semantic-logger')
const { createNotifier } = require('./main/native-notify')
const notifyNative = createNotifier()
const { createLanWsServer, clampLanPort, DEFAULT_LAN_WS_PORT } = require('./main/ws-server')
const {
  createCliResolver,
  resolveCommand,
  commandExists,
  USER_LOCAL_BIN,
  PYTHON39_BIN,
  HOMEBREW_BIN,
  FALLBACK_CLOUDFLARED_BIN,
  LATEST_NVM_NODE_BIN,
  FALLBACK_CLAUDE_BIN,
  FALLBACK_CODEX_BIN,
  FALLBACK_WHISPER_BIN,
  FFMPEG_BIN
} = require('./main/cli-resolver')
const { createTranscriber } = require('./main/whisper-transcribe')
const { normalizeGraphRootPath } = require('./main/graph-builder')
const { computeProjectGraphAsync } = require('./main/graph-worker-client')
const { retitleTranscript } = require('./main/retitle-transcript')
const { decideExtractRunner } = require('./main/extract-runner')
const {
  stripAnsi,
  flattenTerminal,
  extractAgentBlocks,
  blocksEqual,
  createProposalFiles
} = require('./main/agent-pty-proposal')
const {
  extractTurnText,
  resolveRelayCwd,
  relayCwdCandidates,
  statCacheKey,
  safeStat,
  clipText,
  escapeSqlLiteral,
  sanitizeNewProjectName,
  extractCodexResumeId,
  extractClaudeResumeId,
  buildResumeArgs
} = require('./main/session-helpers')
const { createRecentCwds } = require('./main/recent-cwds')
const { createKbPrefs, KB_PREFS_DEFAULT } = require('./main/kb-prefs')
const { createSessionModelReader, shortClaudeModel } = require('./main/session-model-reader')
const { createCodexSessionsIndex } = require('./main/codex-sessions-index')
const { createLastContext } = require('./main/last-context')
const { createClaudeSessionsIndex } = require('./main/claude-sessions-index')
const { createCodexSessionReader } = require('./main/codex-session-reader')
const { createAgentProposalWatcher } = require('./main/agent-proposal-watcher')
const { registerWhatsappIpc, WA_SAFE_CONFIG_FIELDS } = require('./main/whatsapp-ipc')
const { createWindowFactory } = require('./main/window-factory')
const { registerViewerGraphIpc } = require('./main/viewer-graph-ipc')
const { registerTasksIpc } = require('./main/tasks-ipc')
const { registerSkillsIpc } = require('./main/skills-ipc')
const { registerKbIpc } = require('./main/kb-ipc')
const { registerDelegationIpc } = require('./main/delegation-ipc')
const { registerProfilesEnterpriseIpc } = require('./main/profiles-enterprise-ipc')
const { registerAutomationsIpc } = require('./main/automations-ipc')
const { registerBitacoraIpc } = require('./main/bitacora-ipc')
const { createHealthCollectors } = require('./main/health-collectors')
const { createSessionListing, projectDirFor } = require('./main/claude-session-listing')
const { handleOpenTaskSession } = require('./main/telegram-open-task-session')
const { createSessionGit, cwdExcludedFromIsolation } = require('./main/session-git')
const { createSessionGitMap } = require('./main/session-git-map')
const { createSubchatManager } = require('./main/subchat-pty')
const { createVoiceHelperProcess } = require('./main/voice-helper-process')
const { createAppleFileTranscriber } = require('./main/apple-transcribe')
const { writePromptThenEnter } = require('./main/pty-prompt-write')
const { createVoiceNoteMaker } = require('./main/voice-note')
const { createVoiceTurnWatcher } = require('./main/voice-turn-watcher')
const { createVoiceSendTarget, pickForkedSessionId, voiceTurnLockActive } = require('./main/voice-send-target')
const { createTaskSessionForkWatch } = require('./main/task-session-fork-watch')
const { createVoiceSession } = require('./main/voice-session')
const { speakableFromMarkdown, chunkSpeakableFromMarkdown } = require('./main/voice-speakable')
const { createViewerSpeech } = require('./main/viewer-speech')
const voiceRouter = require('./main/voice-router')
const { registerWindowControlsIpc } = require('./main/window-controls-ipc')
const {
  buildLanSessionLegacyRoots,
  createLanPermissionNormalizer,
  sanitizeLanRequestedModel,
  sanitizeLanRequestedCli,
  sanitizeLanRequestedEffort,
  buildLanCliArgs,
  resolveLanRemoteContextInput,
  resolveLanRemoteIp,
  LAN_CLAUDE_EFFORT_LEVELS: _LAN_CLAUDE_EFFORT_LEVELS,
  LAN_CODEX_EFFORT_LEVELS: _LAN_CODEX_EFFORT_LEVELS
} = require('./main/lan-helpers')
const { createTelegramRelayBindings, shouldAllowMacSessionFallback } = require('./main/telegram-relay-bindings')
const { createTelegramHiddenPtyPool } = require('./main/telegram-hidden-pty-pool')
const { createTelegramNotifyBot } = require('./main/telegram-notify-bot')
const terminalHandoff = require('./main/terminal-handoff')
const { registerProposalIpc } = require('./main/proposal-ipc')
const { registerFilesystemIpc, fileKind, IGNORE_NAMES } = require('./main/filesystem-ipc')
const { registerWsServerIpc } = require('./main/ws-server-ipc')
const { registerAutomationChatIpc } = require('./main/automation-chat-ipc')
const { createClaudeSessionCache } = require('./main/claude-session-cache')
const { registerTelegramSessionLinkIpc } = require('./main/telegram-session-link-ipc')
const { createRelayTranscriptHelpers } = require('./main/relay-transcript-helpers')
const { createConfigCrud } = require('./main/config-crud')
const { createLanAudit } = require('./main/lan-audit')
const {
  CONFIG_FILENAME,
  DEFAULT_PROFILE_ID,
  normalizeMcpServerList,
  sanitizePersonaPrompt,
  sanitizeProfileId,
  normalizeProfileEntry,
  normalizeProfiles,
  resolveActiveProfileId,
  makeProfileIdFromName,
  createConfigNormalizers,
  explainLanPublicUrl,
  readConfigFromFile,
  writeConfigToFile
} = require('./main/config-store')
const {
  DEFAULT_ROLE_ID: DEFAULT_ENTERPRISE_ROLE_ID,
  normalizeEnterpriseConfig,
  normalizeRemoteContext,
  resolveEffectiveSessionContext,
  sanitizeId: sanitizeEnterpriseId
} = require('./main/enterprise-policy')
const { TelegramBridge } = require('./telegram-bridge')
const { createHeadlessRunners } = require('./headless-runners')
const { preflightTask } = require('./main/execution-policy')
const TaskScheduler = require('./scheduler')
const { createExecutor } = require('./scheduler/executor')
const { createSinks, createInboxSink } = require('./scheduler/sinks')
const { createPersistence } = require('./scheduler/persistence')
const { createDelegationManager } = require('./main/delegation-manager')
const { createInbox } = require('./main/tasks-inbox')
const { createSessionLinks } = require('./main/session-links')
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

// Electron 25+: protocol.handle requiere registrar el scheme antes de app.ready
// para que se comporte como standard (igual que el legacy registerFileProtocol).
try {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WA_MEDIA_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
} catch (err) {
  console.error('[whatsapp] registerSchemesAsPrivileged failed:', err?.message || err)
}

const AGENT_PATTERNS_PATH = path.join(os.homedir(), '.claude', 'skills', 'luismi', 'automation-builder', 'patterns.md')

// Keep userData at the legacy path so existing config/Telegram tokens survive the rename.
const oldUserData = path.join(app.getPath('appData'), 'CLAUDE-NOVAK')
app.setPath('userData', oldUserData)

const TMP_DIR = '/tmp/claude-electron'
const AGENT_PROPOSAL_BASE = '/tmp/poweragent-proposal'
const AGENT_PROPOSAL_POLL_MS = 1500
const AGENT_PROPOSAL_DIR = path.dirname(AGENT_PROPOSAL_BASE)
const AGENT_PROPOSAL_FILE_PREFIX = `${path.basename(AGENT_PROPOSAL_BASE)}-`
const AGENT_PROPOSAL_FILE_SUFFIX = '.json'
const CODEX_HOME_DIR = path.join(os.homedir(), '.codex')
const CODEX_HISTORY_PATH = path.join(CODEX_HOME_DIR, 'history.jsonl')
const CODEX_SESSION_INDEX_PATH = path.join(CODEX_HOME_DIR, 'session_index.jsonl')
const CODEX_STATE_DB_PATH = path.join(CODEX_HOME_DIR, 'state_5.sqlite')
const WHISPER_CPP_MODEL = process.env.WHISPER_CPP_MODEL || path.join(os.homedir(), '.cache/whisper-cpp/ggml-base-q5_1.bin')
const LAN_PERMISSION_KEYS = Object.freeze([
  'pty.execute',
  'fs.read',
  'fs.write',
  'fs.list',
  'fs.delete',
  'fs.rename',
  'viewer.open',
  'automations.manage'
])
const DEFAULT_LAN_ROLE_PERMISSIONS = Object.freeze({
  'pty.execute': true,
  'fs.read': true,
  'fs.write': true,
  'fs.list': true,
  'fs.delete': true,
  'fs.rename': true,
  'viewer.open': true,
  'automations.manage': true
})
const LAN_CLAUDE_EFFORT_LEVELS = _LAN_CLAUDE_EFFORT_LEVELS
const LAN_CODEX_EFFORT_LEVELS = _LAN_CODEX_EFFORT_LEVELS

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

// ── PERF-H6: pty-data IPC batching ──
const { createPtyDataBatcher } = require('./main/pty-data-batcher')
const _ptyBatcher = createPtyDataBatcher()
const enqueuePtyData = (s, d) => _ptyBatcher.enqueue(s, d)
const flushPtyData = (s) => _ptyBatcher.flush(s)

// ── Auto-update de los CLI dentro del PTY ──
// Codex se cierra tras actualizarse ("Please restart Codex"); relanzamos la
// sesión en vez de mandar al usuario al picker.
const { createCodexResumeCwdPrompt } = require('./main/codex-resume-watch')
const { createCliUpdateWatcher } = require('./main/cli-update-watch')
const cliUpdateWatcher = createCliUpdateWatcher()

// ── Per-window sessions ──
// key = webContents.id → WindowSession { win, wcId, ordinal, pty, cols, rows, cwd, activeCli, treeWatcher, treeWatcherPath, treeWatchDebounce }
const sessions = new Map()
const telegramRelayByChat = new Map() // chatId(string) -> wcId(number)
let primaryWcId = null
let lastPrimarySnapshot = { cwd: os.homedir(), activeCli: 'claude' }
let nextOrdinal = 0
let telegramBridge = null
// Emparejamiento por código para chats desconocidos (robo de Hermes Agent).
// En memoria a propósito: reiniciar la app caduca todos los códigos.
const { createPairingManager } = require('./main/telegram-pairing')
const telegramPairing = createPairingManager()

// Detector de tareas repetidas (robo del learning loop de Hermes): 3+ encargos
// parecidos en 30 días por canal → notificación proponiendo tarea 📌 o skill.
// Lazy: userData no está listo en top-level.
const { createRepeatedPromptDetector } = require('./main/repeated-prompts')
const { searchSessionContentInFiles } = require('./main/session-content-search')
const { createHealthWatchdog } = require('./main/health-watchdog')
const { buildStatusPanelSnapshot } = require('./main/status-panel')
let healthWatchdog = null
let repeatedPrompts = null
function getRepeatedPrompts() {
  if (!repeatedPrompts) {
    repeatedPrompts = createRepeatedPromptDetector({
      storePath: path.join(app.getPath('userData'), 'repeated-prompts.json')
    })
  }
  return repeatedPrompts
}

// Un solo canal para "hay decisiones nuevas en la bandeja" (pairing Telegram,
// encargos repetidos): el renderer refresca el dropdown y el badge al oírlo.
function broadcastDecisionsChanged() {
  for (const s of sessions.values()) {
    if (s.win && !s.win.isDestroyed()) s.win.webContents.send('decisions-changed')
  }
}

function feedRepeatedPromptDetector(text, source) {
  try {
    const res = getRepeatedPrompts().record({ text, source })
    if (res?.repeated) {
      notifyNative({
        title: 'POWER-AGENT: encargo repetido',
        body: `Me has pedido esto ${res.count} veces en 30 días: «${String(res.example || '').slice(0, 120)}». Resuélvelo en la bandeja 🔔.`
      })
      broadcastDecisionsChanged()
    }
  } catch (err) {
    try { console.warn('[repeated-prompts]', err?.message || err) } catch {}
  }
}
let telegramNotifyBot = null
let telegramHiddenPtyPool = null
let whatsappClient = null
let whatsappReachable = false
let whatsappRetryTimer = null
let autoUpdater = null
let lanWsServer = null
// Túnel efímero "Compartir por internet": sus URLs mandan sobre las de la
// config mientras está vivo y JAMÁS se persisten (ver main/lan-tunnel.js).
const lanTunnel = createLanTunnelManager({
  getPorts: () => {
    const status = getLanServerStatus()
    return { wsPort: status.port, httpPort: status.httpPort }
  },
  cloudflaredBin: FALLBACK_CLOUDFLARED_BIN,
  log: (message) => console.log(message)
})
const autoUpdateState = {
  available: false,
  downloaded: false
}

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
  },
  lanServer: {
    enabled: false,
    port: DEFAULT_LAN_WS_PORT
  },
  profiles: [{
    id: DEFAULT_PROFILE_ID,
    name: 'Personal',
    claudeMdPath: '',
    mcpServers: [],
    cwd: '',
    personaPrompt: ''
  }],
  activeProfile: DEFAULT_PROFILE_ID,
  enterprise: {
    version: 1,
    enabled: false,
    roles: [{
      id: DEFAULT_ENTERPRISE_ROLE_ID,
      name: 'Operador estándar',
      permissions: {
        'pty.execute': true,
        'fs.read': true,
        'fs.write': true,
        'fs.list': true,
        'fs.delete': true,
        'fs.rename': true,
        'viewer.open': true,
        'automations.manage': true
      },
      allowedRoots: [],
      readOnlyRoots: [],
      allowedMcpServers: []
    }],
    operators: []
  }
})

let appConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
const semanticLogger = createSemanticLogger()


const { normalizeAppConfig, normalizeLanServerConfig } = createConfigNormalizers({
  clampLanPort,
  normalizeEnterpriseConfig,
  defaultEnterpriseRoleId: DEFAULT_ENTERPRISE_ROLE_ID
})

function configFilePath() {
  return path.join(app.getPath('userData'), CONFIG_FILENAME)
}

function loadAppConfig() {
  const raw = readConfigFromFile(configFilePath(), DEFAULT_CONFIG)
  return normalizeAppConfig(raw)
}

function saveAppConfig(nextConfig) {
  const normalized = normalizeAppConfig(nextConfig)
  writeConfigToFile(configFilePath(), normalized)
  appConfig = normalized
  return normalized
}

const _configCrud = createConfigCrud({
  getAppConfig: () => appConfig,
  saveAppConfig,
  normalizeAppConfig,
  normalizeEnterpriseConfig,
  normalizeProfileEntry,
  sanitizeProfileId,
  sanitizeEnterpriseId,
  sanitizePersonaPrompt,
  makeProfileIdFromName,
  resolveActiveProfileId,
  DEFAULT_PROFILE_ID,
  DEFAULT_ENTERPRISE_ROLE_ID
})
const {
  getProfileById,
  getActiveProfile,
  listProfilesPayload,
  createProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  listEnterprisePayload,
  saveEnterpriseConfig,
  createEnterpriseRole,
  updateEnterpriseRole,
  deleteEnterpriseRole,
  createEnterpriseOperator,
  updateEnterpriseOperator,
  deleteEnterpriseOperator
} = _configCrud

const cliResolver = createCliResolver(() => appConfig)
const { getConfiguredBin, getConfiguredWhisperBin, buildRuntimeEnv, cliMeta, ensureCliAvailable } = cliResolver

// Vía Apple (helper de voz) para transcribir audios: se crea más abajo, junto
// al voiceHelper — late binding a propósito, mismo patrón que los índices de
// createSessionListing. Si aún no existe, el transcriber cae a whisper.
let appleFileTranscriber = null

const { transcribeAudioFile } = createTranscriber({
  getWhisperBin: () => getConfiguredWhisperBin(),
  modelPath: WHISPER_CPP_MODEL,
  tmpDir: TMP_DIR,
  appleTranscribe: (wavPath, meta) => {
    if (!appleFileTranscriber) return Promise.reject(new Error('helper de voz aún no inicializado'))
    return appleFileTranscriber.transcribeWav(wavPath, meta)
  },
  log: (m) => console.log('[transcribe]', m)
})

const { shellQuote } = require('./main/shell-quote')

function buildFdLimitCommand(bin, args = []) {
  const parts = [shellQuote(bin), ...args.map(shellQuote)]
  const log = '/tmp/claude-novak-fd.log'
  return `echo "[$(date +%H:%M:%S)] before ulimit=$(ulimit -n) hard=$(ulimit -Hn) bin=${shellQuote(bin)}" >> ${log} 2>/dev/null; ulimit -n 65536 2>/dev/null || true; echo "[$(date +%H:%M:%S)] after  ulimit=$(ulimit -n)" >> ${log} 2>/dev/null; exec ${parts.join(' ')}`
}

// ── Session helpers ──
function getSession(wcId) {
  return sessions.get(wcId) || null
}

function getSessionByEvent(event) {
  return sessions.get(event.sender.id) || null
}

// No hay tracking de foco entre sesiones distintas del mismo proyecto hoy:
// si hay más de una sesión abierta sobre el mismo cwd, se aplica a la primera
// encontrada (orden de Map, que es orden de apertura).
function findSessionByProjectDir(projectDir) {
  for (const session of sessions.values()) {
    if (!session || !session.pty) continue
    const realCwd = session.gitWorkspace?.realCwd || session.cwd
    if (realCwd === projectDir) return session
  }
  return null
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

function broadcastTelegramPairing() {
  const pending = telegramPairing.listPending()
  for (const s of sessions.values()) {
    if (s.win && !s.win.isDestroyed()) s.win.webContents.send('telegram-pairing-changed', pending)
  }
  broadcastDecisionsChanged()
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

function getLanClientHtmlPath() {
  return path.join(__dirname, 'lan-client.html')
}

const normalizeLanPermissionMap = createLanPermissionNormalizer({
  LAN_PERMISSION_KEYS,
  DEFAULT_LAN_ROLE_PERMISSIONS
})

const _lanAudit = createLanAudit({
  getAppConfig: () => appConfig,
  resolveEffectiveSessionContext,
  sanitizeProfileId,
  logSemantic: (action, payload) => logSemantic(action, payload),
  DEFAULT_PROFILE_ID,
  DEFAULT_ENTERPRISE_ROLE_ID
})
const {
  resolveLanEnterpriseContext,
  logEnterpriseSessionSemantic,
  logLanAuditSemantic
} = _lanAudit

function resolveLanSessionConfig(remoteMeta = {}) {
  const rawRemoteContext = resolveLanRemoteContextInput(remoteMeta)
  const rawInvite = rawRemoteContext?.raw?.lanInvite
  const rawProject = rawRemoteContext?.raw?.lanProject
  const invitedCwd = resolveExistingDir(rawInvite?.cwd)
  const selectedProjectCwd = resolveExistingDir(rawProject?.cwd)
  const invitedSessionId = isValidSessionId(String(rawInvite?.sessionId || ''))
    ? String(rawInvite.sessionId)
    : ''
  const invitedCli = sanitizeLanRequestedCli(rawInvite?.cli)
  const hasValidInvite = !!(invitedCwd && invitedSessionId && invitedCli)
  const requestedCli = sanitizeLanRequestedCli(
    rawRemoteContext?.cli || rawRemoteContext?.provider || rawRemoteContext?.engine
  )
  const cli = (hasValidInvite ? invitedCli : '') || requestedCli || (getActiveCliSync() === 'codex' ? 'codex' : 'claude')
  const cliCheck = ensureCliAvailable(cli)
  if (!cliCheck.ok) throw new Error(cliCheck.error)
  const activeProfile = getActiveProfile()
  const remoteContext = normalizeRemoteContext(rawRemoteContext)
  const requestedModel = sanitizeLanRequestedModel(
    rawRemoteContext?.model || rawRemoteContext?.modelId || rawRemoteContext?.m
  )
  const requestedEffort = sanitizeLanRequestedEffort(
    rawRemoteContext?.effort || rawRemoteContext?.reasoningEffort || rawRemoteContext?.reasoning || rawRemoteContext?.e,
    cli
  )
  const remoteIp = resolveLanRemoteIp(remoteMeta)
  const enterpriseContext = resolveLanEnterpriseContext(remoteContext, activeProfile, invitedCwd || selectedProjectCwd || getCwdSync())
  const effectiveProfile = getProfileById(enterpriseContext.profileId) || activeProfile
  const profileCwd = resolveExistingDir(effectiveProfile?.cwd)
  const currentCwd = resolveExistingDir(getCwdSync())
  const cwd = invitedCwd || selectedProjectCwd || profileCwd || currentCwd || os.homedir()
  if (hasValidInvite && enterpriseContext.enterpriseApplied) {
    const allowed = Array.isArray(enterpriseContext.allowedRoots) ? enterpriseContext.allowedRoots : []
    const allowedInviteCwd = allowed.some((root) => {
      const normalizedRoot = resolveExistingDir(root)
      return normalizedRoot === cwd || (normalizedRoot && cwd.startsWith(normalizedRoot + path.sep))
    })
    if (!allowedInviteCwd) {
      throw new Error('La invitación apunta a un proyecto fuera de las carpetas permitidas para este equipo.')
    }
  }
  if (selectedProjectCwd && enterpriseContext.enterpriseApplied) {
    const allowedProjectCwd = Array.isArray(enterpriseContext.allowedRoots) && enterpriseContext.allowedRoots.some((root) => {
      const normalizedRoot = resolveExistingDir(root)
      return normalizedRoot === cwd || (normalizedRoot && cwd.startsWith(normalizedRoot + path.sep))
    })
    if (!allowedProjectCwd) {
      throw new Error('El proyecto seleccionado está fuera de las carpetas permitidas para este equipo.')
    }
  }
  const legacyBootstrap = getProfileStartupMessage(effectiveProfile)
  const personaResolved = sanitizePersonaPrompt(enterpriseContext.personaResolved || '')
  const bootstrapMessage = legacyBootstrap
  const allowedMcpServers = Array.isArray(enterpriseContext.allowedMcpServers) && enterpriseContext.allowedMcpServers.length
    ? [...enterpriseContext.allowedMcpServers]
    : [...normalizeMcpServerList(effectiveProfile?.mcpServers || [])]
  const permissions = enterpriseContext.enterpriseApplied
    ? normalizeLanPermissionMap(enterpriseContext.permissions)
    : { ...DEFAULT_LAN_ROLE_PERMISSIONS }
  const args = buildLanCliArgs(cli, {
    model: requestedModel,
    effort: requestedEffort
  })
  if (cli === 'claude' && personaResolved) {
    args.push('--append-system-prompt', personaResolved)
  }
  const lanEnv = { ...cliCheck.env }
  // LAN fuera del hook de persona viva: aquí manda la persona del operador
  // (fijada al spawn con el flag de arriba), no el perfil activo local.
  delete lanEnv.POWERAGENT_PERSONA_FILE
  if (cli === 'claude') {
    lanEnv.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = '1'
  }
  logEnterpriseSessionSemantic(enterpriseContext, { ip: remoteIp })
  return {
    cli,
    cwd,
    bin: cliCheck.bin,
    env: lanEnv,
    args,
    requestedCli,
    model: requestedModel,
    effort: requestedEffort,
    mode: enterpriseContext.enterpriseApplied ? 'enterprise' : 'legacy',
    enterpriseEnabled: Boolean(appConfig?.enterprise?.enabled),
    operatorId: enterpriseContext.operatorId || '',
    roleId: enterpriseContext.roleId || '',
    profileId: effectiveProfile?.id || activeProfile?.id || DEFAULT_PROFILE_ID,
    personaResolved,
    personaSource: enterpriseContext.personaSource || (personaResolved ? 'operator-or-profile' : 'none'),
    allowedRoots: hasValidInvite
      ? (Array.isArray(enterpriseContext.allowedRoots) && enterpriseContext.allowedRoots.length
          ? [...enterpriseContext.allowedRoots]
          : buildLanSessionLegacyRoots(cwd))
      : (Array.isArray(enterpriseContext.allowedRoots) ? [...enterpriseContext.allowedRoots] : buildLanSessionLegacyRoots(cwd)),
    readOnlyRoots: Array.isArray(enterpriseContext.readOnlyRoots) ? [...enterpriseContext.readOnlyRoots] : [],
    allowedMcpServers,
    permissions,
    bootstrapMessage
  }
}

async function runLanSemanticChatTurn({ session, prompt, signal } = {}) {
  const sessionRef = session && typeof session === 'object' ? session : {}
  const text = String(prompt || '').trim()
  if (!text) return { text: '', sessionId: null }

  const cli = sessionRef.cli === 'codex' ? 'codex' : 'claude'
  const cwd = resolveExistingDir(sessionRef.cwd) || getCwdSync() || os.homedir()
  const model = sanitizeLanRequestedModel(sessionRef?.context?.model || sessionRef?.context?.request?.model || '')
  const effort = sanitizeLanRequestedEffort(
    sessionRef?.context?.effort || sessionRef?.context?.request?.effort || '',
    cli
  )
  const currentChatSessionId = String(sessionRef.chatSessionId || '').trim()

  if (cli === 'codex') {
    const result = await runCodexHeadless({
      prompt: text,
      sessionId: currentChatSessionId || undefined,
      signal,
      cwd,
      model,
      effort,
      timeoutMs: 240000,
      origin: 'lan'
    })
    const nextSessionId = String(result?.sessionId || currentChatSessionId || '').trim()
    return { text: String(result?.text || '').trim(), sessionId: nextSessionId || null }
  }

  const result = await runClaudeHeadless({
    prompt: text,
    sessionId: currentChatSessionId || undefined,
    signal,
    cwd,
    model: model || getClaudeModel(),
    effort,
    timeoutMs: 240000,
    origin: 'lan'
  })
  const nextSessionId = String(result?.sessionId || currentChatSessionId || '').trim()
  return { text: String(result?.text || '').trim(), sessionId: nextSessionId || null }
}

function ensureLanAuthToken() {
  // SEC-C1: token Bearer obligatorio. Si no existe, lo generamos y persistimos.
  const current = appConfig?.lanServer?.authToken
  if (typeof current === 'string' && current.length >= 32) return current
  const token = require('crypto').randomBytes(32).toString('hex')
  persistLanServerConfig({ authToken: token })
  return token
}

function ensureLanWsServer() {
  if (lanWsServer) return lanWsServer
  lanWsServer = createLanWsServer({
    clientHtmlPath: getLanClientHtmlPath(),
    getSessionConfig: (remoteMeta) => resolveLanSessionConfig(remoteMeta),
    listReusableSessions: (meta) => listLanReusableSessions(meta),
    listReusableProjects: (meta) => listLanReusableProjects(meta),
    transcribeAudio: (audioPath) => transcribeAudioFile(audioPath, buildRuntimeEnv()),
    runSemanticChatTurn: (payload) => runLanSemanticChatTurn(payload),
    buildExecCommand: buildFdLimitCommand,
    logger: (message) => console.log(message),
    onAuditEvent: (event) => logLanAuditSemantic(event),
    getAuthToken: () => ensureLanAuthToken(),
    // El túnel efímero, si está vivo, manda sobre las URLs configuradas.
    getPublicClientUrl: () => lanTunnel.getPublicClientUrl() || appConfig?.lanServer?.publicClientUrl || '',
    getPublicWsUrl: () => lanTunnel.getPublicWsUrl() || appConfig?.lanServer?.publicWsUrl || '',
    // Getters: sessionGit/sessionGitMap son `let` inicializados en onReady,
    // después de crear el servidor. La resolución perezosa evita capturar null.
    sessionGit: () => sessionGit,
    sessionGitMap: () => sessionGitMap
  })
  return lanWsServer
}

function persistLanServerConfig(patch = {}) {
  const current = appConfig?.lanServer || {}
  // saveAppConfig ya normaliza: normalizar aquí sería pasar dos veces por los
  // saneadores (y arriesgarse a que alguno deje de ser idempotente).
  const saved = saveAppConfig({
    ...appConfig,
    lanServer: {
      ...current,
      ...patch
    }
  })
  return saved.lanServer
}

async function startLanServer(options = {}) {
  const server = ensureLanWsServer()
  const port = clampLanPort(options?.port ?? appConfig?.lanServer?.port ?? DEFAULT_LAN_WS_PORT)
  const started = await server.start({
    port,
    clientHtmlPath: getLanClientHtmlPath()
  })
  if (options?.persist) persistLanServerConfig({ enabled: true, port })
  return {
    ok: true,
    ...started,
    sessions: server.listSessions()
  }
}

async function stopLanServer(options = {}) {
  const server = lanWsServer
  // Sin servidor no hay nada que proxear: el túnel muere con él.
  try { lanTunnel.stop() } catch {}
  if (server && server.isRunning()) {
    await server.stop()
  }
  if (options?.persist) persistLanServerConfig({ enabled: false })
  return { ok: true, ...getLanServerStatus() }
}

function getLanServerStatus() {
  const configuredPort = clampLanPort(appConfig?.lanServer?.port ?? DEFAULT_LAN_WS_PORT)
  if (!lanWsServer) {
    return {
      running: false,
      ip: '',
      port: configuredPort,
      httpPort: configuredPort + 1,
      wsUrl: '',
      clientUrl: '',
      publicClientUrl: appConfig?.lanServer?.publicClientUrl || '',
      publicWsUrl: appConfig?.lanServer?.publicWsUrl || '',
      publicUrlWarning: null,
      tunnel: lanTunnel.getStatus(),
      sessions: []
    }
  }
  const status = lanWsServer.getStatus()
  return {
    running: !!status.running,
    ip: status.ip || '',
    port: clampLanPort(status.port ?? configuredPort),
    httpPort: Number(status.httpPort || (configuredPort + 1)),
    wsUrl: status.wsUrl || '',
    clientUrl: status.clientUrl || '',
    publicClientUrl: appConfig?.lanServer?.publicClientUrl || '',
    publicWsUrl: appConfig?.lanServer?.publicWsUrl || '',
    publicUrlWarning: status.publicUrlWarning || null,
    tunnel: lanTunnel.getStatus(),
    sessions: Array.isArray(status.sessions) ? status.sessions : []
  }
}

function createLanSessionInvite(event) {
  const session = getSessionByEvent(event) || (primaryWcId != null ? sessions.get(primaryWcId) : null)
  if (!session || !session.pty) {
    return { ok: false, error: 'No hay una sesión local activa para compartir.' }
  }
  const cli = session.activeCli === 'codex' ? 'codex' : 'claude'
  const sessionId = semanticSessionId(session, cli)
  if (!sessionId) {
    return { ok: false, error: 'Habla al menos una vez antes de compartir esta sesión.' }
  }
  const server = ensureLanWsServer()
  if (!server.isRunning()) {
    return { ok: false, error: 'Activa primero el servidor LAN.' }
  }
  const meta = buildCurrentSessionMeta(session) || {}
  try {
    return server.createSessionInvite({
      cwd: session.gitWorkspace?.realCwd || session.cwd,
      sessionId,
      cli,
      label: meta.title || `${cli} · ${sessionId}`
    })
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

const _healthCollectors = createHealthCollectors({
  getTasksScheduler: () => tasksScheduler,
  getPrimarySession: () => primaryWcId != null ? sessions.get(primaryWcId) : null,
  getSessions: () => sessions,
  ensureCliAvailable,
  getAppConfig: () => appConfig,
  getTelegramBridge: () => telegramBridge
})
const {
  countConfiguredTelegramUsers,
  collectWhatsappBridgeHealth,
  collectLaunchdHealth,
  collectSchedulerHealth,
  collectPtyHealth,
  collectTelegramHealth,
  collectHealthSnapshot
} = _healthCollectors

function semanticCli(cliHint) {
  const cli = cliHint || getActiveCliSync() || 'claude'
  return cli === 'codex' ? 'codex' : 'claude'
}

function semanticSessionId(session, cliHint) {
  const cli = semanticCli(cliHint || session?.activeCli)
  if (!session) return ''
  if (cli === 'codex') return String(session.codexSessionId || '')
  return String(session.claudeSessionId || '')
}

function semanticDetail(detail) {
  const text = String(detail || '').replace(/\s+/g, ' ').trim()
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text
}

function logSemantic(action, payload = {}) {
  if (!action) return
  const event = payload && typeof payload === 'object' ? payload : {}
  semanticLogger.log({
    session: event.session || '',
    cli: semanticCli(event.cli),
    action: String(action),
    detail: semanticDetail(event.detail || ''),
    ok: event.ok !== false
  })
}

function logSemanticForSession(session, action, payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {}
  logSemantic(action, {
    session: p.session || semanticSessionId(session, p.cli),
    cli: p.cli || session?.activeCli || getActiveCliSync(),
    detail: p.detail || '',
    ok: p.ok !== false
  })
}

// Stubs listos para el flujo AGENT_PROPOSAL (Task D).
function logProposalApprovedStub(payload = {}) {
  logSemantic('propuesta_aprobada', payload)
}

function logProposalRejectedStub(payload = {}) {
  logSemantic('propuesta_rechazada', payload)
}

function getPrimaryWindowSession() {
  return primaryWcId != null ? sessions.get(primaryWcId) : null
}

const agentProposalWatcher = createAgentProposalWatcher({
  baseDir: AGENT_PROPOSAL_DIR,
  filePrefix: AGENT_PROPOSAL_FILE_PREFIX,
  fileSuffix: AGENT_PROPOSAL_FILE_SUFFIX,
  pollMs: AGENT_PROPOSAL_POLL_MS,
  emitToRenderers: (payload) => {
    if (!payload) return false
    const first = getPrimaryWindowSession()
    const candidates = []
    if (first) candidates.push(first)
    for (const s of sessions.values()) {
      if (!s || s === first) continue
      candidates.push(s)
    }
    for (const s of candidates) {
      if (!s?.win || s.win.isDestroyed()) continue
      try {
        s.win.webContents.send('proposal:new', payload)
        return true
      } catch {}
    }
    return false
  },
  broadcastCleared: (payload) => broadcastToAllWindows('proposal:cleared', payload)
})

const sanitizeProposalIdForFilename = agentProposalWatcher.sanitizeProposalIdForFilename
const guessProposalIdFromFile = agentProposalWatcher.guessProposalIdFromFile
const buildProposalMarkerPath = agentProposalWatcher.buildProposalMarkerPath
const serializePendingProposalForRenderer = agentProposalWatcher.serializeForRenderer
const syncPendingProposalToWindow = agentProposalWatcher.syncToWindow
const pauseAgentProposalPolling = agentProposalWatcher.pause
const detectPendingAgentProposal = agentProposalWatcher.detect
const startAgentProposalPolling = agentProposalWatcher.start
const resumeAgentProposalPolling = agentProposalWatcher.resume
const finalizePendingProposal = agentProposalWatcher.finalize

function resolveProposalExecutionSession(event) {
  const fromEvent = event ? getSessionByEvent(event) : null
  if (fromEvent?.pty) return fromEvent
  const primary = getPrimaryWindowSession()
  if (primary?.pty) return primary
  for (const s of sessions.values()) {
    if (s?.pty) return s
  }
  return fromEvent || primary || null
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
const _relayTranscriptHelpers = createRelayTranscriptHelpers({
  resolveClaudeProjectDir,
  extractTurnText,
  flattenTerminal,
  stripAnsi
})
const {
  claudeProjectSessionsDir,
  listClaudeSessionFilesWithMtime,
  snapshotClaudeSessions,
  findUpdatedOrNewClaudeSessionId,
  snapshotClaudeSessionMeta,
  findRelayTranscript,
  resolveResumeCwd,
  detectForkedRelayTranscript,
  pickRelayTranscriptCandidate,
  extractAssistantTextFromTranscript,
  cleanRelayFallbackText
} = _relayTranscriptHelpers

async function relayThroughPty(session, prompt, { onText, signal, mode } = {}) {
  if (!session?.pty || !session?.cwd) return null
  const targetCli = mode || session.activeCli
  if (targetCli !== 'claude' && targetCli !== 'codex') return null
  if (session.activeCli !== targetCli) return null
  // Si hay un turno en vuelo (relayActive o un turno de VOZ con su cerrojo
  // voiceTurnUntil), esperar a que se libere (máx 30s) en vez de devolver null
  // inmediato. relayActive cubre el race del bridge bajo carga; el cerrojo de
  // voz cubre el orden más probable de la mezcla: un Telegram llegando a mitad
  // de un turno de voz sobre el mismo PTY (CLAUDE.md § Git automático,
  // PENDIENTE INMEDIATO cerrado 2026-08-06). El cerrojo caduca solo (180s).
  const relayBusy = () => session.relayActive || voiceTurnLockActive(session)
  if (relayBusy()) {
    const RELAY_BUSY_WAIT_MS = 30000
    const RELAY_BUSY_POLL_MS = 50
    const waitStart = Date.now()
    while (relayBusy() && Date.now() - waitStart < RELAY_BUSY_WAIT_MS) {
      if (signal?.aborted) {
        const err = new Error('Request aborted')
        err.name = 'AbortError'
        throw err
      }
      await new Promise((r) => setTimeout(r, RELAY_BUSY_POLL_MS))
      if (!session?.pty) return null
    }
    if (relayBusy()) return null
  }
  const message = String(prompt || '').trim()
  if (!message) return null

  // El transcript se localiza por sessionId, NO adivinando el directorio: una
  // sesión nueva en worktree escribe en el proyecto del worktree, pero una
  // resumida (--resume) sigue escribiendo en el proyecto original. Ver
  // findRelayTranscript.
  const relayCwds = relayCwdCandidates(session)
  let transcript = targetCli === 'claude'
    ? findRelayTranscript({ sessionId: session.claudeSessionId || null, cwds: relayCwds })
    : null
  let baseOffset = transcript?.size || 0
  const preferredSessionId = targetCli === 'claude'
    ? (session.claudeSessionId || transcript?.sessionId || null)
    : null
  if (targetCli === 'claude' && !session.claudeSessionId && preferredSessionId) session.claudeSessionId = preferredSessionId

  session.relayActive = true

  return new Promise((resolve, reject) => {
    const MAX_WAIT_MS = 180000
    // WAIT_FIRST_OUTPUT_MS: techo absoluto para "primer signo de vida" tras el write.
    // Subido a 90s para cubrir modelos pensantes (Sonnet/Opus extended thinking) y
    // MCPs lentos (Supabase, WebFetch, indexado cwd grande). Con el liveness check
    // del transcript abajo, en la práctica solo dispara si el PTY está realmente
    // colgado (claude crasheó, MCP timeout interno, etc.).
    const WAIT_FIRST_OUTPUT_MS = 90000
    // LIVENESS_POLL_MS: cada X ms revisamos si el transcript JSONL creció durante
    // el wait inicial. Claude CLI escribe al JSONL antes de redibujar el TUI cuando
    // el modelo está razonando o llamando tools. Si crece, el modelo está vivo y
    // reseteamos firstOutputTimer (sin marcar sawAnyOutput aún — eso es señal de
    // texto real en el PTY).
    const LIVENESS_POLL_MS = 2000
    // Cada cuánto se mira el transcript para ver si el turno ya cerró.
    const TRANSCRIPT_POLL_MS = 300
    const SILENCE_MS = targetCli === 'codex' ? 3200 : 2200
    const ECHO_SKIP_MS = 700
    const FORCE_FINAL_TEXT_MS = 15000
    const FORCE_END_RELAY_MS = 45000
    const MAX_CAPTURE_CHARS = 180000

    // startedAt se reajusta tras el pre-drain para que los timers y el filtro
    // por timestamp del transcript cuenten desde el momento real del write.
    let startedAt = Date.now()
    let lastDataAt = startedAt
    let sawAnyOutput = false
    let capture = ''
    let finalized = false
    let silenceTimer = null
    let firstOutputTimer = null
    let maxTimer = null
    let livenessTimer = null
    let livenessBaseline = null
    let transcriptPoll = null

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
      // Relocalizar si aún no teníamos fichero: la sesión puede haberlo creado
      // durante este turno (primer mensaje de una sesión nueva).
      if (!transcript) {
        const found = findRelayTranscript({
          sessionId: session.claudeSessionId || preferredSessionId,
          cwds: relayCwds
        })
        if (found) {
          transcript = found
          baseOffset = 0 // fichero nuevo: todo su contenido es de este turno
        }
      }
      const candidate = transcript
      let fromTranscript = { text: '', sawAssistant: false, sawEndTurn: false, turnComplete: false }
      let sid = session.claudeSessionId || preferredSessionId || null
      if (candidate) {
        sid = candidate.sessionId || sid
        const offset = baseOffset
        // Filtrar por timestamp del turno: una respuesta tardía del turno previo
        // puede escribirse al transcript después del snapshot inicial, lo que
        // antes provocaba que el turno N+1 devolviera la respuesta del turno N.
        fromTranscript = extractAssistantTextFromTranscript(candidate.filePath, offset, startedAt)
        // Nota: no se hace rescate leyendo el transcript desde 0 porque eso reintroduce
        // respuestas de turnos anteriores y desfasa la conversación en Telegram.
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
      if (fromTranscript.turnComplete || fromTranscript.sawEndTurn) {
        finishOk(text, sid)
        return
      }
      if (text && elapsed >= FORCE_FINAL_TEXT_MS) {
        finishOk(text, sid)
        return
      }
      if (elapsed >= FORCE_END_RELAY_MS) {
        // NUNCA raspar el TUI: mandaba spinners, el banner de bienvenida y el
        // historial entero a Telegram. Sin texto en el transcript, error claro.
        if (!text) {
          const err = new Error('No pude leer la respuesta de Claude (transcript no disponible)')
          err.name = 'RelayEmpty'
          finishErr(err)
          return
        }
        finishOk(text, sid)
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
      if (livenessTimer) clearInterval(livenessTimer)
      if (transcriptPoll) clearInterval(transcriptPoll)
      if (signal) signal.removeEventListener('abort', onAbort)
      if (session) {
        session.relayActive = false
        session.relayListener = null
        session.relayCancel = null
      }
    }

    const PRE_DRAIN_MS = 250
    // Listener provisional: absorbe cualquier residuo del turno previo durante PRE_DRAIN_MS
    // antes de escribir el nuevo prompt. Evita que output tardío del turno N contamine
    // el capture/timer del turno N+1.
    session.relayListener = () => {}

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

    setTimeout(() => {
      if (finalized) return
      if (!session?.pty) {
        const err = new Error('PTY no disponible')
        err.name = 'RelayPtyClosed'
        finishErr(err)
        return
      }
      // Reinstalar snapshot del transcript justo antes de escribir el prompt,
      // así el offset cubre cualquier escritura tardía del turno anterior.
      let dirSnapsBefore = []
      if (targetCli === 'claude') {
        try {
          const fresh = findRelayTranscript({
            sessionId: session.claudeSessionId || preferredSessionId,
            cwds: relayCwds
          })
          if (fresh) {
            transcript = fresh
            baseOffset = fresh.size // todo lo que venga después es de este turno
          }
        } catch {}
        // Snapshot de TODOS los .jsonl candidatos PRE-write: si el turno acaba
        // en un fichero forkeado (--resume interactivo crea sessionId nuevo),
        // el poll lo detecta comparando contra este estado.
        try {
          dirSnapsBefore = relayCwds.map((c) => ({ cwd: c, snap: snapshotClaudeSessionMeta(c) }))
        } catch {}
      }

      // Reset reloj: el turno empieza a contar desde aquí (no desde el inicio del Promise).
      startedAt = Date.now()
      lastDataAt = startedAt

      // Listener real: instalado solo después del drenaje.
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

      // Disparo por transcript: el JSONL es la fuente de verdad y dice cuándo
      // acabó el turno. Sin esto había que esperar 2,2s de silencio del TUI y,
      // en turnos con herramientas, se acababa en los topes de 15s/45s.
      if (targetCli === 'claude') {
        let lastPolledSize = baseOffset
        let lastForkCheckAt = 0
        transcriptPoll = setInterval(() => {
          if (finalized) return
          try {
            // Si el fichero no ha crecido no hay nada nuevo: un stat en vez de
            // parsear. Sin esto el poll trabaja en balde 3 veces por segundo.
            if (transcript) {
              const size = safeStat(transcript.filePath)?.size ?? 0
              if (size <= lastPolledSize) {
                // Transcript esperado congelado: puede ser el fork de un
                // --resume interactivo (el TUI resume creando un sessionId
                // NUEVO y escribe los turnos ahí; el viejo no crece jamás).
                const now = Date.now()
                if (now - startedAt < 1500 || now - lastForkCheckAt < 1000) return
                lastForkCheckAt = now
                const forked = detectForkedRelayTranscript({
                  cwds: relayCwds,
                  before: dirSnapsBefore,
                  excludeSessionId: transcript.sessionId || session.claudeSessionId || preferredSessionId,
                  promptMarker: message
                })
                if (!forked) return
                transcript = { filePath: forked.filePath, sessionId: forked.sessionId, size: forked.baseOffset, mtimeMs: 0 }
                baseOffset = forked.baseOffset
                lastPolledSize = forked.baseOffset
                session.claudeSessionId = forked.sessionId
              } else {
                lastPolledSize = size
              }
            }
            const { sid, fromTranscript } = buildRelayResult()
            if (fromTranscript.turnComplete) finishOk(fromTranscript.text, sid)
          } catch {}
        }, TRANSCRIPT_POLL_MS)
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

      // Liveness check (solo Claude): si el transcript JSONL crece durante el
      // wait inicial, el modelo está vivo (escribiendo al log antes de redibujar
      // el TUI). Reseteamos firstOutputTimer para extender la ventana sin pedir
      // texto del PTY todavía. Cuando llegue texto real al PTY, relayListener
      // marca sawAnyOutput y este chequeo deja de operar.
      if (targetCli === 'claude') {
        livenessBaseline = transcript?.size || 0
        livenessTimer = setInterval(() => {
          if (finalized || sawAnyOutput) return
          if (!session?.pty) return
          let grew = false
          try {
            const current = transcript ? safeStat(transcript.filePath)?.size || 0 : 0
            if (current > livenessBaseline) grew = true
            livenessBaseline = current
          } catch {}
          if (grew) {
            // Modelo respondiendo: refresca el timer de "primer output" para no
            // matar un turno legítimo que tarda en redibujar el TUI.
            if (firstOutputTimer) clearTimeout(firstOutputTimer)
            firstOutputTimer = setTimeout(() => {
              if (finalized || sawAnyOutput) return
              const err = new Error('Relay no output')
              err.name = 'RelayNoOutput'
              finishErr(err)
            }, WAIT_FIRST_OUTPUT_MS)
          }
        }, LIVENESS_POLL_MS)
      }

      armSilenceTimer()
      // El ENTER va APARTE del texto (main/pty-prompt-write.js): pegados en el
      // mismo write, el TUI lo trata como pegado y el turno queda escrito sin
      // enviar. Con textos cortos colaba; una transcripción de voz lo destapó.
      writePromptThenEnter((chunk) => session.pty.write(chunk), message)
        .catch((err) => finishErr(err))
    }, PRE_DRAIN_MS)
  })
}

const _relayBindings = createTelegramRelayBindings({
  telegramRelayByChat,
  getSessions: () => sessions,
  getPrimaryWcId: () => primaryWcId,
  getTelegramBridge: () => telegramBridge,
  killPty: (s) => killPty(s),
  startPty: (s, cols, rows, cwd, args) => startPty(s, cols, rows, cwd, args),
  updatePrimarySnapshot: () => updatePrimarySnapshot(),
  getTaskSessionByWcId: (wcId) => taskSessionStateByWc.get(wcId) || null
})
const {
  canRelayTelegramToPty,
  normalizeTelegramChatKey,
  getRelayBindingForChat,
  getRelayBindingForSession,
  describeRelayUnavailable,
  pickRelaySession,
  bindRelaySessionToTelegramChat,
  unbindRelaySessionForTelegramChat,
  unbindRelaySessionsByWcId,
  pickRelaySessionForChat,
  syncSessionContextAfterTelegramDetach
} = _relayBindings

const { looksRemotePath, resolveExistingDir } = require('./main/dir-helpers')

function getProfileStartupMessage(profile) {
  const claudeMdPath = typeof profile?.claudeMdPath === 'string' ? profile.claudeMdPath.trim() : ''
  if (!claudeMdPath) return ''
  if (looksRemotePath(claudeMdPath)) return ''
  try {
    const stat = fs.statSync(claudeMdPath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 512 * 1024) return ''
    const text = fs.readFileSync(claudeMdPath, 'utf-8').trim()
    return text ? `${text}\n` : ''
  } catch {
    return ''
  }
}

function scheduleProfileBootstrapMessage(session, proc, profile) {
  const message = getProfileStartupMessage(profile)
  if (!message) return
  setTimeout(() => {
    if (!proc?._alive) return
    if (session?.pty !== proc) return
    try { proc.write(message) } catch {}
  }, 650)
}

// Modelo Claude por defecto (config). 'opus' = contexto estándar 200k, evita
// el gate de créditos del 1M. Usado al spawnear PTY local y como fallback headless.
function getClaudeModel() {
  return appConfig?.cli?.claudeModel || 'opus'
}

// Args claude para spawn local: prepende --model con el default configurado.
// La persona del perfil NO va aquí: viaja por el hook UserPromptSubmit (persona
// viva, ver syncActivePersonaFile) para poder cambiarla en sesiones abiertas.
function buildClaudeLocalArgs(cli, sessionId) {
  return buildResumeArgs(cli, sessionId, cli === 'claude' ? getClaudeModel() : '')
}

// ── Persona viva por perfil ──
// La persona del perfil activo vive en un fichero de estado que el hook
// ~/.claude/hooks/poweragent-persona.sh inyecta como contexto en CADA mensaje
// de las sesiones nacidas de la app (env POWERAGENT_PERSONA_FILE, heredada por
// todos los spawns vía process.env). Cambiar de perfil = reescribir el fichero:
// aplica en el SIGUIENTE mensaje, también en sesiones ya abiertas. Las sesiones
// LAN quedan fuera (persona de operador fijada al spawn); WhatsApp ni carga
// settings. Detalle: .claude/memory/tech/tech_perfiles_persona_invisible.md.
function activePersonaFilePath() {
  return path.join(app.getPath('userData'), 'active-persona.md')
}

function syncActivePersonaFile() {
  const file = activePersonaFilePath()
  try {
    const persona = sanitizePersonaPrompt(getActiveProfile()?.personaPrompt || '')
    fs.writeFileSync(file, persona ? `${persona}\n` : '', 'utf-8')
  } catch (err) {
    console.warn('[persona] no pude escribir active-persona.md:', err?.message || err)
  }
  return file
}

// ── Sub-chat desechable (fork de la sesión activa, ver main/subchat-pty.js) ──
const subchatManager = createSubchatManager({
  ptySpawn: (file, argv, opts) => pty.spawn(file, argv, opts),
  ensureCliAvailable,
  buildFdLimitCommand,
  getClaudeModel,
  snapshotSessions: (cwd) => snapshotClaudeSessions(cwd),
  // Misma regla que la detección del fork del `--resume`, incluida la renuncia
  // ante ambigüedad: si aparecen dos ficheros nuevos, ninguno es adoptable.
  detectNewSessionId: (cwd, before, excludeIds = []) => pickForkedSessionId({
    groups: [{ rows: listClaudeSessionFilesWithMtime(cwd), before }],
    excludeIds: [...excludeIds, ...knownClaudeSessionIds()]
  }),
  log: (m) => console.log('[subchat]', m)
})

// ── Modo voz (ver docs/superpowers/specs/2026-08-04-voz-en-directo-design.md) ──
//
// UN helper por app, no por ventana: el micrófono es un recurso único del
// sistema y dos procesos peleándose por él darían dos peticiones de permiso y
// audio partido. `voiceOwnerWcId` marca de quién es el modo voz ahora mismo.
//
// El modo voz NO spawnea ningún PTY propio (CLAUDE.md § Regla para spawns
// nuevos): el encargo escribe en el PTY de la sesión madre, que ya pasó por
// `ensureSessionWorkspace`, y la charla reutiliza `subchat-pty`, que está
// excluido a propósito y hereda el workCwd de la madre. El helper de voz es un
// proceso Swift sin acceso al repo.
const VOICE_HELPER_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'voice-helper')
  : path.join(__dirname, 'resources', 'voice-helper')

let voiceOwnerWcId = null

function getVoiceSessionOwner() {
  if (voiceOwnerWcId == null) return null
  return sessions.get(voiceOwnerWcId) || null
}

// Resolutor pendiente de `voice:voices`: el listado llega como evento por el
// stream general del helper, no como respuesta directa al send.
let voiceVoicesWaiter = null

const voiceHelper = createVoiceHelperProcess({
  helperPath: VOICE_HELPER_PATH,
  spawnFn: (bin, args, opts) => spawn(bin, args, opts),
  onEvent: (evt) => {
    // Traza de eventos del helper (volumen bajo: unos pocos por frase). Vital
    // para diagnosticar el modo voz en la app instalada: lanzándola desde
    // Terminal con redirect se ve dónde se corta el ciclo
    // listening→speech-detected→partial→final.
    try {
      if (evt && evt.type !== 'voices') {
        const extra = typeof evt.text === 'string' ? ` "${evt.text.slice(0, 60)}"` : ''
        console.log('[voz-evt]', evt.type + extra)
      }
    } catch {}
    if (evt && evt.type === 'voices' && typeof voiceVoicesWaiter === 'function') {
      voiceVoicesWaiter(Array.isArray(evt.voices) ? evt.voices : [])
    }
    // Las transcripciones de fichero (ids `ftr:`) y las síntesis a fichero
    // (ids `syn:`) se consumen las primeras: sus eventos no son de nadie más.
    // Un `error` fatal rechaza sus pendientes pero NO se consume —
    // voice-session también tiene que verlo.
    try {
      if (appleFileTranscriber?.handleHelperEvent(evt)) return
    } catch (err) { console.warn('[voz]', err?.message || err) }
    try {
      if (voiceNoteMaker?.handleHelperEvent(evt)) return
    } catch (err) { console.warn('[voz]', err?.message || err) }
    // Las lecturas del visor (ids `viewer:`) se consumen antes de que los vea
    // voice-session; los hello pasan a los dos (no se consumen).
    let consumido = false
    try { consumido = viewerSpeech.handleHelperEvent(evt) } catch (err) { console.warn('[voz]', err?.message || err) }
    if (consumido) return
    try { voiceSession.handleHelperEvent(evt) } catch (err) { console.warn('[voz]', err?.message || err) }
  },
  log: (m) => console.log('[voz]', m)
})

const voiceWatcher = createVoiceTurnWatcher({
  findRelayTranscript,
  extractAssistantTextFromTranscript,
  statFn: (p) => safeStat(p)
})

const voiceSendTargetRaw = createVoiceSendTarget({
  // Sesión VIVA en cada consulta (nada de copias cacheadas): voice-session
  // revalida el destino turno a turno, y con una copia el cambio de sesión o de
  // CLI en esa ventana pasaría desapercibido.
  getSession: getVoiceSessionOwner,
  subchat: subchatManager,
  relayCwdCandidates,
  findRelayTranscript,
  snapshotClaudeSessionMeta,
  detectForkedRelayTranscript,
  statFn: (p) => safeStat(p),
  readFileFn: (p) => fs.readFileSync(p, 'utf8'),
  log: (m) => console.log('[voz]', m)
})

// Envoltorio del destino de voz: los encargos alimentan el detector de tareas
// repetidas. La charla (sub-chat) no cuenta — no es un encargo de trabajo.
const voiceSendTarget = async (args = {}) => {
  if (args?.mode === 'encargo') feedRepeatedPromptDetector(args.text, 'voz')
  return voiceSendTargetRaw(args)
}

const voiceSession = createVoiceSession({
  helper: voiceHelper,
  speakable: speakableFromMarkdown,
  watcher: voiceWatcher,
  router: voiceRouter,
  getSession: getVoiceSessionOwner,
  sendToTarget: voiceSendTarget,
  // La voz elegida, LEÍDA en cada consulta: voice-session la reenvía cuando el
  // helper resucita, y el usuario puede haberla cambiado entre medias.
  getVoiceId: () => appConfig?.cli?.voiceId || '',
  // Misma pausa que se le manda al helper, leída igual de viva: las dos mitades
  // del corte de turno (el umbral relativo de Node y el absoluto del helper)
  // tienen que trabajar con el mismo número o una cortaría antes que la otra.
  getSilenceMs: () => Number(appConfig?.cli?.voiceSilenceMs) || undefined,
  // El modo voz también se apaga SOLO (error fatal del helper, sesión que deja
  // de servir) y por esos caminos no pasa nadie que suelte `voiceOwnerWcId`.
  // Sin esto, el micro queda marcado como ocupado por una ventana que ya no lo
  // tiene y ninguna otra puede encender la voz hasta reiniciar la app.
  onShutdown: () => { voiceOwnerWcId = null },
  notifyRenderer: (evt) => {
    const s = getVoiceSessionOwner()
    try {
      if (s?.win && !s.win.isDestroyed?.()) s.win.webContents.send('voice:event', evt)
    } catch {}
  },
  log: (m) => console.log('[voz]', m)
})

// Lectura en voz alta desde el visor de archivos (botón 🔊 "Léemelo").
const viewerSpeech = createViewerSpeech({
  helper: voiceHelper,
  chunker: (md) => chunkSpeakableFromMarkdown(md),
  isVoiceModeEnabled: () => voiceSession.isEnabled(),
  applyPrefs: () => applyVoicePrefsToHelper(),
  notifyEnded: (wcId) => {
    try {
      const wc = webContents.fromId(wcId)
      if (wc && !wc.isDestroyed()) wc.send('viewer:speech-ended')
    } catch {}
  },
  log: (m) => console.log('[voz]', m)
})

// Transcripción de audios (Telegram/WhatsApp/dictado) por Apple Speech en
// servidor, con whisper de fallback en main/whisper-transcribe.js. El helper
// se arranca solo para esto y se para al acabar — salvo que el modo voz o el
// lector del visor lo tengan en uso.
appleFileTranscriber = createAppleFileTranscriber({
  helper: voiceHelper,
  // El transcriptor y el sintetizador comparten helper: ninguno lo para si el
  // otro tiene trabajo pendiente (de ahí el cruce de pendingCount).
  isVoiceInUse: () => voiceSession.isEnabled() || viewerSpeech.isReading() || voiceNoteMaker.pendingCount() > 0,
  log: (m) => console.log('[transcribe]', m)
})

// Notas de voz de respuesta para Telegram (texto → TTS con la voz configurada
// → .ogg opus). Ver main/voice-note.js.
const voiceNoteMaker = createVoiceNoteMaker({
  helper: voiceHelper,
  tmpDir: TMP_DIR,
  ffmpegBin: FFMPEG_BIN,
  applyPrefs: () => applyVoicePrefsToHelper(),
  isVoiceInUse: () => voiceSession.isEnabled() || viewerSpeech.isReading() || appleFileTranscriber.pendingCount() > 0,
  log: (m) => console.log('[voz-nota]', m)
})

// Todos los sessionIds de claude que YA tienen dueño: sesiones vivas, sus
// sub-chats de voz, y las task-sessions (que es donde viven también los PTYs
// ocultos del pool de Telegram). La detección del fork de un `--resume` los
// necesita para no adoptar el .jsonl de otra sesión: un sub-chat abierto dentro
// de la ventana de detección crea un fichero nuevo en el mismo proyecto y por
// mtime es indistinguible del fork propio.
function knownClaudeSessionIds() {
  const ids = []
  try {
    for (const s of sessions.values()) {
      if (s?.claudeSessionId) ids.push(s.claudeSessionId)
      if (s?.voiceSubchatSessionId) ids.push(s.voiceSubchatSessionId)
    }
  } catch {}
  try {
    for (const st of taskSessionStateByWc.values()) {
      if (st?.claudeSessionId) ids.push(st.claudeSessionId)
    }
  } catch {}
  // Los sub-chats abiertos desde el botón: el suyo es un fork con sessionId
  // propio que no está en ninguna sesión ni task-session.
  try {
    for (const sid of subchatManager.sessionIds()) ids.push(sid)
  } catch {}
  return ids
}

// Vigía de fork para task-sessions/pool oculto: mismas guardas que el
// detectFork de startPty. El vigía anterior adoptaba ficheros que solo habían
// CRECIDO — la sesión interactiva del usuario en el mismo proyecto — y esa
// mezcla se persistía en la tarea y en el relay de Telegram.
const taskSessionForkWatch = createTaskSessionForkWatch({
  listClaudeSessionFilesWithMtime,
  snapshotClaudeSessions,
  pickForkedSessionId,
  knownClaudeSessionIds,
  hasLiveSubchat: () => subchatManager.hasAny(),
  resolveResumeCwd
})

// El modo voz muere con la ventana que lo tenía: sin esto el helper se queda
// escuchando y hablándole a nadie.
function releaseVoiceMode(wcId) {
  const s = wcId != null ? sessions.get(wcId) : null
  if (s) s.voiceSubchatSessionId = null
  if (voiceOwnerWcId == null || voiceOwnerWcId !== wcId) return
  try { voiceSession.disable() } catch {}
  voiceOwnerWcId = null
}

// ── Git por sesión (aislamiento por worktree) ──
// Fail-open: si sessionGit es null o prepare devuelve null, la sesión corre en
// su cwd real sin aislamiento (comportamiento idéntico al de siempre).
async function ensureSessionWorkspace(session, cwd) {
  if (!sessionGit) return
  const realCwd = resolveExistingDir(cwd) || resolveExistingDir(session.cwd)
  if (!realCwd) return
  if (session.gitWorkspace) {
    if (session.gitWorkspace.realCwd === realCwd) return       // restart/hot-switch: reusar worktree
    finalizeWorkspaceForSession(session)                        // cambio de proyecto en la misma ventana
  }
  try {
    session.gitWorkspace = await sessionGit.prepareSessionWorkspace({ realCwd })
  } catch (err) {
    console.warn('[session-git] prepare:', err?.message || err)
    session.gitWorkspace = null
  }
}

function finalizeWorkspaceForSession(session) {
  const ws = session?.gitWorkspace
  if (!ws) return
  session.gitWorkspace = null
  const p = (async () => {
    const copied = sessionGit.copySessionsHome({ realCwd: ws.realCwd, workCwd: ws.workCwd })
    const r = await sessionGit.finalizeSessionWorkspace(ws)
    for (const sid of copied) sessionGitMap.markFinalized(sid)
    if (r.outcome === 'conflict' || r.outcome === 'dirty-target' || r.outcome === 'error') {
      notifySessionGitIssue(ws, r)
    }
  })().catch((err) => console.warn('[session-git] finalize:', err?.message)).finally(() => pendingFinalizes.delete(p))
  pendingFinalizes.add(p)
  return p
}

// El conocimiento del proyecto no se pudo commitear: la sesión arranca en el
// cwd real (sin worktree) para que lea el disco tal cual, que es lo seguro. Se
// avisa porque el aislamiento desaparece sin que el usuario haya tocado nada.
function notifyKbNotCommitted(realCwd, detail) {
  const msg = `El conocimiento de ${realCwd} tiene cambios que git no pudo registrar${detail ? ` (${detail})` : ''}. La sesión arranca SIN aislamiento para que lea las fichas tal como están en disco.`
  notifyNative({
    title: 'POWER-AGENT · conocimiento',
    body: msg,
    fallback: () => {
      try {
        const box = {
          type: 'warning',
          title: 'POWER-AGENT · conocimiento',
          message: 'Conocimiento sin registrar en git',
          detail: msg,
          buttons: ['Entendido']
        }
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (win) dialog.showMessageBox(win, box); else dialog.showMessageBox(box)
      } catch {}
    }
  })
  console.warn('[session-git]', msg)
}

function notifySessionGitIssue(ws, r) {
  const msg = r.outcome === 'conflict'
    ? `Conflicto al integrar la sesión. Sus cambios quedaron en la rama ${r.branch} de ${ws.realCwd}.`
    : r.outcome === 'dirty-target'
      ? `El proyecto ${ws.realCwd} tenía cambios sin commitear. Los cambios de la sesión quedaron en la rama ${r.branch}.`
      : `Error integrando la sesión (${r.detail || 'desconocido'}). Rama: ${r.branch}.`
  // Sin notificación nativa (app sin firmar en Electron 42+) este aviso es la
  // única forma de enterarse de que una rama quedó sin integrar → cae a diálogo.
  notifyNative({
    title: 'POWER-AGENT · git por sesión',
    body: msg,
    fallback: () => {
      try {
        const box = {
          type: 'warning',
          title: 'POWER-AGENT · git por sesión',
          message: 'La sesión no se pudo integrar',
          detail: msg,
          buttons: ['Entendido']
        }
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (win) dialog.showMessageBox(win, box); else dialog.showMessageBox(box)
      } catch {}
    }
  })
  console.warn('[session-git]', msg)
}

// Relanza el CLI en la misma sesión tras un auto-update (codex se cierra solo
// pidiendo reinicio). Reutiliza el worktree ya creado: NO vuelve a pasar por
// ensureSessionWorkspace, porque session.gitWorkspace sigue siendo válido.
function respawnAfterCliUpdate(wcId) {
  const s = sessions.get(wcId)
  if (!s || s.pty) return
  if (s.win && !s.win.isDestroyed()) {
    s.win.webContents.send('pty-restarting', { cli: s.activeCli, reason: 'cli-update' })
  }
  setTimeout(() => {
    const live = sessions.get(wcId)
    if (!live || live.pty) return
    try {
      startPty(live, live.cols, live.rows, live.cwd, live.lastPtyArgs || [])
    } catch (err) {
      const msg = `No se pudo reiniciar tras la actualización: ${err?.message || err}`
      console.warn('[cli-update]', msg)
      if (live.win && !live.win.isDestroyed()) live.win.webContents.send('pty-exit')
    }
  }, 500)
}

// ── PTY per-session ──
function startPty(session, cols, rows, cwd, args = []) {
  if (!session) throw new Error('Sesión no disponible')
  if (session.pty) return session.pty
  const activeProfile = getActiveProfile()
  session.profileId = activeProfile.id
  session.ptyStartedAt = Date.now()
  if (cols && rows) {
    session.cols = cols
    session.rows = rows
  }
  const requestedCwd = resolveExistingDir(cwd)
  const profileCwd = resolveExistingDir(activeProfile.cwd)
  if (requestedCwd) session.cwd = requestedCwd
  else if (!resolveExistingDir(session.cwd)) session.cwd = profileCwd || os.homedir()
  const cliCheck = ensureCliAvailable(session.activeCli)
  if (!cliCheck.ok) {
    notifyPtyError(session, cliCheck.error)
    throw new Error(cliCheck.error)
  }

  // Snapshot ANTES del spawn solo si es claude — para capturar el sessionId que cree.
  const sessionFilesBefore = session.activeCli === 'claude'
    ? snapshotClaudeSessions(session.gitWorkspace?.workCwd || session.cwd)
    : null
  // Un `--resume` FORKEA (regla dura, CLAUDE.md § Relay de Telegram): claude
  // abre un sessionId NUEVO con el historial copiado y escribe ahí, y el
  // fichero del id resumido no vuelve a crecer. Quedarse con el id de los args
  // deja apuntando a un fichero muerto a TODO lo que dependa de él: el
  // `--fork-session` del sub-chat (que heredaría un contexto congelado en el
  // instante del resume), el modo voz y el relay. Se snapshotean los proyectos
  // candidatos para reconocer el fichero que aparezca.
  const resumedClaudeId = session.activeCli === 'claude' ? extractClaudeResumeId(args) : ''
  const forkScanBefore = resumedClaudeId
    ? new Map(relayCwdCandidates(session).map((c) => [c, snapshotClaudeSessions(c)]))
    : null
  if (session.activeCli === 'claude') {
    session.claudeSessionId = resumedClaudeId
  } else if (session.activeCli === 'codex') {
    session.codexSessionId = extractCodexResumeId(args)
  }

  let proc
  try {
    proc = pty.spawn('/bin/bash', ['-c', buildFdLimitCommand(cliCheck.bin, args)], {
      name: 'xterm-256color',
      cols: session.cols || 120,
      rows: session.rows || 35,
      cwd: session.gitWorkspace?.workCwd || session.cwd,
      env: cliCheck.env
    })
  } catch (err) {
    const msg = `No se pudo iniciar ${cliCheck.name}: ${err.message || err}`
    notifyPtyError(session, msg)
    throw new Error(msg)
  }

  proc._alive = true
  session.pty = proc
  session.lastPtyArgs = Array.isArray(args) ? args.slice() : []
  const myWcId = session.wcId
  // Reanudar codex pregunta por el directorio cuando el del rollout no es el
  // actual — con aislamiento git, siempre. Lo contesta la app (ver módulo).
  session.codexCwdPrompt = session.activeCli === 'codex'
    ? createCodexResumeCwdPrompt({
      onAnswer: (data) => { try { proc.write(data) } catch {} },
      onNotice: (message) => {
        const live = sessions.get(myWcId)
        if (live?.win && !live.win.isDestroyed()) live.win.webContents.send('pty-notice', message)
      },
      // Codex se cierra al chocar con otro escritor de la misma conversación: sin
      // este aviso el PTY moría y el renderer abría el picker sin decir por qué.
      onFatal: (message) => {
        const live = sessions.get(myWcId)
        if (live) notifyPtyError(live, message)
      }
    })
    : null
  scheduleProfileBootstrapMessage(session, proc, activeProfile)
  logSemanticForSession(session, 'pty_inicio', {
    detail: `cwd=${session.cwd || ''}`,
    ok: true
  })

  // Poll continuo para capturar el sessionId que claude cree/actualice en ~/.claude/projects/...
  // Sigue hasta detectarlo o hasta que el PTY muera. Con backoff: una ventana
  // abierta sin primer prompt no tiene .jsonl que detectar — tras el primer
  // minuto el sondeo se espacia (máx 15 s) en vez de leer el proyecto cada 2 s
  // para siempre. Coste asumido: si el primer prompt llega con la ventana ya
  // "fría", el id se aprende hasta 15 s tarde; las rutas con prompt lo reparan.
  if (sessionFilesBefore) {
    let detectDelay = 2000
    let detectTicks = 0
    const detectTick = () => {
      const s = sessions.get(myWcId)
      if (!s || !s.pty || s.pty !== proc) return
      if (s.claudeSessionId) return
      const sid = findUpdatedOrNewClaudeSessionId(s.gitWorkspace?.workCwd || s.cwd, sessionFilesBefore)
      if (sid) {
        s.claudeSessionId = sid
        if (s.gitWorkspace) sessionGitMap.recordActive({
          claudeSessionId: sid,
          realCwd: s.gitWorkspace.realCwd,
          branch: s.gitWorkspace.branch,
          worktreePath: s.gitWorkspace.worktreePath
        })
        return
      }
      detectTicks += 1
      if (detectTicks >= 30) detectDelay = Math.min(15000, Math.round(detectDelay * 1.5))
      setTimeout(detectTick, detectDelay)
    }
    setTimeout(detectTick, detectDelay)
  }

  // Gemelo del anterior para la sesión resumida: aquí el id no está vacío, está
  // PODRIDO. Se busca el .jsonl que no existía antes del spawn y no es el
  // resumido; sin prompt con el que verificar no hay otra señal (donde sí lo
  // hay, manda `detectForkedRelayTranscript`). Ventana acotada: si en 60 s no
  // apareció, no lo hará.
  if (forkScanBefore) {
    let intentos = 0
    const detectFork = setInterval(() => {
      const s = sessions.get(myWcId)
      if (!s || !s.pty || s.pty !== proc || intentos >= 30) { clearInterval(detectFork); return }
      intentos += 1
      // Si ya lo arregló otro camino (relay, modo voz), no hay nada que hacer.
      if (s.claudeSessionId !== resumedClaudeId) { clearInterval(detectFork); return }
      // Con un sub-chat vivo NO se adopta nada, aunque el candidato sea único:
      // `--fork-session` escribe un .jsonl nuevo en estos mismos proyectos y,
      // si la madre aún no ha escrito nada, es el ÚNICO fichero nuevo — la
      // guarda de ambigüedad no lo tapa y la madre acabaría adoptando el id de
      // su propio sub-chat (y `recordActive` guardándolo contra su worktree).
      // El sub-chat aprende su id por su cuenta, pero tarda hasta 1 s en
      // saberlo: esto cubre ese hueco y el de cualquier sub-chat de otra ventana.
      if (subchatManager.hasAny()) {
        // Y además se refresca la foto: lo que hay en disco AHORA deja de ser
        // "nuevo". Sin esto, al cerrar el sub-chat su .jsonl seguía contando
        // como candidato y la madre acababa adoptando el id de un sub-chat ya
        // muerto. Cubre también al sub-chat que nunca llegó a aprender su id.
        // Precio consciente: si el fork propio de la madre nació en esta misma
        // ventana, se absorbe y ya no se adoptará por esta vía — el id se
        // repara en el primer turno con prompt, que es la ruta fiable.
        for (const cwd of forkScanBefore.keys()) {
          try { forkScanBefore.set(cwd, snapshotClaudeSessions(cwd)) } catch {}
        }
        return
      }
      // Los proyectos candidatos se miran JUNTOS: si aparecen dos ficheros
      // nuevos entre todos, hay otro actor en juego y no se adopta ninguno.
      const groups = []
      for (const [cwd, before] of forkScanBefore) {
        groups.push({ rows: listClaudeSessionFilesWithMtime(cwd), before })
      }
      const sid = pickForkedSessionId({
        groups,
        excludeIds: [resumedClaudeId, ...knownClaudeSessionIds()]
      })
      if (!sid) return
      s.claudeSessionId = sid
      if (s.gitWorkspace) sessionGitMap.recordActive({
        claudeSessionId: sid,
        realCwd: s.gitWorkspace.realCwd,
        branch: s.gitWorkspace.branch,
        worktreePath: s.gitWorkspace.worktreePath
      })
      clearInterval(detectFork)
    }, 2000)
  }

  proc.onData((data) => {
    if (!proc._alive) return
    const s = sessions.get(myWcId)
    if (s) trackPtyLoadForGraph(s)
    try { cliUpdateWatcher.observe(myWcId, data) } catch {}
    try { s?.codexCwdPrompt?.feed(data) } catch {}
    // Relay (Telegram) recibe data sin batching para no romper la detección de
    // marcadores de fin de turno.
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
    // PERF-H6: batching de pty-data hacia el renderer. Flush a ~16ms (60fps) o
    // cuando acumulamos ≥8KB. Multi-PTY ya no satura el IPC con miles de
    // mensajes pequeños/turno.
    enqueuePtyData(s, data)
  })

  proc.onExit(() => {
    // PERF-H6: vaciar el buffer pendiente antes de mandar pty-exit.
    const sBeforeExit = sessions.get(myWcId)
    if (sBeforeExit) { try { flushPtyData(sBeforeExit) } catch {} }
    const s = sessions.get(myWcId)
    // El CLI acaba de autoactualizarse y se ha cerrado pidiendo reinicio: no es
    // fin de sesión, así que relanzamos en vez de avisar al renderer.
    const restartAfterUpdate = !!proc._alive && !!s && s.pty === proc &&
      cliUpdateWatcher.takeRestart(myWcId)
    if (proc._alive && !restartAfterUpdate) {
      if (s && s.win && !s.win.isDestroyed()) s.win.webContents.send('pty-exit')
    }
    if (s && s.pty === proc) {
      try { subchatManager.close(s.wcId, 'parent-pty-closed') } catch {}
      releaseVoiceMode(s.wcId)
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
    if (restartAfterUpdate) respawnAfterCliUpdate(myWcId)
  })

  if (session === sessions.get(primaryWcId)) updatePrimarySnapshot()
  return proc
}

function killPty(session) {
  if (!session) return
  try { subchatManager.close(session.wcId, 'parent-pty-closed') } catch {}
  releaseVoiceMode(session.wcId)
  try { cliUpdateWatcher.forget(session.wcId) } catch {}
  if (!session.pty) return
  logSemanticForSession(session, 'pty_fin', {
    detail: `cwd=${session.cwd || ''}`,
    ok: true
  })
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
  finalizeWorkspaceForSession(s)
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
    minWidth: 640,
    minHeight: 420,
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
  const activeProfile = getActiveProfile()
  const profileCwd = resolveExistingDir(activeProfile.cwd) || os.homedir()
  const session = {
    win,
    wcId,
    ordinal,
    pty: null,
    cols: 120,
    rows: 35,
    cwd: profileCwd,
    activeCli: appConfig.cli.defaultCli === 'codex' ? 'codex' : 'claude',
    profileId: activeProfile.id,
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
    graphBuildPromise: null,
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
    if (win.isDestroyed()) return
    win.webContents.send('telegram-status', telegramBridge?.getStatus() || null)
    syncPendingProposalToWindow(win)
    if (autoUpdateState.available) win.webContents.send('update:available')
    if (autoUpdateState.downloaded) win.webContents.send('update:downloaded')
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

// ── Tasks Manager (singleton) ──
let tasksScheduler = null
let delegationManager = null
let tasksInbox = null
let sessionLinks = null
let recentCwds = null
let kbPrefs = null
let lastContext = null
let sessionGit = null
let sessionGitMap = null
const pendingFinalizes = new Set()
// Guarda de reentrada para el finalize en before-quit: cuando esperamos a las
// integraciones git pendientes hacemos preventDefault + app.quit(), lo que vuelve
// a disparar before-quit; esta bandera deja pasar ese segundo disparo sin repetir.
let quitFinalizeHandled = false
let claudeSessionsIndex = null
let codexSessionsIndex = null
let automationManager = null
let automationChat = null
let cwdHistoryCache = []
// Una ventana de chat por automation.
const chatWindows = new Map() // automationId → BrowserWindow
const chatWcToAutomation = new Map() // wcId → automationId

const windowFactory = createWindowFactory({
  BrowserWindow,
  nativeTheme,
  app,
  getPrimaryWin: () => primaryWcId != null ? sessions.get(primaryWcId)?.win : null,
  getRootDir: () => __dirname
})
const openViewerWindow = windowFactory.openViewerWindow
const openTasksManager = windowFactory.openTasksManager
const openBitacoraWindow = windowFactory.openBitacoraWindow

function broadcastToAllWindows(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try { win.webContents.send(channel, payload) } catch {}
    }
  }
}

function notifyUpdateAvailable() {
  autoUpdateState.available = true
  broadcastToAllWindows('update:available')
}

function notifyUpdateDownloaded() {
  autoUpdateState.available = true
  autoUpdateState.downloaded = true
  broadcastToAllWindows('update:downloaded')
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

const AGENT_BUFFER_MAX = 200_000
const AGENT_BOOT_DELAY_MS = 3500

const {
  proposalPaths,
  ensureProposalDir,
  clearProposalFromDisk,
  readProposalFromDisk
} = createProposalFiles(AGENT_PROPOSAL_BASE)

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
  lines.push('   - NO necesitas pedir permiso para Write — la app acepta ediciones en este flujo y mantiene el resto de controles.')
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
    proc = pty.spawn('/bin/bash', ['-c', buildFdLimitCommand(cliCheck.bin, buildClaudeLocalArgs(session.activeCli, null))], {
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

// ── Task session popup (claude/codex --resume <sessionId> en ventana propia) ──
// Una ventana por sessionId. Si ya hay ventana abierta para ese sessionId, focus.
const taskSessionWindowsBySessionId = new Map() // sessionId → BrowserWindow
const taskSessionStateByWc = new Map()          // wcId → TaskSessionState

function resolveTaskSessionCwd(sessionId, providedCwd) {
  const safe = (p) => (typeof p === 'string' && p.trim()) ? p.trim() : ''
  const candidate = safe(providedCwd)
  if (candidate) {
    try { if (fs.statSync(candidate).isDirectory()) return candidate } catch {}
  }
  try {
    const projectsRoot = path.join(os.homedir(), '.claude', 'projects')
    if (!fs.existsSync(projectsRoot)) return os.homedir()
    const dirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
    for (const dir of dirs) {
      const file = path.join(projectsRoot, dir, `${sessionId}.jsonl`)
      if (!fs.existsSync(file)) continue
      try {
        const raw = fs.readFileSync(file, 'utf8')
        const nl = raw.indexOf('\n')
        const firstLine = nl >= 0 ? raw.slice(0, nl) : raw
        const obj = JSON.parse(firstLine)
        const cwd = safe(obj?.cwd)
        if (cwd) {
          try {
            if (fs.statSync(cwd).isDirectory()) return cwd
          } catch {
            // cwd no existe en disco (p.ej. worktree borrado tras finalizar
            // la sesión) — si sabemos a qué cwd real pertenecía, usarlo.
            try {
              const entry = sessionGitMap?.lookupByWorktreePath(cwd)
              if (entry && entry.realCwd) return entry.realCwd
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}
  return os.homedir()
}

async function openTaskSessionWindow({ sessionId, cwd, cli, taskName, hidden = false, chatId = '' } = {}) {
  if (!sessionId || typeof sessionId !== 'string') return null
  if (!isValidSessionId(sessionId)) return null
  const normalizedChat = chatId ? String(chatId) : ''

  const existing = taskSessionWindowsBySessionId.get(sessionId)
  if (existing && !existing.isDestroyed()) {
    const existingState = taskSessionStateByWc.get(existing.webContents.id)
    // PTY-H4: si la ventana existente ya pertenece a OTRO chat de Telegram,
    // no la reusamos — abriríamos un wcId compartido y un evict de uno
    // arrastraría al otro. Cada chat tiene su propia ventana.
    const existingChat = existingState?.telegramChatId || ''
    const chatConflict = normalizedChat && existingChat && existingChat !== normalizedChat
    if (!chatConflict) {
      if (!hidden) {
        if (existingState) existingState.hidden = false
        if (existing.isMinimized()) existing.restore()
        existing.show()
        existing.focus()
      }
      if (existingState && normalizedChat && !existingState.telegramChatId) {
        existingState.telegramChatId = normalizedChat
      }
      return existing
    }
  }

  const targetCli = cli === 'codex' ? 'codex' : 'claude'
  const targetCwd = resolveTaskSessionCwd(sessionId, cwd)
  const targetTaskName = typeof taskName === 'string' ? taskName : ''

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
    title: targetTaskName ? `Sesión — ${targetTaskName}` : 'Sesión — POWER-AGENT',
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: initialTheme === 'light' ? '#f7f7fa' : '#1a1a1d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'task-session-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const wcId = win.webContents.id
  const taskState = {
    win,
    wcId,
    sessionId,
    initialSessionId: sessionId,
    cwd: targetCwd,
    cli: targetCli,
    activeCli: targetCli,
    claudeSessionId: targetCli === 'claude' ? sessionId : null,
    codexSessionId: targetCli === 'codex' ? sessionId : null,
    relayActive: false,
    relayListener: null,
    relayCancel: null,
    hidden: !!hidden,
    telegramChatId: normalizedChat,
    taskName: targetTaskName,
    theme: initialTheme,
    cols: 120,
    rows: 35,
    pty: null,
    detectIntervalId: null,
    sessionFilesSnapshot: null
  }
  taskSessionStateByWc.set(wcId, taskState)
  taskSessionWindowsBySessionId.set(sessionId, win)

  win.loadFile('task-session.html', { query: { theme: initialTheme, sid: sessionId } })
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    const s = taskSessionStateByWc.get(wcId)
    if (s && s.hidden) return
    win.show()
  })
  win.on('closed', () => {
    const s = taskSessionStateByWc.get(wcId)
    if (s) killTaskSessionPty(s)
    taskSessionStateByWc.delete(wcId)
    try { unbindRelaySessionsByWcId(wcId) } catch {}
    try { telegramHiddenPtyPool?.notifyWindowClosed?.(wcId) } catch {}
    if (taskSessionWindowsBySessionId.get(taskState.initialSessionId) === win) {
      taskSessionWindowsBySessionId.delete(taskState.initialSessionId)
    }
    if (taskSessionWindowsBySessionId.get(taskState.sessionId) === win) {
      taskSessionWindowsBySessionId.delete(taskState.sessionId)
    }
  })
  return win
}

function killTaskSessionPty(s) {
  if (!s) return
  if (s.detectIntervalId) { try { clearInterval(s.detectIntervalId) } catch {} ; s.detectIntervalId = null }
  if (!s.pty) return
  try { s.pty._alive = false } catch {}
  try { s.pty.kill() } catch {}
  s.pty = null
}

function startTaskSessionPty(s) {
  if (!s) throw new Error('Sesión no disponible')
  if (s.pty) return s.pty
  const cliCheck = ensureCliAvailable(s.cli)
  if (!cliCheck.ok) {
    if (s.win && !s.win.isDestroyed()) {
      s.win.webContents.send('task-session:error', { error: cliCheck.error })
    }
    throw new Error(cliCheck.error)
  }

  const args = buildClaudeLocalArgs(s.cli, s.sessionId)

  // Foto pre-spawn para el vigía de fork (solo claude). Incluye el proyecto
  // ORIGINAL del id resumido: ahí es donde aparecerá el .jsonl forkeado.
  s.sessionFilesSnapshot = s.cli === 'claude'
    ? taskSessionForkWatch.begin({ cwd: s.cwd, resumedSessionId: s.sessionId })
    : null

  let proc
  try {
    proc = pty.spawn('/bin/bash', ['-c', buildFdLimitCommand(cliCheck.bin, args)], {
      name: 'xterm-256color',
      cols: s.cols || 120,
      rows: s.rows || 35,
      cwd: s.cwd || os.homedir(),
      env: cliCheck.env
    })
  } catch (err) {
    const msg = `No se pudo iniciar ${cliCheck.name}: ${err.message || err}`
    if (s.win && !s.win.isDestroyed()) {
      s.win.webContents.send('task-session:error', { error: msg })
    }
    throw new Error(msg)
  }

  proc._alive = true
  s.pty = proc
  const myWcId = s.wcId

  if (s.cli === 'claude' && s.sessionFilesSnapshot) {
    const detect = setInterval(() => {
      const st = taskSessionStateByWc.get(myWcId)
      if (!st || !st.pty || st.pty !== proc) { clearInterval(detect); return }
      const sid = taskSessionForkWatch.tick(st.sessionFilesSnapshot)
      if (sid && sid !== st.sessionId) {
        const prev = st.sessionId
        st.sessionId = sid
        // Mantener claudeSessionId sincronizado con la rotación: relayThroughPty
        // lo usa para localizar el transcript actual y armar preferredSessionId.
        if (st.activeCli === 'claude' || st.cli === 'claude') st.claudeSessionId = sid
        try { telegramHiddenPtyPool?.notifySessionRotated?.(myWcId, sid, st.activeCli || st.cli) } catch {}
        try { st.win?.webContents.send('task-session:session-id-updated', { sessionId: sid, previous: prev }) } catch {}
        if (taskSessionWindowsBySessionId.get(prev) === st.win) {
          taskSessionWindowsBySessionId.delete(prev)
        }
        taskSessionWindowsBySessionId.set(sid, st.win)
        persistTaskSessionIdRotation(st.initialSessionId, sid).catch((err) => {
          console.warn('[task-session] no se pudo persistir nuevo sessionId:', err?.message || err)
        })
        clearInterval(detect)
        st.detectIntervalId = null
      }
    }, 2000)
    s.detectIntervalId = detect
  }

  proc.onData((data) => {
    if (!proc._alive) return
    const st = taskSessionStateByWc.get(myWcId)
    if (!st) return
    const text = typeof data === 'string' ? data : data.toString('utf8')
    // CRÍTICO: alimentar al relay PTY de Telegram cuando este task-session
    // está enlazado a un chat (pool oculto). Sin esto, relayThroughPty nunca
    // detecta output ⇒ RelayNoOutput ⇒ "falló la lectura de respuesta del PTY".
    if (st.relayListener) {
      try { st.relayListener(text) } catch {}
    }
    if (!st.win || st.win.isDestroyed()) return
    st.win.webContents.send('task-session:data', text)
  })

  proc.onExit(() => {
    if (proc._alive) {
      const st = taskSessionStateByWc.get(myWcId)
      if (st && st.win && !st.win.isDestroyed()) st.win.webContents.send('task-session:exit')
    }
    const st = taskSessionStateByWc.get(myWcId)
    if (st && st.pty === proc) {
      // Cancela relay activo si lo hubiera, para que Telegram no se quede colgado.
      if (typeof st.relayCancel === 'function') {
        const err = new Error('PTY cerrado')
        err.name = 'RelayPtyClosed'
        try { st.relayCancel(err) } catch {}
      }
      st.pty = null
      if (st.detectIntervalId) { try { clearInterval(st.detectIntervalId) } catch {} ; st.detectIntervalId = null }
    }
    // PTY-H3: notificar al pool que el PTY murió. Sin esto, el pool cree que sigue
    // sano hasta TTL (15min) y /abrir o el sink podrían reusar una ventana zombie.
    if (telegramHiddenPtyPool) {
      try { telegramHiddenPtyPool.notifyPtyExit(myWcId) } catch {}
    }
  })

  return proc
}

async function persistTaskSessionIdRotation(originalSessionId, newSessionId) {
  if (!tasksScheduler || !originalSessionId || !newSessionId) return
  if (originalSessionId === newSessionId) return
  let tasks = []
  try { tasks = await tasksScheduler.persistence.loadTasks() } catch { return }
  if (!Array.isArray(tasks)) return
  const matches = tasks.filter(t => t && t.sessionId === originalSessionId)
  if (!matches.length) return
  for (const t of matches) {
    try {
      await tasksScheduler.persistence.updateTask(t.id, { sessionId: newSessionId })
    } catch (err) {
      console.warn('[task-session] updateTask falló para', t.id, err?.message || err)
    }
  }
}

// ── Bridge wiring (one global bridge) ──
// Enganche de la sesión de un run de tarea al chat: persistir sid en el bridge
// y (solo claude) asegurar PTY oculto en el pool. Compartido por la ruta legacy
// del sink telegram y por el botón «Continuar esta sesión» del bot de avisos.
async function ensureHiddenPtyForTaskRun({ chatId, sessionId, cli, cwd, taskName }) {
  if (!telegramHiddenPtyPool) return { ok: false, error: 'pool no inicializado' }
  const isClaude = cli === 'claude'
  const cliKey = (cli === 'codex') ? 'codex' : 'claude'
  // PTY-H2: persistimos sid en el bridge SIEMPRE (también Codex). Sin esto,
  // el siguiente mensaje del usuario por Telegram a una sesión Codex pierde
  // contexto (sid==null → sesión nueva). El pool oculto solo aplica a Claude;
  // Codex sigue en headless --resume estable.
  if (sessionId && telegramBridge && typeof telegramBridge.adoptSession === 'function') {
    try { telegramBridge.adoptSession(String(chatId), cliKey, sessionId) } catch {}
  }
  if (!isClaude) return { ok: true, skipped: true, reason: 'cli-not-claude' }
  const res = await telegramHiddenPtyPool.ensureHiddenPtyForChat({ chatId, sessionId, cli, cwd, taskName })
  return res
}

// Bot de avisos separado: lifecycle completo (crear/parar) según config.
// Sin token configurado no existe y el sink cae a la ruta legacy (fail-open).
function applyTelegramNotifyBot() {
  const token = appConfig.telegram?.notifyBotToken || ''
  if (telegramNotifyBot) {
    const bot = telegramNotifyBot
    telegramNotifyBot = null
    try { bot.stop() } catch {}
  }
  if (!token) return
  telegramNotifyBot = createTelegramNotifyBot({
    token,
    stateDir: app.getPath('userData'),
    getAllowedUsers: () => appConfig.telegram?.allowedUsers || [],
    onContinueSession: async ({ chatId, sessionId, cli, cwd, taskName }) => {
      // Binding EXPLÍCITO pedido por el usuario desde el aviso: además del
      // pool, dejamos el run como "último" del chat para que /abrir funcione.
      if (telegramBridge && typeof telegramBridge.rememberRunForChat === 'function') {
        try { telegramBridge.rememberRunForChat(String(chatId), { sessionId, cli, cwd, taskName }) } catch {}
      }
      return ensureHiddenPtyForTaskRun({ chatId, sessionId, cli, cwd, taskName })
    },
    // Turno escrito en el chat de avisos tras «Continuar»: mismo enrutado que
    // un mensaje del bot principal (binding → PTY oculto > headless --resume),
    // pero la respuesta vuelve por el bot de avisos.
    onUserReply: async ({ chatId, text, session }) => {
      if (!telegramBridge || typeof telegramBridge.onRunQuery !== 'function') {
        return { ok: false, text: 'El bridge principal no está disponible.' }
      }
      feedRepeatedPromptDetector(text, 'avisos')
      const cli = (session?.cli === 'codex') ? 'codex' : 'claude'
      const sid = (typeof telegramBridge.getSessionId === 'function' && telegramBridge.getSessionId(String(chatId), cli)) || session?.sessionId || null
      let acc = ''
      const result = await telegramBridge.onRunQuery({
        cli,
        prompt: text,
        userPrompt: text,
        chatId: String(chatId),
        sessionId: sid,
        chatCwd: session?.cwd || undefined,
        onText: (t) => { acc += t }
      })
      if (result?.sessionId && typeof telegramBridge.adoptSession === 'function') {
        try { telegramBridge.adoptSession(String(chatId), cli, result.sessionId) } catch {}
      }
      return { ok: true, text: acc || result?.text || '' }
    }
  })
  telegramNotifyBot.start()
}

function initTelegramBridge() {
  telegramBridge = new TelegramBridge({
    tmpDir: TMP_DIR,
    stateDir: app.getPath('userData'),
    // Emparejamiento por código: el desconocido recibe un código de 6 dígitos
    // y Luismi lo aprueba en Configuración → Telegram. El manager reutiliza el
    // código pendiente del mismo usuario, así que solo se notifica al crearlo.
    // /doctor desde el móvil: el mismo chequeo de las 8:00, a demanda.
    onRunDoctor: async () => {
      if (!healthWatchdog) return { ok: false, error: 'el doctor no está arrancado' }
      return healthWatchdog.runOnce({ force: true, quiet: true })
    },
    // Late binding: scheduler y automationManager se crean DESPUÉS de este
    // bridge (mismo patrón que getNotifyBot en los sinks).
    onListTasks: async () => {
      if (!tasksScheduler?.persistence) return []
      const tasks = await tasksScheduler.persistence.loadTasks()
      return (tasks || []).map((t) => ({ id: t.id, name: t.name, enabled: t.enabled }))
    },
    onRunTaskNow: async (taskId) => {
      if (!tasksScheduler) return { ok: false, error: 'el scheduler no está arrancado' }
      // Lo que puede fallar YA (tarea borrada, run en curso) se comprueba antes
      // de confirmar; runNow resuelve al ACABAR el run (minutos) y no se espera
      // — el resultado viaja por los sinks de la tarea, como un run programado.
      const task = await tasksScheduler.persistence.getTask(taskId)
      if (!task) return { ok: false, error: 'tarea no encontrada (¿borrada?)' }
      if (tasksScheduler.activeRuns.has(taskId)) return { ok: false, error: 'ya hay una ejecución en curso' }
      tasksScheduler.runNow(taskId).catch((err) => {
        console.warn('[telegram/tareas] runNow falló:', err?.message || err)
      })
      return { ok: true }
    },
    // Proyecto nuevo desde el bot: carpeta bajo la raíz de proyectos de Luismi.
    // Si ya existe no es error — se selecciona (el bridge avisa de que existía).
    onCreateProject: async (rawName) => {
      const check = sanitizeNewProjectName(rawName)
      if (!check.ok) return { ok: false, error: check.error }
      const root = path.join(os.homedir(), 'Desktop', 'LUISMI')
      const cwd = path.join(root, check.name)
      if (!path.resolve(cwd).startsWith(path.resolve(root) + path.sep)) {
        return { ok: false, error: 'nombre inválido' }
      }
      try {
        if (fs.existsSync(cwd)) return { ok: true, cwd, existed: true }
        fs.mkdirSync(cwd, { recursive: true })
        return { ok: true, cwd, existed: false }
      } catch (err) {
        return { ok: false, error: err?.message || 'no pude crear la carpeta' }
      }
    },
    onListAutomations: async () => {
      if (!automationManager) return []
      const autos = await automationManager.list()
      return (autos || []).map((a) => ({ id: a.id, name: a.name, slug: a.slug, status: a.status }))
    },
    onRunAutomationNow: async (automationId) => {
      if (!automationManager) return { ok: false, error: 'las automatizaciones no están arrancadas' }
      const autos = await automationManager.list()
      const auto = (autos || []).find((a) => a.id === automationId)
      if (!auto) return { ok: false, error: 'automatización no encontrada' }
      if (auto.status !== 'installed') return { ok: false, error: 'no está instalada' }
      automationManager.runOnce(automationId).then((res) => {
        if (res?.ok === false) console.warn('[telegram/autos] runOnce falló:', res.error || res)
      }).catch((err) => {
        console.warn('[telegram/autos] runOnce falló:', err?.message || err)
      })
      return { ok: true }
    },
    onPairingRequest: ({ userId, chatId, username, firstName }) => {
      const res = telegramPairing.requestPairing({ userId, chatId, username, firstName })
      if (res.ok && res.created) {
        const who = username ? `@${username}` : (firstName || userId)
        notifyNative({
          title: 'Telegram: solicitud de vinculación',
          body: `${who} pide acceso — código ${res.code}. Apruébalo en Configuración → Telegram.`
        })
        broadcastTelegramPairing()
      }
      return res
    },
    onTranscribeFile: async (filePath) => {
      return transcribeAudioFile(filePath, buildRuntimeEnv())
    },
    // Audio va, audio viene: la respuesta a una nota de voz vuelve como nota
    // de voz. El markdown pasa por el mismo filtro hablable del modo voz
    // (fuera código/diffs/tablas, tope 2000); si no queda nada que decir, se
    // devuelve null y el bridge manda el texto completo.
    onMakeVoiceNote: async (texto) => {
      const hablable = speakableFromMarkdown(texto)
      if (!hablable || !hablable.trim()) return null
      return voiceNoteMaker.makeVoiceNote(hablable)
    },
    onRunQuery: async (opts) => {
      const tg = appConfig.telegram || {}
      // Prioridad de cwd: proyecto elegido por el chat (/proyecto) > sesión
      // primaria de la app > homedir. Sin esto, tras un arranque limpio el
      // headless corría en homedir y `--resume` no encontraba el transcript.
      const chatCwd = resolveExistingDir(opts?.chatCwd)
      const cwd = chatCwd || getCwdSync()
      const binding = getRelayBindingForChat(opts?.chatId)
      const boundCli = binding.bound ? binding.session?.activeCli : null
      const targetCli = (boundCli === 'claude' || boundCli === 'codex')
        ? boundCli
        : (opts?.cli === 'codex' ? 'codex' : 'claude')
      // PTY-H1: refrescar TTL del pool cuando hay tráfico real en el chat.
      // Sin esto, una conversación viva muere al cumplir TTL desde la creación.
      if (binding.bound && telegramHiddenPtyPool && opts?.chatId) {
        try { telegramHiddenPtyPool.touchHiddenPty(opts.chatId) } catch {}
      }

      // Regla: si el chat tiene sessionId persistida y NO hay binding explícito de relay PTY,
      // ir directo a headless --resume con esa sesión. Esto cubre tareas programadas y
      // cualquier comunicación Mac→Telegram que haya enlazado una sesión al chat.
      const hasExplicitSid = !binding.bound && typeof opts?.sessionId === 'string' && opts.sessionId.length > 0
      if (hasExplicitSid && targetCli === 'codex') {
        return runCodexHeadless({ ...opts, cli: 'codex', cwd, model: tg.codexModel || '', effort: tg.codexEffort || '', origin: 'telegram', securityMode: 'trusted' })
      }
      if (hasExplicitSid && targetCli === 'claude') {
        // El transcript manda: `--resume` solo funciona si el cwd del spawn
        // mapea al proyecto donde vive el <sessionId>.jsonl. Localizarlo por
        // sessionId, nunca adivinar por cwd (regla del relay, misma trampa).
        const resumeCwd = resolveResumeCwd(opts.sessionId) || cwd
        try {
          return await runClaudeHeadless({ ...opts, cwd: resumeCwd, model: tg.claudeModel || getClaudeModel(), effort: tg.claudeEffort || '', origin: 'telegram', securityMode: 'trusted' })
        } catch (err) {
          if (err?.name === 'AbortError' || !/no conversation found/i.test(String(err?.message || ''))) throw err
          // Sesión huérfana (transcript borrado o ilocalizable): mejor empezar
          // conversación nueva que devolver error para siempre. El sessionId
          // nuevo vuelve al bridge en el result y sustituye al muerto.
          console.warn('[telegram-headless] sessionId huérfano, arrancando conversación nueva:', opts.sessionId)
          return runClaudeHeadless({ ...opts, sessionId: null, cwd, model: tg.claudeModel || getClaudeModel(), effort: tg.claudeEffort || '', origin: 'telegram', securityMode: 'trusted' })
        }
      }

      if (targetCli === 'codex') {
        // Codex por Telegram se mantiene en ruta headless estable (resume por thread_id).
        // El relay PTY en Codex puede no delimitar fin de turno de forma consistente y provocar latencia/doble respuesta.
        return runCodexHeadless({ ...opts, cli: 'codex', cwd, model: tg.codexModel || '', effort: tg.codexEffort || '', origin: 'telegram', securityMode: 'trusted' })
      }

      // Telegram manda: con proyecto elegido desde el bot no se cae a las sesiones
      // abiertas en el Mac. Regla y motivo en shouldAllowMacSessionFallback().
      const allowMacFallback = shouldAllowMacSessionFallback({ bindingBound: binding.bound, chatCwd })
      const relaySession = pickRelaySessionForChat(opts?.chatId, allowMacFallback, 'claude')
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
          const reason = err?.name || err?.message || 'unknown'
          console.warn('[telegram-relay] PTY relay falló:', reason, binding.bound ? '(bound)' : '(fallback)')
          if (binding.bound) {
            const detail = describeRelayUnavailable(binding.session, 'claude')
            throw new Error(`Relay PTY enlazado falló (${reason}): ${detail}.`)
          }
        }
      }
      if (binding.bound) {
        throw new Error(`La sesión enlazada de Telegram no está disponible: ${describeRelayUnavailable(binding.session, 'claude')}.`)
      }

      return runClaudeHeadless({ ...opts, cwd, model: tg.claudeModel || getClaudeModel(), effort: tg.claudeEffort || '', origin: 'telegram', securityMode: 'trusted' })
    },
    onGetActiveCli: async () => getActiveCliSync(),
    onGetCwd: async () => getCwdSync(),
    onSetCli: async (cli) => {
      const s = primaryWcId != null ? sessions.get(primaryWcId) : null
      if (s) return setActiveCli(s, cli)
      // decision: sin ventana primaria, persiste como defaultCli y devuelve ok
      if (cli !== 'claude' && cli !== 'codex') return { ok: false, error: 'Invalid CLI' }
      saveAppConfig({
        ...appConfig,
        cli: { ...appConfig.cli, defaultCli: cli }
      })
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
    onGetTelegramModel: (cli) => (cli === 'codex' ? appConfig.telegram?.codexModel : appConfig.telegram?.claudeModel) || '',
    onSetTelegramModel: async ({ cli, model }) => {
      // Sin reiniciar el bridge: onRunQuery lee appConfig.telegram en cada
      // turno, así que el cambio aplica desde el mensaje siguiente.
      const field = cli === 'codex' ? 'codexModel' : 'claudeModel'
      saveAppConfig({
        ...appConfig,
        telegram: { ...appConfig.telegram, [field]: String(model || '') }
      })
      return { ok: true }
    },
    onGetLinkStatus: async ({ chatId }) => {
      const binding = getRelayBindingForChat(chatId)
      if (!binding.bound || !binding.session) return { bound: false }
      const s = binding.session
      return {
        bound: true,
        via: 'pty',
        cli: s.activeCli || 'claude',
        sessionId: s.claudeSessionId || s.codexSessionId || '',
        cwd: s.cwd || ''
      }
    },
    onStatus: () => broadcastTelegramStatus(),
    onSemanticInput: ({ chatId, cli, sessionId, prompt }) => {
      feedRepeatedPromptDetector(prompt, 'telegram')
      const charCount = String(prompt || '').length
      logSemantic('telegram_entrada', {
        session: sessionId || '',
        cli: cli || getActiveCliSync(),
        detail: `chat=${chatId || ''} chars=${charCount}`,
        ok: true
      })
    },
    onSemanticOutput: ({ chatId, cli, sessionId, ok, error }) => {
      logSemantic('telegram_salida', {
        session: sessionId || '',
        cli: cli || getActiveCliSync(),
        detail: ok === false
          ? `chat=${chatId || ''} error=${error || 'unknown'}`
          : `chat=${chatId || ''}`,
        ok: ok !== false
      })
    },
    onOpenTaskSession: async (payload) => {
      try {
        return await handleOpenTaskSession(payload, {
          isValidSessionId,
          normalizeTelegramChatKey,
          telegramHiddenPtyPool,
          taskSessionStateByWc,
          telegramRelayByChat,
          openTaskSessionWindow
        })
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
    },
    onListProjects: async () => {
      try { return recentCwds ? recentCwds.list({ pruneMissing: true }) : [] } catch { return [] }
    },
    onListSessions: async ({ cwd, cli } = {}) => {
      try {
        if (!cwd || looksRemotePath(cwd)) return []
        if (cli === 'codex') return listCodexSessionsForCwd(cwd, { limit: 12 })
        return listClaudeSessionsForCwd(cwd, { limit: 12 })
      } catch {
        return []
      }
    }
  })
}

const codexSessionReader = createCodexSessionReader({
  historyPath: CODEX_HISTORY_PATH,
  sessionIndexPath: CODEX_SESSION_INDEX_PATH,
  stateDbPath: CODEX_STATE_DB_PATH
})
const {
  loadCodexHistoryRows,
  loadCodexSessionIndexMap,
  readCodexStateThreadMeta,
  guessCodexSessionFromHistory,
  fileCacheKey
} = codexSessionReader

const _sessionCache = createClaudeSessionCache({
  resolveClaudeProjectDir,
  listClaudeSessionFilesWithMtime,
  extractTurnText,
  clipText,
  safeStat,
  statCacheKey,
  codexSessionReader,
  CODEX_HISTORY_PATH,
  CODEX_SESSION_INDEX_PATH,
  CODEX_STATE_DB_PATH,
  PERF
})
const {
  currentSessionMetaCache,
  rememberClaudeSessionTitle,
  forgetClaudeSessionTitle,
  readClaudeSessionTitle,
  buildCurrentSessionMeta
} = _sessionCache

const sessionModelReader = createSessionModelReader()

// Etiqueta de modelo para la tira de sesión. Verdad = transcript/rollout
// (un /model a mitad de sesión se refleja en el turno siguiente); sin turno
// todavía, el --model del spawn. Se PINTA, jamás se persiste en la sesión.
function resolveSessionModelLabel(session, meta) {
  if (!meta) return ''
  if (meta.cli === 'codex') {
    const ctx = sessionModelReader.readCodexSessionModel(meta.sessionId)
    if (ctx?.model) return ctx.effort ? `${ctx.model} · ${ctx.effort}` : ctx.model
    return ''
  }
  const fromTranscript = sessionModelReader.readClaudeSessionModel(meta.path)
  if (fromTranscript) return shortClaudeModel(fromTranscript)
  const args = Array.isArray(session?.lastPtyArgs) ? session.lastPtyArgs : []
  const i = args.indexOf('--model')
  const argModel = i >= 0 ? String(args[i + 1] || '').trim() : ''
  if (argModel && !argModel.startsWith('--')) return shortClaudeModel(argModel)
  return ''
}

function resolveSessionIdForRelay(session) {
  if (!session) return null
  const cli = session.activeCli === 'codex' ? 'codex' : 'claude'
  // Regla dura (bug real 2026-08-07, `6956fd5`): un id ADIVINADO ("última
  // .jsonl por mtime" / historial) se devuelve para este uso puntual pero NO
  // se persiste en la sesión — el campo relleno paraba al vigía de startPty y
  // la sesión quedaba envenenada para siempre. El relay se auto-repara por
  // prompt si la adivinanza era mala; el campo lo escriben solo el spawn, los
  // vigías o el relay verificando.
  if (cli === 'claude') {
    if (session.claudeSessionId) return session.claudeSessionId
    const latest = listClaudeSessionFilesWithMtime(resolveRelayCwd(session))[0]
    return latest?.sessionId || null
  }
  if (session.codexSessionId) return session.codexSessionId
  const guess = guessCodexSessionFromHistory(session)
  return guess?.sessionId || null
}

// La compactación "últimos 20 turnos" (compactClaudeSessionIfNeeded) se retiró
// el 2026-08-08: con >30 turnos tiraba el sessionId y arrancaba conversación
// NUEVA con los turnos pegados como texto — la conversación real quedaba
// huérfana y abrirla luego en la CLI mostraba solo esos 20 turnos. El headless
// resume siempre la sesión real; de los contextos largos se ocupa claude.

const { runClaudeHeadless, runCodexHeadless } = createHeadlessRunners({
  cliMeta,
  buildRuntimeEnv,
  commandExists,
  buildFdLimitCommand,
  getCwdSync,
  // SEC-H7: auditoría semántica de cada invocación headless (prompt_hash, origin, sessionId).
  onAuditEvent: (event) => {
    try { logSemantic(event.action, event) } catch {}
  }
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

// Endurecimiento global de navegación: la app es 100% local (todo loadFile,
// cero loadURL/webview). Cualquier window.open — p.ej. un enlace clicado en el
// terminal vía WebLinksAddon — se abre en el navegador del sistema, nunca en
// una BrowserWindow nueva; y ninguna ventana puede navegar fuera de file://.
app.on('web-contents-created', (_event, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { try { shell.openExternal(url) } catch {} }
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => {
    if (/^file:/i.test(url)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) { try { shell.openExternal(url) } catch {} }
  })
})

app.whenReady().then(async () => {
  appConfig = loadAppConfig()

  // Persona viva: fichero de estado + env heredada por todos los spawns.
  // Debe ir ANTES de cualquier ensureCliAvailable (su env parte de process.env).
  process.env.POWERAGENT_PERSONA_FILE = syncActivePersonaFile()

  // Autorizar getUserMedia (micro) y disparar prompt TCC nativo de macOS
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') return callback(true)
    callback(true)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)
  // PERF-H3: askForMediaAccess sin await. TCC de macOS puede tardar seg/min en
  // responder y bloqueaba el overlay "Elige proyecto". Best-effort fire-and-forget.
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone')
      .then((ok) => console.log('[mic] askForMediaAccess →', ok))
      .catch((err) => console.log('[mic] askForMediaAccess error:', err?.message || err))
  }

  buildAppMenu()
  telegramHiddenPtyPool = createTelegramHiddenPtyPool({
    openWindow: (args) => openTaskSessionWindow(args),
    startPty: (state) => startTaskSessionPty(state),
    getTaskState: (wcId) => taskSessionStateByWc.get(wcId) || null,
    closeWindow: (wcId) => {
      const st = taskSessionStateByWc.get(wcId)
      if (!st) return
      const win = st.win
      try {
        if (win && typeof win.isDestroyed === 'function' && !win.isDestroyed()) {
          win.close()
        }
      } catch {}
    },
    bindRelay: (chatId, wcId) => { telegramRelayByChat.set(String(chatId), wcId) },
    unbindRelay: (chatId, wcId) => {
      const key = String(chatId)
      const currentWcId = telegramRelayByChat.get(key)
      if (wcId == null || currentWcId === wcId) {
        telegramRelayByChat.delete(key)
      }
    },
    log: (event, data) => {
      if (process.env.POWERAGENT_TG_POOL_DEBUG === '1') {
        try { console.log('[tg-pool]', event, data) } catch {}
      }
    }
  })
  initTelegramBridge()
  try { applyTelegramNotifyBot() } catch (err) { console.warn('[telegram-notify] no arrancó:', err?.message || err) }

  // Doctor diario in-app: chequeo de salud una vez al día, aviso por el bot
  // de avisos (o notificación nativa si no hay bot) SOLO si hay problemas.
  try {
    healthWatchdog = createHealthWatchdog({
      collect: () => collectHealthSnapshot(primaryWcId != null ? sessions.get(primaryWcId) : null),
      notify: async (text) => {
        const tg = appConfig.telegram || {}
        const chatId = tg.notifyChatId || (Array.isArray(tg.allowedUsers) ? tg.allowedUsers[0] : null)
        if (telegramNotifyBot && chatId) {
          const res = await telegramNotifyBot.sendTaskNotification({ chatId, text })
          if (res?.ok) return
        }
        notifyNative({ title: 'POWER-AGENT · doctor', body: text.slice(0, 200) })
      },
      isEnabled: () => appConfig.telegram?.healthWatchdog !== false,
      log: (m) => console.warn('[doctor]', m)
    })
    healthWatchdog.start()
  } catch (err) {
    console.warn('[doctor] no arrancó:', err?.message || err)
  }

  createWindow()
  startAgentProposalPolling()
  if (appConfig?.lanServer?.enabled) {
    startLanServer({ port: appConfig.lanServer.port, persist: false }).catch((err) => {
      console.warn('[lan] auto-start failed:', err?.message || err)
    })
  }

  try {
    ({ autoUpdater } = require('electron-updater'))
    autoUpdater.on('update-available', () => {
      notifyUpdateAvailable()
    })
    autoUpdater.on('update-downloaded', () => {
      notifyUpdateDownloaded()
    })
    Promise.resolve(autoUpdater.checkForUpdatesAndNotify()).catch((err) => {
      console.warn('[updater] check failed:', err?.message || err)
    })
  } catch (err) {
    autoUpdater = null
    console.warn('[updater] electron-updater not available:', err?.message || err)
  }

  telegramBridge.applyConfig(appConfig.telegram).catch((err) => {
    const s = primaryWcId != null ? sessions.get(primaryWcId) : null
    notifyPtyError(s, `Error iniciando Telegram bridge: ${err?.message || err}`)
  })

  try {
    const persistence = createPersistence({ userDataDir: app.getPath('userData') })
    const executor = createExecutor({
      runClaudeHeadless,
      runCodexHeadless,
      appConfig,
      userDataDir: app.getPath('userData')
    })
    tasksInbox = createInbox({ userDataDir: app.getPath('userData') })
    const broadcastInbox = (channel, payload) => {
      try {
        for (const w of BrowserWindow.getAllWindows()) {
          if (w && !w.isDestroyed()) {
            try { w.webContents.send(channel, payload) } catch {}
          }
        }
      } catch {}
    }
    const baseSinks = createSinks({
      telegramBridge,
      broadcastToAllWindows,
      onEnsureHiddenPty: ensureHiddenPtyForTaskRun,
      // Late binding: el notify bot se (re)crea al aplicar config, después de
      // crear los sinks. Mismo patrón que los índices de createSessionListing.
      getNotifyBot: () => telegramNotifyBot,
      getNotifyChatId: () => appConfig.telegram?.notifyChatId || null
    })
    const inboxSink = createInboxSink({ inbox: tasksInbox, broadcast: broadcastInbox })
    const sinks = { ...baseSinks, inbox: inboxSink }
    tasksScheduler = new TaskScheduler({
      executor,
      sinks,
      persistence,
      broadcast: broadcastToAllWindows,
      preflight: preflightTask
    })
    tasksScheduler.persistence = persistence
    await tasksScheduler.init()
    sessionLinks = createSessionLinks({
      userDataDir: app.getPath('userData'),
      getTelegramSessionsByChat: null,
      getWhatsAppLinks: null
    })
    recentCwds = createRecentCwds({ userDataDir: app.getPath('userData') })
    kbPrefs = createKbPrefs({ userDataDir: app.getPath('userData') })
    lastContext = createLastContext({ userDataDir: app.getPath('userData') })
    try {
      sessionGitMap = createSessionGitMap({
        filePath: path.join(app.getPath('userData'), 'session-git-map.json'),
        atomicWriteJsonSync
      })
      sessionGit = createSessionGit({
        worktreesRoot: path.join(app.getPath('userData'), 'worktrees'),
        looksRemotePath,
        // Apagado global (toggle) O por carpeta (cli.gitIsolationExcludes):
        // el aislamiento sigue donde aporta y calla donde molesta.
        isEnabled: (realCwd) => {
          if (appConfig?.cli?.gitSessionIsolation === false) return false
          return !cwdExcludedFromIsolation(realCwd, appConfig?.cli?.gitIsolationExcludes || [])
        },
        resolveClaudeProjectDir,
        // El aislamiento se ha desactivado para esta sesión porque el
        // conocimiento del proyecto no llegó a HEAD: sin aviso, el usuario no
        // tiene forma de saber por qué su fichas/casos no cuadran con git.
        onDegraded: ({ realCwd, detail }) => notifyKbNotCommitted(realCwd, detail)
      })
      // Recuperación tras crash + barrido de huérfanos (fire-and-forget).
      // Al arrancar no hay ningún PTY vivo → toda entrada activa del registro
      // es huérfana por definición: integrarla (commit+merge) y marcarla
      // finalizada antes del sweep, que solo borra ramas ya mergeadas.
      const registered = Object.entries(sessionGitMap.all())
        .map(([claudeSessionId, e]) => ({ claudeSessionId, ...e }))
      const orphanEntries = registered.filter((e) => e.active)
      ;(async () => {
        // El registro solo conoce las sesiones que llegaron a generar un
        // claudeSessionId. Los worktrees que quedaron fuera se descubren en
        // disco (todo worktree presente al arrancar es huérfano).
        const discovered = await sessionGit.discoverUnregisteredWorkspaces({
          knownWorktreePaths: registered.map((e) => e.worktreePath).filter(Boolean)
        })
        const results = await sessionGit.recoverOrphanedWorkspaces({
          entries: [...orphanEntries, ...discovered]
        })
        for (const r of results || []) {
          try { sessionGitMap.markFinalized(r.claudeSessionId) } catch {}
        }
        await sessionGit.sweepOrphans({
          realCwds: [
            ...Object.values(sessionGitMap.all()).map((e) => e.realCwd),
            ...discovered.map((e) => e.realCwd)
          ]
        })
      })().catch((err) => console.warn('[session-git] recovery/sweep:', err?.message))
    } catch (err) {
      console.warn('[session-git] init failed:', err?.message || err)
      sessionGit = null
      sessionGitMap = null
    }
    try {
      delegationManager = createDelegationManager({
        userDataDir: app.getPath('userData'),
        maxConcurrent: 3,
        broadcast: broadcastToAllWindows,
        prepareWorkspace: ({ realCwd }) => sessionGit?.prepareSessionWorkspace({ realCwd }),
        finalizeWorkspace: (workspace) => sessionGit?.finalizeSessionWorkspace(workspace),
        runChild: ({ cli, ...opts }) => cli === 'codex'
          ? runCodexHeadless({ ...opts, origin: 'delegation' })
          : runClaudeHeadless({ ...opts, origin: 'delegation' })
      })
      await delegationManager.init()
    } catch (err) {
      console.warn('[delegation] init failed:', err?.message || err)
      delegationManager = null
    }
    try {
      claudeSessionsIndex = createClaudeSessionsIndex({ userDataDir: app.getPath('userData') })
    } catch (err) {
      console.error('[claude-sessions-index] init failed:', err?.message || err)
      claudeSessionsIndex = null
    }
    try {
      codexSessionsIndex = createCodexSessionsIndex({ userDataDir: app.getPath('userData') })
      if (codexSessionsIndex.isEmpty()) {
        codexSessionsIndex.bootstrap().catch((err) => {
          console.warn('[codex-index] bootstrap failed:', err?.message || err)
        })
      }
      codexSessionsIndex.startWatcher()
    } catch (e) {
      console.warn('[codex-index] init failed:', e?.message || e)
      codexSessionsIndex = null
    }
  } catch (err) {
    console.error('[tasks] scheduler init failed:', err?.message || err)
    tasksScheduler = null
    tasksInbox = null
    sessionLinks = null
  }

  try {
    automationManager = createAutomationManager({
      userDataDir: app.getPath('userData'),
      runClaudeHeadless,
      appConfig,
      telegramBridge,
      broadcast: broadcastToAllWindows,
      onSemanticEvent: (event) => {
        if (!event || !event.action) return
        logSemantic(event.action, {
          session: event.session || '',
          cli: event.cli || getActiveCliSync(),
          detail: event.detail || '',
          ok: event.ok !== false
        })
      }
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
      // Electron 25+: protocol.registerFileProtocol está deprecated → usar protocol.handle.
      protocol.handle(WA_MEDIA_PROTOCOL, (request) => {
        try {
          const u = new URL(request.url)
          const name = decodeURIComponent(u.hostname || u.pathname.replace(/^\/+/, ''))
          const safe = path.basename(name)
          const filePath = path.join(WA_MEDIA_DIR, safe)
          return net.fetch('file://' + filePath)
        } catch {
          return new Response(null, { status: 404 })
        }
      })
    } catch (err) {
      console.error('[whatsapp] protocol register failed:', err?.message || err)
    }

    whatsappClient = createWhatsAppClient({
      buildRuntimeEnv,
      transcribeAudio: (mediaPath) => transcribeAudioFile(mediaPath, buildRuntimeEnv()),
      onAutoReplySent: ({ jid, ok, mode, reason, text, error }) => {
        const chars = String(text || '').length
        const modeTag = mode ? ` mode=${mode}` : ''
        const reasonTag = reason ? ` reason=${reason}` : ''
        const errorTag = error ? ` error=${error}` : ''
        logSemantic('whatsapp_respuesta', {
          session: '',
          cli: 'claude',
          detail: `jid=${jid || ''}${modeTag}${reasonTag} chars=${chars}${errorTag}`,
          ok: ok !== false
        })
      }
    })
    whatsappClient.on('new-message', (payload) => broadcastToAllWindows('whatsapp:new-message', payload))
    whatsappClient.on('chat-updated', (payload) => broadcastToAllWindows('whatsapp:chat-updated', payload))
    whatsappClient.on('auto-reply-typing', (payload) => broadcastToAllWindows('whatsapp:auto-reply-typing', payload))
    whatsappClient.on('status-changed', (status) => {
      whatsappReachable = status !== 'disconnected'
      broadcastToAllWindows('whatsapp:status-changed', status)
    })

    whatsappClient.on('new-message', (payload) => {
      try {
        const message = payload && (payload.message || payload)
        if (!message || message.fromMe === true) return
        const mainFocused = BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w !== windowFactory.getWhatsappWindow() && w.isFocused())
        const _waWin = windowFactory.getWhatsappWindow()
        const waFocused = !!(_waWin && !_waWin.isDestroyed() && _waWin.isFocused())
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
        notifyNative({
          title: String(title),
          body,
          silent: false,
          onClick: () => {
            try { global.__openWhatsappWindow && global.__openWhatsappWindow() } catch {}
          },
          // Aquí no molestamos con diálogos: un rebote del Dock por mensaje basta.
          fallback: () => { try { app.dock && app.dock.bounce('informational') } catch {} }
        })
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
        const headers = {}
        try {
          const waAuth = require('./whatsapp/whatsapp-auth')
          const token = waAuth.readToken(waAuth.defaultTokenPath())
          if (token) headers[waAuth.HEADER_NAME] = token
        } catch {}
        const req = require('http').request({
          host: '127.0.0.1', port: 3031, method: 'GET', path: '/status', timeout: 3000, headers
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
}).catch((err) => {
  // Un throw en el arranque (config corrupta, persona, etc.) dejaba la app
  // sin ventana y sin mensaje — el patrón del incidente "arrancó sin ventana".
  try { console.error('[main] fallo de arranque:', err?.stack || err) } catch {}
  try { dialog.showErrorBox('POWER-AGENT no pudo arrancar', String(err?.stack || err?.message || err)) } catch {}
  app.quit()
})

process.on('unhandledRejection', (err) => {
  try { console.error('[main] unhandledRejection:', err?.stack || err) } catch {}
})

app.on('activate', () => {
  if (sessions.size === 0) createWindow()
})

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    globalShortcut.unregisterAll()
    telegramBridge?.stop()
    try { telegramNotifyBot?.stop() } catch {}
    // Esperar (acotado) a que terminen las integraciones git de las sesiones
    // cerradas antes de salir, para no perder merges en curso.
    if (pendingFinalizes.size) {
      await Promise.race([
        Promise.allSettled([...pendingFinalizes]),
        new Promise((r) => setTimeout(r, 10000))
      ])
    }
    app.quit()
  }
})

app.on('before-quit', (event) => {
  // Segundo disparo tras nuestro propio app.quit(): la limpieza ya corrió, salir.
  if (quitFinalizeHandled) return
  globalShortcut.unregisterAll()
  pauseAgentProposalPolling()
  try { lanTunnel.stop() } catch {}
  try { lanWsServer?.stop() } catch {}
  for (const s of sessions.values()) killPty(s)
  for (const s of agentPtySessions.values()) killAgentPty(s)
  try { subchatManager.closeAll() } catch {}
  try { voiceSession.disable() } catch {}
  voiceOwnerWcId = null
  try { telegramHiddenPtyPool?.destroy('app-quit') } catch {}
  telegramBridge?.stop()
  try { telegramNotifyBot?.stop() } catch {}
  try { whatsappClient?.stop() } catch {}
  if (whatsappRetryTimer) { clearTimeout(whatsappRetryTimer); whatsappRetryTimer = null }
  try { if (typeof app.setBadgeCount === 'function') app.setBadgeCount(0) } catch {}
  try { tasksScheduler?.destroy() } catch {}
  try { delegationManager?.destroy() } catch {}
  // PERF-H7: flush índices pendientes para no perder writes en debounce.
  try { claudeSessionsIndex?.flush?.() } catch {}
  try { codexSessionsIndex?.flush?.() } catch {}
  try { codexSessionsIndex?.stopWatcher() } catch {}
  try { sessionGitMap?.flush?.() } catch {}
  // Cmd+Q en macOS no pasa por window-all-closed: forzar la integración git de
  // las sesiones vivas con workspace y esperar (acotado) a que terminen los merges.
  // finalizeWorkspaceForSession anula session.gitWorkspace al entrar → llamarlo dos
  // veces (ej. tras destroySession) es un no-op, sin doble finalize.
  for (const s of sessions.values()) finalizeWorkspaceForSession(s)
  if (pendingFinalizes.size) {
    event.preventDefault()
    quitFinalizeHandled = true
    ;(async () => {
      await Promise.race([
        Promise.allSettled([...pendingFinalizes]),
        new Promise((r) => setTimeout(r, 10000))
      ])
      // Los markFinalized ocurren durante los finalize → flush final tras la espera.
      try { sessionGitMap?.flush?.() } catch {}
      app.quit()
    })().catch(() => { try { app.quit() } catch {} })
  } else {
    quitFinalizeHandled = true
  }
})

// ── PTY IPC ──
ipcMain.handle('pty-start', async (event, { cols, rows, cwd, cli, sessionId } = {}) => {
  const s = getSessionByEvent(event)
  if (!s) return null
  if (cli && (cli === 'claude' || cli === 'codex') && s.activeCli !== cli) {
    const switchResult = setActiveCli(s, cli)
    if (!switchResult.ok) {
      notifyPtyError(s, switchResult.error || 'No se pudo cambiar de CLI')
      throw new Error(switchResult.error || 'No se pudo cambiar de CLI')
    }
  }
  const args = buildClaudeLocalArgs(s.activeCli, sessionId)
  await ensureSessionWorkspace(s, cwd)
  startPty(s, cols, rows, cwd, args)
  if (s === sessions.get(primaryWcId)) updatePrimarySnapshot()
  try {
    if (recentCwds && s.cwd) recentCwds.push(s.cwd)
    if (lastContext) lastContext.set(s.wcId, {
      cwd: s.cwd,
      cli: s.activeCli,
      sessionId: sessionId || null
    })
  } catch {}
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

// ── Recent cwds + last context (flujo arranque cwd-first) ──
ipcMain.handle('fs:is-dir', async (_event, p) => {
  const target = String(p || '').trim()
  if (!target) return false
  try {
    if (!isPathSafe(target, allowedFsRoots())) return false
  } catch { return false }
  // fs.promises.stat con timeout 3s. Paths SMB/NAS no responsivos colgaban el
  // main process con statSync. Si tarda, asumimos que existe (lo dirime el spawn).
  try {
    const stat = await Promise.race([
      fs.promises.stat(target),
      new Promise((_, reject) => setTimeout(() => reject(new Error('STAT_TIMEOUT')), 3000))
    ])
    return stat.isDirectory()
  } catch (err) {
    if (err?.message === 'STAT_TIMEOUT') return true
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) return true
    return false
  }
})
ipcMain.handle('recent-cwds:list', () => {
  try { return recentCwds ? recentCwds.list() : [] } catch { return [] }
})
ipcMain.handle('recent-cwds:push', (_event, cwd) => {
  try { return recentCwds ? recentCwds.push(cwd) : [] } catch { return [] }
})
ipcMain.handle('recent-cwds:remove', (_event, cwd) => {
  try { return recentCwds ? recentCwds.remove(cwd) : [] } catch { return [] }
})
ipcMain.handle('kb-prefs:get', (_event, cwd) => {
  try { return kbPrefs ? kbPrefs.get(cwd) : KB_PREFS_DEFAULT } catch { return KB_PREFS_DEFAULT }
})
ipcMain.handle('kb-prefs:set', (_event, { cwd, enabled } = {}) => {
  try { return kbPrefs ? kbPrefs.set(cwd, enabled) : KB_PREFS_DEFAULT } catch { return KB_PREFS_DEFAULT }
})
ipcMain.handle('last-context:get', (event) => {
  try {
    const s = getSessionByEvent(event)
    if (!s || !lastContext) return null
    return lastContext.get(s.wcId)
  } catch { return null }
})
ipcMain.handle('last-context:most-recent', () => {
  try { return lastContext ? lastContext.mostRecent() : null } catch { return null }
})
ipcMain.handle('last-context:clear', (event) => {
  try {
    const s = getSessionByEvent(event)
    if (!s || !lastContext) return
    lastContext.remove(s.wcId)
  } catch {}
})

ipcMain.handle('pty-restart', (event, { cwd, cols, rows } = {}) => {
  const s = getSessionByEvent(event)
  if (!s) return null
  killPty(s)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      ensureSessionWorkspace(s, cwd).then(() => {
        startPty(s, cols, rows, cwd, buildClaudeLocalArgs(s.activeCli, null))
        if (s === sessions.get(primaryWcId)) updatePrimarySnapshot()
        resolve(s.cwd)
      }).catch(reject)
    }, 200)
  })
})

ipcMain.handle('pty-cwd', (event) => {
  const s = getSessionByEvent(event)
  return s ? s.cwd : os.homedir()
})

// ── Sub-chat IPC (fork desechable de la sesión activa) ──
ipcMain.handle('subchat:can-start', (event) => {
  const s = getSessionByEvent(event)
  return subchatManager.canStart(s)
})

ipcMain.handle('subchat:start', (event, { cols, rows } = {}) => {
  const s = getSessionByEvent(event)
  if (!s) return { ok: false, error: 'Sesión no disponible' }
  return subchatManager.start(s, { cols, rows })
})

ipcMain.on('subchat:write', (event, data) => {
  const s = getSessionByEvent(event)
  if (s) subchatManager.write(s.wcId, data)
})

ipcMain.on('subchat:resize', (event, { cols, rows } = {}) => {
  const s = getSessionByEvent(event)
  if (s) subchatManager.resize(s.wcId, cols, rows)
})

ipcMain.handle('subchat:close', (event) => {
  const s = getSessionByEvent(event)
  if (!s) return false
  // Cerrar el sub-chat mata su fork: el sessionId guardado ya no crece nunca
  // más y el modo voz se quedaría vigilando un fichero muerto hasta el timeout.
  s.voiceSubchatSessionId = null
  return subchatManager.close(s.wcId, 'renderer')
})

// ── Modo voz IPC ──
// Solo un dueño a la vez: el micro es del sistema, no de la ventana.
ipcMain.handle('voice:enable', (event) => {
  const s = getSessionByEvent(event)
  if (!s) return { ok: false, reason: 'sin sesión' }
  if (voiceOwnerWcId != null && voiceOwnerWcId !== s.wcId) {
    return { ok: false, reason: 'el modo voz ya está activo en otra ventana' }
  }
  // `spawn` no lanza con un binario ausente o sin permiso de ejecución: emite
  // 'error' de forma asíncrona, así que el fallo tardaría tres respawns en
  // salir a la luz mientras el botón ya dice "escuchando". Se comprueba aquí,
  // antes de tocar nada, y el motivo llega entero al renderer.
  const bin = voiceHelper.checkBinary()
  if (!bin.ok) return bin
  voiceOwnerWcId = s.wcId
  let res
  // Si enable() lanza y no se suelta la propiedad, el modo voz queda pegado a
  // una ventana que no lo tiene y TODAS las demás ven "ya está activo en otra
  // ventana" hasta reiniciar la app.
  try { res = voiceSession.enable() } catch (err) {
    voiceOwnerWcId = null
    return { ok: false, reason: `no se pudo arrancar el modo voz: ${err?.message || err}` }
  }
  if (!res || !res.ok) {
    voiceOwnerWcId = null
    return res || { ok: false, reason: 'no se pudo arrancar el modo voz' }
  }
  // enable() puede haberse apagado a sí misma por el camino (un fatal del helper
  // llega síncrono desde helper.start()). Devolver ok con la voz apagada deja el
  // botón en rojo y el micro cerrado; `voiceOwnerWcId` ya lo soltó el onShutdown.
  if (!voiceSession.isEnabled()) return { ok: false, reason: 'el modo voz no llegó a arrancar' }
  // La voz y la velocidad elegidas se mandan tras arrancar: el helper nace con
  // las del sistema.
  applyVoicePrefsToHelper()
  return res
})

// Empuja voz y velocidad de la config al helper. Se llama tras cada enable() y
// al guardar Configuración con el helper vivo — así el cambio se oye en la
// frase siguiente, sin apagar y encender el modo voz.
function applyVoicePrefsToHelper() {
  if (!voiceHelper.isRunning()) return
  const voiceId = appConfig?.cli?.voiceId || ''
  if (voiceId) voiceHelper.send({ cmd: 'voice', id: voiceId })
  const rate = Number(appConfig?.cli?.voiceRate)
  if (Number.isFinite(rate)) voiceHelper.send({ cmd: 'rate', value: rate })
  const silence = Number(appConfig?.cli?.voiceSilenceMs)
  if (Number.isFinite(silence) && silence > 0) voiceHelper.send({ cmd: 'silence', ms: silence })
}

// Lista de voces del sistema para el selector de Configuración. El helper puede
// arrancarse solo para esto (los permisos son perezosos: listar voces no toca
// el micrófono ni dispara ningún diálogo). Si lo hemos arrancado nosotros y el
// modo voz no está en uso, se para al terminar para no dejar un proceso vivo.
ipcMain.handle('voice:voices', async () => {
  const bin = voiceHelper.checkBinary()
  if (!bin.ok) return { ok: false, reason: bin.reason || 'no hay helper de voz', voices: [] }
  const arrancadoParaEsto = !voiceHelper.isRunning()
  if (arrancadoParaEsto) {
    try { voiceHelper.start() } catch (err) {
      return { ok: false, reason: `no se pudo arrancar el helper: ${err?.message || err}`, voices: [] }
    }
  }
  const voces = await new Promise((resolve) => {
    const timer = setTimeout(() => { voiceVoicesWaiter = null; resolve(null) }, 4000)
    voiceVoicesWaiter = (list) => { clearTimeout(timer); voiceVoicesWaiter = null; resolve(list) }
    if (!voiceHelper.send({ cmd: 'voices' })) {
      clearTimeout(timer); voiceVoicesWaiter = null; resolve(null)
    }
  })
  if (arrancadoParaEsto && !voiceSession.isEnabled()) {
    try { voiceHelper.stop() } catch {}
  }
  if (!Array.isArray(voces)) return { ok: false, reason: 'el helper no contestó', voices: [] }
  return { ok: true, voices: voces }
})

// Lectura de documentos desde el visor. El texto llega del renderer del visor
// (el contenido del textarea, con ediciones sin guardar incluidas); el gate del
// modo voz y el troceo viven en main/viewer-speech.js.
ipcMain.handle('viewer:speak', (event, { text } = {}) => {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'no hay nada que leer' }
  const bin = voiceHelper.checkBinary()
  if (!bin.ok) return { ok: false, reason: bin.reason || 'no hay helper de voz' }
  return viewerSpeech.speak(event.sender.id, text)
})

ipcMain.handle('viewer:speak-stop', (event) => viewerSpeech.stop(event.sender.id))

// Cerrar la ventana del visor calla su lectura (la ventana se destruye sin
// pasar por el botón: Cmd+W, cierre de la app…).
app.on('web-contents-created', (_e, wc) => {
  // El id se captura AHORA: sobre un webContents destruido cualquier getter tira.
  const wcId = wc.id
  wc.once('destroyed', () => { try { viewerSpeech.handleWindowClosed(wcId) } catch {} })
})

// Apagar y cambiar de modo son del DUEÑO. Sin esta comprobación, cualquier otra
// ventana (o una vista LAN) apaga el micro de quien lo está usando.
ipcMain.handle('voice:disable', (event) => {
  if (voiceOwnerWcId == null) return { ok: true }
  const s = getSessionByEvent(event)
  if (!s || voiceOwnerWcId !== s.wcId) return { ok: false, reason: 'el modo voz es de otra ventana' }
  try { voiceSession.disable() } catch {}
  voiceOwnerWcId = null
  return { ok: true }
})

ipcMain.handle('voice:set-mode', (event, { mode } = {}) => {
  const s = getSessionByEvent(event)
  if (!s || voiceOwnerWcId !== s.wcId) return { ok: false, reason: 'el modo voz es de otra ventana' }
  voiceSession.setForcedMode(mode)
  return { ok: true, mode: mode === 'charla' || mode === 'encargo' ? mode : null }
})

ipcMain.handle('voice:state', (event) => {
  const s = getSessionByEvent(event)
  return {
    enabled: voiceSession.isEnabled(),
    state: voiceSession.getState(),
    broken: voiceHelper.isBroken(),
    // Para que una ventana que NO es la dueña pinte el botón apagado aunque el
    // modo voz esté encendido en otra.
    mine: !!s && voiceOwnerWcId === s.wcId
  }
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
registerFilesystemIpc({
  ipcMain,
  dialog,
  safeIpcHandle,
  winFromEvent,
  assertSafeFsPath,
  markGraphCacheDirtyByPath
})

function computeProjectGraphForSession(session, rootPath) {
  const root = normalizeGraphRootPath(rootPath)
  if (!root) return { ok: false, error: 'no rootPath' }
  // El build corre en worker_thread (antes, síncrono aquí: congelaba PTYs,
  // IPC y WS en proyectos grandes). ipcMain.handle resuelve la promesa.
  if (!session) return computeProjectGraphAsync(root)

  if (session.graphCacheRoot !== root) {
    session.graphCacheRoot = root
    session.graphCacheDirty = true
    session.graphBuildPromise = null
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

  // Coalescer: un build en vuelo para este root sirve a todas las llamadas.
  if (session.graphBuildPromise) return session.graphBuildPromise

  const build = computeProjectGraphAsync(root).then((result) => {
    if (session.graphCacheRoot === root) {
      session.graphCacheResult = result
      session.graphCacheBuiltAt = Date.now()
      session.graphCacheDirty = false
    }
    if (session.graphBuildPromise === build) session.graphBuildPromise = null
    return result
  }, (err) => {
    if (session.graphBuildPromise === build) session.graphBuildPromise = null
    return { ok: false, error: String(err?.message || err) }
  })
  session.graphBuildPromise = build
  return build
}

ipcMain.handle('sidebar:get-graph', (event, rootPath) => {
  const s = getSessionByEvent(event)
  return computeProjectGraphForSession(s, rootPath)
})

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

// ── Sesiones de Claude ──
const _sessionListing = createSessionListing({
  resolveClaudeProjectDir,
  resolveExistingDir,
  extractTurnText,
  claudeIndex: () => claudeSessionsIndex,
  get codexIndex() { return codexSessionsIndex },
  // Late binding: sessionGitMap se crea en onReady, después de este top-level.
  // Al listar sesiones de un cwd, sumamos las de sus worktrees ACTIVOS —
  // mientras la sesión sigue en worktree, su .jsonl vive ahí, no en el real.
  getActiveWorktreeSessionDirs: (cwd) => {
    try {
      return (sessionGitMap?.listActiveForCwd(cwd) || [])
        .map((entry) => resolveClaudeProjectDir(entry.worktreePath))
        .filter(Boolean)
    } catch {
      return []
    }
  },
  // Los rollouts de codex guardan el cwd donde corrieron: con aislamiento git es
  // el worktree, así que sin esto las sesiones de hoy no salen en el picker.
  worktreesRoot: path.join(app.getPath('userData'), 'worktrees')
})
const {
  listClaudeSessionsForCwd,
  listCodexSessionsForCwd,
  listLanReusableSessions
} = _sessionListing

function listLanReusableProjects(meta = {}) {
  const requestedCwd = resolveExistingDir(meta?.cwd)
  const invitedCwd = resolveExistingDir(meta?.invitedCwd)
  const roots = (Array.isArray(meta?.allowedRoots) ? meta.allowedRoots : [])
    .map((root) => resolveExistingDir(root))
    .filter(Boolean)
  const allowed = (cwd) => {
    if (!cwd) return false
    if (!roots.length) return cwd === requestedCwd || cwd === invitedCwd
    return roots.some((root) => cwd === root || cwd.startsWith(root + path.sep))
  }
  const source = recentCwds ? recentCwds.list({ pruneMissing: true }) : []
  const rows = []
  const seen = new Set()
  const add = (rawCwd, lastUsedAt = 0) => {
    const cwd = resolveExistingDir(rawCwd)
    if (!cwd || seen.has(cwd) || !allowed(cwd)) return
    seen.add(cwd)
    rows.push({
      cwd,
      label: path.basename(cwd) || cwd,
      lastUsedAt: Number(lastUsedAt || 0)
    })
  }
  // El actual va primero para que el selector remoto sea útil incluso si aún
  // no se ha escrito en recent-cwds.json; la invitación siempre queda dentro
  // de su único proyecto permitido.
  add(invitedCwd || requestedCwd)
  for (const entry of source) add(entry?.cwd, entry?.lastUsedAt)
  return rows.slice(0, 50)
}

ipcMain.handle('list-sessions', async (event, cwd, cli) => {
  if (cli === 'codex') {
    return listCodexSessionsForCwd(cwd, { limit: 1000 })
  }
  return listClaudeSessionsForCwd(cwd, { limit: 1000 })
})

// Búsqueda en el CONTENIDO de las sesiones del proyecto (robo de Hermes:
// buscar en tus conversaciones pasadas). Streaming sobre los .jsonl del
// listado normal; solo claude — el índice codex no guarda paths uniformes.
ipcMain.handle('search-session-content', async (event, cwd, query) => {
  const q = String(query || '').trim()
  if (q.length < 3) return []
  const sessions = await listClaudeSessionsForCwd(cwd, { limit: 1000 })
  const entries = (sessions || [])
    .filter((s) => s && s.id && s.path)
    .map((s) => ({ id: s.id, path: s.path }))
  return searchSessionContentInFiles({ entries, query: q, maxResults: 40 })
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
    try { if (claudeSessionsIndex) claudeSessionsIndex.removeSession(cwd, sessionId) } catch {}
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
    // PERF-H8: lectura async + write async para no bloquear main en transcripts grandes.
    let raw
    try {
      raw = await fs.promises.readFile(file, 'utf-8')
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, error: 'No encontré el archivo de sesión.' }
      throw err
    }
    const { updated, text: finalText } = retitleTranscript(raw, nextTitle)
    if (!updated) {
      return { ok: false, error: 'No encontré un mensaje de usuario para renombrar en esta sesión.' }
    }
    await atomicWriteFileAsync(file, finalText, 'utf-8')
    let stat = null
    try { stat = await fs.promises.stat(file) } catch {}
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

ipcMain.handle('resume-session', async (event, { sessionId, cwd, cols, rows, cli } = {}) => {
  const s = getSessionByEvent(event)
  if (!s) return null
  if (cli && (cli === 'claude' || cli === 'codex') && s.activeCli !== cli) {
    const switchResult = setActiveCli(s, cli)
    if (!switchResult.ok) {
      notifyPtyError(s, switchResult.error || 'No se pudo cambiar de CLI')
      throw new Error(switchResult.error || 'No se pudo cambiar de CLI')
    }
  }
  killPty(s)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      ensureSessionWorkspace(s, cwd).then(() => {
        // Copiar el JSONL de la sesión a reanudar dentro del worktree para que
        // `--resume` lo encuentre bajo el cwd aislado.
        if (sessionId && s.gitWorkspace) {
          try {
            sessionGit.copySessionToWorktree({
              claudeSessionId: sessionId,
              realCwd: s.gitWorkspace.realCwd,
              workCwd: s.gitWorkspace.workCwd
            })
          } catch (err) {
            console.warn('[session-git] copySessionToWorktree:', err?.message || err)
          }
        }
        startPty(s, cols, rows, cwd, buildClaudeLocalArgs(s.activeCli, sessionId))
        if (s === sessions.get(primaryWcId)) updatePrimarySnapshot()
        try {
          if (recentCwds && s.cwd) recentCwds.push(s.cwd)
          if (lastContext) lastContext.set(s.wcId, {
            cwd: s.cwd,
            cli: s.activeCli,
            sessionId: sessionId || null
          })
        } catch {}
        resolve(s.cwd)
      }).catch(reject)
    }, 200)
  })
})

// Abrir una sesión continuable desde la bandeja de tareas.
// Valida sessionId + existencia del JSONL, enfoca la ventana principal y
// pide al renderer que ejecute resumeSession() (necesita cols/rows del xterm).
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
  const meta = buildCurrentSessionMeta(s)
  // Chivato de aislamiento para la topbar: si la sesión corre en worktree,
  // el usuario tiene que VERLO (rama + carpeta real), no descubrirlo por
  // archivos que aparecen donde no los busca.
  if (meta && typeof meta === 'object') {
    meta.gitIsolation = s.gitWorkspace
      ? { branch: s.gitWorkspace.branch || '', realCwd: s.gitWorkspace.realCwd || '' }
      : null
    try { meta.model = resolveSessionModelLabel(s, meta) } catch { meta.model = '' }
  }
  return meta
})

ipcMain.handle('session:handoff-to-terminal', async (event) => {
  const session = getSessionByEvent(event)
  const target = terminalHandoff.captureHandoffTarget(session, {
    resolveCodexSessionId: (s) => guessCodexSessionFromHistory(s)?.sessionId || null
  })
  if (target.error) return { ok: false, error: target.error }
  killPty(session)
  if (session.win && !session.win.isDestroyed()) session.win.webContents.send('pty-exit')
  await finalizeWorkspaceForSession(session)
  try {
    await terminalHandoff.openInTerminal(target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `No se pudo abrir Terminal: ${err?.message || err}` }
  }
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

ipcMain.handle('get-app-config', () => JSON.parse(JSON.stringify(appConfig)))

registerProfilesEnterpriseIpc({
  ipcMain,
  dialog,
  winFromEvent,
  // Toda mutación de perfiles resincroniza el fichero de persona viva: así el
  // hook inyecta siempre la persona vigente sin reiniciar sesiones.
  profilesApi: {
    listProfilesPayload,
    createProfile: (...a) => { const r = createProfile(...a); syncActivePersonaFile(); return r },
    updateProfile: (...a) => { const r = updateProfile(...a); syncActivePersonaFile(); return r },
    deleteProfile: (...a) => { const r = deleteProfile(...a); syncActivePersonaFile(); return r },
    setActiveProfile: (...a) => { const r = setActiveProfile(...a); syncActivePersonaFile(); return r }
  },
  enterpriseApi: {
    listEnterprisePayload, saveEnterpriseConfig,
    createEnterpriseRole, updateEnterpriseRole, deleteEnterpriseRole,
    createEnterpriseOperator, updateEnterpriseOperator, deleteEnterpriseOperator
  }
})

ipcMain.handle('save-app-config', async (event, partialConfig) => {
  const previousDefault = appConfig.cli.defaultCli
  // SEC-H2/H3: allowlist estricta. enterprise.roles/operators/enabled NO se aceptan
  // desde este canal (usar 'enterprise:save-config'). lanServer.authToken NO se acepta
  // desde renderer. cli/telegram filtrados por campos válidos.
  const partial = partialConfig || {}
  // Estado LAN previo: decide si hay que reiniciar el servidor. Reiniciar mata
  // las sesiones remotas vivas e invalida los invites pendientes, así que solo
  // se hace cuando cambia algo que lo exige de verdad.
  const previousLanPort = clampLanPort(appConfig.lanServer?.port ?? DEFAULT_LAN_WS_PORT)
  const warnings = []

  // Un campo fuera de la allowlist se descartaba en SILENCIO: ese fue el bug de
  // las URLs públicas del túnel (bug_lan_allowlist_urls_publicas_2026_08_13).
  // Ahora el descarte se reporta. authToken y enterprise.* están fuera aposta.
  const dropped = [
    ...pickDropped(partial.cli, SAFE_CLI).map((k) => `cli.${k}`),
    ...pickDropped(partial.telegram, SAFE_TELEGRAM).map((k) => `telegram.${k}`),
    ...pickDropped(partial.lanServer, SAFE_LAN).map((k) => `lanServer.${k}`)
  ]
  if (dropped.length) {
    warnings.push(`Campos ignorados al guardar (no están en la allowlist): ${dropped.join(', ')}`)
  }

  // Una URL pública mal formada también se blanqueaba sin decir nada.
  for (const [key, kind] of [['publicClientUrl', 'client'], ['publicWsUrl', 'ws']]) {
    if (!partial.lanServer || !Object.prototype.hasOwnProperty.call(partial.lanServer, key)) continue
    const { error } = explainLanPublicUrl(partial.lanServer[key], kind)
    if (error) warnings.push(error)
  }

  saveAppConfig({
    ...appConfig,
    cli: { ...appConfig.cli, ...pick(partial.cli, SAFE_CLI) },
    telegram: { ...appConfig.telegram, ...pick(partial.telegram, SAFE_TELEGRAM) },
    lanServer: { ...appConfig.lanServer, ...pick(partial.lanServer, SAFE_LAN) },
    profiles: Array.isArray(partial.profiles) ? partial.profiles : appConfig.profiles,
    activeProfile: typeof partial.activeProfile === 'string' ? partial.activeProfile : appConfig.activeProfile,
    enterprise: appConfig.enterprise // sin tocar: usar enterprise:save-config
  })

  // Voz/velocidad del modo voz: aplicar en caliente si el helper está vivo.
  try { applyVoicePrefsToHelper() } catch {}

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
  if (Object.prototype.hasOwnProperty.call(partial, 'telegram')) {
    try { applyTelegramNotifyBot() } catch (err) { warnings.push(`Bot de avisos no arrancó: ${err?.message || err}`) }
  }
  broadcastTelegramStatus()
  if (Object.prototype.hasOwnProperty.call(partial, 'lanServer')) {
    const nextPort = clampLanPort(appConfig.lanServer?.port ?? DEFAULT_LAN_WS_PORT)
    // La decisión vive en main/lan-server-action.js para que la suite la cubra
    // sin Electron: reiniciar de más corta las sesiones remotas y anula invites.
    const { action } = decideLanServerAction({
      enabled: !!appConfig.lanServer?.enabled,
      running: getLanServerStatus().running,
      previousPort: previousLanPort,
      nextPort
    })
    if (action === 'stop') {
      try { await stopLanServer({ persist: false }) } catch {}
    } else if (action === 'start') {
      try {
        await startLanServer({ port: nextPort, persist: false })
      } catch (err) {
        warnings.push(
          `Config guardada pero el servidor LAN quedó PARADO: ${err?.message || err}. ` +
          'Revisa el puerto y vuelve a activarlo.'
        )
      }
    }
  }
  return {
    ok: telegramResult.ok,
    telegram: telegramResult,
    warnings,
    config: appConfig,
    lan: getLanServerStatus()
  }
})

ipcMain.handle('get-telegram-status', () => telegramBridge?.getStatus() || null)

// ── Emparejamiento por código (Configuración → Telegram) ──
ipcMain.handle('telegram:pairing-list', () => telegramPairing.listPending())

ipcMain.handle('telegram:pairing-approve', async (_event, code) => {
  const res = telegramPairing.approve(code)
  if (!res.ok) return { ...res, pending: telegramPairing.listPending() }
  const current = Array.isArray(appConfig.telegram?.allowedUsers) ? appConfig.telegram.allowedUsers : []
  saveAppConfig({
    ...appConfig,
    telegram: { ...appConfig.telegram, allowedUsers: [...current, res.userId] }
  })
  let telegramResult = { ok: true, running: false }
  if (telegramBridge) telegramResult = await telegramBridge.applyConfig(appConfig.telegram)
  broadcastTelegramStatus()
  broadcastTelegramPairing()
  // Aviso al chat recién aprobado (best effort).
  if (res.chatId && telegramBridge) {
    try { await telegramBridge._sendMessage(res.chatId, 'Vinculado. Ya puedes hablar con el bot.') } catch {}
  }
  return { ok: true, userId: res.userId, telegram: telegramResult, pending: telegramPairing.listPending() }
})

ipcMain.handle('telegram:pairing-reject', (_event, code) => {
  const res = telegramPairing.reject(code)
  broadcastTelegramPairing()
  return { ...res, pending: telegramPairing.listPending() }
})

// ── Bandeja única de decisiones (pairing + encargos repetidos) ──
// Pase manual del doctor desde el panel: resultado a la UI, sin Telegram.
ipcMain.handle('doctor:run', async () => {
  if (!healthWatchdog) return { ok: false, error: 'El doctor no está arrancado.' }
  try {
    const res = await healthWatchdog.runOnce({ force: true, quiet: true })
    return { ok: true, ...res }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// ── Panel "¿qué está pasando?" ──
ipcMain.handle('status-panel:get', () => buildStatusPanelSnapshot({
  sessions: [...sessions.entries()].map(([wcId, s]) => ({
    wcId,
    activeCli: s.activeCli,
    cwd: s.cwd,
    claudeSessionId: s.claudeSessionId,
    codexSessionId: s.codexSessionId,
    pty: s.pty,
    gitWorkspace: s.gitWorkspace,
    relayActive: s.relayActive
  })),
  poolStats: (() => { try { return telegramHiddenPtyPool?.getStats() || null } catch { return null } })(),
  recentEvents: (() => { try { return semanticLogger.readRecent({ limit: 12 }) } catch { return [] } })(),
  voiceOwnerWcId
}))

ipcMain.handle('decisions:list', () => ({
  pairing: telegramPairing.listPending(),
  repeated: (() => { try { return getRepeatedPrompts().listProposals() } catch { return [] } })()
}))

ipcMain.handle('decisions:resolve-repeated', (_event, { id, status } = {}) => {
  let res = { ok: false }
  try { res = getRepeatedPrompts().resolveProposal(id, status) } catch {}
  broadcastDecisionsChanged()
  return res
})

ipcMain.handle('health:get', async (event) => {
  const s = getSessionByEvent(event) || (primaryWcId != null ? sessions.get(primaryWcId) : null)
  return collectHealthSnapshot(s)
})

registerWsServerIpc({
  ipcMain,
  startLanServer,
  stopLanServer,
  getLanServerStatus,
  createLanSessionInvite,
  getLanWsServer: () => lanWsServer,
  getLanTunnel: () => lanTunnel,
  clampLanPort,
  getAppConfig: () => appConfig,
  DEFAULT_LAN_WS_PORT
})

registerProposalIpc({
  ipcMain,
  agentProposalWatcher,
  resolveProposalExecutionSession,
  getSessionByEvent,
  getPrimaryWindowSession,
  finalizePendingProposal,
  serializePendingProposalForRenderer,
  logProposalApprovedStub,
  logProposalRejectedStub,
  semanticSessionId,
  getActiveCliSync
})

ipcMain.handle('update:install', async () => {
  if (!autoUpdater) return { ok: false, error: 'autoUpdater no disponible' }
  try {
    autoUpdater.quitAndInstall()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

// ── Transferir sesión activa de la ventana a Telegram ──
registerTelegramSessionLinkIpc({
  ipcMain,
  getSessions: () => sessions,
  getTelegramBridge: () => telegramBridge,
  getTelegramRelayByChat: () => telegramRelayByChat,
  resolveSessionIdForRelay,
  getRelayBindingForSession,
  bindRelaySessionToTelegramChat,
  unbindRelaySessionForTelegramChat,
  unbindRelaySessionsByWcId,
  broadcastTelegramStatus,
  syncSessionContextAfterTelegramDetach
})

registerWindowControlsIpc({
  ipcMain,
  winFromEvent,
  getSessions: () => sessions,
  createWindow
})

registerBitacoraIpc({
  ipcMain,
  dialog,
  semanticLogger,
  winFromEvent,
  getBitacoraWin: () => windowFactory.getBitacoraWin(),
  openBitacoraWindow
})

ipcMain.handle('whatsapp-window:open', () => windowFactory.openWhatsappWindow())

global.__openWhatsappWindow = () => {
  try { windowFactory.openWhatsappWindow() }
  catch (err) { console.warn('[whatsapp] open from notification failed:', err?.message || err) }
}

registerViewerGraphIpc({
  ipcMain,
  BrowserWindow,
  rootDir: __dirname,
  getSessionByEvent,
  getCwdSync,
  getPrimaryWin: () => primaryWcId != null ? sessions.get(primaryWcId)?.win : null,
  getAllowedFsRoots: allowedFsRoots,
  openViewerWindow
})

registerTasksIpc({
  ipcMain,
  BrowserWindow,
  dialog,
  nativeTheme,
  getScheduler: () => tasksScheduler,
  getAppConfig: () => appConfig,
  getSessions: () => sessions,
  getTasksManagerWin: () => windowFactory.getTasksManagerWin(),
  openTasksManager,
  getInbox: () => tasksInbox,
  getSessionLinks: () => sessionLinks
})

registerSkillsIpc({
  ipcMain,
  getUserDataDir: () => app.getPath('userData'),
  getDefaultCwd: () => getCwdSync()
})

registerKbIpc({
  ipcMain,
  shell,
  getDefaultCwd: () => getCwdSync(),
  runClaudeHeadless: (opts) => runClaudeHeadless(opts),
  getModel: () => getClaudeModel(),
  getUserDataDir: () => app.getPath('userData'),
  transcribeAudioFile,
  buildRuntimeEnv,
  sendPromptToSession: async (projectDir, text) => {
    const session = findSessionByProjectDir(projectDir)
    if (!session || !session.pty) throw new Error('no hay ninguna sesión abierta de este proyecto; ábrela y reinténtalo')
    await writePromptThenEnter((chunk) => session.pty.write(chunk), text)
  },
  log: (msg) => console.log(msg)
})

registerDelegationIpc({
  ipcMain,
  getManager: () => delegationManager,
  getDefaultCwd: () => getCwdSync()
})

registerAutomationsIpc({
  ipcMain,
  shell,
  getAutomationManager: () => automationManager,
  getAutomationChat: () => automationChat,
  getAgentPtyWindowByAutomation: () => agentPtyWindowByAutomation,
  getChatWindows: () => chatWindows
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

// ── Task session popup IPC ──
function getTaskSessionByEvent(event) {
  return taskSessionStateByWc.get(event.sender.id) || null
}

ipcMain.handle('app:open-task-session', async (_event, payload = {}) => {
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
  if (!sessionId || !isValidSessionId(sessionId)) {
    return { ok: false, error: 'sessionId inválido' }
  }
  const cli = payload?.cli === 'codex' ? 'codex' : 'claude'
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : ''
  const taskName = typeof payload?.taskName === 'string' ? payload.taskName : ''
  try {
    const win = await openTaskSessionWindow({ sessionId, cwd, cli, taskName })
    return win ? { ok: true } : { ok: false, error: 'No se pudo abrir la ventana de sesión' }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('task-session:init', async (event) => {
  const s = getTaskSessionByEvent(event)
  if (!s) return { sessionId: null }
  return {
    sessionId: s.sessionId,
    cwd: s.cwd,
    cli: s.cli,
    taskName: s.taskName,
    theme: s.theme
  }
})

ipcMain.handle('task-session:start', (event, { cols, rows } = {}) => {
  const s = getTaskSessionByEvent(event)
  if (!s) return { ok: false, error: 'No task session' }
  if (cols && rows) { s.cols = cols; s.rows = rows }
  try {
    startTaskSessionPty(s)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.on('task-session:write', (event, data) => {
  const s = getTaskSessionByEvent(event)
  if (!s || !s.pty) return
  try { s.pty.write(data) } catch {}
})

ipcMain.on('task-session:resize', (event, { cols, rows } = {}) => {
  const s = getTaskSessionByEvent(event)
  if (!s) return
  if (cols && rows) { s.cols = cols; s.rows = rows }
  try { s.pty?.resize(cols, rows) } catch {}
})

ipcMain.on('task-session:close-self', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender)
  if (w && !w.isDestroyed()) w.close()
})

ipcMain.on('task-session:minimize-self', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender)
  if (w && !w.isDestroyed()) w.minimize()
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

  const decision = decideExtractRunner(runner, ensureCliAvailable)
  if (!decision.ok) return { ok: false, error: decision.error }
  const prompt = buildExtractPrompt(transcript)

  let result
  try {
    if (decision.runner === 'codex') {
      result = await runCodexHeadless({ prompt, cwd: s.cwd, origin: 'extractor' })
    } else {
      result = await runClaudeHeadless({ prompt, cwd: s.cwd, model: getClaudeModel(), origin: 'extractor' })
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
  if (!automationManager) return { ok: false, error: 'AutomationManager no inicializado' }
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

registerAutomationChatIpc({
  ipcMain,
  BrowserWindow,
  getAutomationChat: () => automationChat,
  getChatWcToAutomation: () => chatWcToAutomation
})

// ── WhatsApp IPC ──
registerWhatsappIpc({
  ipcMain,
  dialog,
  winFromEvent,
  getClient: () => whatsappClient,
  getClientLoadError: () => whatsappModuleLoadError,
  getReachable: () => whatsappReachable,
  getAllowedFsRoots: allowedFsRoots,
  transcribeAudioFile,
  buildRuntimeEnv,
  WA_CONFIG_PATH,
  WA_MEDIA_DIR,
  TMP_DIR
})
