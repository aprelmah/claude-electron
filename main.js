const { app, BrowserWindow, Menu, globalShortcut, ipcMain, nativeTheme, dialog, session, systemPreferences, shell, clipboard, protocol, net, Notification } = require('electron')
const pty = require('node-pty')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const http = require('http')
const { atomicWriteJsonSync, atomicWriteFileSync } = require('./main/atomic-writes')
const { isPathSafe, isValidSessionId } = require('./main/path-sandbox')
const { createSemanticLogger } = require('./main/semantic-logger')
const { createLanWsServer, clampLanPort, DEFAULT_LAN_WS_PORT } = require('./main/ws-server')
const {
  createCliResolver,
  resolveCommand,
  commandExists,
  USER_LOCAL_BIN,
  PYTHON39_BIN,
  HOMEBREW_BIN,
  LATEST_NVM_NODE_BIN,
  FALLBACK_CLAUDE_BIN,
  FALLBACK_CODEX_BIN,
  FALLBACK_WHISPER_BIN,
  FFMPEG_BIN
} = require('./main/cli-resolver')
const { createTranscriber } = require('./main/whisper-transcribe')
const { computeProjectGraph, normalizeGraphRootPath } = require('./main/graph-builder')
const {
  stripAnsi,
  flattenTerminal,
  extractAgentBlocks,
  blocksEqual,
  createProposalFiles
} = require('./main/agent-pty-proposal')
const {
  extractTurnText,
  statCacheKey,
  safeStat,
  clipText,
  escapeSqlLiteral,
  escapeForCompactedPrompt,
  extractCodexResumeId,
  extractClaudeResumeId,
  buildResumeArgs
} = require('./main/session-helpers')
const { createRecentCwds } = require('./main/recent-cwds')
const { createCodexSessionsIndex } = require('./main/codex-sessions-index')
const { createLastContext } = require('./main/last-context')
const { createClaudeSessionsIndex } = require('./main/claude-sessions-index')
const { createCodexSessionReader } = require('./main/codex-session-reader')
const { createAgentProposalWatcher } = require('./main/agent-proposal-watcher')
const { registerWhatsappIpc, WA_SAFE_CONFIG_FIELDS } = require('./main/whatsapp-ipc')
const { createWindowFactory } = require('./main/window-factory')
const { registerViewerGraphIpc } = require('./main/viewer-graph-ipc')
const { registerTasksIpc } = require('./main/tasks-ipc')
const { registerProfilesEnterpriseIpc } = require('./main/profiles-enterprise-ipc')
const { registerAutomationsIpc } = require('./main/automations-ipc')
const { registerBitacoraIpc } = require('./main/bitacora-ipc')
const { createHealthCollectors } = require('./main/health-collectors')
const { createSessionListing, projectDirFor } = require('./main/claude-session-listing')
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
const { createTelegramRelayBindings } = require('./main/telegram-relay-bindings')
const { createTelegramHiddenPtyPool } = require('./main/telegram-hidden-pty-pool')
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
const TaskScheduler = require('./scheduler')
const { createExecutor } = require('./scheduler/executor')
const { createSinks, createInboxSink } = require('./scheduler/sinks')
const { createPersistence } = require('./scheduler/persistence')
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

// ── Per-window sessions ──
// key = webContents.id → WindowSession { win, wcId, ordinal, pty, cols, rows, cwd, activeCli, treeWatcher, treeWatcherPath, treeWatchDebounce }
const sessions = new Map()
const telegramRelayByChat = new Map() // chatId(string) -> wcId(number)
let primaryWcId = null
let lastPrimarySnapshot = { cwd: os.homedir(), activeCli: 'claude' }
let nextOrdinal = 0
let telegramBridge = null
let telegramHiddenPtyPool = null
let whatsappClient = null
let whatsappReachable = false
let whatsappRetryTimer = null
let autoUpdater = null
let lanWsServer = null
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

const { transcribeAudioFile } = createTranscriber({
  getWhisperBin: () => getConfiguredWhisperBin(),
  modelPath: WHISPER_CPP_MODEL,
  tmpDir: TMP_DIR
})

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

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
  const requestedCli = sanitizeLanRequestedCli(
    rawRemoteContext?.cli || rawRemoteContext?.provider || rawRemoteContext?.engine
  )
  const cli = requestedCli || (getActiveCliSync() === 'codex' ? 'codex' : 'claude')
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
  const enterpriseContext = resolveLanEnterpriseContext(remoteContext, activeProfile, getCwdSync())
  const effectiveProfile = getProfileById(enterpriseContext.profileId) || activeProfile
  const profileCwd = resolveExistingDir(effectiveProfile?.cwd)
  const currentCwd = resolveExistingDir(getCwdSync())
  const cwd = profileCwd || currentCwd || os.homedir()
  const legacyBootstrap = getProfileStartupMessage(effectiveProfile)
  const personaResolved = sanitizePersonaPrompt(enterpriseContext.personaResolved || '')
  const bootstrapMessage = personaResolved
    ? `${personaResolved}\n`
    : legacyBootstrap
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
  const lanEnv = { ...cliCheck.env }
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
    allowedRoots: Array.isArray(enterpriseContext.allowedRoots) ? [...enterpriseContext.allowedRoots] : buildLanSessionLegacyRoots(cwd),
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
      timeoutMs: 240000
    })
    const nextSessionId = String(result?.sessionId || currentChatSessionId || '').trim()
    return { text: String(result?.text || '').trim(), sessionId: nextSessionId || null }
  }

  const compacted = compactClaudeSessionIfNeeded({
    sessionId: currentChatSessionId || undefined,
    prompt: text,
    cwd
  })
  const result = await runClaudeHeadless({
    prompt: compacted.prompt,
    sessionId: compacted.sessionId || undefined,
    signal,
    cwd,
    model,
    effort,
    timeoutMs: 240000
  })
  const nextSessionId = String(result?.sessionId || currentChatSessionId || '').trim()
  return { text: String(result?.text || '').trim(), sessionId: nextSessionId || null }
}

function ensureLanWsServer() {
  if (lanWsServer) return lanWsServer
  lanWsServer = createLanWsServer({
    clientHtmlPath: getLanClientHtmlPath(),
    getSessionConfig: (remoteMeta) => resolveLanSessionConfig(remoteMeta),
    listReusableSessions: (meta) => listLanReusableSessions(meta),
    transcribeAudio: (audioPath) => transcribeAudioFile(audioPath, buildRuntimeEnv()),
    runSemanticChatTurn: (payload) => runLanSemanticChatTurn(payload),
    buildExecCommand: buildFdLimitCommand,
    logger: (message) => console.log(message),
    onAuditEvent: (event) => logLanAuditSemantic(event)
  })
  return lanWsServer
}

function persistLanServerConfig(patch = {}) {
  const current = appConfig?.lanServer || {}
  const merged = normalizeAppConfig({
    ...appConfig,
    lanServer: {
      ...current,
      ...patch
    }
  })
  saveAppConfig(merged)
  return merged.lanServer
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
      clientUrl: '',
      sessions: []
    }
  }
  const status = lanWsServer.getStatus()
  return {
    running: !!status.running,
    ip: status.ip || '',
    port: clampLanPort(status.port ?? configuredPort),
    httpPort: Number(status.httpPort || (configuredPort + 1)),
    clientUrl: status.clientUrl || '',
    sessions: Array.isArray(status.sessions) ? status.sessions : []
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
  pickRelayTranscriptCandidate,
  extractAssistantTextFromTranscript,
  cleanRelayFallbackText
} = _relayTranscriptHelpers

async function relayThroughPty(session, prompt, { onText, signal, mode } = {}) {
  if (!session?.pty || !session?.cwd) return null
  const targetCli = mode || session.activeCli
  if (targetCli !== 'claude' && targetCli !== 'codex') return null
  if (session.activeCli !== targetCli) return null
  // Si hay un turno en vuelo (relayActive), esperar a que se libere (máx 30s)
  // en vez de devolver null inmediato. Cubre race del bridge bajo carga: la cola
  // por chat ya serializa, pero un cleanup tardío del turno anterior podría dejar
  // relayActive=true por unos ms. Sin esto, el segundo turno caía a "PTY enlazado falló".
  if (session.relayActive) {
    const RELAY_BUSY_WAIT_MS = 30000
    const RELAY_BUSY_POLL_MS = 50
    const waitStart = Date.now()
    while (session.relayActive && Date.now() - waitStart < RELAY_BUSY_WAIT_MS) {
      if (signal?.aborted) {
        const err = new Error('Request aborted')
        err.name = 'AbortError'
        throw err
      }
      await new Promise((r) => setTimeout(r, RELAY_BUSY_POLL_MS))
      if (!session?.pty) return null
    }
    if (session.relayActive) return null
  }
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
      if (livenessTimer) clearInterval(livenessTimer)
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
      if (targetCli === 'claude') {
        try {
          const refreshed = snapshotClaudeSessionMeta(session.cwd)
          for (const [k, v] of refreshed.entries()) beforeMeta.set(k, v)
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
        livenessBaseline = snapshotClaudeSessionMeta(session.cwd)
        livenessTimer = setInterval(() => {
          if (finalized || sawAnyOutput) return
          if (!session?.pty) return
          let grew = false
          try {
            const current = snapshotClaudeSessionMeta(session.cwd)
            for (const [file, meta] of current.entries()) {
              const prev = livenessBaseline.get(file)
              if (!prev || (meta?.size || 0) > (prev?.size || 0)) {
                grew = true
                break
              }
            }
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
      try { session.pty.write(message + '\r') } catch (err) { finishErr(err); return }
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

function resolveExistingDir(inputPath) {
  const value = typeof inputPath === 'string' ? inputPath.trim() : ''
  if (!value) return ''
  try {
    const stat = fs.statSync(value)
    return stat.isDirectory() ? value : ''
  } catch {
    return ''
  }
}

function getProfileStartupMessage(profile) {
  const personaPrompt = sanitizePersonaPrompt(profile?.personaPrompt || '')
  if (personaPrompt) return `${personaPrompt}\n`
  const claudeMdPath = typeof profile?.claudeMdPath === 'string' ? profile.claudeMdPath.trim() : ''
  if (!claudeMdPath) return ''
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
  scheduleProfileBootstrapMessage(session, proc, activeProfile)
  logSemanticForSession(session, 'pty_inicio', {
    detail: `cwd=${session.cwd || ''}`,
    ok: true
  })

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
let tasksInbox = null
let sessionLinks = null
let recentCwds = null
let lastContext = null
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
          try { if (fs.statSync(cwd).isDirectory()) return cwd } catch {}
        }
      } catch {}
    }
  } catch {}
  return os.homedir()
}

async function openTaskSessionWindow({ sessionId, cwd, cli, taskName, hidden = false } = {}) {
  if (!sessionId || typeof sessionId !== 'string') return null
  if (!isValidSessionId(sessionId)) return null

  const existing = taskSessionWindowsBySessionId.get(sessionId)
  if (existing && !existing.isDestroyed()) {
    const existingState = taskSessionStateByWc.get(existing.webContents.id)
    if (!hidden) {
      if (existingState) existingState.hidden = false
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
    }
    return existing
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

  const args = s.cli === 'codex'
    ? ['resume', s.sessionId]
    : ['--resume', s.sessionId]

  s.sessionFilesSnapshot = s.cli === 'claude'
    ? snapshotClaudeSessions(s.cwd)
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
      const sid = findUpdatedOrNewClaudeSessionId(st.cwd, st.sessionFilesSnapshot)
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

      // Regla: si el chat tiene sessionId persistida y NO hay binding explícito de relay PTY,
      // ir directo a headless --resume con esa sesión. Esto cubre tareas programadas y
      // cualquier comunicación Mac→Telegram que haya enlazado una sesión al chat.
      const hasExplicitSid = !binding.bound && typeof opts?.sessionId === 'string' && opts.sessionId.length > 0
      if (hasExplicitSid && targetCli === 'codex') {
        return runCodexHeadless({ ...opts, cli: 'codex', cwd, model: tg.codexModel || '', effort: tg.codexEffort || '' })
      }
      if (hasExplicitSid && targetCli === 'claude') {
        const compacted = compactClaudeSessionIfNeeded({ sessionId: opts.sessionId, prompt: opts?.prompt, cwd })
        return runClaudeHeadless({ ...opts, ...compacted, cwd, model: tg.claudeModel || '', effort: tg.claudeEffort || '' })
      }

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
    onStatus: () => broadcastTelegramStatus(),
    onSemanticInput: ({ chatId, cli, sessionId, prompt }) => {
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
    onOpenTaskSession: async ({ sessionId, cli, cwd, taskName, chatId }) => {
      try {
        if (!sessionId || !isValidSessionId(sessionId)) {
          return { ok: false, error: 'sessionId inválido' }
        }
        const targetCli = cli === 'codex' ? 'codex' : 'claude'
        const key = normalizeTelegramChatKey(chatId)
        if (key && telegramHiddenPtyPool) {
          const existing = telegramHiddenPtyPool.getHiddenPtyForChat(key)
          if (existing && existing.sessionId === sessionId && existing.cli === targetCli) {
            const shown = telegramHiddenPtyPool.showHiddenPty(key)
            if (shown) {
              const st = taskSessionStateByWc.get(existing.wcId)
              if (st) st.hidden = false
              return { ok: true, fromPool: true }
            }
          }
        }
        const win = await openTaskSessionWindow({
          sessionId,
          cwd: cwd || '',
          cli: targetCli,
          taskName: taskName || ''
        })
        if (!win) return { ok: false, error: 'No se pudo abrir la ventana' }
        if (key) {
          try { telegramRelayByChat.set(key, win.webContents.id) } catch {}
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
    }
  })
}

const TG_HISTORY_THRESHOLD = 30
const TG_HISTORY_KEEP = 20

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
    const executor = createExecutor({ runClaudeHeadless, runCodexHeadless, appConfig })
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
      onEnsureHiddenPty: async ({ chatId, sessionId, cli, cwd, taskName }) => {
        if (!telegramHiddenPtyPool) return { ok: false, error: 'pool no inicializado' }
        // Codex en Telegram se mantiene en headless (resume por thread_id estable).
        // El pool solo spawnea PTY oculto para Claude.
        if (cli !== 'claude') return { ok: true, skipped: true, reason: 'cli-not-claude' }
        const res = await telegramHiddenPtyPool.ensureHiddenPtyForChat({ chatId, sessionId, cli, cwd, taskName })
        // Red de seguridad: persistir sid en el bridge para que onRunQuery pueda
        // caer a headless --resume si el PTY oculto se cuelga o cae por TTL.
        if (res && res.ok && sessionId && telegramBridge && typeof telegramBridge.adoptSession === 'function') {
          try { telegramBridge.adoptSession(String(chatId), 'claude', sessionId) } catch {}
        }
        return res
      }
    })
    const inboxSink = createInboxSink({ inbox: tasksInbox, broadcast: broadcastInbox })
    const sinks = { ...baseSinks, inbox: inboxSink }
    tasksScheduler = new TaskScheduler({ executor, sinks, persistence, broadcast: broadcastToAllWindows })
    tasksScheduler.persistence = persistence
    await tasksScheduler.init()
    sessionLinks = createSessionLinks({
      userDataDir: app.getPath('userData'),
      getTelegramSessionsByChat: null,
      getWhatsAppLinks: null
    })
    recentCwds = createRecentCwds({ userDataDir: app.getPath('userData') })
    lastContext = createLastContext({ userDataDir: app.getPath('userData') })
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
  pauseAgentProposalPolling()
  try { lanWsServer?.stop() } catch {}
  for (const s of sessions.values()) killPty(s)
  for (const s of agentPtySessions.values()) killAgentPty(s)
  try { telegramHiddenPtyPool?.destroy('app-quit') } catch {}
  telegramBridge?.stop()
  try { whatsappClient?.stop() } catch {}
  if (whatsappRetryTimer) { clearTimeout(whatsappRetryTimer); whatsappRetryTimer = null }
  try { if (typeof app.setBadgeCount === 'function') app.setBadgeCount(0) } catch {}
  try { tasksScheduler?.destroy() } catch {}
  try { codexSessionsIndex?.stopWatcher() } catch {}
})

// ── PTY IPC ──
ipcMain.handle('pty-start', (event, { cols, rows, cwd, cli, sessionId } = {}) => {
  const s = getSessionByEvent(event)
  if (!s) return null
  if (cli && (cli === 'claude' || cli === 'codex') && s.activeCli !== cli) {
    const switchResult = setActiveCli(s, cli)
    if (!switchResult.ok) {
      notifyPtyError(s, switchResult.error || 'No se pudo cambiar de CLI')
      throw new Error(switchResult.error || 'No se pudo cambiar de CLI')
    }
  }
  const args = sessionId ? buildResumeArgs(s.activeCli, sessionId) : []
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
  get codexIndex() { return codexSessionsIndex }
})
const {
  listClaudeSessionsForCwd,
  listCodexSessionsForCwd,
  listLanReusableSessions
} = _sessionListing

ipcMain.handle('list-sessions', async (event, cwd, cli) => {
  if (cli === 'codex') {
    return listCodexSessionsForCwd(cwd, { limit: 1000 })
  }
  return listClaudeSessionsForCwd(cwd, { limit: 1000 })
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
      try {
        startPty(s, cols, rows, cwd, buildResumeArgs(s.activeCli, sessionId))
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
      } catch (err) {
        reject(err)
      }
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

ipcMain.handle('get-app-config', () => JSON.parse(JSON.stringify(appConfig)))

registerProfilesEnterpriseIpc({
  ipcMain,
  dialog,
  winFromEvent,
  profilesApi: { listProfilesPayload, createProfile, updateProfile, deleteProfile, setActiveProfile },
  enterpriseApi: {
    listEnterprisePayload, saveEnterpriseConfig,
    createEnterpriseRole, updateEnterpriseRole, deleteEnterpriseRole,
    createEnterpriseOperator, updateEnterpriseOperator, deleteEnterpriseOperator
  }
})

ipcMain.handle('save-app-config', async (event, partialConfig) => {
  const previousDefault = appConfig.cli.defaultCli
  const enterprisePatch = partialConfig?.enterprise
  const mergedEnterprise = enterprisePatch
    ? {
      ...appConfig.enterprise,
      ...enterprisePatch,
      roles: enterprisePatch?.roles ?? appConfig?.enterprise?.roles,
      operators: enterprisePatch?.operators ?? appConfig?.enterprise?.operators
    }
    : appConfig.enterprise
  const merged = normalizeAppConfig({
    ...appConfig,
    ...partialConfig,
    cli: { ...appConfig.cli, ...(partialConfig?.cli || {}) },
    telegram: { ...appConfig.telegram, ...(partialConfig?.telegram || {}) },
    lanServer: { ...appConfig.lanServer, ...(partialConfig?.lanServer || {}) },
    profiles: partialConfig?.profiles ?? appConfig.profiles,
    activeProfile: partialConfig?.activeProfile ?? appConfig.activeProfile,
    enterprise: mergedEnterprise
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
  if (Object.prototype.hasOwnProperty.call(partialConfig || {}, 'lanServer')) {
    if (appConfig.lanServer?.enabled) {
      try {
        await startLanServer({ port: appConfig.lanServer.port, persist: false })
      } catch (err) {
        warnings.push(`Config guardada pero no pude iniciar servidor LAN: ${err?.message || err}`)
      }
    } else {
      try { await stopLanServer({ persist: false }) } catch {}
    }
  }
  return { ok: telegramResult.ok, telegram: telegramResult, warnings, config: appConfig }
})

ipcMain.handle('get-telegram-status', () => telegramBridge?.getStatus() || null)

ipcMain.handle('health:get', async (event) => {
  const s = getSessionByEvent(event) || (primaryWcId != null ? sessions.get(primaryWcId) : null)
  return collectHealthSnapshot(s)
})

registerWsServerIpc({
  ipcMain,
  startLanServer,
  stopLanServer,
  getLanServerStatus,
  getLanWsServer: () => lanWsServer,
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
