// ── Window id (per-window localStorage scoping) ──
const WID = new URLSearchParams(location.search).get('wid') || '0'

// ── DOM ──
const btnTheme = document.getElementById('btn-theme')
const btnNewWindow = document.getElementById('btn-new-window')
const btnRestart = document.getElementById('btn-restart')
const btnMinimize = document.getElementById('btn-minimize')
const btnClose = document.getElementById('btn-close')
const btnPin = document.getElementById('btn-pin')
const btnMic = document.getElementById('btn-mic')
const btnImage = document.getElementById('btn-image')
const btnFile = document.getElementById('btn-file')
const btnSidebar = document.getElementById('btn-sidebar')
const btnSettings = document.getElementById('btn-settings')
const btnBitacora = document.getElementById('btn-bitacora')
const btnProposals = document.getElementById('btn-proposals')
const proposalBadge = document.getElementById('proposal-badge')
const btnTasksInbox = document.getElementById('btn-tasks-inbox')
const tasksInboxBadge = document.getElementById('tasks-inbox-badge')
const proposalModal = document.getElementById('proposal-modal')
const proposalModalId = document.getElementById('proposal-modal-id')
const proposalTitle = document.getElementById('proposal-title')
const proposalDescription = document.getElementById('proposal-description')
const proposalCommand = document.getElementById('proposal-command')
const proposalScriptPath = document.getElementById('proposal-script-path')
const proposalScriptPreview = document.getElementById('proposal-script-preview')
const btnProposalApprove = document.getElementById('btn-proposal-approve')
const btnProposalReject = document.getElementById('btn-proposal-reject')
const btnOpenGraphWindow = document.getElementById('btn-open-graph-window')
const btnSendTelegram = document.getElementById('btn-send-telegram')
const btnSendTelegramWrap = document.getElementById('btn-send-telegram-wrap')
const cliSelector = document.getElementById('cli-selector')
const profileSelector = document.getElementById('profile-selector')
const profileReminder = document.getElementById('profile-reminder')
const profileReminderName = document.getElementById('profile-reminder-name')
const profileReminderMcp = document.getElementById('profile-reminder-mcp')
const termEl = document.getElementById('terminal')
const termWrap = document.getElementById('terminal-wrap')
const dropOverlay = document.getElementById('drop-overlay')
const statusBar = document.getElementById('status-bar')
const statusText = document.getElementById('status-text')
const sidebar = document.getElementById('sidebar')
const sidebarTitle = document.getElementById('sidebar-title')
const treeEl = document.getElementById('tree')
const divider = document.getElementById('divider')
const btnOpenFolder = document.getElementById('btn-open-folder')
const btnRefreshTree = document.getElementById('btn-refresh-tree')
const btnRemoteSessionsToggle = document.getElementById('btn-remote-sessions-toggle')
const graphCanvas = document.getElementById('graph-canvas')
const graphFilters = document.getElementById('graph-filters')
const btnViewTree = document.getElementById('btn-view-tree')
const btnViewGraph = document.getElementById('btn-view-graph')
const btnWorkHere = document.getElementById('btn-work-here')
const cwdValue = document.getElementById('cwd-value')
const btnSessions = document.getElementById('btn-sessions')
const sessionsModal = document.getElementById('sessions-modal')
const sessionsList = document.getElementById('sessions-list')
const sessionsSearchInput = document.getElementById('sessions-search')
const sessionsCwd = document.getElementById('sessions-cwd')
const sessionsEmpty = document.getElementById('sessions-empty')
const btnCloseSessions = document.getElementById('btn-close-sessions')
const settingsModal = document.getElementById('settings-modal')
const btnCloseSettings = document.getElementById('btn-close-settings')
const btnSaveSettings = document.getElementById('btn-save-settings')
const btnRefreshTelegramStatus = document.getElementById('btn-refresh-telegram-status')
const cfgDefaultCli = document.getElementById('cfg-default-cli')
const cfgClaudeBin = document.getElementById('cfg-claude-bin')
const cfgClaudeModel = document.getElementById('cfg-claude-model')
const cfgGitIsolation = document.getElementById('cfg-git-isolation')
const cfgGitIsolationExcludes = document.getElementById('cfg-git-isolation-excludes')
const cfgCodexBin = document.getElementById('cfg-codex-bin')
const cfgWhisperBin = document.getElementById('cfg-whisper-bin')
const cfgVoiceId = document.getElementById('cfg-voice-id')
const cfgVoiceRate = document.getElementById('cfg-voice-rate')
const cfgVoiceRateLabel = document.getElementById('cfg-voice-rate-label')
const cfgVoiceSilence = document.getElementById('cfg-voice-silence')
const cfgVoiceSilenceLabel = document.getElementById('cfg-voice-silence-label')
const cfgTelegramEnabled = document.getElementById('cfg-telegram-enabled')
const cfgTelegramToken = document.getElementById('cfg-telegram-token')
const cfgTelegramUsers = document.getElementById('cfg-telegram-users')
const cfgTelegramPairingBlock = document.getElementById('cfg-telegram-pairing-block')
const cfgTelegramPairingList = document.getElementById('cfg-telegram-pairing-list')
const cfgTelegramNotifyToken = document.getElementById('cfg-telegram-notify-token')
const cfgTelegramNotifyChat = document.getElementById('cfg-telegram-notify-chat')
const cfgTelegramClaudeModel = document.getElementById('cfg-telegram-claude-model')
const cfgTelegramClaudeEffort = document.getElementById('cfg-telegram-claude-effort')
const cfgTelegramCodexModel = document.getElementById('cfg-telegram-codex-model')
const cfgTelegramCodexEffort = document.getElementById('cfg-telegram-codex-effort')
const cfgTelegramStatus = document.getElementById('cfg-telegram-status')
const cfgLanEnabled = document.getElementById('cfg-lan-enabled')
const cfgLanPort = document.getElementById('cfg-lan-port')
const cfgLanStatus = document.getElementById('cfg-lan-status')
const cfgLanUrl = document.getElementById('cfg-lan-url')
const cfgLanClientUrl = document.getElementById('cfg-lan-client-url')
const cfgLanQr = document.getElementById('cfg-lan-qr')
const cfgEnterpriseEnabled = document.getElementById('cfg-enterprise-enabled')
const cfgEnterpriseStatus = document.getElementById('cfg-enterprise-status')
const btnOpenEnterpriseModal = document.getElementById('btn-open-enterprise-modal')
const sessionStripCli = document.getElementById('session-strip-cli')
const sessionStripTitle = document.getElementById('session-strip-title')
const sessionStripEdit = document.getElementById('session-strip-edit')
const sessionStripId = document.getElementById('session-strip-id')
const sessionStripIsolation = document.getElementById('session-strip-isolation')
const healthIndicator = document.getElementById('health-indicator')
const healthGlobalDot = document.getElementById('health-global-dot')
const healthDotPty = document.getElementById('health-dot-pty')
const healthDotTelegram = document.getElementById('health-dot-telegram')
const healthDotWhatsapp = document.getElementById('health-dot-whatsapp')
const healthDotLaunchd = document.getElementById('health-dot-launchd')
const healthDotScheduler = document.getElementById('health-dot-scheduler')
const healthPopover = document.getElementById('health-popover')
const healthPopoverList = document.getElementById('health-popover-list')
const healthPopoverMeta = document.getElementById('health-popover-meta')
const updateBanner = document.getElementById('update-banner')
const updateBannerText = document.getElementById('update-banner-text')
const btnInstallUpdate = document.getElementById('btn-install-update')
const profilePopover = document.getElementById('profile-popover')
const profilePopoverMain = document.getElementById('profile-popover-main')
const profilePopoverClaudeMd = document.getElementById('profile-popover-claude-md')
const profilePopoverCwd = document.getElementById('profile-popover-cwd')
const profilePopoverMcps = document.getElementById('profile-popover-mcps')
const profilePopoverMcpsEffective = document.getElementById('profile-popover-mcps-effective')
const profilesModal = document.getElementById('profiles-modal')
const btnCloseProfiles = document.getElementById('btn-close-profiles')
const profilesListEl = document.getElementById('profiles-list')
const btnProfileNew = document.getElementById('btn-profile-new')
const btnProfileDelete = document.getElementById('btn-profile-delete')
const btnProfileSave = document.getElementById('btn-profile-save')
const profileNameInput = document.getElementById('profile-name')
const profileClaudeMdInput = document.getElementById('profile-claude-md')
const profileMcpsInput = document.getElementById('profile-mcps')
const profileCwdInput = document.getElementById('profile-cwd')
const profilePersonaPromptInput = document.getElementById('profile-persona-prompt')
const profileFormNote = document.getElementById('profile-form-note')
const btnPickProfileClaudeMd = document.getElementById('btn-pick-profile-claude-md')
const btnPickProfileCwd = document.getElementById('btn-pick-profile-cwd')
const remoteSessionsPanel = document.getElementById('remote-sessions-panel')
const remoteSessionsListEl = document.getElementById('remote-sessions-list')
const remoteSessionsEmptyEl = document.getElementById('remote-sessions-empty')
const remoteSessionsCountEl = document.getElementById('remote-sessions-count')
const enterpriseModal = document.getElementById('enterprise-modal')
const btnCloseEnterprise = document.getElementById('btn-close-enterprise')
const enterpriseRolesListEl = document.getElementById('enterprise-roles-list')
const enterpriseOperatorsListEl = document.getElementById('enterprise-operators-list')
const enterpriseEditorEmpty = document.getElementById('enterprise-editor-empty')
const enterpriseRoleForm = document.getElementById('enterprise-role-form')
const enterpriseOperatorForm = document.getElementById('enterprise-operator-form')
const enterpriseModalStatus = document.getElementById('enterprise-modal-status')
const btnEnterpriseRoleNew = document.getElementById('btn-enterprise-role-new')
const btnEnterpriseOperatorNew = document.getElementById('btn-enterprise-operator-new')
const btnEnterpriseDelete = document.getElementById('btn-enterprise-delete')
const btnEnterpriseSave = document.getElementById('btn-enterprise-save')
const enterpriseRoleIdInput = document.getElementById('enterprise-role-id')
const enterpriseRoleNameInput = document.getElementById('enterprise-role-name')
const enterpriseRolePermPtyExecute = document.getElementById('enterprise-role-perm-pty-execute')
const enterpriseRolePermFsRead = document.getElementById('enterprise-role-perm-fs-read')
const enterpriseRolePermFsWrite = document.getElementById('enterprise-role-perm-fs-write')
const enterpriseRolePermFsList = document.getElementById('enterprise-role-perm-fs-list')
const enterpriseRolePermFsDelete = document.getElementById('enterprise-role-perm-fs-delete')
const enterpriseRolePermFsRename = document.getElementById('enterprise-role-perm-fs-rename')
const enterpriseRolePermViewerOpen = document.getElementById('enterprise-role-perm-viewer-open')
const enterpriseRolePermAutomationsManage = document.getElementById('enterprise-role-perm-automations-manage')
const enterpriseRoleAllowedRootsInput = document.getElementById('enterprise-role-allowed-roots')
const enterpriseRoleReadOnlyRootsInput = document.getElementById('enterprise-role-readonly-roots')
const enterpriseRoleAllowedMcpsInput = document.getElementById('enterprise-role-allowed-mcps')
const enterpriseOperatorIdInput = document.getElementById('enterprise-operator-id')
const enterpriseOperatorNameInput = document.getElementById('enterprise-operator-name')
const enterpriseOperatorUsernameInput = document.getElementById('enterprise-operator-username')
const enterpriseOperatorRoleIdInput = document.getElementById('enterprise-operator-role-id')
const enterpriseOperatorProfileIdInput = document.getElementById('enterprise-operator-profile-id')
const enterpriseOperatorEnabledInput = document.getElementById('enterprise-operator-enabled')
const enterpriseOperatorPersonaInput = document.getElementById('enterprise-operator-persona')
const ENTERPRISE_PERMISSION_INPUTS = {
  'pty.execute': enterpriseRolePermPtyExecute,
  'fs.read': enterpriseRolePermFsRead,
  'fs.write': enterpriseRolePermFsWrite,
  'fs.list': enterpriseRolePermFsList,
  'fs.delete': enterpriseRolePermFsDelete,
  'fs.rename': enterpriseRolePermFsRename,
  'viewer.open': enterpriseRolePermViewerOpen,
  'automations.manage': enterpriseRolePermAutomationsManage
}

// ── Themes ──
const THEMES = {
  dark: {
    foreground: '#e8e8f0', background: '#1a1a1f',
    cursor: '#7c6af7', cursorAccent: '#1a1a1f',
    selectionBackground: '#3a3a48',
    black: '#1a1a1f', red: '#ff6b7a', green: '#7cd99c', yellow: '#f0c060',
    blue: '#7aa8ff', magenta: '#c878e0', cyan: '#5ed4d4', white: '#d0d0e0',
    brightBlack: '#5a5a70', brightRed: '#ff8090', brightGreen: '#90e8b0',
    brightYellow: '#ffd070', brightBlue: '#90b8ff', brightMagenta: '#d890f0',
    brightCyan: '#70e8e8', brightWhite: '#ffffff'
  },
  light: {
    foreground: '#1a1a2e', background: '#fafafd',
    cursor: '#5b4fe8', cursorAccent: '#fafafd',
    selectionBackground: '#d0d0e0',
    black: '#1a1a2e', red: '#d83040', green: '#3a9050', yellow: '#a8730a',
    blue: '#3a60c8', magenta: '#9040b8', cyan: '#1a8080', white: '#606080',
    brightBlack: '#404060', brightRed: '#e04050', brightGreen: '#4ca060',
    brightYellow: '#b8830a', brightBlue: '#4a70d8', brightMagenta: '#a050c8',
    brightCyan: '#2a9090', brightWhite: '#1a1a2e'
  }
}

const term = new Terminal({
  fontFamily: 'Menlo, Monaco, "SF Mono", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.2,
  cursorBlink: true,
  cursorStyle: 'bar',
  allowTransparency: false,
  scrollback: 10000,
  theme: THEMES.dark
})

const fitAddon = new FitAddon.FitAddon()
const webLinksAddon = new WebLinksAddon.WebLinksAddon()
term.loadAddon(fitAddon)
term.loadAddon(webLinksAddon)
term.open(termEl)

const HEALTH_POLL_MS = 15_000

// Clic en el terminal → mover cursor readline a esa columna (solo fila activa del prompt)
let _termClickPending = null

termEl.addEventListener('mousedown', (e) => {
  _termClickPending = null
  if (e.button !== 0) return
  if (term.buffer.active === term.buffer.alternate) return // vim, less, etc.
  const screen = termEl.querySelector('.xterm-screen')
  if (!screen) return
  const rect = screen.getBoundingClientRect()
  const buf = term.buffer.active
  const clickCol = Math.max(0, Math.floor((e.clientX - rect.left) * term.cols / rect.width))
  const clickRow = Math.max(0, Math.floor((e.clientY - rect.top) * term.rows / rect.height))
  if (clickRow !== buf.cursorY) return
  const diff = clickCol - buf.cursorX
  if (diff === 0 || Math.abs(diff) > 300) return
  _termClickPending = diff
}, true)

termEl.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || _termClickPending == null) return
  const diff = _termClickPending
  _termClickPending = null
  if (term.hasSelection()) return
  window.api.writePty(diff < 0 ? '\x1b[D'.repeat(-diff) : '\x1b[C'.repeat(diff))
})

// Borrar selección del prompt con Backspace/Delete
term.attachCustomKeyEventHandler((e) => {
  if (e.type !== 'keydown') return true
  if (e.key !== 'Backspace' && e.key !== 'Delete') return true
  if (!term.hasSelection()) return true
  const sel = term.getSelectionPosition()
  if (!sel) return true
  const buf = term.buffer.active
  if (sel.start.y !== buf.cursorY || sel.end.y !== buf.cursorY) return true
  const len = term.getSelection().length
  if (!len) return true
  term.clearSelection()
  const toEnd = sel.end.x - buf.cursorX
  let seq = ''
  if (toEnd > 0) seq += '\x1b[C'.repeat(toEnd)
  else if (toEnd < 0) seq += '\x1b[D'.repeat(-toEnd)
  seq += '\x7f'.repeat(len)
  window.api.writePty(seq)
  return false
})

function applyTermTheme(name) {
  document.body.classList.remove('dark', 'light')
  document.body.classList.add(name)
  term.options.theme = THEMES[name]
  localStorage.setItem('claude-electron-theme', name)
}

async function initTheme() {
  let saved = localStorage.getItem('claude-electron-theme')
  if (!saved) saved = await window.api.getSystemTheme()
  applyTermTheme(saved)
}

const DEFAULT_TERM_COLS = 120
const DEFAULT_TERM_ROWS = 35

// Fit/resize por instancia de terminal. observeEl: contenedor cuyo tamaño
// dispara refits. sendResize(cols, rows): sincroniza el PTY correspondiente.
function createTermFit({ term, fitAddon, observeEl, sendResize }) {
  const pendingTimers = []
  let debounceId = null
  let observer = null

  function clearPending() {
    while (pendingTimers.length) {
      const id = pendingTimers.pop()
      try { clearTimeout(id) } catch {}
    }
  }

  function getSafeSize({ forceFit = true } = {}) {
    if (forceFit) {
      try { fitAddon.fit() } catch {}
    }
    let cols = Number(term.cols || 0)
    let rows = Number(term.rows || 0)
    if (!Number.isFinite(cols) || cols < 40) cols = DEFAULT_TERM_COLS
    if (!Number.isFinite(rows) || rows < 10) rows = DEFAULT_TERM_ROWS
    cols = Math.max(40, Math.min(260, Math.floor(cols)))
    rows = Math.max(10, Math.min(120, Math.floor(rows)))
    return { cols, rows }
  }

  function fitAndSync(options = {}) {
    const { cols, rows } = getSafeSize(options)
    try { sendResize(cols, rows) } catch {}
    return { cols, rows }
  }

  function fitDebounced() {
    if (debounceId) clearTimeout(debounceId)
    debounceId = setTimeout(() => {
      fitAndSync({ forceFit: true })
      debounceId = null
    }, 140)
  }

  function scheduleRefit(options = {}) {
    clearPending()
    const delays = [0, 80, 180, 360, 720, 1200]
    for (const delay of delays) {
      const id = setTimeout(() => {
        fitAndSync({ forceFit: options.forceFit !== false })
      }, delay)
      pendingTimers.push(id)
    }
  }

  if (window.ResizeObserver && observeEl) {
    try {
      observer = new ResizeObserver(() => scheduleRefit({ forceFit: true }))
      observer.observe(observeEl)
    } catch {}
  }

  function dispose() {
    if (debounceId) { clearTimeout(debounceId); debounceId = null }
    clearPending()
    if (observer) {
      try { observer.disconnect() } catch {}
      observer = null
    }
  }

  return { fitAndSync, fitDebounced, scheduleRefit, dispose, getSafeSize }
}

const mainTermFit = createTermFit({
  term,
  fitAddon,
  observeEl: termEl, // antes se observaba termWrap; observar #terminal reacciona también al split
  sendResize: (cols, rows) => window.api.resizePty(cols, rows)
})

// Wrappers de compatibilidad: el resto del archivo llama a estos nombres.
function getSafeTerminalSize(options = {}) { return mainTermFit.getSafeSize(options) }
function fitAndSync(options = {}) { return mainTermFit.fitAndSync(options) }
function fitAndSyncDebounced() { mainTermFit.fitDebounced() }
function scheduleTerminalRefit(options = {}) { mainTermFit.scheduleRefit(options) }

// ── Sub-chat desechable ──
let subchatTerm = null
let subchatFit = null
let subchatOffData = null
let subchatOffExit = null
let subchatOpening = false
// El pty del sub-chat murió (madre cerrada, crash del fork, start rechazado)
// pero el panel/xterm se dejan visibles para que el mensaje de error no
// desaparezca solo. Solo ✕ o el toggle Cmd+Shift+S hacen la limpieza final.
let subchatDead = false
const subchatPane = document.getElementById('subchat-pane')
const subchatDividerEl = document.getElementById('subchat-divider')
const subchatTermEl = document.getElementById('subchat-terminal')
const btnSubchat = document.getElementById('btn-subchat')
const btnSubchatClose = document.getElementById('btn-subchat-close')

// Deja el pty por muerto pero el panel abierto: escribe el motivo en el
// xterm, suelta los listeners IPC (ya no hay nada al otro lado) y espera a
// que el usuario cierre con ✕ o el toggle. Usada tanto por subchat:exit
// como por cualquier fallo al arrancar (IMPORTANT 3 e IMPORTANT 4 comparten
// este mismo camino: el panel se queda vivo mostrando el error).
function killSubchatPaneKeepVisible(message) {
  if (subchatTerm) { try { subchatTerm.write(message) } catch {} }
  if (subchatOffData) { try { subchatOffData() } catch {} subchatOffData = null }
  if (subchatOffExit) { try { subchatOffExit() } catch {} subchatOffExit = null }
  subchatDead = true
}

function handleSubchatExit(payload) {
  const code = payload?.code
  const suffix = (code === null || code === undefined) ? '' : ` (code ${code})`
  killSubchatPaneKeepVisible(`\r\n\x1b[33m[sub-chat terminó${suffix}]\x1b[0m\r\n`)
}

async function openSubchatPane() {
  if (subchatTerm || subchatOpening) return
  subchatOpening = true
  try {
    const can = await window.api.subchat.canStart()
    if (!can?.ok) {
      if (btnSubchat) btnSubchat.title = `Sub-chat: ${can?.reason || 'no disponible'}`
      return
    }
    subchatDead = false
    subchatPane.classList.remove('hidden')
    subchatDividerEl.classList.remove('hidden')
    subchatTerm = new Terminal({
      fontFamily: 'Menlo, Monaco, "SF Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: false,
      scrollback: 5000,
      theme: term.options.theme
    })
    const subchatFitAddon = new FitAddon.FitAddon()
    subchatTerm.loadAddon(subchatFitAddon)
    subchatTerm.open(subchatTermEl)
    subchatFit = createTermFit({
      term: subchatTerm,
      fitAddon: subchatFitAddon,
      observeEl: subchatTermEl,
      sendResize: (cols, rows) => window.api.subchat.resize(cols, rows)
    })
    subchatTerm.onData((d) => window.api.subchat.write(d))
    subchatOffData = window.api.subchat.onData((d) => subchatTerm?.write(d))
    subchatOffExit = window.api.subchat.onExit((payload) => handleSubchatExit(payload))
    const size = subchatFit.getSafeSize({ forceFit: true })
    try {
      const r = await window.api.subchat.start(size.cols, size.rows)
      if (!r?.ok) {
        killSubchatPaneKeepVisible(`\r\n\x1b[31m${r?.error || 'No se pudo abrir el sub-chat'}\x1b[0m\r\n`)
        return
      }
    } catch (err) {
      killSubchatPaneKeepVisible(`\r\n\x1b[31m${err?.message || 'No se pudo abrir el sub-chat'}\x1b[0m\r\n`)
      return
    }
    subchatFit.scheduleRefit({ forceFit: true })
    mainTermFit.scheduleRefit({ forceFit: true })
    subchatTerm.focus()
  } finally {
    subchatOpening = false
  }
}

function closeSubchatPane({ notifyMain = true } = {}) {
  if (notifyMain) { try { window.api.subchat.close() } catch {} }
  if (subchatOffData) { try { subchatOffData() } catch {} subchatOffData = null }
  if (subchatOffExit) { try { subchatOffExit() } catch {} subchatOffExit = null }
  if (subchatFit) { try { subchatFit.dispose() } catch {} subchatFit = null }
  if (subchatTerm) { try { subchatTerm.dispose() } catch {} subchatTerm = null }
  subchatDead = false
  subchatPane.classList.add('hidden')
  subchatDividerEl.classList.add('hidden')
  subchatPane.style.flexBasis = ''
  mainTermFit.scheduleRefit({ forceFit: true })
  term.focus()
}

if (btnSubchat) btnSubchat.addEventListener('click', () => { openSubchatPane() })
if (btnSubchatClose) btnSubchatClose.addEventListener('click', () => closeSubchatPane())

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyS') {
    e.preventDefault()
    if (subchatTerm) closeSubchatPane()
    else openSubchatPane()
  }
})

// Divisor arrastrable: ajusta flex-basis del panel en % del row.
;(function initSubchatDivider() {
  let dragging = false
  subchatDividerEl.addEventListener('mousedown', (e) => {
    dragging = true
    e.preventDefault()
  })
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return
    const row = document.getElementById('terminal-row')
    const rect = row.getBoundingClientRect()
    const pct = Math.max(20, Math.min(70, ((rect.right - e.clientX) / rect.width) * 100))
    subchatPane.style.flexBasis = `${pct}%`
  })
  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    if (subchatFit) subchatFit.scheduleRefit({ forceFit: true })
    mainTermFit.scheduleRefit({ forceFit: true })
  })
})()

window.addEventListener('resize', () => {
  mainTermFit.fitDebounced()
  if (subchatFit) subchatFit.fitDebounced()
})
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    mainTermFit.scheduleRefit({ forceFit: true })
    if (subchatFit) subchatFit.scheduleRefit({ forceFit: true })
  })
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  mainTermFit.scheduleRefit({ forceFit: true })
  if (subchatFit) subchatFit.scheduleRefit({ forceFit: true })
})
window.addEventListener('beforeunload', () => {
  mainTermFit.dispose()
  if (subchatFit) subchatFit.dispose()
})

// ── Status bar ──
let statusTimer = null
function showStatus(text, type = 'info', ms = 0) {
  statusText.textContent = text
  statusBar.className = `status-${type}`
  statusBar.classList.remove('hidden')
  clearTimeout(statusTimer)
  if (ms > 0) statusTimer = setTimeout(hideStatus, ms)
}
function hideStatus() {
  statusBar.classList.add('hidden')
}

let latestHealth = null
let healthRefreshInFlight = false
let healthPopoverOpen = false
let healthOutsideClickHandler = null
let healthEscapeHandler = null
let pendingProposal = null
let proposalActionInFlight = false
let updateState = 'idle'
let updateInstallInFlight = false
let lanServerSnapshot = null
let lanStatusRefreshInFlight = false
const REMOTE_SESSIONS_VISIBLE_KEY = `poweragent.remote-sessions.visible:${WID}`
let remoteSessionsUserVisible = false
try {
  remoteSessionsUserVisible = localStorage.getItem(REMOTE_SESSIONS_VISIBLE_KEY) === '1'
} catch {
  remoteSessionsUserVisible = false
}
let sessionStripMetaSnapshot = null
let sessionStripEditInput = null
let fullRestartInFlight = null
let queuedFullRestartCwd = ''
const ENTERPRISE_PERMISSION_KEYS = [
  'pty.execute',
  'fs.read',
  'fs.write',
  'fs.list',
  'fs.delete',
  'fs.rename',
  'viewer.open',
  'automations.manage'
]
const ENTERPRISE_DEFAULTS = Object.freeze({
  enabled: false,
  roles: [],
  operators: []
})
let enterpriseState = { enabled: false, roles: [], operators: [] }
let enterpriseApiAvailable = false
let enterpriseApiLastError = ''
let enterpriseSelection = { type: '', id: '' }

function renderUpdateBanner() {
  if (!updateBanner || !updateBannerText || !btnInstallUpdate) return
  if (updateState === 'idle') {
    updateBanner.classList.add('hidden')
    updateBanner.classList.remove('ready')
    btnInstallUpdate.classList.add('hidden')
    return
  }
  const downloaded = updateState === 'downloaded'
  updateBanner.classList.remove('hidden')
  updateBanner.classList.toggle('ready', downloaded)
  updateBannerText.textContent = downloaded
    ? 'Actualización descargada. Lista para instalar.'
    : 'Nueva versión disponible, descargando...'
  btnInstallUpdate.classList.toggle('hidden', !downloaded)
  btnInstallUpdate.disabled = updateInstallInFlight
}

async function installDownloadedUpdate() {
  if (updateInstallInFlight) return
  if (!window.api.installUpdate) return
  updateInstallInFlight = true
  renderUpdateBanner()
  showStatus('Instalando actualización y reiniciando…', 'busy')
  try {
    const result = await window.api.installUpdate()
    if (result && result.ok === false) throw new Error(result.error || 'No se pudo instalar la actualización')
  } catch (err) {
    updateInstallInFlight = false
    renderUpdateBanner()
    showStatus(errorMessage(err), 'error', 7000)
  }
}

function setDotState(el, state) {
  if (!el) return
  el.classList.remove('state-ok', 'state-warn', 'state-error', 'state-off')
  el.classList.add(`state-${state}`)
}

function mapPtyDotState(state) {
  if (state === 'active') return 'ok'
  if (state === 'error') return 'error'
  return 'off'
}

function mapTelegramDotState(state) {
  if (state === 'linked') return 'ok'
  if (state === 'disconnected') return 'warn'
  if (state === 'error') return 'error'
  return 'off'
}

function mapWhatsappDotState(state) {
  if (state === 'ready') return 'ok'
  if (state === 'disconnected') return 'warn'
  if (state === 'error') return 'error'
  return 'off'
}

function mapLaunchdDotState(service) {
  if (service?.state === 'error') return 'error'
  const count = Number(service?.count || 0)
  return count > 0 ? 'ok' : 'warn'
}

function mapSchedulerDotState(service) {
  if (service?.state === 'error') return 'error'
  const count = Number(service?.activeJobs || 0)
  return count > 0 ? 'ok' : 'off'
}

function renderHealthPopoverRows(health) {
  if (!healthPopoverList) return
  const rows = [
    {
      name: 'PTY',
      dot: mapPtyDotState(health?.pty?.state),
      detail: `${health?.pty?.state || 'n/d'} · CLI ${health?.pty?.cli || 'claude'}`
    },
    {
      name: 'Telegram',
      dot: mapTelegramDotState(health?.telegram?.state),
      detail: `${health?.telegram?.state || 'n/d'} · ${health?.telegram?.detail || '-'}`
    },
    {
      name: 'WhatsApp',
      dot: mapWhatsappDotState(health?.whatsapp?.state),
      detail: `${health?.whatsapp?.state || 'n/d'} · ${health?.whatsapp?.detail || '-'}`
    },
    {
      name: 'Launchd',
      dot: mapLaunchdDotState(health?.launchd),
      detail: `${Number(health?.launchd?.count || 0)} jobs com.luismi activos`
    },
    {
      name: 'Scheduler',
      dot: mapSchedulerDotState(health?.scheduler),
      detail: `${Number(health?.scheduler?.activeJobs || 0)} jobs · ${Number(health?.scheduler?.runningJobs || 0)} ejecutándose`
    }
  ]

  healthPopoverList.innerHTML = rows.map((row) => (
    `<div class="health-popover-row">
      <span class="health-dot state-${row.dot}"></span>
      <span class="health-popover-service">${row.name}</span>
      <span class="health-popover-detail" title="${row.detail.replace(/"/g, '&quot;')}">${row.detail}</span>
    </div>`
  )).join('')
}

function positionHealthPopover() {
  if (!healthIndicator || !healthPopover || healthPopover.classList.contains('hidden')) return
  const r = healthIndicator.getBoundingClientRect()
  const gap = 8
  const maxRight = window.innerWidth - 10
  let left = r.right - healthPopover.offsetWidth
  if (left < 10) left = 10
  if (left + healthPopover.offsetWidth > maxRight) left = maxRight - healthPopover.offsetWidth
  const top = Math.min(window.innerHeight - healthPopover.offsetHeight - 10, r.bottom + gap)
  healthPopover.style.left = `${Math.max(10, left)}px`
  healthPopover.style.top = `${Math.max(10, top)}px`
}

function closeHealthPopover() {
  if (!healthPopover) return
  healthPopover.classList.add('hidden')
  healthPopoverOpen = false
  if (healthIndicator) healthIndicator.setAttribute('aria-expanded', 'false')
  if (healthOutsideClickHandler) {
    document.removeEventListener('mousedown', healthOutsideClickHandler, true)
    window.removeEventListener('resize', positionHealthPopover)
    healthOutsideClickHandler = null
  }
  if (healthEscapeHandler) {
    window.removeEventListener('keydown', healthEscapeHandler)
    healthEscapeHandler = null
  }
}

function openHealthPopover() {
  if (!healthPopover || !healthIndicator) return
  healthPopover.classList.remove('hidden')
  healthPopoverOpen = true
  healthIndicator.setAttribute('aria-expanded', 'true')
  renderHealthPopoverRows(latestHealth)
  positionHealthPopover()
  healthOutsideClickHandler = (ev) => {
    if (healthPopover.contains(ev.target) || healthIndicator.contains(ev.target)) return
    closeHealthPopover()
  }
  healthEscapeHandler = (ev) => {
    if (ev.key === 'Escape') closeHealthPopover()
  }
  document.addEventListener('mousedown', healthOutsideClickHandler, true)
  window.addEventListener('resize', positionHealthPopover)
  window.addEventListener('keydown', healthEscapeHandler)
}

function renderHealthIndicator(health) {
  latestHealth = health || latestHealth
  if (!healthIndicator) return

  const ptyDot = mapPtyDotState(health?.pty?.state)
  const telegramDot = mapTelegramDotState(health?.telegram?.state)
  const whatsappDot = mapWhatsappDotState(health?.whatsapp?.state)
  const launchdDot = mapLaunchdDotState(health?.launchd)
  const schedulerDot = mapSchedulerDotState(health?.scheduler)

  const hasError = [ptyDot, telegramDot, whatsappDot, launchdDot, schedulerDot].includes('error')
  const hasWarn = [ptyDot, telegramDot, whatsappDot, launchdDot, schedulerDot].includes('warn')
  const globalDot = hasError ? 'error' : (hasWarn ? 'warn' : 'ok')

  setDotState(healthGlobalDot, globalDot)
  setDotState(healthDotPty, ptyDot)
  setDotState(healthDotTelegram, telegramDot)
  setDotState(healthDotWhatsapp, whatsappDot)
  setDotState(healthDotLaunchd, launchdDot)
  setDotState(healthDotScheduler, schedulerDot)

  healthIndicator.classList.toggle('global-error', globalDot === 'error')
  const tooltip = [
    `PTY: ${health?.pty?.state || 'n/d'} (${health?.pty?.cli || 'claude'})`,
    `Telegram: ${health?.telegram?.state || 'n/d'}`,
    `WhatsApp: ${health?.whatsapp?.state || 'n/d'}`,
    `Launchd: ${Number(health?.launchd?.count || 0)} jobs`,
    `Scheduler: ${Number(health?.scheduler?.activeJobs || 0)} jobs`
  ].join('\n')
  healthIndicator.title = tooltip

  if (healthPopoverOpen) {
    renderHealthPopoverRows(health)
    if (healthPopoverMeta) {
      const ts = Number(health?.ts || Date.now())
      healthPopoverMeta.textContent = `Actualizado: ${new Date(ts).toLocaleTimeString('es-ES')}`
    }
    positionHealthPopover()
  }
}

async function refreshHealth(force = false) {
  if (!window.api.getHealth) return
  if (healthRefreshInFlight && !force) return
  healthRefreshInFlight = true
  try {
    const health = await window.api.getHealth()
    renderHealthIndicator(health)
    if (healthPopoverMeta && health?.ts) {
      healthPopoverMeta.textContent = `Actualizado: ${new Date(health.ts).toLocaleTimeString('es-ES')}`
    }
  } catch (err) {
    const fallback = {
      ts: Date.now(),
      pty: { state: 'error', cli: 'claude' },
      telegram: { state: 'error' },
      whatsapp: { state: 'error' },
      launchd: { state: 'error', count: 0 },
      scheduler: { state: 'error', activeJobs: 0, runningJobs: 0 }
    }
    renderHealthIndicator(fallback)
    if (healthPopoverMeta) healthPopoverMeta.textContent = `Error: ${errorMessage(err)}`
  } finally {
    healthRefreshInFlight = false
  }
}

if (healthIndicator) {
  healthIndicator.addEventListener('click', async (ev) => {
    ev.stopPropagation()
    if (healthPopoverOpen) {
      closeHealthPopover()
      return
    }
    await refreshHealth(true)
    openHealthPopover()
  })
}

function setProposalBadge(count) {
  if (!proposalBadge) return
  const n = Number(count || 0)
  proposalBadge.textContent = String(n)
  proposalBadge.classList.toggle('hidden', n <= 0)
}

function renderProposalModal(proposal) {
  const p = proposal || {}
  if (proposalModalId) proposalModalId.textContent = p.id ? `ID: ${p.id}` : ''
  if (proposalTitle) proposalTitle.textContent = p.title || 'Propuesta pendiente'
  if (proposalDescription) proposalDescription.textContent = p.description || '(sin descripción)'
  if (proposalCommand) proposalCommand.textContent = p.command || '(sin comando)'
  if (proposalScriptPath) proposalScriptPath.textContent = p.script_path || '(sin ruta)'
  if (proposalScriptPreview) proposalScriptPreview.textContent = p.script_preview || '(sin preview)'
}

function openProposalModal() {
  if (!proposalModal || !pendingProposal) return
  proposalModal.classList.remove('hidden')
}

function closeProposalModal() {
  if (!proposalModal) return
  proposalModal.classList.add('hidden')
}

function setProposalButtonsBusy(busy) {
  proposalActionInFlight = !!busy
  if (btnProposalApprove) btnProposalApprove.disabled = !!busy
  if (btnProposalReject) btnProposalReject.disabled = !!busy
}

function setPendingProposal(payload) {
  if (!payload || typeof payload !== 'object') return
  pendingProposal = {
    id: String(payload.id || '').trim(),
    title: String(payload.title || '').trim(),
    description: String(payload.description || '').trim(),
    command: String(payload.command || '').trim(),
    script_path: String(payload.script_path || '').trim(),
    script_preview: typeof payload.script_preview === 'string' ? payload.script_preview : ''
  }
  setProposalBadge(1)
  renderProposalModal(pendingProposal)
}

function clearPendingProposal() {
  pendingProposal = null
  setProposalBadge(0)
  closeProposalModal()
}

async function approvePendingProposal() {
  if (!pendingProposal || proposalActionInFlight) return
  setProposalButtonsBusy(true)
  try {
    const res = await window.api.proposalApprove?.(pendingProposal.id)
    if (!res || res.ok === false) {
      showStatus((res && res.error) || 'No se pudo aprobar la propuesta', 'error', 6500)
      return
    }
    clearPendingProposal()
    showStatus('Propuesta aprobada y enviada al PTY', 'ok', 3500)
  } catch (err) {
    showStatus(errorMessage(err), 'error', 6500)
  } finally {
    setProposalButtonsBusy(false)
  }
}

async function rejectPendingProposal() {
  if (!pendingProposal || proposalActionInFlight) return
  setProposalButtonsBusy(true)
  try {
    const res = await window.api.proposalReject?.(pendingProposal.id)
    if (!res || res.ok === false) {
      showStatus((res && res.error) || 'No se pudo rechazar la propuesta', 'error', 6500)
      return
    }
    clearPendingProposal()
    showStatus('Propuesta rechazada', 'warn', 3000)
  } catch (err) {
    showStatus(errorMessage(err), 'error', 6500)
  } finally {
    setProposalButtonsBusy(false)
  }
}

if (btnInstallUpdate) {
  btnInstallUpdate.addEventListener('click', () => {
    installDownloadedUpdate()
  })
}

if (typeof window.api.onUpdateAvailable === 'function') {
  window.api.onUpdateAvailable(() => {
    updateState = 'available'
    updateInstallInFlight = false
    renderUpdateBanner()
  })
}

if (typeof window.api.onUpdateDownloaded === 'function') {
  window.api.onUpdateDownloaded(() => {
    updateState = 'downloaded'
    updateInstallInFlight = false
    renderUpdateBanner()
  })
}
renderUpdateBanner()
const PROFILE_MANAGE_VALUE = '__manage_profiles__'
const DEFAULT_PROFILE_ID = 'default'
let profilesState = { profiles: [], activeProfile: DEFAULT_PROFILE_ID }
let profileModalSelectedId = DEFAULT_PROFILE_ID
let profilePopoverOpen = false
let profileOutsideClickHandler = null
let profileEscapeHandler = null

function copyProfilesState(payload) {
  const profiles = Array.isArray(payload?.profiles)
    ? payload.profiles.map((p) => ({
      id: String(p?.id || '').trim(),
      name: String(p?.name || '').trim(),
      claudeMdPath: String(p?.claudeMdPath || '').trim(),
      cwd: String(p?.cwd || '').trim(),
      personaPrompt: typeof p?.personaPrompt === 'string' ? p.personaPrompt : '',
      mcpServers: Array.isArray(p?.mcpServers) ? p.mcpServers.map((m) => String(m || '').trim()).filter(Boolean) : []
    }))
    : []
  const activeProfile = String(payload?.activeProfile || DEFAULT_PROFILE_ID).trim() || DEFAULT_PROFILE_ID
  return { profiles, activeProfile }
}

function getProfileById(id) {
  const wanted = String(id || '').trim()
  return profilesState.profiles.find((p) => p.id === wanted) || null
}

function getActiveProfile() {
  return getProfileById(profilesState.activeProfile) || getProfileById(DEFAULT_PROFILE_ID) || null
}

function normalizeMcpServerList(values) {
  if (!Array.isArray(values)) return []
  const unique = new Set()
  for (const value of values) {
    const mcp = String(value || '').trim()
    if (mcp) unique.add(mcp)
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
}

function summarizeMcpList(mcps, emptyText) {
  return mcps.length ? mcps.join(', ') : emptyText
}

function getEnterpriseEffectiveMcpSummary(profileId = '') {
  const sessions = Array.isArray(lanServerSnapshot?.sessions) ? lanServerSnapshot.sessions : []
  const enterpriseSessions = sessions.filter((session) => String(session?.context?.mode || '').trim() === 'enterprise')
  if (!enterpriseSessions.length) {
    return {
      applicable: false,
      sessionCount: 0,
      effectiveMcps: [],
      variantsCount: 0,
      shortText: '—',
      lineText: 'No aplica: no hay sesiones enterprise activas',
      detailText: 'No aplica: no hay sesiones enterprise activas'
    }
  }

  const wantedProfileId = String(profileId || '').trim()
  let scopedSessions = enterpriseSessions
  if (wantedProfileId) {
    const matched = enterpriseSessions.filter((session) => String(session?.context?.profileId || '').trim() === wantedProfileId)
    if (matched.length > 0) {
      scopedSessions = matched
    } else {
      return {
        applicable: false,
        sessionCount: 0,
        effectiveMcps: [],
        variantsCount: 0,
        shortText: '—',
        lineText: 'No aplica: no hay sesiones enterprise activas para este perfil',
        detailText: `No aplica: hay ${enterpriseSessions.length} sesión(es) enterprise, pero ninguna para el perfil activo`
      }
    }
  }

  const effectiveSet = new Set()
  const variants = new Set()
  for (const session of scopedSessions) {
    const allowed = normalizeMcpServerList(session?.context?.allowedMcpServers || [])
    for (const mcp of allowed) effectiveSet.add(mcp)
    variants.add(allowed.join('|'))
  }

  const effectiveMcps = Array.from(effectiveSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  const variantsCount = variants.size
  const sessionCount = scopedSessions.length
  const names = summarizeMcpList(effectiveMcps, 'ninguno')
  let detailText = ''
  if (variantsCount <= 1) {
    detailText = `${effectiveMcps.length} MCP en ${sessionCount} sesión(es): ${names}`
  } else {
    detailText = `${effectiveMcps.length} MCP únicos en ${sessionCount} sesiones (${variantsCount} combinaciones): ${names}`
  }

  return {
    applicable: true,
    sessionCount,
    effectiveMcps,
    variantsCount,
    shortText: `${effectiveMcps.length}`,
    lineText: `${effectiveMcps.length} en ${sessionCount} sesión(es) enterprise`,
    detailText
  }
}

function getProfileMcpSummary(profile) {
  const configuredMcps = normalizeMcpServerList(profile?.mcpServers || [])
  const effective = getEnterpriseEffectiveMcpSummary(profile?.id || '')
  const configuredNames = summarizeMcpList(configuredMcps, 'ninguno')
  const effectiveNames = summarizeMcpList(effective.effectiveMcps, 'ninguno')
  const badgeText = `MCP ${configuredMcps.length} · Emp ${effective.shortText}`
  const badgeTitle = [
    `MCP configurados del perfil activo: ${configuredNames}`,
    effective.applicable
      ? `MCP efectivos de sesión (modo empresa): ${effectiveNames}`
      : 'MCP efectivos de sesión (modo empresa): no aplica, sin sesiones enterprise activas'
  ].join('\n')

  return {
    badgeText,
    badgeTitle,
    configured: {
      count: configuredMcps.length,
      mcps: configuredMcps,
      rowText: configuredMcps.length
        ? `${configuredMcps.length} configurado(s): ${configuredNames}`
        : 'Sin MCP configurados en el perfil activo',
      tooltipText: `MCP configurados del perfil activo: ${configuredNames}`
    },
    effective: {
      applicable: effective.applicable,
      count: effective.effectiveMcps.length,
      mcps: effective.effectiveMcps,
      sessionCount: effective.sessionCount,
      variantsCount: effective.variantsCount,
      rowText: effective.lineText,
      tooltipText: effective.applicable
        ? `MCP efectivos de sesión (modo empresa): ${effective.detailText}`
        : 'MCP efectivos de sesión (modo empresa): no aplica, sin sesiones enterprise activas',
      detailText: effective.detailText
    }
  }
}

function renderProfileSelector(selectedId = '') {
  if (!profileSelector) return
  const activeId = selectedId || profilesState.activeProfile
  const options = profilesState.profiles.map((p) => ({
    value: p.id,
    label: p.name || p.id
  }))
  options.push({ value: PROFILE_MANAGE_VALUE, label: 'Gestionar perfiles...' })
  profileSelector.innerHTML = ''
  for (const opt of options) {
    const el = document.createElement('option')
    el.value = opt.value
    el.textContent = opt.label
    profileSelector.appendChild(el)
  }
  profileSelector.value = options.some((o) => o.value === activeId) ? activeId : profilesState.activeProfile
}

function renderProfileReminder() {
  const active = getActiveProfile()
  if (!profileReminderName || !profileReminderMcp) return
  const mcpSummary = getProfileMcpSummary(active)
  profileReminderName.textContent = active?.name || 'Perfil'
  profileReminderMcp.textContent = mcpSummary.badgeText
  profileReminderMcp.title = mcpSummary.badgeTitle
  if (profileReminder) {
    profileReminder.title = active
      ? `${active.name} · ${active.cwd || 'cwd actual'}\n${mcpSummary.badgeTitle}`
      : 'Perfil activo'
  }
  renderProfilePopover(mcpSummary)
}

function renderProfilePopover(mcpSummary = null) {
  const active = getActiveProfile()
  if (!profilePopoverMain) return
  if (!active) {
    profilePopoverMain.textContent = 'Sin perfil activo'
    profilePopoverClaudeMd.textContent = '-'
    profilePopoverCwd.textContent = '-'
    profilePopoverMcps.textContent = '-'
    if (profilePopoverMcpsEffective) profilePopoverMcpsEffective.textContent = '-'
    return
  }
  const summary = mcpSummary || getProfileMcpSummary(active)
  profilePopoverMain.textContent = `${active.name} (${active.id})`
  profilePopoverClaudeMd.textContent = active.claudeMdPath || 'No configurado'
  profilePopoverClaudeMd.title = active.claudeMdPath || 'No configurado'
  profilePopoverCwd.textContent = active.cwd || 'Usar cwd actual'
  profilePopoverCwd.title = active.cwd || 'Usar cwd actual'
  profilePopoverMcps.textContent = summary.configured.rowText
  profilePopoverMcps.title = summary.configured.tooltipText
  if (profilePopoverMcpsEffective) {
    profilePopoverMcpsEffective.textContent = summary.effective.rowText
    profilePopoverMcpsEffective.title = summary.effective.tooltipText
  }
}

function positionProfilePopover() {
  if (!profileReminder || !profilePopover || profilePopover.classList.contains('hidden')) return
  const r = profileReminder.getBoundingClientRect()
  const gap = 8
  let left = r.right - profilePopover.offsetWidth
  if (left < 10) left = 10
  if (left + profilePopover.offsetWidth > window.innerWidth - 10) {
    left = window.innerWidth - profilePopover.offsetWidth - 10
  }
  const top = Math.min(window.innerHeight - profilePopover.offsetHeight - 10, r.bottom + gap)
  profilePopover.style.left = `${Math.max(10, left)}px`
  profilePopover.style.top = `${Math.max(10, top)}px`
}

function closeProfilePopover() {
  if (!profilePopover) return
  profilePopover.classList.add('hidden')
  profilePopoverOpen = false
  profileReminder?.setAttribute('aria-expanded', 'false')
  if (profileOutsideClickHandler) {
    document.removeEventListener('mousedown', profileOutsideClickHandler, true)
    window.removeEventListener('resize', positionProfilePopover)
    profileOutsideClickHandler = null
  }
  if (profileEscapeHandler) {
    window.removeEventListener('keydown', profileEscapeHandler)
    profileEscapeHandler = null
  }
}

function openProfilePopover() {
  if (!profilePopover || !profileReminder) return
  renderProfilePopover()
  profilePopover.classList.remove('hidden')
  profilePopoverOpen = true
  profileReminder.setAttribute('aria-expanded', 'true')
  positionProfilePopover()
  profileOutsideClickHandler = (ev) => {
    if (profilePopover.contains(ev.target) || profileReminder.contains(ev.target)) return
    closeProfilePopover()
  }
  profileEscapeHandler = (ev) => {
    if (ev.key === 'Escape') closeProfilePopover()
  }
  document.addEventListener('mousedown', profileOutsideClickHandler, true)
  window.addEventListener('resize', positionProfilePopover)
  window.addEventListener('keydown', profileEscapeHandler)
}

async function refreshProfilesState() {
  if (!window.api.listProfiles) return profilesState
  try {
    const payload = await window.api.listProfiles()
    profilesState = copyProfilesState(payload)
  } catch {
    return profilesState
  }
  if (!profilesState.profiles.length) {
    profilesState = {
      profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Personal', claudeMdPath: '', mcpServers: [], cwd: '', personaPrompt: '' }],
      activeProfile: DEFAULT_PROFILE_ID
    }
  }
  if (!getProfileById(profilesState.activeProfile)) profilesState.activeProfile = profilesState.profiles[0].id
  return profilesState
}

function readProfileForm() {
  return {
    name: profileNameInput?.value?.trim() || '',
    claudeMdPath: profileClaudeMdInput?.value?.trim() || '',
    mcpServers: (profileMcpsInput?.value || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    cwd: profileCwdInput?.value?.trim() || '',
    personaPrompt: profilePersonaPromptInput?.value || ''
  }
}

function fillProfileForm(profile) {
  if (!profile) return
  profileNameInput.value = profile.name || ''
  profileClaudeMdInput.value = profile.claudeMdPath || ''
  profileMcpsInput.value = Array.isArray(profile.mcpServers) ? profile.mcpServers.join(', ') : ''
  profileCwdInput.value = profile.cwd || ''
  if (profilePersonaPromptInput) profilePersonaPromptInput.value = profile.personaPrompt || ''
  const locked = profile.id === DEFAULT_PROFILE_ID
  btnProfileDelete.disabled = locked
  if (profileFormNote) {
    profileFormNote.textContent = locked
      ? 'El perfil Personal no se puede borrar.'
      : 'Puedes borrar este perfil cuando quieras.'
  }
}

function renderProfilesModalList() {
  if (!profilesListEl) return
  profilesListEl.innerHTML = ''
  for (const profile of profilesState.profiles) {
    const row = document.createElement('div')
    row.className = 'profile-item' + (profile.id === profileModalSelectedId ? ' active' : '')
    const mcps = Array.isArray(profile.mcpServers) ? profile.mcpServers.length : 0
    const nameEl = document.createElement('div')
    nameEl.className = 'profile-item-name'
    nameEl.textContent = profile.name || profile.id
    const metaEl = document.createElement('div')
    metaEl.className = 'profile-item-meta'
    metaEl.textContent = `${profile.id} · MCP ${mcps}`
    row.append(nameEl, metaEl)
    row.addEventListener('click', () => {
      profileModalSelectedId = profile.id
      renderProfilesModalList()
      fillProfileForm(profile)
    })
    profilesListEl.appendChild(row)
  }
}

async function openProfilesModal() {
  closeProfilePopover()
  await refreshProfilesState()
  profileModalSelectedId = profilesState.activeProfile
  renderProfilesModalList()
  fillProfileForm(getProfileById(profileModalSelectedId))
  profilesModal?.classList.remove('hidden')
}

async function applyProfileChange(newProfileId) {
  const previousId = profilesState.activeProfile
  if (!newProfileId || newProfileId === previousId) return true
  closeProfilePopover()
  const result = await window.api.setActiveProfile(newProfileId)
  if (!result?.ok) {
    showStatus(result?.error || 'No se pudo cambiar el perfil', 'error', 5000)
    return false
  }
  profilesState = copyProfilesState(result)
  renderProfileSelector()
  renderProfileReminder()
  const next = getActiveProfile()
  showStatus(`Cambiando perfil: ${next?.name || newProfileId}…`, 'busy')
  const restartCwd = next?.cwd || await window.api.ptyCwd()
  try {
    await fullRestart(restartCwd)
    if (next?.cwd) {
      try { await setRoot(next.cwd) } catch {}
    }
    await updateCwdLabel()
    await refreshSessionStrip(true)
    await refreshHealth(true)
    showStatus(`Perfil activo: ${next?.name || newProfileId}`, 'ok', 2000)
    return true
  } catch (err) {
    await window.api.setActiveProfile(previousId)
    await refreshProfilesState()
    renderProfileSelector()
    renderProfileReminder()
    showStatus(errorMessage(err), 'error', 6500)
    return false
  }
}

if (profileReminder) {
  profileReminder.addEventListener('click', (ev) => {
    ev.stopPropagation()
    if (profilePopoverOpen) {
      closeProfilePopover()
      return
    }
    openProfilePopover()
  })
}
function errorMessage(err) {
  return err?.message || String(err)
}

function normalizeEntityId(rawId, fallback = '') {
  const clean = String(rawId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  if (clean) return clean
  return String(fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

function makeEnterpriseId(prefix, existingIds = new Set()) {
  const base = normalizeEntityId(prefix, 'item') || 'item'
  if (!existingIds.has(base)) return base
  let n = 2
  while (existingIds.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function normalizeStringListFromComma(raw) {
  if (Array.isArray(raw)) return Array.from(new Set(raw.map((v) => String(v || '').trim()).filter(Boolean)))
  return Array.from(new Set(String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)))
}

function normalizeStringListFromLines(raw) {
  if (Array.isArray(raw)) return Array.from(new Set(raw.map((v) => String(v || '').trim()).filter(Boolean)))
  return Array.from(new Set(String(raw || '')
    .split(/\r?\n/g)
    .map((v) => v.trim())
    .filter(Boolean)))
}

function normalizeRolePermissions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const key of ENTERPRISE_PERMISSION_KEYS) {
    out[key] = Boolean(src[key])
  }
  return out
}

function normalizeEnterpriseRole(raw, fallbackId = '') {
  const role = raw && typeof raw === 'object' ? raw : {}
  const policy = role.policy && typeof role.policy === 'object' ? role.policy : {}
  return {
    id: normalizeEntityId(role.id, fallbackId),
    name: String(role.name || '').trim() || 'Rol',
    permissions: normalizeRolePermissions(role.permissions),
    allowedRoots: normalizeStringListFromLines(role.allowedRoots ?? policy.allowedRoots),
    readOnlyRoots: normalizeStringListFromLines(role.readOnlyRoots ?? policy.readOnlyRoots),
    allowedMcpServers: normalizeStringListFromComma(role.allowedMcpServers ?? role.mcpServers ?? policy.allowedMcpServers)
  }
}

function normalizeEnterpriseOperator(raw, fallbackId = '') {
  const op = raw && typeof raw === 'object' ? raw : {}
  return {
    id: normalizeEntityId(op.id, fallbackId),
    name: String(op.name || '').trim() || 'Operador',
    username: String(op.username || '').trim(),
    enabled: op.enabled !== false,
    roleId: normalizeEntityId(op.roleId, ''),
    defaultProfileId: normalizeEntityId(op.defaultProfileId, ''),
    personaPrompt: typeof op.personaPrompt === 'string' ? op.personaPrompt : ''
  }
}

function extractEnterprisePayload(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.enterprise && typeof raw.enterprise === 'object') return raw.enterprise
  if (
    Object.prototype.hasOwnProperty.call(raw, 'enabled') ||
    Array.isArray(raw.roles) ||
    Array.isArray(raw.operators)
  ) {
    return raw
  }
  return null
}

function copyEnterpriseState(payload) {
  const src = extractEnterprisePayload(payload) || ENTERPRISE_DEFAULTS
  const roles = []
  const roleIds = new Set()
  for (const item of Array.isArray(src.roles) ? src.roles : []) {
    const next = normalizeEnterpriseRole(item)
    if (!next.id || roleIds.has(next.id)) continue
    roleIds.add(next.id)
    roles.push(next)
  }
  const operators = []
  const operatorIds = new Set()
  for (const item of Array.isArray(src.operators) ? src.operators : []) {
    const next = normalizeEnterpriseOperator(item)
    if (!next.id || operatorIds.has(next.id)) continue
    operatorIds.add(next.id)
    operators.push(next)
  }
  return {
    enabled: Boolean(src.enabled),
    roles,
    operators
  }
}

function getEnterpriseRoleById(id) {
  const wanted = normalizeEntityId(id, '')
  return enterpriseState.roles.find((r) => r.id === wanted) || null
}

function getEnterpriseOperatorById(id) {
  const wanted = normalizeEntityId(id, '')
  return enterpriseState.operators.find((o) => o.id === wanted) || null
}

function canUseEnterpriseApi() {
  return typeof window.api.enterpriseGetConfig === 'function' &&
    typeof window.api.enterpriseSaveConfig === 'function'
}

function setEnterpriseModalStatus(text, kind = 'info') {
  if (!enterpriseModalStatus) return
  enterpriseModalStatus.textContent = text || ''
  enterpriseModalStatus.dataset.kind = kind
}

function renderEnterpriseStatus() {
  if (!cfgEnterpriseStatus) return
  const modeText = enterpriseState.enabled
    ? 'Estado: modo empresa activo'
    : 'Estado: modo legacy (sesiones remotas heredan perfil global)'
  const roleCount = enterpriseState.roles.length
  const opCount = enterpriseState.operators.length
  const lines = [modeText, `Roles: ${roleCount} · Operadores: ${opCount}`]
  if (!enterpriseApiAvailable) lines.push('Backend enterprise:* no disponible todavía (UI preparada, guardado pendiente de backend).')
  if (enterpriseApiLastError) lines.push(`Error enterprise API: ${enterpriseApiLastError}`)
  cfgEnterpriseStatus.textContent = lines.join('\n')
}

async function refreshEnterpriseState(config = null) {
  enterpriseApiAvailable = canUseEnterpriseApi()
  enterpriseApiLastError = ''
  const fromConfig = copyEnterpriseState(config?.enterprise || ENTERPRISE_DEFAULTS)
  enterpriseState = fromConfig
  if (enterpriseApiAvailable) {
    try {
      const res = await window.api.enterpriseGetConfig()
      if (res?.ok === false) {
        enterpriseApiLastError = String(res.error || 'enterprise:get-config devolvió error')
      } else {
        const fromApi = extractEnterprisePayload(res)
        if (fromApi) enterpriseState = copyEnterpriseState(fromApi)
      }
    } catch (err) {
      enterpriseApiLastError = errorMessage(err)
    }
  }
  if (cfgEnterpriseEnabled) cfgEnterpriseEnabled.checked = enterpriseState.enabled
  renderEnterpriseStatus()
}

function renderEnterpriseRoleOptions(selectedId = '') {
  if (!enterpriseOperatorRoleIdInput) return
  const rows = enterpriseState.roles.map((role) => ({
    value: role.id,
    label: role.name ? `${role.name} (${role.id})` : role.id
  }))
  enterpriseOperatorRoleIdInput.innerHTML = ''
  if (!rows.length) {
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = 'Sin roles'
    enterpriseOperatorRoleIdInput.appendChild(empty)
    enterpriseOperatorRoleIdInput.value = ''
    return
  }
  for (const row of rows) {
    const opt = document.createElement('option')
    opt.value = row.value
    opt.textContent = row.label
    enterpriseOperatorRoleIdInput.appendChild(opt)
  }
  enterpriseOperatorRoleIdInput.value = rows.some((r) => r.value === selectedId)
    ? selectedId
    : rows[0].value
}

function renderEnterpriseProfileOptions(selectedId = '') {
  if (!enterpriseOperatorProfileIdInput) return
  const rows = profilesState.profiles.map((profile) => ({
    value: profile.id,
    label: profile.name ? `${profile.name} (${profile.id})` : profile.id
  }))
  enterpriseOperatorProfileIdInput.innerHTML = ''
  if (!rows.length) {
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = 'Sin perfiles'
    enterpriseOperatorProfileIdInput.appendChild(empty)
    enterpriseOperatorProfileIdInput.value = ''
    return
  }
  for (const row of rows) {
    const opt = document.createElement('option')
    opt.value = row.value
    opt.textContent = row.label
    enterpriseOperatorProfileIdInput.appendChild(opt)
  }
  enterpriseOperatorProfileIdInput.value = rows.some((r) => r.value === selectedId)
    ? selectedId
    : rows[0].value
}

function fillEnterpriseRoleForm(role) {
  if (!role) return
  enterpriseRoleIdInput.value = role.id || ''
  enterpriseRoleNameInput.value = role.name || ''
  for (const key of ENTERPRISE_PERMISSION_KEYS) {
    const input = ENTERPRISE_PERMISSION_INPUTS[key]
    if (!input) continue
    input.checked = Boolean(role.permissions?.[key])
  }
  enterpriseRoleAllowedRootsInput.value = (role.allowedRoots || []).join('\n')
  enterpriseRoleReadOnlyRootsInput.value = (role.readOnlyRoots || []).join('\n')
  enterpriseRoleAllowedMcpsInput.value = (role.allowedMcpServers || []).join(', ')
}

function fillEnterpriseOperatorForm(operator) {
  if (!operator) return
  enterpriseOperatorIdInput.value = operator.id || ''
  enterpriseOperatorNameInput.value = operator.name || ''
  enterpriseOperatorUsernameInput.value = operator.username || ''
  enterpriseOperatorEnabledInput.checked = operator.enabled !== false
  renderEnterpriseRoleOptions(operator.roleId || '')
  renderEnterpriseProfileOptions(operator.defaultProfileId || '')
  enterpriseOperatorPersonaInput.value = operator.personaPrompt || ''
}

function readEnterpriseRoleForm() {
  const permissions = {}
  for (const key of ENTERPRISE_PERMISSION_KEYS) {
    permissions[key] = Boolean(ENTERPRISE_PERMISSION_INPUTS[key]?.checked)
  }
  return {
    id: normalizeEntityId(enterpriseRoleIdInput?.value, ''),
    name: String(enterpriseRoleNameInput?.value || '').trim(),
    permissions,
    allowedRoots: normalizeStringListFromLines(enterpriseRoleAllowedRootsInput?.value || ''),
    readOnlyRoots: normalizeStringListFromLines(enterpriseRoleReadOnlyRootsInput?.value || ''),
    allowedMcpServers: normalizeStringListFromComma(enterpriseRoleAllowedMcpsInput?.value || '')
  }
}

function readEnterpriseOperatorForm() {
  return {
    id: normalizeEntityId(enterpriseOperatorIdInput?.value, ''),
    name: String(enterpriseOperatorNameInput?.value || '').trim(),
    username: String(enterpriseOperatorUsernameInput?.value || '').trim(),
    enabled: Boolean(enterpriseOperatorEnabledInput?.checked),
    roleId: normalizeEntityId(enterpriseOperatorRoleIdInput?.value, ''),
    defaultProfileId: normalizeEntityId(enterpriseOperatorProfileIdInput?.value, ''),
    personaPrompt: enterpriseOperatorPersonaInput?.value || ''
  }
}

function renderEnterpriseLists() {
  if (enterpriseRolesListEl) {
    enterpriseRolesListEl.innerHTML = ''
    for (const role of enterpriseState.roles) {
      const item = document.createElement('div')
      item.className = 'enterprise-item' + ((enterpriseSelection.type === 'role' && enterpriseSelection.id === role.id) ? ' active' : '')
      const enabledPermCount = ENTERPRISE_PERMISSION_KEYS.filter((key) => role.permissions?.[key]).length
      item.innerHTML = `
        <div class="enterprise-item-title">${role.name || role.id}</div>
        <div class="enterprise-item-meta">${role.id} · ${enabledPermCount} permisos · roots ${role.allowedRoots.length}</div>
      `
      item.addEventListener('click', () => {
        enterpriseSelection = { type: 'role', id: role.id }
        renderEnterpriseLists()
        renderEnterpriseEditor()
      })
      enterpriseRolesListEl.appendChild(item)
    }
  }

  if (enterpriseOperatorsListEl) {
    enterpriseOperatorsListEl.innerHTML = ''
    for (const operator of enterpriseState.operators) {
      const item = document.createElement('div')
      item.className = 'enterprise-item' + ((enterpriseSelection.type === 'operator' && enterpriseSelection.id === operator.id) ? ' active' : '')
      const roleLabel = operator.roleId || 'sin-rol'
      const profileLabel = operator.defaultProfileId || 'sin-perfil'
      const modeLabel = operator.enabled ? 'ON' : 'OFF'
      item.innerHTML = `
        <div class="enterprise-item-title">${operator.name || operator.id}</div>
        <div class="enterprise-item-meta">${operator.id} · ${operator.username || '-'} · ${roleLabel} · ${profileLabel} · ${modeLabel}</div>
      `
      item.addEventListener('click', () => {
        enterpriseSelection = { type: 'operator', id: operator.id }
        renderEnterpriseLists()
        renderEnterpriseEditor()
      })
      enterpriseOperatorsListEl.appendChild(item)
    }
  }
}

function renderEnterpriseEditor() {
  const selectedRole = enterpriseSelection.type === 'role'
    ? getEnterpriseRoleById(enterpriseSelection.id)
    : null
  const selectedOperator = enterpriseSelection.type === 'operator'
    ? getEnterpriseOperatorById(enterpriseSelection.id)
    : null

  if (enterpriseEditorEmpty) enterpriseEditorEmpty.classList.add('hidden')
  if (enterpriseRoleForm) enterpriseRoleForm.classList.add('hidden')
  if (enterpriseOperatorForm) enterpriseOperatorForm.classList.add('hidden')

  if (selectedRole) {
    enterpriseRoleForm?.classList.remove('hidden')
    fillEnterpriseRoleForm(selectedRole)
  } else if (selectedOperator) {
    enterpriseOperatorForm?.classList.remove('hidden')
    fillEnterpriseOperatorForm(selectedOperator)
  } else if (enterpriseEditorEmpty) {
    enterpriseEditorEmpty.classList.remove('hidden')
  }

  if (btnEnterpriseDelete) {
    btnEnterpriseDelete.disabled = !(selectedRole || selectedOperator)
  }
}

function applyEnterpriseEditorToState() {
  if (enterpriseSelection.type === 'role') {
    const idx = enterpriseState.roles.findIndex((r) => r.id === enterpriseSelection.id)
    if (idx < 0) return
    const prev = enterpriseState.roles[idx]
    const nextRaw = readEnterpriseRoleForm()
    const next = normalizeEnterpriseRole({
      ...prev,
      ...nextRaw,
      id: nextRaw.id || prev.id
    }, prev.id)
    if (!next.id) next.id = prev.id
    enterpriseState.roles[idx] = next
    if (prev.id !== next.id) {
      enterpriseSelection.id = next.id
      for (const operator of enterpriseState.operators) {
        if (operator.roleId === prev.id) operator.roleId = next.id
      }
    }
    return
  }

  if (enterpriseSelection.type === 'operator') {
    const idx = enterpriseState.operators.findIndex((o) => o.id === enterpriseSelection.id)
    if (idx < 0) return
    const prev = enterpriseState.operators[idx]
    const nextRaw = readEnterpriseOperatorForm()
    const next = normalizeEnterpriseOperator({
      ...prev,
      ...nextRaw,
      id: nextRaw.id || prev.id
    }, prev.id)
    if (!next.id) next.id = prev.id
    enterpriseState.operators[idx] = next
    if (prev.id !== next.id) enterpriseSelection.id = next.id
  }
}

function validateEnterpriseStateDraft(draft) {
  const roleIds = new Set()
  for (const role of draft.roles) {
    if (!role.id) return 'Todos los roles necesitan ID.'
    if (roleIds.has(role.id)) return `ID de rol duplicado: ${role.id}`
    roleIds.add(role.id)
  }

  const profileIds = new Set(profilesState.profiles.map((p) => p.id))
  const operatorIds = new Set()
  for (const operator of draft.operators) {
    if (!operator.id) return 'Todos los operadores necesitan ID.'
    if (operatorIds.has(operator.id)) return `ID de operador duplicado: ${operator.id}`
    operatorIds.add(operator.id)
    if (operator.roleId && !roleIds.has(operator.roleId)) {
      return `Operador ${operator.id}: rol no encontrado (${operator.roleId}).`
    }
    if (operator.defaultProfileId && !profileIds.has(operator.defaultProfileId)) {
      return `Operador ${operator.id}: perfil no encontrado (${operator.defaultProfileId}).`
    }
  }
  return ''
}

function buildEnterprisePayloadFromState() {
  return copyEnterpriseState({
    enabled: Boolean(cfgEnterpriseEnabled?.checked),
    roles: enterpriseState.roles,
    operators: enterpriseState.operators
  })
}

async function saveEnterpriseConfigFromUi() {
  if (enterpriseModal && !enterpriseModal.classList.contains('hidden')) {
    applyEnterpriseEditorToState()
  }
  const draft = buildEnterprisePayloadFromState()
  const validationError = validateEnterpriseStateDraft(draft)
  if (validationError) {
    setEnterpriseModalStatus(validationError, 'err')
    return { ok: false, error: validationError }
  }

  enterpriseState = draft
  enterpriseState.enabled = Boolean(cfgEnterpriseEnabled?.checked)
  renderEnterpriseStatus()
  if (!canUseEnterpriseApi()) {
    enterpriseApiAvailable = false
    const msg = 'No se pudo guardar empresa: backend enterprise:* no disponible.'
    enterpriseApiLastError = msg
    renderEnterpriseStatus()
    setEnterpriseModalStatus(msg, 'warn')
    return { ok: false, error: msg, code: 'api-unavailable' }
  }

  try {
    const res = await window.api.enterpriseSaveConfig(draft)
    if (res?.ok === false) {
      const msg = String(res.error || 'enterprise:save-config devolvió error')
      enterpriseApiLastError = msg
      renderEnterpriseStatus()
      setEnterpriseModalStatus(msg, 'err')
      return { ok: false, error: msg }
    }
    const payload = extractEnterprisePayload(res)
    if (payload) enterpriseState = copyEnterpriseState(payload)
    enterpriseApiAvailable = true
    enterpriseApiLastError = ''
    if (cfgEnterpriseEnabled) cfgEnterpriseEnabled.checked = enterpriseState.enabled
    renderEnterpriseStatus()
    renderEnterpriseLists()
    renderEnterpriseEditor()
    setEnterpriseModalStatus('Configuración enterprise guardada.', 'ok')
    return { ok: true }
  } catch (err) {
    const msg = errorMessage(err)
    enterpriseApiAvailable = true
    enterpriseApiLastError = msg
    renderEnterpriseStatus()
    setEnterpriseModalStatus(msg, 'err')
    return { ok: false, error: msg }
  }
}

function newEnterpriseRole() {
  applyEnterpriseEditorToState()
  const existing = new Set(enterpriseState.roles.map((r) => r.id))
  const id = makeEnterpriseId('rol', existing)
  const role = normalizeEnterpriseRole({
    id,
    name: `Rol ${enterpriseState.roles.length + 1}`,
    permissions: {
      'pty.execute': true,
      'fs.read': true,
      'fs.write': false,
      'fs.list': true,
      'fs.delete': false,
      'fs.rename': false,
      'viewer.open': true,
      'automations.manage': false
    },
    allowedRoots: [],
    readOnlyRoots: [],
    allowedMcpServers: []
  }, id)
  enterpriseState.roles.push(role)
  enterpriseSelection = { type: 'role', id: role.id }
  renderEnterpriseLists()
  renderEnterpriseEditor()
  setEnterpriseModalStatus('Rol creado localmente. Guarda para persistir.', 'warn')
}

function newEnterpriseOperator() {
  applyEnterpriseEditorToState()
  const existing = new Set(enterpriseState.operators.map((o) => o.id))
  const id = makeEnterpriseId('operador', existing)
  const fallbackRoleId = enterpriseState.roles[0]?.id || ''
  const fallbackProfileId = profilesState.activeProfile || profilesState.profiles[0]?.id || ''
  const operator = normalizeEnterpriseOperator({
    id,
    name: `Operador ${enterpriseState.operators.length + 1}`,
    username: '',
    enabled: true,
    roleId: fallbackRoleId,
    defaultProfileId: fallbackProfileId,
    personaPrompt: ''
  }, id)
  enterpriseState.operators.push(operator)
  enterpriseSelection = { type: 'operator', id: operator.id }
  renderEnterpriseLists()
  renderEnterpriseEditor()
  setEnterpriseModalStatus('Operador creado localmente. Guarda para persistir.', 'warn')
}

function deleteEnterpriseSelected() {
  if (enterpriseSelection.type === 'role') {
    const role = getEnterpriseRoleById(enterpriseSelection.id)
    if (!role) return
    if (!confirm(`¿Borrar rol "${role.name}"?`)) return
    enterpriseState.roles = enterpriseState.roles.filter((r) => r.id !== role.id)
    for (const op of enterpriseState.operators) {
      if (op.roleId === role.id) op.roleId = ''
    }
    enterpriseSelection = { type: '', id: '' }
    renderEnterpriseLists()
    renderEnterpriseEditor()
    setEnterpriseModalStatus('Rol eliminado localmente. Guarda para persistir.', 'warn')
    return
  }

  if (enterpriseSelection.type === 'operator') {
    const operator = getEnterpriseOperatorById(enterpriseSelection.id)
    if (!operator) return
    if (!confirm(`¿Borrar operador "${operator.name}"?`)) return
    enterpriseState.operators = enterpriseState.operators.filter((o) => o.id !== operator.id)
    enterpriseSelection = { type: '', id: '' }
    renderEnterpriseLists()
    renderEnterpriseEditor()
    setEnterpriseModalStatus('Operador eliminado localmente. Guarda para persistir.', 'warn')
  }
}

async function openEnterpriseModal() {
  await refreshProfilesState()
  renderEnterpriseProfileOptions()
  renderEnterpriseRoleOptions()
  enterpriseSelection = { type: '', id: '' }
  renderEnterpriseLists()
  renderEnterpriseEditor()
  if (!canUseEnterpriseApi()) {
    setEnterpriseModalStatus('Backend enterprise:* no disponible. Puedes preparar la estructura y guardar cuando backend esté listo.', 'warn')
  } else {
    setEnterpriseModalStatus('Edita roles y operadores. Luego pulsa "Guardar empresa".', 'info')
  }
  enterpriseModal?.classList.remove('hidden')
}

function closeEnterpriseModal() {
  enterpriseModal?.classList.add('hidden')
}

let sessionMetaRefreshInFlight = false
let sessionMetaLastKey = ''

function ellipsize(text, max = 110) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function normalizeNonEmpty(value) {
  const text = String(value || '').trim()
  return text || ''
}

function cancelSessionStripInlineEdit() {
  if (!sessionStripEditInput) return
  const input = sessionStripEditInput
  sessionStripEditInput = null
  if (sessionStripTitle && !sessionStripTitle.isConnected && input.isConnected) {
    try { input.replaceWith(sessionStripTitle) } catch {}
  }
}

async function startSessionStripInlineEdit() {
  if (!sessionStripTitle || sessionStripEditInput) return
  const sid = normalizeNonEmpty(sessionStripMetaSnapshot?.sessionId)
  if (!sid) {
    showStatus('No hay sessionId activa para renombrar esta sesión.', 'warn', 3500)
    return
  }
  const cwd = normalizeNonEmpty(sessionStripMetaSnapshot?.cwd)
  if (!cwd) {
    showStatus('No hay carpeta de sesión disponible para renombrar.', 'warn', 3500)
    return
  }
  const current = normalizeNonEmpty(sessionStripMetaSnapshot?.rawTitle) || '(sin título)'
  const input = document.createElement('input')
  input.className = 'session-strip-title-input'
  input.value = current === '(sin título)' ? '' : current
  input.placeholder = 'Título de la sesión…'
  sessionStripTitle.replaceWith(input)
  sessionStripEditInput = input
  sessionStripEdit?.setAttribute('aria-pressed', 'true')
  input.focus()
  input.select()

  let cancelled = false
  const rollback = () => {
    cancelled = true
    cancelSessionStripInlineEdit()
    renderSessionStrip(sessionStripMetaSnapshot || null)
  }
  const commit = async () => {
    if (cancelled || sessionStripEditInput !== input) return
    const val = normalizeNonEmpty(input.value)
    if (!val || val === current) {
      rollback()
      return
    }
    const res = await window.api.updateSessionTitle(cwd, sid, val)
    if (!res || !res.ok) {
      rollback()
      showStatus((res && res.error) || 'No se pudo editar el título de la sesión.', 'error', 6000)
      return
    }
    sessionMetaLastKey = ''
    sessionStripMetaSnapshot = {
      ...(sessionStripMetaSnapshot || {}),
      title: res.title || val,
      rawTitle: res.title || val,
      sessionId: sid,
      cwd
    }
    cancelSessionStripInlineEdit()
    renderSessionStrip(sessionStripMetaSnapshot)
    showStatus('Título de sesión actualizado', 'ok', 2200)
    await refreshSessionStrip(true)
  }

  input.addEventListener('blur', () => { commit().catch(() => rollback()) })
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      input.blur()
      return
    }
    if (ev.key === 'Escape') {
      ev.preventDefault()
      rollback()
    }
  })
}

function renderSessionStrip(meta) {
  if (!sessionStripCli || !sessionStripTitle || !sessionStripId) return
  const cli = meta?.cli === 'codex' ? 'codex' : 'claude'
  const sid = normalizeNonEmpty(meta?.sessionId)
  const rawTitle = normalizeNonEmpty(meta?.title) || '(sin título)'
  const title = ellipsize(rawTitle, 140)
  const cwd = normalizeNonEmpty(meta?.cwd)
  const displayCli = cli === 'codex' ? 'Codex' : 'Claude'
  sessionStripMetaSnapshot = { ...meta, cli, sessionId: sid, title: rawTitle, rawTitle, cwd }

  sessionStripCli.textContent = displayCli
  sessionStripCli.classList.toggle('codex', cli === 'codex')
  if (!sessionStripEditInput) {
    sessionStripTitle.textContent = `Sesión: ${title}`
    sessionStripTitle.title = `${displayCli} · ${rawTitle}`
  }
  if (sessionStripEdit) {
    sessionStripEdit.disabled = !sid
    sessionStripEdit.title = sid ? 'Editar título de la sesión' : 'No hay sessionId detectada'
    sessionStripEdit.setAttribute('aria-pressed', sessionStripEditInput ? 'true' : 'false')
  }

  if (sid) {
    sessionStripId.disabled = false
    sessionStripId.classList.add('ready')
    sessionStripId.dataset.sessionId = sid
    sessionStripId.textContent = sid
    sessionStripId.title = 'Copiar UID exacta de sesión'
  } else {
    sessionStripId.disabled = true
    sessionStripId.classList.remove('ready')
    sessionStripId.dataset.sessionId = ''
    sessionStripId.textContent = 'UID: —'
    sessionStripId.title = 'UID todavía no detectada'
  }
}

async function refreshSessionStrip(force = false) {
  if (sessionMetaRefreshInFlight && !force) return
  sessionMetaRefreshInFlight = true
  try {
    const meta = await window.api.getCurrentSessionMeta()
    // Chivato de aislamiento: visible SIEMPRE que la sesión corra en worktree.
    // Fuera de la key de render: se actualiza en cada poll, es barato.
    if (sessionStripIsolation) {
      const iso = meta?.gitIsolation
      sessionStripIsolation.classList.toggle('hidden', !iso)
      sessionStripIsolation.title = iso
        ? `Sesión aislada en worktree git\nRama: ${iso.branch}\nCarpeta real: ${iso.realCwd}\nAl cerrar la sesión se fusiona solo. Configurable en Configuración → CLI.`
        : ''
    }
    const key = `${meta?.cli || ''}|${meta?.sessionId || ''}|${meta?.title || ''}`
    if (force || key !== sessionMetaLastKey) {
      if (sessionStripEditInput) {
        const incomingSid = normalizeNonEmpty(meta?.sessionId)
        const currentSid = normalizeNonEmpty(sessionStripMetaSnapshot?.sessionId)
        if (!incomingSid || (currentSid && incomingSid !== currentSid)) {
          cancelSessionStripInlineEdit()
        }
      }
      sessionMetaLastKey = key
      renderSessionStrip(meta || null)
    }
  } catch {}
  sessionMetaRefreshInFlight = false
  try {
    const can = await window.api.subchat.canStart()
    if (btnSubchat) {
      btnSubchat.disabled = !can?.ok && !subchatTerm
      btnSubchat.title = can?.ok || subchatTerm
        ? 'Sub-chat (pregunta lateral sin tocar el hilo) — Cmd+Shift+S'
        : `Sub-chat: ${can?.reason || 'no disponible'}`
    }
  } catch {}
}

if (sessionStripId) {
  sessionStripId.addEventListener('click', async () => {
    const sid = sessionStripId.dataset.sessionId || ''
    if (!sid) return
    const ok = await window.api.copyText(sid)
    if (ok) showStatus('UID de sesión copiada', 'ok', 1500)
    else showStatus('No pude copiar la UID', 'error', 2500)
  })
}
if (sessionStripEdit) {
  sessionStripEdit.addEventListener('click', () => { startSessionStripInlineEdit().catch(() => {}) })
}
if (sessionStripTitle) {
  sessionStripTitle.addEventListener('dblclick', () => { startSessionStripInlineEdit().catch(() => {}) })
}

function renderTelegramStatus(status) {
  if (!status) {
    cfgTelegramStatus.textContent = 'Estado: bridge no inicializado.'
    return
  }
  const lines = [
    `Estado: ${status.running ? 'ON' : 'OFF'}`,
    `Info: ${status.lastInfo || '-'}`,
    `Bot: ${status.botUsername ? '@' + status.botUsername : '-'}`,
    `Chats conectados: ${status.activeChats?.length || 0}`
  ]
  if (status.lastError) lines.push(`Error: ${status.lastError}`)
  cfgTelegramStatus.textContent = lines.join('\n')
}

function clampLanPort(value) {
  const n = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(n)) return 9999
  if (n < 1024) return 1024
  if (n > 65534) return 65534
  return n
}

function formatConnectedAge(connectedAt) {
  const ts = Number(connectedAt || 0)
  if (!ts) return '-'
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function isRemoteSessionsPanelVisible() {
  return Boolean(lanServerSnapshot?.running) && remoteSessionsUserVisible
}

function renderRemoteSessionsToggle() {
  if (!btnRemoteSessionsToggle) return
  const visible = Boolean(remoteSessionsUserVisible)
  const running = Boolean(lanServerSnapshot?.running)
  btnRemoteSessionsToggle.classList.toggle('active', visible)
  btnRemoteSessionsToggle.setAttribute('aria-pressed', visible ? 'true' : 'false')
  if (visible) {
    btnRemoteSessionsToggle.setAttribute('aria-label', 'Ocultar sesiones remotas LAN')
    btnRemoteSessionsToggle.title = running
      ? 'Ocultar sesiones remotas LAN'
      : 'Sesiones LAN marcadas para mostrarse cuando el servidor esté activo'
  } else {
    btnRemoteSessionsToggle.setAttribute('aria-label', 'Mostrar sesiones remotas LAN')
    btnRemoteSessionsToggle.title = 'Mostrar sesiones remotas LAN'
  }
}

function setRemoteSessionsUserVisible(next, { persist = true } = {}) {
  remoteSessionsUserVisible = Boolean(next)
  if (persist) {
    try {
      localStorage.setItem(REMOTE_SESSIONS_VISIBLE_KEY, remoteSessionsUserVisible ? '1' : '0')
    } catch {}
  }
  renderRemoteSessionsToggle()
  if (remoteSessionsPanel) {
    remoteSessionsPanel.classList.toggle('hidden', !isRemoteSessionsPanelVisible())
  }
}

function renderRemoteSessions(list) {
  if (!remoteSessionsPanel || !remoteSessionsListEl || !remoteSessionsEmptyEl || !remoteSessionsCountEl) return
  const rows = Array.isArray(list) ? list : []
  remoteSessionsCountEl.textContent = String(rows.length)
  remoteSessionsListEl.innerHTML = ''
  remoteSessionsPanel.classList.toggle('hidden', !isRemoteSessionsPanelVisible())
  remoteSessionsEmptyEl.style.display = rows.length ? 'none' : 'block'
  for (const row of rows) {
    const item = document.createElement('div')
    item.className = 'remote-session-row'

    const main = document.createElement('div')
    main.className = 'remote-session-main'

    const title = document.createElement('div')
    title.className = 'remote-session-title'
    title.textContent = `${row.ip || '-'} · ${row.cli || 'claude'}`

    const meta = document.createElement('div')
    meta.className = 'remote-session-meta'
    meta.textContent = `${row.cwd || '-'} · ${formatConnectedAge(row.connectedAt)}`

    const context = row && typeof row === 'object' ? (row.context || {}) : {}
    const caps = row && typeof row === 'object' ? (row.capabilities || {}) : {}
    const contextWrap = document.createElement('div')
    contextWrap.className = 'remote-session-context'

    const modePill = document.createElement('span')
    modePill.className = 'remote-session-pill'
    modePill.textContent = context.mode === 'enterprise' ? 'enterprise' : 'legacy'
    contextWrap.appendChild(modePill)

    if (context.operatorId) {
      const opPill = document.createElement('span')
      opPill.className = 'remote-session-pill'
      opPill.textContent = `op:${context.operatorId}`
      contextWrap.appendChild(opPill)
    }
    if (context.roleId) {
      const rolePill = document.createElement('span')
      rolePill.className = 'remote-session-pill'
      rolePill.textContent = `rol:${context.roleId}`
      contextWrap.appendChild(rolePill)
    }
    if (context.profileId) {
      const profilePill = document.createElement('span')
      profilePill.className = 'remote-session-pill'
      profilePill.textContent = `perfil:${context.profileId}`
      contextWrap.appendChild(profilePill)
    }
    const mcpCount = Array.isArray(context.allowedMcpServers) ? context.allowedMcpServers.length : 0
    const mcpPill = document.createElement('span')
    mcpPill.className = 'remote-session-pill'
    mcpPill.textContent = `MCP:${mcpCount}`
    contextWrap.appendChild(mcpPill)

    const rootsCount = Array.isArray(context.allowedRoots) ? context.allowedRoots.length : 0
    const rootPill = document.createElement('span')
    rootPill.className = 'remote-session-pill'
    rootPill.textContent = `roots:${rootsCount}`
    contextWrap.appendChild(rootPill)

    const deniedPerms = []
    if (caps?.pty?.execute === false) deniedPerms.push('pty.execute')
    if (caps?.fs?.read === false) deniedPerms.push('fs.read')
    if (caps?.fs?.write === false) deniedPerms.push('fs.write')
    if (caps?.fs?.list === false) deniedPerms.push('fs.list')

    let deniedEl = null
    if (deniedPerms.length) {
      const denyPill = document.createElement('span')
      denyPill.className = 'remote-session-pill warn'
      denyPill.textContent = `deny:${deniedPerms.join('|')}`
      contextWrap.appendChild(denyPill)

      deniedEl = document.createElement('div')
      deniedEl.className = 'remote-session-denied'
      deniedEl.textContent = 'Permisos limitados activos en esta sesión.'
      deniedEl.title = `Bloqueado: ${deniedPerms.join(', ')}`
    }

    const closeBtn = document.createElement('button')
    closeBtn.className = 'remote-session-close'
    closeBtn.textContent = 'Cerrar'
    closeBtn.type = 'button'
    closeBtn.dataset.remoteSessionClose = String(row.id || '')

    main.appendChild(title)
    main.appendChild(meta)
    main.appendChild(contextWrap)
    if (deniedEl) main.appendChild(deniedEl)
    item.appendChild(main)
    item.appendChild(closeBtn)
    remoteSessionsListEl.appendChild(item)
  }
}

function renderLanStatus(snapshot, errorText = '') {
  lanServerSnapshot = snapshot || null
  const running = Boolean(snapshot?.running)
  const ip = String(snapshot?.ip || '').trim()
  const port = Number(snapshot?.port || clampLanPort(cfgLanPort?.value || 9999))
  const wsUrl = running && ip ? `ws://${ip}:${port}` : '-'
  const clientUrl = running && snapshot?.clientUrl ? String(snapshot.clientUrl) : '-'
  const sessionCount = Array.isArray(snapshot?.sessions) ? snapshot.sessions.length : 0
  if (cfgLanStatus) {
    const base = running ? `Estado: activo (${sessionCount} sesiones)` : 'Estado: detenido'
    cfgLanStatus.textContent = errorText ? `${base}\nError: ${errorText}` : base
  }
  if (cfgLanUrl) cfgLanUrl.textContent = `URL: ${wsUrl}`
  if (cfgLanClientUrl) cfgLanClientUrl.textContent = `Cliente: ${clientUrl}`
  if (cfgLanQr) {
    if (running && window.QRCode && typeof window.QRCode.toDataURL === 'function') {
      cfgLanQr.textContent = `QR listo para ${wsUrl}`
    } else if (running) {
      cfgLanQr.textContent = 'QR no disponible (librería qrcode no instalada).'
    } else {
      cfgLanQr.textContent = 'QR no disponible'
    }
  }
  renderRemoteSessionsToggle()
  renderRemoteSessions(snapshot?.sessions || [])
  renderProfileReminder()
}

async function refreshLanServerStatus(force = false) {
  if (!window.api.wsServerSessions) return
  if (lanStatusRefreshInFlight && !force) return
  lanStatusRefreshInFlight = true
  try {
    const status = await window.api.wsServerSessions()
    renderLanStatus(status, status?.ok === false ? (status.error || 'Error') : '')
  } catch (err) {
    renderLanStatus(lanServerSnapshot, errorMessage(err))
  } finally {
    lanStatusRefreshInFlight = false
  }
}

// Etiqueta humana del slider de velocidad. La escala es la de AVSpeechUtterance
// (0,5 = normal del sistema); los números a secas no le dicen nada a nadie.
function voiceRateLabelText(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 'normal'
  if (n < 0.42) return 'lenta'
  if (n < 0.48) return 'algo lenta'
  if (n <= 0.56) return 'normal'
  if (n <= 0.62) return 'algo rápida'
  return 'rápida'
}

// Segundos con coma decimal, estilo es-ES: 1800 → "1,8 s".
function voiceSilenceLabelText(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '1,8 s'
  return `${(n / 1000).toFixed(1).replace('.', ',')} s`
}

async function refreshVoiceSettings(config) {
  if (!cfgVoiceId || !cfgVoiceRate) return
  const actual = config?.cli?.voiceId || ''
  const rate = Number(config?.cli?.voiceRate)
  cfgVoiceRate.value = Number.isFinite(rate) ? String(rate) : '0.52'
  if (cfgVoiceRateLabel) cfgVoiceRateLabel.textContent = voiceRateLabelText(cfgVoiceRate.value)
  if (cfgVoiceSilence) {
    // Ojo: Number('') === 0 — el vacío es "sin preferencia", no 0 ms.
    const silence = Number(config?.cli?.voiceSilenceMs)
    cfgVoiceSilence.value = Number.isFinite(silence) && silence > 0 ? String(silence) : '1800'
    if (cfgVoiceSilenceLabel) cfgVoiceSilenceLabel.textContent = voiceSilenceLabelText(cfgVoiceSilence.value)
  }

  // Voces del sistema. Si el helper no contesta (binario ausente, timeout), el
  // selector se queda con "Voz del sistema" + la guardada: nunca se pierde en
  // silencio una voz ya elegida por no poder listar.
  let res = null
  try { res = await window.api.voice.voices() } catch { res = null }
  const voces = res?.ok && Array.isArray(res.voices) ? res.voices : []
  cfgVoiceId.innerHTML = ''
  const porDefecto = document.createElement('option')
  porDefecto.value = ''
  porDefecto.textContent = 'Voz del sistema'
  cfgVoiceId.appendChild(porDefecto)
  const QUALITY_LABEL = { premium: 'premium', enhanced: 'mejorada', default: 'básica' }
  for (const v of voces) {
    if (!v || !v.id) continue
    const opt = document.createElement('option')
    opt.value = v.id
    const calidad = QUALITY_LABEL[v.quality] || v.quality || ''
    opt.textContent = calidad ? `${v.name} (${calidad})` : v.name
    cfgVoiceId.appendChild(opt)
  }
  if (actual && !voces.some((v) => v && v.id === actual)) {
    const opt = document.createElement('option')
    opt.value = actual
    opt.textContent = `${actual} (guardada)`
    cfgVoiceId.appendChild(opt)
  }
  cfgVoiceId.value = actual
  // Un value que no casa con ninguna option deja el select en blanco: caer a
  // "Voz del sistema" explícitamente.
  if (cfgVoiceId.value !== actual) cfgVoiceId.value = ''
}

if (cfgVoiceRate) {
  cfgVoiceRate.addEventListener('input', () => {
    if (cfgVoiceRateLabel) cfgVoiceRateLabel.textContent = voiceRateLabelText(cfgVoiceRate.value)
  })
}

if (cfgVoiceSilence) {
  cfgVoiceSilence.addEventListener('input', () => {
    if (cfgVoiceSilenceLabel) cfgVoiceSilenceLabel.textContent = voiceSilenceLabelText(cfgVoiceSilence.value)
  })
}

// Solicitudes de emparejamiento Telegram pendientes. DOM a mano con
// textContent: el username lo escribe un desconocido, nunca va en innerHTML.
function renderPairingList(pending) {
  if (!cfgTelegramPairingBlock || !cfgTelegramPairingList) return
  const list = Array.isArray(pending) ? pending : []
  cfgTelegramPairingList.textContent = ''
  cfgTelegramPairingBlock.style.display = list.length ? '' : 'none'
  for (const entry of list) {
    const row = document.createElement('div')
    row.className = 'pairing-row'
    const label = document.createElement('span')
    const who = entry.username ? `@${entry.username}` : (entry.firstName || entry.userId)
    label.textContent = `${who} (${entry.userId}) — código ${entry.code}`
    const approveBtn = document.createElement('button')
    approveBtn.type = 'button'
    approveBtn.textContent = 'Aprobar'
    approveBtn.addEventListener('click', async () => {
      const res = await window.api.telegramPairingApprove(entry.code)
      renderPairingList(res?.pending)
      if (res?.ok) {
        const config = await window.api.getAppConfig()
        cfgTelegramUsers.value = Array.isArray(config?.telegram?.allowedUsers) ? config.telegram.allowedUsers.join(', ') : ''
      }
    })
    const rejectBtn = document.createElement('button')
    rejectBtn.type = 'button'
    rejectBtn.textContent = 'Rechazar'
    rejectBtn.addEventListener('click', async () => {
      const res = await window.api.telegramPairingReject(entry.code)
      renderPairingList(res?.pending)
    })
    row.appendChild(label)
    row.appendChild(approveBtn)
    row.appendChild(rejectBtn)
    cfgTelegramPairingList.appendChild(row)
  }
}

async function refreshPairingList() {
  if (!window.api.telegramPairingList) return
  try { renderPairingList(await window.api.telegramPairingList()) } catch {}
}

async function refreshSettings() {
  const config = await window.api.getAppConfig()
  cfgDefaultCli.value = config?.cli?.defaultCli || 'claude'
  cfgClaudeBin.value = config?.cli?.claudeBin || ''
  if (cfgClaudeModel) cfgClaudeModel.value = config?.cli?.claudeModel || 'opus'
  if (cfgGitIsolation) cfgGitIsolation.checked = config?.cli?.gitSessionIsolation !== false
  if (cfgGitIsolationExcludes) {
    cfgGitIsolationExcludes.value = Array.isArray(config?.cli?.gitIsolationExcludes)
      ? config.cli.gitIsolationExcludes.join('\n')
      : ''
  }
  cfgCodexBin.value = config?.cli?.codexBin || ''
  cfgWhisperBin.value = config?.cli?.whisperBin || ''
  await refreshVoiceSettings(config)
  cfgTelegramEnabled.checked = Boolean(config?.telegram?.enabled)
  cfgTelegramToken.value = config?.telegram?.botToken || ''
  cfgTelegramUsers.value = Array.isArray(config?.telegram?.allowedUsers) ? config.telegram.allowedUsers.join(', ') : ''
  if (cfgTelegramNotifyToken) cfgTelegramNotifyToken.value = config?.telegram?.notifyBotToken || ''
  if (cfgTelegramNotifyChat) cfgTelegramNotifyChat.value = config?.telegram?.notifyChatId || ''
  cfgTelegramClaudeModel.value = config?.telegram?.claudeModel || ''
  cfgTelegramClaudeEffort.value = config?.telegram?.claudeEffort || ''
  cfgTelegramCodexModel.value = config?.telegram?.codexModel || ''
  cfgTelegramCodexEffort.value = config?.telegram?.codexEffort || ''
  if (cfgLanEnabled) cfgLanEnabled.checked = Boolean(config?.lanServer?.enabled)
  if (cfgLanPort) cfgLanPort.value = String(clampLanPort(config?.lanServer?.port ?? 9999))
  await refreshEnterpriseState(config)
  renderTelegramStatus(await window.api.getTelegramStatus())
  await refreshPairingList()
  await refreshLanServerStatus(true)
}

// ── Inyecta texto al PTY ──
function injectToPty(text) {
  if (!text) return
  window.api.writePty(text)
  term.focus()
}

// ── Botones de ventana ──
btnTheme.addEventListener('click', () => {
  applyTermTheme(document.body.classList.contains('dark') ? 'light' : 'dark')
})
btnMinimize.addEventListener('click', () => window.api.minimizeWindow())
btnClose.addEventListener('click', () => window.api.closeWindow())
document.getElementById('drag-area').addEventListener('dblclick', () => window.api.toggleMaximize())
async function fullRestart(cwd) {
  const requestedCwd = normalizeNonEmpty(cwd)
  if (fullRestartInFlight) {
    if (requestedCwd) queuedFullRestartCwd = requestedCwd
    await fullRestartInFlight
    if (queuedFullRestartCwd) {
      const nextCwd = queuedFullRestartCwd
      queuedFullRestartCwd = ''
      return fullRestart(nextCwd)
    }
    return
  }

  fullRestartInFlight = (async () => {
    const targetCwd = requestedCwd || normalizeNonEmpty(await window.api.ptyCwd())
    fitAndSync()
    term.reset()
    term.clear()
    await window.api.restartPty(targetCwd || undefined, term.cols, term.rows)
    await refreshSessionStrip(true)
    await refreshHealth(true)
    fitAndSync()
  })()

  try {
    await fullRestartInFlight
  } finally {
    fullRestartInFlight = null
  }
}

btnRestart.addEventListener('click', async () => {
  showStatus('Reiniciando terminal…', 'busy')
  try {
    await fullRestart()
    await updateCwdLabel()
    hideStatus()
    term.focus()
  } catch (err) {
    showStatus(errorMessage(err), 'error', 6000)
  }
})
btnPin.addEventListener('click', async () => {
  window.api.togglePin()
  const pinned = await window.api.isPinned()
  btnPin.classList.toggle('active', pinned)
})

// ── Botón "Llevar a Terminal" ──
const btnHandoffTerminal = document.getElementById('btn-handoff-terminal')
if (btnHandoffTerminal) {
  btnHandoffTerminal.addEventListener('click', async () => {
    if (btnHandoffTerminal.disabled) return
    btnHandoffTerminal.disabled = true
    try {
      const res = await window.api.handoffToTerminal()
      if (!res?.ok) showStatus(res?.error || 'No se pudo llevar la sesión a Terminal', 'error', 7000)
    } catch (err) {
      showStatus(String(err?.message || err), 'error', 7000)
    } finally {
      btnHandoffTerminal.disabled = false
    }
  })
}

// ── Botón "Enviar a Telegram" ──
async function refreshSendTelegramButton() {
  if (!btnSendTelegram) return
  try {
    const res = await window.api.canSendSessionToTelegram()
    const ok = !!(res && res.ok)
    const linked = !!(res && res.linked)
    const linkedChatId = res && res.chatId ? String(res.chatId) : ''
    const relayBusy = !!(res && res.relayActive)
    const wrap = btnSendTelegramWrap
    const reasons = {
      'no-session': 'No hay sesión',
      'not-supported-cli': 'CLI no soportado para relay (usa claude o codex)',
      'no-session-id': 'Aún no detecto el ID — habla un mensaje con claude y vuelve a intentarlo',
      'bridge-not-init': 'Telegram no inicializado',
      'bridge-not-running': 'Activa Telegram en Configuración',
      'no-allowed-user': 'Añade tu user ID en Configuración → Telegram → allowed users'
    }

    btnSendTelegram.disabled = !(ok || linked)
    btnSendTelegram.classList.toggle('active', linked || ok)

    if (linked) {
      btnSendTelegram.classList.add('tg-linked-live')
      btnSendTelegram.setAttribute('aria-label', 'Telegram enlazado')
      const chatLabel = linkedChatId ? ` (chat ${linkedChatId})` : ''
      const suffix = relayBusy ? ' Ahora mismo está procesando una petición.' : ''
      const tip = ok
        ? `Enlazado en vivo${chatLabel}: Telegram usa esta sesión PTY directa (sin --resume). Pulsa para desconectar.${suffix}`
        : `Enlazado en vivo${chatLabel}, pero no disponible ahora: ${reasons[res?.reason] || 'No disponible'}.${suffix}`
      btnSendTelegram.title = tip
      if (wrap) wrap.title = tip
      return
    }

    btnSendTelegram.classList.remove('tg-linked-live')
    btnSendTelegram.setAttribute('aria-label', 'Enviar a Telegram')

    if (ok) {
      const tip = 'Conectar esta sesión viva a Telegram (relay directo, sin sobrecoste por turno)'
      btnSendTelegram.title = tip
      if (wrap) wrap.title = tip
    } else {
      const reason = res && res.reason
      const tip = '📱 ' + (reasons[reason] || 'No disponible')
      btnSendTelegram.title = tip
      if (wrap) wrap.title = tip
    }
  } catch {
    btnSendTelegram.disabled = true
    btnSendTelegram.classList.remove('tg-linked-live')
    btnSendTelegram.setAttribute('aria-label', 'Enviar a Telegram')
  }
}

if (btnSendTelegram) {
  btnSendTelegram.addEventListener('click', async () => {
    if (btnSendTelegram.disabled) return
    btnSendTelegram.disabled = true
    try {
      const state = await window.api.canSendSessionToTelegram()
      if (state && state.linked) {
        showStatus('Desconectando sesión de Telegram…', 'busy')
        const off = await window.api.disconnectSessionFromTelegram()
        if (!off || off.ok === false) {
          showStatus((off && off.error) || 'No se pudo desconectar', 'error', 6000)
          btnSendTelegram.disabled = false
          return
        }
        const cliLabel = off?.cli === 'codex' ? 'Codex' : 'Claude'
        const sync = off?.sync || null
        let statusText = `✓ Sesión ${cliLabel} desconectada de Telegram`
        let statusKind = 'ok'
        if (sync?.mode === 'codex' && sync?.refreshed && sync?.sessionId) {
          statusText += ` · contexto recargado (${String(sync.sessionId).slice(0, 8)}…)`
        } else if (sync?.mode === 'codex' && sync?.ok === false) {
          statusText += ' · desconectada, pero falló recarga de contexto Codex'
          statusKind = 'error'
        }
        showStatus(statusText, statusKind, statusKind === 'error' ? 7000 : 5000)
        btnSendTelegram.classList.remove('tg-linked-live')
        btnSendTelegram.classList.remove('active')
        refreshSendTelegramButton()
        refreshSessionStrip(true)
        return
      }

      showStatus('Enviando sesión a Telegram…', 'busy')
      const res = await window.api.sendSessionToTelegram()
      if (!res || res.ok === false) {
        showStatus((res && res.error) || 'No se pudo enviar', 'error', 6000)
        btnSendTelegram.disabled = false
        return
      }
      const cliLabel = res?.cli === 'codex' ? 'Codex' : 'Claude'
      const sidPart = res?.sessionId ? ` (ID ${res.sessionId.slice(0, 8)}…)` : ''
      showStatus(`✓ Sesión ${cliLabel} conectada a Telegram${sidPart} — relay PTY activo`, 'ok', 8000)
      btnSendTelegram.classList.add('active')
      refreshSendTelegramButton()
      refreshSessionStrip(true)
    } catch (err) {
      showStatus(errorMessage(err), 'error', 6000)
      btnSendTelegram.disabled = false
    }
  })
  // Refresco periódico ligero mientras la ventana está activa.
  setInterval(refreshSendTelegramButton, 6500)
  refreshSendTelegramButton()
  // Refresca tras cambios de status de Telegram.
  if (window.api.onTelegramStatus) {
    window.api.onTelegramStatus(() => refreshSendTelegramButton())
  }
  if (window.api.onTelegramPairingChanged) {
    window.api.onTelegramPairingChanged((pending) => renderPairingList(pending))
  }
  if (window.api.onPtyTransferredToTelegram) {
    window.api.onPtyTransferredToTelegram(() => {
      refreshSendTelegramButton()
      refreshSessionStrip(true)
    })
  }
}

if (btnNewWindow) {
  btnNewWindow.addEventListener('click', () => window.api.newWindow())
}

if (btnBitacora) {
  btnBitacora.addEventListener('click', async () => {
    try { await window.api.openBitacoraWindow?.() } catch {}
  })
}

if (btnProposals) {
  btnProposals.addEventListener('click', () => {
    if (!pendingProposal) {
      showStatus('No hay propuestas pendientes', 'info', 1800)
      return
    }
    renderProposalModal(pendingProposal)
    openProposalModal()
  })
}

if (btnProposalApprove) btnProposalApprove.addEventListener('click', () => { approvePendingProposal() })
if (btnProposalReject) btnProposalReject.addEventListener('click', () => { rejectPendingProposal() })
proposalModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeProposalModal)

if (typeof window.api.onProposalNew === 'function') {
  window.api.onProposalNew((payload) => {
    if (!payload || typeof payload !== 'object') return
    setPendingProposal(payload)
    openProposalModal()
    showStatus('Nueva propuesta pendiente de aprobación', 'warn', 2800)
  })
}

if (typeof window.api.onProposalCleared === 'function') {
  window.api.onProposalCleared((payload) => {
    const id = String(payload?.id || '').trim()
    if (pendingProposal && id && pendingProposal.id && id !== pendingProposal.id) return
    clearPendingProposal()
  })
}

if (profileSelector) {
  profileSelector.addEventListener('change', async (e) => {
    const value = String(e?.target?.value || '')
    if (value === PROFILE_MANAGE_VALUE) {
      renderProfileSelector()
      await openProfilesModal()
      return
    }
    const ok = await applyProfileChange(value)
    if (!ok) renderProfileSelector()
  })
}

btnSettings.addEventListener('click', async () => {
  await refreshSettings()
  settingsModal.classList.remove('hidden')
})

if (cfgEnterpriseEnabled) {
  cfgEnterpriseEnabled.addEventListener('change', () => {
    enterpriseState.enabled = Boolean(cfgEnterpriseEnabled.checked)
    renderEnterpriseStatus()
  })
}

if (btnOpenEnterpriseModal) {
  btnOpenEnterpriseModal.addEventListener('click', async () => {
    await openEnterpriseModal()
  })
}

function closeProfilesModal() {
  profilesModal?.classList.add('hidden')
}

if (btnCloseProfiles) btnCloseProfiles.addEventListener('click', closeProfilesModal)
profilesModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeProfilesModal)

if (btnProfileNew) {
  btnProfileNew.addEventListener('click', async () => {
    const result = await window.api.createProfile({ name: 'Nuevo perfil', claudeMdPath: '', mcpServers: [], cwd: '', personaPrompt: '' })
    if (!result?.ok) {
      showStatus(result?.error || 'No pude crear el perfil', 'error', 5000)
      return
    }
    profilesState = copyProfilesState(result)
    const created = result.profile?.id || profilesState.profiles[profilesState.profiles.length - 1]?.id
    profileModalSelectedId = created || profilesState.activeProfile
    renderProfilesModalList()
    fillProfileForm(getProfileById(profileModalSelectedId))
    renderProfileSelector()
    renderProfileReminder()
  })
}

if (btnProfileSave) {
  btnProfileSave.addEventListener('click', async () => {
    const profile = getProfileById(profileModalSelectedId)
    if (!profile) return
    const patch = readProfileForm()
    if (!patch.name) {
      showStatus('El perfil necesita un nombre', 'warn', 3500)
      return
    }
    const result = await window.api.updateProfile(profile.id, patch)
    if (!result?.ok) {
      showStatus(result?.error || 'No pude guardar el perfil', 'error', 5500)
      return
    }
    profilesState = copyProfilesState(result)
    renderProfilesModalList()
    fillProfileForm(getProfileById(profile.id))
    renderProfileSelector()
    renderProfileReminder()
    showStatus('Perfil guardado', 'ok', 1800)
  })
}

if (btnProfileDelete) {
  btnProfileDelete.addEventListener('click', async () => {
    const profile = getProfileById(profileModalSelectedId)
    if (!profile) return
    if (profile.id === DEFAULT_PROFILE_ID) {
      showStatus('El perfil Personal no se puede borrar', 'warn', 3000)
      return
    }
    if (!confirm(`¿Borrar perfil "${profile.name}"?`)) return
    const result = await window.api.deleteProfile(profile.id)
    if (!result?.ok) {
      showStatus(result?.error || 'No pude borrar el perfil', 'error', 5500)
      return
    }
    profilesState = copyProfilesState(result)
    profileModalSelectedId = profilesState.activeProfile
    renderProfilesModalList()
    fillProfileForm(getProfileById(profileModalSelectedId))
    renderProfileSelector()
    renderProfileReminder()
    showStatus('Perfil borrado', 'ok', 1800)
  })
}

if (btnPickProfileClaudeMd) {
  btnPickProfileClaudeMd.addEventListener('click', async () => {
    const picked = await window.api.pickProfileClaudeMd()
    if (picked) profileClaudeMdInput.value = picked
  })
}

if (btnPickProfileCwd) {
  btnPickProfileCwd.addEventListener('click', async () => {
    const picked = await window.api.pickProfileCwd()
    if (picked) profileCwdInput.value = picked
  })
}

if (btnCloseEnterprise) btnCloseEnterprise.addEventListener('click', closeEnterpriseModal)
enterpriseModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeEnterpriseModal)
if (btnEnterpriseRoleNew) btnEnterpriseRoleNew.addEventListener('click', newEnterpriseRole)
if (btnEnterpriseOperatorNew) btnEnterpriseOperatorNew.addEventListener('click', newEnterpriseOperator)
if (btnEnterpriseDelete) btnEnterpriseDelete.addEventListener('click', deleteEnterpriseSelected)
if (btnEnterpriseSave) {
  btnEnterpriseSave.addEventListener('click', async () => {
    await saveEnterpriseConfigFromUi()
    renderEnterpriseLists()
    renderEnterpriseEditor()
  })
}

enterpriseModal?.addEventListener('input', () => {
  if (enterpriseModal.classList.contains('hidden')) return
  setEnterpriseModalStatus('Cambios locales sin guardar.', 'warn')
})

btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'))
settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => settingsModal.classList.add('hidden'))

btnRefreshTelegramStatus.addEventListener('click', async () => {
  renderTelegramStatus(await window.api.getTelegramStatus())
})

if (remoteSessionsListEl) {
  remoteSessionsListEl.addEventListener('click', async (ev) => {
    const btn = ev.target?.closest?.('button[data-remote-session-close]')
    if (!btn) return
    const id = String(btn.dataset.remoteSessionClose || '').trim()
    if (!id) return
    btn.disabled = true
    try {
      const res = await window.api.wsServerCloseSession?.(id)
      if (!res?.ok) showStatus(res?.error || 'No pude cerrar la sesión remota', 'error', 3000)
      await refreshLanServerStatus(true)
    } catch (err) {
      showStatus(errorMessage(err), 'error', 3000)
    } finally {
      btn.disabled = false
    }
  })
}

if (btnRemoteSessionsToggle) {
  btnRemoteSessionsToggle.addEventListener('click', () => {
    setRemoteSessionsUserVisible(!remoteSessionsUserVisible)
  })
}

btnSaveSettings.addEventListener('click', async () => {
  showStatus('Guardando configuracion…', 'busy')
  const lanEnabled = Boolean(cfgLanEnabled?.checked)
  const lanPort = clampLanPort(cfgLanPort?.value || 9999)
  if (cfgLanPort) cfgLanPort.value = String(lanPort)
  const payload = {
    cli: {
      defaultCli: cfgDefaultCli.value,
      claudeBin: cfgClaudeBin.value.trim(),
      claudeModel: cfgClaudeModel ? cfgClaudeModel.value.trim() : '',
      gitSessionIsolation: cfgGitIsolation ? Boolean(cfgGitIsolation.checked) : true,
      gitIsolationExcludes: cfgGitIsolationExcludes ? cfgGitIsolationExcludes.value : [],
      codexBin: cfgCodexBin.value.trim(),
      whisperBin: cfgWhisperBin.value.trim(),
      voiceId: cfgVoiceId ? cfgVoiceId.value : '',
      voiceRate: cfgVoiceRate ? cfgVoiceRate.value : '',
      voiceSilenceMs: cfgVoiceSilence ? cfgVoiceSilence.value : ''
    },
    telegram: {
      enabled: cfgTelegramEnabled.checked,
      botToken: cfgTelegramToken.value.trim(),
      allowedUsers: cfgTelegramUsers.value
        .split(/[,\s]+/g)
        .map((x) => x.trim())
        .filter(Boolean),
      claudeModel: cfgTelegramClaudeModel.value,
      claudeEffort: cfgTelegramClaudeEffort.value,
      codexModel: cfgTelegramCodexModel.value.trim(),
      codexEffort: cfgTelegramCodexEffort.value,
      notifyBotToken: cfgTelegramNotifyToken ? cfgTelegramNotifyToken.value.trim() : '',
      notifyChatId: cfgTelegramNotifyChat ? cfgTelegramNotifyChat.value.trim() : ''
    },
    lanServer: {
      enabled: lanEnabled,
      port: lanPort
    }
  }

  const result = await window.api.saveAppConfig(payload)
  if (!result.ok) {
    showStatus(result.error || 'Error guardando configuracion', 'error', 7000)
    await refreshSettings()
    return
  }

  const currentCli = await window.api.getActiveCli()
  cliSelector.value = currentCli
  // `save-app-config` puede haber cambiado "CLI por defecto" y aplicado el
  // cambio a esta ventana en silencio (main.js: setActiveCli sin evento
  // propio) — a diferencia del `cli-selector` de la topbar, aquí no hay
  // ningún otro punto que se entere. Se sincroniza ANTES del fullRestart, no
  // después: `s.activeCli` en main ya cambió aunque el restart del PTY falle
  // luego, así que el gate debe reflejarlo pase lo que pase con el restart.
  await updateVoiceCliAvailability(currentCli)
  try {
    await fullRestart()
    term.focus()
  } catch (err) {
    showStatus(errorMessage(err), 'error', 7000)
    await refreshSettings()
    return
  }

  let enterpriseWarning = ''
  const enterpriseRes = await saveEnterpriseConfigFromUi()
  if (!enterpriseRes?.ok) {
    enterpriseWarning = enterpriseRes?.error || 'No se pudo guardar configuración enterprise'
  }

  await refreshSettings()
  await refreshLanServerStatus(true)
  const allWarnings = []
  if (Array.isArray(result.warnings) && result.warnings.length) allWarnings.push(...result.warnings)
  if (enterpriseWarning) allWarnings.push(`Enterprise: ${enterpriseWarning}`)
  if (allWarnings.length) {
    showStatus(allWarnings.join(' | '), 'warn', 7000)
  } else {
    showStatus('Configuracion guardada y aplicada', 'info', 2500)
  }
})

// ── Imagen / Archivo ──
btnImage.addEventListener('click', async () => {
  const paths = await window.api.pickImage()
  if (!paths.length) return
  injectToPty(paths.map(p => `@${p}`).join(' ') + ' ')
})

btnFile.addEventListener('click', async () => {
  const paths = await window.api.pickFile()
  if (!paths.length) return
  injectToPty(paths.map(p => `@${p}`).join(' ') + ' ')
})

// ── Drag & drop ──
let dragDepth = 0
window.addEventListener('dragenter', (e) => {
  e.preventDefault()
  dragDepth++
  dropOverlay.classList.remove('hidden')
})
window.addEventListener('dragover', (e) => { e.preventDefault() })
window.addEventListener('dragleave', (e) => {
  e.preventDefault()
  dragDepth--
  if (dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.add('hidden') }
})
window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  dropOverlay.classList.add('hidden')
  const files = Array.from(e.dataTransfer.files)
  if (!files.length) return
  const paths = files
    .map(f => window.api?.getPathForFile ? window.api.getPathForFile(f) : (f.path || ''))
    .filter(Boolean)
    .map(p => `@${p}`)
    .join(' ') + ' '
  if (paths.trim()) injectToPty(paths)
})

// ── Micro de dictado ──
let mediaRecorder = null
let audioChunks = []
let recording = false

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunks = []
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(audioChunks, { type: 'audio/webm' })
      if (blob.size < 500) {
        showStatus('Audio muy corto, ignorado', 'warn', 2000)
        return
      }
      showStatus('Transcribiendo…', 'busy')
      try {
        const buf = await blob.arrayBuffer()
        const text = await window.api.transcribeAudio(buf)
        hideStatus()
        if (text) injectToPty(text + ' ')
      } catch (err) {
        showStatus(`Error transcripción: ${err.message || err}`, 'error', 4000)
      }
    }

    mediaRecorder.start()
    recording = true
    btnMic.classList.add('recording')
    showStatus('● Grabando… (clic para parar)', 'rec')
  } catch (err) {
    showStatus(`Sin micro: ${err.message || err}`, 'error', 4000)
  }
}

function stopRecording() {
  if (mediaRecorder && recording) {
    mediaRecorder.stop()
    recording = false
    btnMic.classList.remove('recording')
  }
}

btnMic.addEventListener('click', () => {
  recording ? stopRecording() : startRecording()
})

// atajo: Cmd+Shift+M para dictado
window.addEventListener('keydown', (e) => {
  if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'm') {
    e.preventDefault()
    recording ? stopRecording() : startRecording()
  }
})

// ── Sidebar: árbol de archivos ──
let rootPath = null
const ROOT_KEY = `claude-electron-root:${WID}`

// ── Historial de navegación ──
const navHistory = []
let navIndex = -1
const btnNavBack = document.getElementById('btn-nav-back')
const btnNavForward = document.getElementById('btn-nav-forward')

function updateNavButtons() {
  btnNavBack.disabled = navIndex <= 0
  btnNavForward.disabled = navIndex >= navHistory.length - 1
}

btnNavBack.addEventListener('click', async () => {
  if (navIndex <= 0) return
  navIndex--
  await setRoot(navHistory[navIndex], false)
})
btnNavForward.addEventListener('click', async () => {
  if (navIndex >= navHistory.length - 1) return
  navIndex++
  await setRoot(navHistory[navIndex], false)
})
const CLI_KEY = `claude-electron-cli:${WID}`

// ── Vista grafo / árbol ──────────────────────────────────────────────────
let graphInstance = null
let graphAllData = null
let currentView = localStorage.getItem('poweragent.sidebar.view') || 'tree'
let graphMode = localStorage.getItem('poweragent.graph.mode') || 'refs'
const DEFAULT_GRAPH_FORCES = Object.freeze({
  repulsion: -220,
  linkDistance: 96,
  particleSpeed: 3600,
  compactness: 0.03
})
const DEFAULT_GRAPH_SPEED = 6

function clampGraphNumber (value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function sanitizeGraphForces (raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    repulsion: Math.round(clampGraphNumber(src.repulsion, -900, -20, DEFAULT_GRAPH_FORCES.repulsion) / 10) * 10,
    linkDistance: Math.round(clampGraphNumber(src.linkDistance, 20, 320, DEFAULT_GRAPH_FORCES.linkDistance) / 2) * 2,
    particleSpeed: Math.round(clampGraphNumber(src.particleSpeed, 500, 12000, DEFAULT_GRAPH_FORCES.particleSpeed) / 50) * 50,
    compactness: clampGraphNumber(src.compactness, 0, 0.2, DEFAULT_GRAPH_FORCES.compactness)
  }
}

function persistGraphForces () {
  localStorage.setItem('poweragent.graph.repulsion', String(graphForces.repulsion))
  localStorage.setItem('poweragent.graph.linkDistance', String(graphForces.linkDistance))
  localStorage.setItem('poweragent.graph.particleSpeed', String(graphForces.particleSpeed))
  localStorage.setItem('poweragent.graph.compactness', String(graphForces.compactness))
}

function resetGraphViewSettings () {
  graphForces = { ...DEFAULT_GRAPH_FORCES }
  graphSpeedSlider = DEFAULT_GRAPH_SPEED
  persistGraphForces()
  localStorage.setItem('poweragent_graph_speed', String(graphSpeedSlider))
  if (graphInstance?.setForces) graphInstance.setForces(graphForces)
  if (graphInstance?.setSpeed) graphInstance.setSpeed(graphSpeedFactor())
  buildFilters()
  renderFiltered()
}

// v4: reset de fuerzas/velocidad para recuperar legibilidad del layout.
if (localStorage.getItem('poweragent.graph.forces.v') !== '4') {
  localStorage.removeItem('poweragent.graph.repulsion')
  localStorage.removeItem('poweragent.graph.linkDistance')
  localStorage.removeItem('poweragent.graph.particleSpeed')
  localStorage.removeItem('poweragent.graph.compactness')
  localStorage.removeItem('poweragent_graph_speed')
  localStorage.setItem('poweragent.graph.forces.v', '4')
}
let graphForces = sanitizeGraphForces({
  repulsion: Number(localStorage.getItem('poweragent.graph.repulsion')),
  linkDistance: Number(localStorage.getItem('poweragent.graph.linkDistance')),
  particleSpeed: Number(localStorage.getItem('poweragent.graph.particleSpeed')),
  compactness: Number(localStorage.getItem('poweragent.graph.compactness'))
})
persistGraphForces()
let forcePanelOpen = false

// Filtros de extensión estables (evita chips "basura" cuando la raíz del grafo
// contiene backups/logs/temporales).
const ALL_TYPES = ['md', 'js', 'ts', 'json', 'css', 'html', 'py', 'php', 'go', 'otros']
const KNOWN_TYPES = new Set(ALL_TYPES.filter((t) => t !== 'otros'))
const COLORS_BY_TYPE = {
  md: '#a78bfa',
  js: '#fbbf24',
  ts: '#38bdf8',
  json: '#34d399',
  css: '#fb7185',
  html: '#f97316',
  py: '#22c55e',
  php: '#4f7cf5',
  go: '#06b6d4',
  otros: '#6b7280'
}
function colorForExt (type) { return COLORS_BY_TYPE[type] || COLORS_BY_TYPE.otros }
function extLabel (type) { return type }

let presentExts = ALL_TYPES.slice()

// Persistimos las extensiones INACTIVAS, no las activas: así, cuando aparece
// una extensión nueva en un proyecto, arranca activa por defecto.
let refsInactiveTypes = (() => {
  try {
    const raw = localStorage.getItem('poweragent_graph_refs_exts_inactive')
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch { return new Set() }
})()
let structureInactiveTypes = (() => {
  try {
    const raw = localStorage.getItem('poweragent_graph_structure_exts_inactive')
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch { return new Set() }
})()
function persistRefsInactive () {
  try { localStorage.setItem('poweragent_graph_refs_exts_inactive', JSON.stringify(Array.from(refsInactiveTypes))) } catch {}
}
function persistStructureInactive () {
  try { localStorage.setItem('poweragent_graph_structure_exts_inactive', JSON.stringify(Array.from(structureInactiveTypes))) } catch {}
}
// Set efectivo de tipos activos para el modo dado, derivado de `presentExts`
// menos los inactivos persistidos. Nuevas extensiones arrancan activas.
function activeTypesFor (mode) {
  const inactive = mode === 'structure' ? structureInactiveTypes : refsInactiveTypes
  return new Set(ALL_TYPES.filter((t) => !inactive.has(t)))
}
function recomputePresentExts (nodes) {
  presentExts = ALL_TYPES.slice()
}
let graphSearchQuery = localStorage.getItem('poweragent.graph.search') || ''
let graphSearchNo = 0
let graphHotOnly = localStorage.getItem('poweragent.graph.hotOnly') === '1'
// Velocidad del grafo. Slider 1..10 -> factor 0.1..1.0. Default 6 (factor 0.6).
// Luismi: el default antiguo (1.0) mareaba. Persistido por usuario.
let graphSpeedSlider = (() => {
  const raw = Number(localStorage.getItem('poweragent_graph_speed'))
  if (!Number.isFinite(raw) || raw < 1 || raw > 10) return DEFAULT_GRAPH_SPEED
  return Math.round(raw)
})()
function graphSpeedFactor () { return graphSpeedSlider / 10 }
// No persistimos "pausa" entre arranques para evitar que el grafo parezca roto.
let graphPaused = false
localStorage.removeItem('poweragent.graph.paused')
let graphRefreshDebounce = null
let graphRefreshInFlight = false
let graphLastActivePath = ''

function extType (label) {
  const name = String(label || '')
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return 'otros'
  }
  const ext = name.slice(lastDot + 1).toLowerCase()
  if (!ext) return 'otros'
  if (ext === 'mjs' || ext === 'cjs') return 'js'
  if (ext === 'tsx') return 'ts'
  if (ext === 'jsx') return 'js'
  return KNOWN_TYPES.has(ext) ? ext : 'otros'
}

function pathDir (p) {
  if (!p) return ''
  const idx = p.lastIndexOf('/')
  return idx > 0 ? p.slice(0, idx) : ''
}

function pathBase (p) {
  if (!p) return ''
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? (p.slice(idx + 1) || p) : p
}

function buildStructureGraph (nodes, dirs = []) {
  const root = rootPath || ''
  const folderMap = new Map()
  const ensureFolder = (dirPath) => {
    if (!dirPath || folderMap.has(dirPath)) return
    folderMap.set(dirPath, {
      id: dirPath,
      label: pathBase(dirPath),
      path: dirPath,
      connections: 0,
      type: 'folder',
      isRoot: dirPath === root
    })
  }
  const ensureDirChain = (startDir) => {
    let dir = startDir
    while (dir) {
      if (root && !(dir === root || dir.startsWith(root + '/'))) break
      ensureFolder(dir)
      if (root && dir === root) break
      const parent = pathDir(dir)
      if (!parent || parent === dir) break
      dir = parent
    }
  }

  if (root) ensureFolder(root)
  for (const d of (dirs || [])) {
    const p = typeof d === 'string' ? d : d?.path
    if (!p) continue
    ensureDirChain(p)
  }

  nodes.forEach(n => {
    ensureDirChain(pathDir(n.path) || root)
  })

  const folderNodes = Array.from(folderMap.values())
  const fileNodes = nodes.map((n) => ({ ...n, showLabelAlways: true }))
  const allNodes = [...folderNodes, ...fileNodes]
  const edges = []

  nodes.forEach(n => {
    const parentDir = pathDir(n.path) || root
    if (folderMap.has(parentDir)) edges.push({ source: n.id, target: parentDir, kind: 'parent-child' })
  })

  folderNodes.forEach(f => {
    if (f.id === root) return
    const parentDir = pathDir(f.id)
    const targetId = folderMap.has(parentDir) ? parentDir : root
    if (targetId && targetId !== f.id) edges.push({ source: f.id, target: targetId, kind: 'parent-child' })
  })

  return { nodes: allNodes, edges }
}

function pickHotNodeIds (nodes) {
  const files = (nodes || []).filter((n) => n && !n.type)
  if (!files.length) return new Set()
  const now = Date.now()
  const sorted = [...files].sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
  const fresh = sorted.filter((n) => n.mtimeMs && (now - n.mtimeMs) <= 24 * 60 * 60 * 1000)
  const picked = (fresh.length >= 6 ? fresh.slice(0, 120) : sorted.slice(0, 40))
  return new Set(picked.map((n) => n.id))
}

function buildFilters () {
  graphFilters.innerHTML = ''

  const topRow = document.createElement('div')
  topRow.className = 'graph-mode-row'

  ;[['refs', 'Referencias'], ['structure', 'Estructura']].forEach(([mode, label]) => {
    const btn = document.createElement('button')
    btn.className = 'graph-mode-btn' + (graphMode === mode ? ' active' : '')
    btn.textContent = label
    btn.addEventListener('click', () => {
      graphMode = mode
      localStorage.setItem('poweragent.graph.mode', mode)
      buildFilters()
      renderFiltered()
    })
    topRow.appendChild(btn)
  })

  const btnForces = document.createElement('button')
  btnForces.className = 'btn-graph-forces' + (forcePanelOpen ? ' active' : '')
  btnForces.textContent = '⚙ Fuerzas'
  btnForces.addEventListener('click', () => {
    forcePanelOpen = !forcePanelOpen
    buildFilters()
  })
  topRow.appendChild(btnForces)

  const btnHot = document.createElement('button')
  btnHot.className = 'btn-graph-hot' + (graphHotOnly ? ' active' : '')
  btnHot.textContent = '🔥 Calientes'
  btnHot.title = 'Mostrar solo archivos recientes (último día o top más tocados)'
  btnHot.addEventListener('click', () => {
    graphHotOnly = !graphHotOnly
    localStorage.setItem('poweragent.graph.hotOnly', graphHotOnly ? '1' : '0')
    buildFilters()
    renderFiltered()
  })
  topRow.appendChild(btnHot)

  const btnPause = document.createElement('button')
  btnPause.className = 'btn-graph-pause' + (graphPaused ? ' active' : '')
  btnPause.textContent = graphPaused ? '▶ Reanudar' : '⏸ Pausar'
  btnPause.title = graphPaused ? 'Reanudar movimiento del grafo' : 'Parar movimiento del grafo'
  btnPause.addEventListener('click', () => {
    graphPaused = !graphPaused
    if (graphInstance?.setPaused) graphInstance.setPaused(graphPaused)
    buildFilters()
  })
  topRow.appendChild(btnPause)

  // Slider de velocidad (1-10). 1 = muy lento, 10 = rápido. Default 5.
  const speedWrap = document.createElement('label')
  speedWrap.className = 'graph-speed-wrap'
  speedWrap.title = 'Velocidad de la animación del grafo'
  const speedLbl = document.createElement('span')
  speedLbl.className = 'graph-speed-label'
  speedLbl.textContent = 'Velocidad'
  const speedInput = document.createElement('input')
  speedInput.type = 'range'
  speedInput.className = 'graph-speed-input'
  speedInput.min = '1'
  speedInput.max = '10'
  speedInput.step = '1'
  speedInput.value = String(graphSpeedSlider)
  const speedVal = document.createElement('span')
  speedVal.className = 'graph-speed-val'
  speedVal.textContent = String(graphSpeedSlider)
  speedInput.addEventListener('input', () => {
    const v = Math.max(1, Math.min(10, Number(speedInput.value) || 5))
    graphSpeedSlider = v
    speedVal.textContent = String(v)
    localStorage.setItem('poweragent_graph_speed', String(v))
    if (graphInstance?.setSpeed) graphInstance.setSpeed(graphSpeedFactor())
  })
  speedWrap.append(speedLbl, speedInput, speedVal)
  topRow.appendChild(speedWrap)

  graphFilters.appendChild(topRow)

  const searchRow = document.createElement('div')
  searchRow.className = 'graph-search-row'
  const searchInput = document.createElement('input')
  searchInput.className = 'graph-search-input'
  searchInput.type = 'search'
  searchInput.placeholder = 'Buscar en el directorio actual'
  searchInput.value = graphSearchQuery
  const btnPrev = document.createElement('button')
  btnPrev.className = 'btn-graph-search-nav'
  btnPrev.type = 'button'
  btnPrev.textContent = '◀'
  btnPrev.title = 'Coincidencia anterior'
  const btnNext = document.createElement('button')
  btnNext.className = 'btn-graph-search-nav'
  btnNext.type = 'button'
  btnNext.textContent = '▶'
  btnNext.title = 'Coincidencia siguiente'
  const countEl = document.createElement('span')
  countEl.id = 'graph-search-count'
  countEl.className = 'graph-search-count'
  const refreshCount = (idx, total) => {
    if (total > 0) {
      countEl.textContent = `${idx + 1}/${total}`
      countEl.style.visibility = 'visible'
    } else if (graphSearchQuery) {
      countEl.textContent = '0/0'
      countEl.style.visibility = 'visible'
    } else {
      countEl.textContent = ''
      countEl.style.visibility = 'hidden'
    }
  }
  const runSearch = ({ cycle = false } = {}) => {
    graphSearchQuery = searchInput.value.trim()
    localStorage.setItem('poweragent.graph.search', graphSearchQuery)
    if (!graphInstance) return
    if (!graphSearchQuery) {
      graphSearchNo = 0
      graphInstance.searchClear?.()
      refreshCount(-1, 0)
      return
    }
    const info = graphInstance.focusByQuery?.(graphSearchQuery, {
      resetCycle: !cycle,
      scopeDir: rootPath || null,
      step: cycle ? 1 : 0
    }) || null
    graphSearchNo = Number(info?.total || 0)
    refreshCount(Number(info?.index ?? -1), graphSearchNo)
  }
  searchInput.addEventListener('input', () => runSearch({ cycle: false }))
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch({ cycle: true }) }
  })
  btnPrev.addEventListener('click', () => {
    if (!graphInstance?.searchPrev) return
    const info = graphInstance.searchPrev()
    graphSearchNo = Number(info?.total || 0)
    refreshCount(Number(info?.index ?? -1), graphSearchNo)
  })
  btnNext.addEventListener('click', () => {
    if (!graphInstance?.searchNext) return
    const info = graphInstance.searchNext()
    graphSearchNo = Number(info?.total || 0)
    refreshCount(Number(info?.index ?? -1), graphSearchNo)
  })
  searchRow.append(searchInput, btnPrev, btnNext, countEl)
  graphFilters.appendChild(searchRow)
  // Estado inicial del contador al (re)construir filtros
  refreshCount(-1, graphSearchQuery ? graphSearchNo : 0)

  // Panel de fuerzas
  const forcesPanel = document.createElement('div')
  forcesPanel.className = 'graph-forces-panel' + (forcePanelOpen ? ' visible' : '')
  ;[
    ['Repulsión', 'repulsion', -800, -20, 10, v => -v],
    ['Distancia', 'linkDistance', 20, 300, 10, v => v],
    ['Partículas', 'particleSpeed', 500, 10000, 100, v => v],
    ['Compactar', 'compactness', 0, 0.2, 0.005, v => `${Math.round(Number(v) * 100)}%`]
  ].forEach(([label, key, min, max, step, display]) => {
    const row = document.createElement('div')
    row.className = 'graph-force-row'
    const lbl = document.createElement('label')
    lbl.textContent = label
    const input = document.createElement('input')
    input.type = 'range'
    input.min = min; input.max = max; input.step = step
    input.value = graphForces[key]
    const val = document.createElement('span')
    val.textContent = display(graphForces[key])
    input.addEventListener('input', () => {
      graphForces[key] = Number(input.value)
      val.textContent = display(graphForces[key])
      localStorage.setItem(`poweragent.graph.${key}`, graphForces[key])
      if (graphInstance) graphInstance.setForces(graphForces)
    })
    row.append(lbl, input, val)
    forcesPanel.appendChild(row)
  })
  graphFilters.appendChild(forcesPanel)

  if (graphMode === 'refs' || graphMode === 'structure') {
    const chipsRow = document.createElement('div')
    chipsRow.className = 'graph-chips-row'
    const inactive = graphMode === 'refs' ? refsInactiveTypes : structureInactiveTypes
    const persist = graphMode === 'refs' ? persistRefsInactive : persistStructureInactive
    ALL_TYPES.forEach(type => {
      const chip = document.createElement('button')
      const isActive = !inactive.has(type)
      chip.className = 'graph-chip' + (isActive ? ' active' : '')
      chip.textContent = extLabel(type)
      chip.style.setProperty('--chip-color', colorForExt(type))
      chip.addEventListener('click', () => {
        if (inactive.has(type)) {
          inactive.delete(type)
          chip.classList.add('active')
        } else {
          inactive.add(type)
          chip.classList.remove('active')
        }
        persist()
        renderFiltered()
      })
      chipsRow.appendChild(chip)
    })
    graphFilters.appendChild(chipsRow)
  }
}

function renderFiltered () {
  if (!graphAllData) return
  let nodes, edges
  let sourceNodes = graphAllData.nodes
  const activeSet = activeTypesFor(graphMode)
  // Si el set efectivo está vacío (todo desactivado), no filtramos: el usuario
  // probablemente quiso ver todo. Coherente con la spec.
  const applyExtFilter = activeSet.size > 0 && activeSet.size < ALL_TYPES.length
  if (applyExtFilter) {
    sourceNodes = sourceNodes.filter(n => activeSet.has(extType(n.label)))
  }
  if (graphHotOnly) {
    const hotIds = pickHotNodeIds(sourceNodes)
    if (hotIds.size > 0) sourceNodes = sourceNodes.filter((n) => hotIds.has(n.id))
  }
  if (graphMode === 'structure') {
    // Si el filtro de extensiones está completo (todo activo), pasamos los
    // dirs explícitos del proyecto (comportamiento original). Si hay filtro
    // activo parcial, omitimos dirs para que las carpetas se deriven sólo de
    // los archivos visibles y no queden directorios huérfanos colgando.
    const allOn = !applyExtFilter
    const dirsArg = allOn ? (graphAllData.dirs || []) : []
    const structData = buildStructureGraph(sourceNodes, dirsArg)
    nodes = structData.nodes
    edges = structData.edges
  } else {
    nodes = sourceNodes
    const visibleIds = new Set(nodes.map(n => n.id))
    edges = graphAllData.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
  }
  if (graphInstance) { graphInstance.destroy(); graphInstance = null }
  graphInstance = window.GraphRenderer.init(
    graphCanvas,
    { nodes, edges },
    {
      onDblClick: (filePath) => injectToPty(`@${filePath} `),
      onContextMenu: (node, x, y) => showGraphContextMenu(node, x, y),
      forces: graphForces,
      autoPause: false
    }
  )
  if (graphLastActivePath && graphInstance?.markActivePath) {
    graphInstance.markActivePath(graphLastActivePath)
  }
  // Reaplicar velocidad tras (re)render — la nueva instancia parte de 1.0.
  if (graphInstance?.setSpeed) graphInstance.setSpeed(graphSpeedFactor())
  if (graphPaused && graphInstance?.setPaused) {
    graphInstance.setPaused(graphPaused)
  }
  if (graphSearchQuery && graphInstance?.focusByQuery) {
    const info = graphInstance.focusByQuery(graphSearchQuery, {
      resetCycle: true,
      scopeDir: rootPath || null
    })
    graphSearchNo = Number(info?.total || 0)
    const cEl = graphFilters.querySelector('#graph-search-count')
    if (cEl) {
      if (graphSearchNo > 0) {
        cEl.textContent = `${Number(info?.index ?? 0) + 1}/${graphSearchNo}`
        cEl.style.visibility = 'visible'
      } else {
        cEl.textContent = '0/0'
        cEl.style.visibility = 'visible'
      }
    }
  } else {
    graphSearchNo = 0
  }
}

const BINARY_EXTS = new Set([
  'jpg','jpeg','png','gif','webp','bmp','ico','tif','tiff','svgz',
  'pdf','zip','tar','gz','tgz','rar','7z','bz2','xz',
  'mp3','wav','m4a','ogg','flac','aac',
  'mp4','mov','webm','mkv','avi','wmv',
  'exe','dmg','app','pkg','deb','rpm',
  'woff','woff2','ttf','otf','eot',
  'so','dylib','dll','class','jar','o','a',
  'sqlite','db','bin'
])

function isLikelyBinaryByExt (filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  return BINARY_EXTS.has(ext)
}

let graphCtxMenuOpen = false
let graphCtxMenuCloseHandler = null

function closeGraphContextMenu () {
  const menu = document.getElementById('graph-context-menu')
  if (!menu) return
  menu.classList.add('hidden')
  menu.innerHTML = ''
  graphCtxMenuOpen = false
  if (graphCtxMenuCloseHandler) {
    document.removeEventListener('click', graphCtxMenuCloseHandler, true)
    document.removeEventListener('contextmenu', graphCtxMenuCloseHandler, true)
    window.removeEventListener('blur', graphCtxMenuCloseHandler)
    window.removeEventListener('resize', graphCtxMenuCloseHandler)
    graphCtxMenuCloseHandler = null
  }
}

function showGraphContextMenu (node, x, y) {
  try { console.log('[graph-ctx] open', { path: node?.path, type: node?.type, x, y }) } catch {}
  const menu = document.getElementById('graph-context-menu')
  if (!menu) { try { console.warn('[graph-ctx] missing #graph-context-menu element') } catch {}; return }
  // Cierra cualquier menú zombie antes de abrir el nuevo (evita listeners duplicados).
  if (graphCtxMenuOpen) closeGraphContextMenu()
  menu.innerHTML = ''

  const isFolder = node.type === 'folder'

  if (!isFolder) {
    const openItem = document.createElement('div')
    openItem.className = 'ctx-menu-item'
    openItem.textContent = 'Abrir'
    openItem.addEventListener('click', (e) => {
      e.stopPropagation()
      closeGraphContextMenu()
      openGraphFileModal(node)
    })
    menu.appendChild(openItem)
  }

  const pasteItem = document.createElement('div')
  pasteItem.className = 'ctx-menu-item'
  pasteItem.textContent = 'Pegar ruta'
  pasteItem.addEventListener('click', (e) => {
    e.stopPropagation()
    closeGraphContextMenu()
    injectToPty('@' + node.path + ' ')
  })
  menu.appendChild(pasteItem)

  menu.classList.remove('hidden')
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rect = menu.getBoundingClientRect()
  const px = Math.min(x, vw - rect.width - 4)
  const py = Math.min(y, vh - rect.height - 4)
  menu.style.left = Math.max(4, px) + 'px'
  menu.style.top = Math.max(4, py) + 'px'

  graphCtxMenuOpen = true
  graphCtxMenuCloseHandler = (ev) => {
    if (ev && ev.target && menu.contains(ev.target)) return
    closeGraphContextMenu()
  }
  setTimeout(() => {
    document.addEventListener('click', graphCtxMenuCloseHandler, true)
    document.addEventListener('contextmenu', graphCtxMenuCloseHandler, true)
    window.addEventListener('blur', graphCtxMenuCloseHandler)
    window.addEventListener('resize', graphCtxMenuCloseHandler)
  }, 0)
}

let graphFileModalState = { path: null, originalText: null, editable: false }

async function openGraphFileModal (node) {
  try { console.log('[graph-modal] open', { path: node?.path }) } catch {}
  const modal = document.getElementById('graph-file-modal')
  const title = document.getElementById('graph-file-modal-title')
  const sub = document.getElementById('graph-file-modal-sub')
  const textarea = document.getElementById('graph-file-modal-textarea')
  const notice = document.getElementById('graph-file-modal-notice')
  const saveBtn = document.getElementById('graph-file-modal-save')
  const statusEl = document.getElementById('graph-file-modal-status')
  if (!modal) { try { console.warn('[graph-modal] missing #graph-file-modal element') } catch {}; return }
  if (!node || !node.path) { try { console.warn('[graph-modal] node has no path', node) } catch {}; return }

  title.textContent = node.label || node.path.split('/').pop()
  sub.textContent = node.path
  statusEl.textContent = ''
  textarea.value = ''
  notice.textContent = ''

  graphFileModalState = { path: node.path, originalText: null, editable: false }

  if (isLikelyBinaryByExt(node.path)) {
    textarea.classList.add('hidden')
    notice.textContent = 'No editable (archivo binario)'
    notice.classList.remove('hidden')
    saveBtn.disabled = true
    modal.classList.remove('hidden')
    modal.style.display = 'flex'
    return
  }

  textarea.classList.remove('hidden')
  notice.classList.add('hidden')
  textarea.value = 'Cargando…'
  textarea.disabled = true
  saveBtn.disabled = true
  modal.classList.remove('hidden')

  const res = await window.api.fileRead(node.path)
  if (!res || !res.ok) {
    textarea.classList.add('hidden')
    notice.textContent = 'No editable: ' + (res?.error || 'no se pudo leer')
    notice.classList.remove('hidden')
    return
  }
  if (res.kind === 'image' || res.kind === 'binary') {
    textarea.classList.add('hidden')
    notice.textContent = 'No editable (' + res.kind + ')'
    notice.classList.remove('hidden')
    return
  }

  textarea.disabled = false
  textarea.value = res.text || ''
  saveBtn.disabled = false
  graphFileModalState.originalText = res.text || ''
  graphFileModalState.editable = true
}

function closeGraphFileModal () {
  const modal = document.getElementById('graph-file-modal')
  if (!modal) return
  modal.classList.add('hidden')
  modal.style.display = ''
  graphFileModalState = { path: null, originalText: null, editable: false }
}

document.getElementById('graph-file-modal-close')?.addEventListener('click', closeGraphFileModal)
document.getElementById('graph-file-modal-cancel')?.addEventListener('click', closeGraphFileModal)
document.querySelector('#graph-file-modal .modal-backdrop')?.addEventListener('click', closeGraphFileModal)
document.getElementById('graph-file-modal-save')?.addEventListener('click', async () => {
  if (!graphFileModalState.editable || !graphFileModalState.path) return
  const textarea = document.getElementById('graph-file-modal-textarea')
  const statusEl = document.getElementById('graph-file-modal-status')
  const saveBtn = document.getElementById('graph-file-modal-save')
  const content = textarea.value
  saveBtn.disabled = true
  statusEl.textContent = 'Guardando…'
  const res = await window.api.fileWrite(graphFileModalState.path, content)
  if (res && res.ok) {
    graphFileModalState.originalText = content
    statusEl.textContent = '✓ Guardado'
    saveBtn.disabled = false
    setTimeout(() => { statusEl.textContent = '' }, 2000)
  } else {
    statusEl.textContent = '✗ ' + (res?.error || 'error')
    saveBtn.disabled = false
  }
})

function applyView (view) {
  currentView = view
  localStorage.setItem('poweragent.sidebar.view', view)
  if (view === 'graph') {
    treeEl.classList.add('hidden')
    graphCanvas.classList.remove('hidden')
    graphFilters.classList.remove('hidden')
    btnViewTree.classList.remove('active')
    btnViewGraph.classList.add('active')
    loadGraph()
  } else {
    graphCanvas.classList.add('hidden')
    graphFilters.classList.add('hidden')
    treeEl.classList.remove('hidden')
    btnViewTree.classList.add('active')
    btnViewGraph.classList.remove('active')
    if (graphInstance) { graphInstance.destroy(); graphInstance = null }
  }
}

async function loadGraph () {
  if (graphInstance) { graphInstance.destroy(); graphInstance = null }
  const root = rootPath || await window.api.ptyCwd()
  if (!root) return
  const result = await window.api.sidebarGetGraph(root)
  if (!result.ok) return
  if (currentView !== 'graph') return
  graphAllData = { nodes: result.nodes, edges: result.edges, dirs: result.dirs || [] }
  recomputePresentExts(graphAllData.nodes)
  buildFilters()
  renderFiltered()
}

function scheduleGraphRefresh () {
  if (currentView !== 'graph') return
  if (graphRefreshDebounce) clearTimeout(graphRefreshDebounce)
  graphRefreshDebounce = setTimeout(async () => {
    if (graphRefreshInFlight) return
    graphRefreshInFlight = true
    try { await loadGraph() } finally { graphRefreshInFlight = false }
  }, 420)
}

btnViewTree.addEventListener('click', () => applyView('tree'))
btnViewGraph.addEventListener('click', () => applyView('graph'))
if (btnOpenGraphWindow) {
  btnOpenGraphWindow.addEventListener('click', async () => {
    console.log('[graph-window] btn clicked, rootPath=', rootPath)
    let root = rootPath
    if (!root) {
      try { root = localStorage.getItem(ROOT_KEY) || '' } catch {}
    }
    if (!root) {
      try { root = await window.api.ptyCwd() } catch (e) { console.warn('[graph-window] ptyCwd error', e) }
    }
    console.log('[graph-window] resolved root=', root)
    try {
      const res = await window.api.openGraphWindowStandalone(root || null)
      console.log('[graph-window] open result=', res)
    } catch (e) {
      console.error('[graph-window] open error', e)
    }
  })
} else {
  console.warn('[graph-window] btn-open-graph-window not found in DOM')
}

const EXT_ICONS = {
  js: '🟨', ts: '🔷', tsx: '⚛', jsx: '⚛', json: '🔧',
  py: '🐍', md: '📝', txt: '📄', sh: '⚡', html: '🌐',
  css: '🎨', scss: '🎨', yml: '⚙', yaml: '⚙',
  png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
  mp3: '🎵', wav: '🎵', m4a: '🎵', webm: '🎬', mp4: '🎬', mov: '🎬',
  pdf: '📕', zip: '📦', tar: '📦', gz: '📦',
  env: '🔐', gitignore: '🚫', lock: '🔒'
}

function iconFor(name, isDir) {
  if (isDir) return '📁'
  const ext = name.split('.').pop()?.toLowerCase()
  return EXT_ICONS[ext] || '📄'
}

function shortenPath(p, max = 36) {
  if (p.length <= max) return p
  const parts = p.split('/')
  if (parts.length <= 3) return '…/' + parts.slice(-2).join('/')
  return '…/' + parts.slice(-2).join('/')
}

let pendingExpand = new Set()

async function setRoot(newRoot, record = true) {
  rootPath = newRoot
  localStorage.setItem(ROOT_KEY, newRoot)
  if (record) {
    navHistory.splice(navIndex + 1)
    navHistory.push(newRoot)
    navIndex = navHistory.length - 1
  }
  updateNavButtons()
  sidebarTitle.textContent = newRoot.split('/').pop() || newRoot
  sidebarTitle.title = newRoot
  treeEl.innerHTML = ''
  await renderTreeInto(treeEl, newRoot, 0)
  if (typeof updateCwdLabel === 'function') await updateCwdLabel()
  try { window.api.watchDir(newRoot) } catch {}
  try { lastTreeSignature = await computeTreeSignature() } catch {}
  if (currentView === 'graph') loadGraph()
}

function getExpandedPaths() {
  const set = new Set()
  document.querySelectorAll('.tree-row[data-is-dir="true"]').forEach(row => {
    const next = row.nextElementSibling
    if (next && next.classList.contains('tree-sub') && !next.classList.contains('hidden')) {
      set.add(row.dataset.path)
    }
  })
  return set
}

let refreshTreeDebounce = null
let lastTreeSignature = ''
let refreshInFlight = false

async function computeTreeSignature() {
  const expandedDirs = ['__root__:' + rootPath]
  document.querySelectorAll('.tree-row[data-is-dir="true"]').forEach(row => {
    const next = row.nextElementSibling
    if (next && next.classList.contains('tree-sub') && !next.classList.contains('hidden')) {
      expandedDirs.push(row.dataset.path)
    }
  })
  const parts = []
  for (const key of expandedDirs) {
    const dir = key.startsWith('__root__:') ? key.slice(9) : key
    const res = await window.api.readDir(dir)
    if (!res.ok) { parts.push(`${key}=ERR`); continue }
    const sig = res.entries.map(e => `${e.name}|${e.isDir ? 1 : 0}|${e.size || 0}`).join(',')
    parts.push(`${key}=${sig}`)
  }
  return parts.join('||')
}

function scheduleTreeRefresh() {
  if (refreshTreeDebounce) clearTimeout(refreshTreeDebounce)
  refreshTreeDebounce = setTimeout(async () => {
    if (!rootPath) return
    if (refreshInFlight) return
    refreshInFlight = true
    try {
      const newSig = await computeTreeSignature()
      if (newSig === lastTreeSignature) return
      lastTreeSignature = newSig
      const scrollTop = treeEl.parentElement ? treeEl.parentElement.scrollTop : 0
      pendingExpand = getExpandedPaths()
      sidebarTitle.textContent = rootPath.split('/').pop() || rootPath
      sidebarTitle.title = rootPath
      treeEl.innerHTML = ''
      await renderTreeInto(treeEl, rootPath, 0)
      pendingExpand = new Set()
      if (treeEl.parentElement) treeEl.parentElement.scrollTop = scrollTop
    } finally {
      refreshInFlight = false
    }
  }, 400)
}

async function renderTreeInto(container, dir, depth) {
  const res = await window.api.readDir(dir)
  if (!res.ok) {
    const err = document.createElement('div')
    err.className = 'tree-error'
    err.textContent = `⚠ ${res.error}`
    container.appendChild(err)
    return
  }

  for (const entry of res.entries) {
    const row = document.createElement('div')
    row.className = 'tree-row'
    row.dataset.path = entry.path
    row.dataset.isDir = entry.isDir
    row.style.paddingLeft = (8 + depth * 14) + 'px'

    const arrow = document.createElement('span')
    arrow.className = 'tree-arrow'
    arrow.textContent = entry.isDir ? '▸' : ''

    const icon = document.createElement('span')
    icon.className = 'tree-icon'
    icon.textContent = iconFor(entry.name, entry.isDir)

    const label = document.createElement('span')
    label.className = 'tree-label'
    label.textContent = entry.name

    row.append(arrow, icon, label)
    container.appendChild(row)

    if (entry.isDir) {
      const sub = document.createElement('div')
      sub.className = 'tree-sub hidden'
      container.appendChild(sub)

      row.addEventListener('click', async (e) => {
        e.stopPropagation()
        const expanded = !sub.classList.contains('hidden')
        if (expanded) {
          sub.classList.add('hidden')
          arrow.textContent = '▸'
        } else {
          if (!sub.dataset.loaded) {
            await renderTreeInto(sub, entry.path, depth + 1)
            sub.dataset.loaded = '1'
          }
          sub.classList.remove('hidden')
          arrow.textContent = '▾'
        }
      })

      if (pendingExpand.has(entry.path)) {
        if (!sub.dataset.loaded) {
          await renderTreeInto(sub, entry.path, depth + 1)
          sub.dataset.loaded = '1'
        }
        sub.classList.remove('hidden')
        arrow.textContent = '▾'
      }

      row.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        setRoot(entry.path)
      })
    } else {
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        document.querySelectorAll('.tree-row.selected').forEach(r => r.classList.remove('selected'))
        row.classList.add('selected')
      })
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        const tw = document.getElementById('terminal-wrap')
        const r = tw ? tw.getBoundingClientRect() : null
        const hint = r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null
        window.api.openViewerWindow(entry.path, hint)
      })
      // botón aside para enviar a claude (aparece al hover)
      const sendBtn = document.createElement('button')
      sendBtn.className = 'tree-send'
      sendBtn.title = 'Enviar a Claude'
      sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9" fill="currentColor"/></svg>'
      sendBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        injectToPty(`@${entry.path} `)
      })
      row.appendChild(sendBtn)
    }
  }
}

btnOpenFolder.addEventListener('click', async () => {
  const picked = await window.api.pickFolder()
  if (!picked) return
  showStatus('Cargando carpeta y reiniciando Claude…', 'busy')
  try {
    await fullRestart(picked)
    await setRoot(picked)
    await updateCwdLabel()
    hideStatus()
    term.focus()
  } catch (err) {
    showStatus(errorMessage(err), 'error', 6000)
  }
})

btnRefreshTree.addEventListener('click', async () => {
  if (rootPath) await setRoot(rootPath)
  if (currentView === 'graph') loadGraph()
})

async function updateCwdLabel() {
  const cwd = await window.api.ptyCwd()
  cwdValue.textContent = shortenPath(cwd, 32)
  cwdValue.title = cwd
  // sync work-here button state (highlight si rootPath != cwd)
  if (rootPath && rootPath !== cwd) btnWorkHere.classList.add('attention')
  else btnWorkHere.classList.remove('attention')
}

btnWorkHere.addEventListener('click', async () => {
  if (!rootPath) return
  showStatus('Reiniciando Claude en esta carpeta…', 'busy')
  try {
    await fullRestart(rootPath)
    await updateCwdLabel()
    hideStatus()
    term.focus()
  } catch (err) {
    showStatus(errorMessage(err), 'error', 6000)
  }
})


function updateLayoutButtonsState () {
  const collapsed = sidebar.classList.contains('collapsed')
  const disabled = collapsed
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.style.opacity = disabled ? '0.4' : ''
    btn.style.pointerEvents = disabled ? 'none' : ''
  })
}

function expandSidebarIfCollapsed () {
  if (!sidebar.classList.contains('collapsed')) return
  sidebar.classList.remove('collapsed')
  divider.classList.remove('hidden')
  btnSidebar.classList.add('active')
  updateLayoutButtonsState()
}

btnSidebar.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed')
  const collapsed = sidebar.classList.contains('collapsed')
  divider.classList.toggle('hidden', collapsed)
  btnSidebar.classList.toggle('active', !collapsed)
  updateLayoutButtonsState()
  setTimeout(fitAndSync, 50)
})

// ── Layout switcher ──
const LAYOUT_KEY = 'poweragent.layout'
const SIDEBAR_SIZE_KEY = 'poweragent.sidebar.size'
const LAYOUTS = ['left', 'right', 'horizontal', 'split']

function applySidebarSize(name) {
  sidebar.style.width = ''
  sidebar.style.height = ''
  try {
    const raw = localStorage.getItem(SIDEBAR_SIZE_KEY)
    if (!raw) return
    const sizes = JSON.parse(raw)
    const v = sizes?.[name]
    if (typeof v !== 'number' || v <= 0) return
    if (name === 'horizontal') sidebar.style.height = v + 'px'
    else sidebar.style.width = v + 'px'
  } catch {}
}

function persistSidebarSize(name, value) {
  try {
    const raw = localStorage.getItem(SIDEBAR_SIZE_KEY)
    const sizes = raw ? JSON.parse(raw) : {}
    sizes[name] = value
    localStorage.setItem(SIDEBAR_SIZE_KEY, JSON.stringify(sizes))
  } catch {}
}

function setLayout(name, save = true) {
  LAYOUTS.forEach(l => {
    document.body.classList.toggle(`layout-${l}`, l === name)
    document.getElementById(`btn-layout-${l}`)?.classList.toggle('active', l === name)
  })
  applySidebarSize(name)
  const isHoriz = name === 'horizontal'
  divider.style.cursor = isHoriz ? 'row-resize' : 'col-resize'
  if (save) localStorage.setItem(LAYOUT_KEY, name)
  updateLayoutButtonsState()
  setTimeout(fitAndSync, 50)
}

LAYOUTS.forEach(name => {
  document.getElementById(`btn-layout-${name}`)?.addEventListener('click', () => {
    expandSidebarIfCollapsed()
    setLayout(name)
  })
})
setLayout(localStorage.getItem(LAYOUT_KEY) || 'left', false)
updateLayoutButtonsState()

// Divider resize
let isResizing = false
divider.addEventListener('mousedown', (e) => {
  isResizing = true
  const isHoriz = document.body.classList.contains('layout-horizontal')
  document.body.style.cursor = isHoriz ? 'row-resize' : 'col-resize'
  e.preventDefault()
})
window.addEventListener('mousemove', (e) => {
  if (!isResizing) return
  const isHoriz = document.body.classList.contains('layout-horizontal')
  const isRight = document.body.classList.contains('layout-right')
  if (isHoriz) {
    const mainRect = document.getElementById('main').getBoundingClientRect()
    const newH = Math.max(80, Math.min(500, e.clientY - mainRect.top))
    sidebar.style.height = newH + 'px'
  } else if (isRight) {
    const mainRect = document.getElementById('main').getBoundingClientRect()
    const newW = Math.max(160, Math.min(600, mainRect.right - e.clientX))
    sidebar.style.width = newW + 'px'
  } else {
    const newWidth = Math.max(160, Math.min(600, e.clientX))
    sidebar.style.width = newWidth + 'px'
  }
})
window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false
    document.body.style.cursor = ''
    const currentLayout = LAYOUTS.find(l => document.body.classList.contains(`layout-${l}`)) || 'left'
    if (currentLayout === 'horizontal') {
      const h = parseInt(sidebar.style.height, 10)
      if (h > 0) persistSidebarSize(currentLayout, h)
    } else {
      const w = parseInt(sidebar.style.width, 10)
      if (w > 0) persistSidebarSize(currentLayout, w)
    }
    fitAndSync()
  }
})

// ── Sesiones (historial) ──

// Cache de session-links con TTL para no martillear al main en cada render.
const sessionLinksCache = new Map() // sessionId -> { at: ts, value: {links, isLinked} }
const SESSION_LINKS_TTL_MS = 10_000

async function getSessionLinksCached(sessionId) {
  if (!sessionId) return null
  const now = Date.now()
  const hit = sessionLinksCache.get(sessionId)
  if (hit && (now - hit.at) < SESSION_LINKS_TTL_MS) return hit.value
  try {
    if (typeof window.api.tasksSessionLinks !== 'function') return null
    const value = await window.api.tasksSessionLinks(sessionId)
    if (value && typeof value === 'object') {
      sessionLinksCache.set(sessionId, { at: now, value })
      return value
    }
  } catch {}
  return null
}

function describeSessionLinks(links) {
  const reasons = []
  if (!links) return reasons
  if (links.task) reasons.push(`Tarea programada: ${links.task.name || links.task.id || '?'}`)
  if (links.telegram) reasons.push(`Chat Telegram: ${links.telegram.chatId || '?'}`)
  if (links.whatsapp) reasons.push(`Chat WhatsApp: ${links.whatsapp.jid || '?'}`)
  return reasons
}

async function resumeSessionFromHistory(s, cwd) {
  if (sessionsModal && !sessionsModal.classList.contains('hidden')) {
    sessionsModal.classList.add('hidden')
  }
  showStatus('Continuando sesión…', 'busy')
  fitAndSync()
  term.reset()
  term.clear()
  try {
    await window.api.resumeSession(s.id, cwd, term.cols, term.rows)
    fitAndSync()
    await updateCwdLabel()
    await refreshSessionStrip(true)
    hideStatus()
    term.focus()
    // La sesión reanudada puede ser de un CLI distinto al que tenía la
    // ventana (este modal lista sesiones de claude Y codex). No se asume
    // cuál: se relee el activeCli real tras el resume. Envuelto aparte para
    // que un fallo aquí no se confunda con un fallo de resumeSession.
    try { await updateVoiceCliAvailability(await window.api.getActiveCli()) } catch {}
  } catch (err) {
    showStatus(errorMessage(err), 'error', 6000)
  }
}

function fmtRelative(ts) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `hace ${d}d`
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes/1024).toFixed(1)}KB`
  return `${(bytes/1024/1024).toFixed(1)}MB`
}

async function openSessions() {
  const cwd = await window.api.ptyCwd()
  sessionsCwd.textContent = cwd
  sessionsList.innerHTML = ''
  sessionsEmpty.classList.add('hidden')
  sessionsModal.classList.remove('hidden')

  const sessions = await window.api.listSessions(cwd)
  if (!sessions.length) {
    sessionsEmpty.classList.remove('hidden')
    return
  }

  const PAGE_SIZE = 50
  let rendered = 0
  let loadMoreBtn = null
  let visibleSessions = sessions

  const appendSessionRow = (s) => {
    const row = document.createElement('div')
    row.className = 'session-row'
    if (s.searchSnippet) row.title = s.searchSnippet
    row.innerHTML = `
      <div class="session-main">
        <div class="session-name-row">
          <button class="btn-rename" title="Editar título original">
            <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-edit-content" title="Editar contenido original (.jsonl)">✎</button>
          <span class="session-link-badge" style="display:none;margin-left:6px;font-size:11px;cursor:help;" aria-hidden="true">🔗</span>
        </div>
        <div class="session-preview"></div>
        <div class="session-meta">
          <span class="meta-time"></span>
          <span class="meta-msgs"></span>
          <span class="meta-size"></span>
          <span class="meta-id" title="${s.id}">${s.id.slice(0, 8)}…</span>
        </div>
      </div>
      <div class="session-actions">
        <button class="btn-resume" title="Continuar esta sesión">▶</button>
        <button class="btn-delete" title="Borrar sesión">🗑</button>
      </div>
    `

    // Async fetch de enlaces para mostrar el lock + tooltip. No bloquea el render.
    getSessionLinksCached(s.id).then((info) => {
      if (!info || !info.isLinked) return
      const badge = row.querySelector('.session-link-badge')
      if (!badge) return
      const reasons = describeSessionLinks(info.links || {})
      badge.title = reasons.length
        ? `Sesión enlazada:\n${reasons.map((r) => '· ' + r).join('\n')}`
        : 'Sesión enlazada'
      badge.style.display = ''
      badge.setAttribute('aria-hidden', 'false')
    }).catch(() => {})
    const previewEl = row.querySelector('.session-preview')
    previewEl.textContent = s.preview

    row.querySelector('.btn-rename').addEventListener('click', async (e) => {
      e.stopPropagation()
      const current = (previewEl.textContent || '').trim()
      if (!current || current === '(sin contenido)') {
        showStatus('Esta sesión no tiene un título editable detectado.', 'error', 5000)
        return
      }
      if (row.querySelector('.session-title-input')) return
      const input = document.createElement('input')
      input.className = 'session-title-input'
      input.value = current
      input.placeholder = 'Título de la sesión…'
      previewEl.replaceWith(input)
      input.focus()
      input.select()

      const rollback = () => {
        input.replaceWith(previewEl)
        previewEl.textContent = current
      }

      const commit = async () => {
        const val = input.value.trim()
        if (!val) { rollback(); return }
        if (val === current) { rollback(); return }
        const res = await window.api.updateSessionTitle(cwd, s.id, val)
        if (!res || !res.ok) {
          rollback()
          showStatus((res && res.error) || 'No se pudo editar el título original.', 'error', 6000)
          return
        }
        input.replaceWith(previewEl)
        previewEl.textContent = res.title || val
        s.preview = previewEl.textContent
        showStatus('Título original actualizado', 'ok', 2500)
        refreshSessionStrip(true)
      }

      input.addEventListener('blur', () => { commit().catch(() => rollback()) })
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur() }
        if (ev.key === 'Escape') { ev.preventDefault(); rollback() }
      })
    })

    row.querySelector('.btn-edit-content').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!s.path) {
        showStatus('No encontré el archivo original de esta sesión.', 'error', 6000)
        return
      }
      sessionsModal.classList.add('hidden')
      await window.api.openViewerWindow(s.path)
    })

    row.querySelector('.meta-time').textContent = fmtRelative(s.mtime)
    row.querySelector('.meta-msgs').textContent = `${s.msgCount} msgs`
    row.querySelector('.meta-size').textContent = fmtSize(s.size)

    row.querySelector('.btn-resume').addEventListener('click', async (e) => {
      e.stopPropagation()
      await resumeSessionFromHistory(s, cwd)
    })

    row.querySelector('.btn-delete').addEventListener('click', async (e) => {
      e.stopPropagation()
      // Si está enlazada a una tarea/telegram/whatsapp, pedir confirmación dura primero.
      const info = await getSessionLinksCached(s.id)
      if (info && info.isLinked) {
        const reasons = describeSessionLinks(info.links || {})
        const ok = confirm(
          `Esta sesión es la memoria continua de:\n\n  · ${reasons.join('\n  · ')}\n\n` +
          `Si la borras, la próxima ejecución arrancará desde cero.\n\n¿Continuar?`
        )
        if (!ok) return
      } else {
        if (!confirm(`¿Borrar esta sesión?\n\n${s.preview}`)) return
      }
      await window.api.deleteSession(cwd, s.id)
      sessionLinksCache.delete(s.id)
      row.remove()
      if (!sessionsList.querySelector('.session-row')) sessionsEmpty.classList.remove('hidden')
    })

    sessionsList.appendChild(row)
  }

  const renderPage = () => {
    if (loadMoreBtn) { loadMoreBtn.remove(); loadMoreBtn = null }
    const end = Math.min(rendered + PAGE_SIZE, visibleSessions.length)
    for (let i = rendered; i < end; i++) appendSessionRow(visibleSessions[i])
    rendered = end
    if (rendered < visibleSessions.length) {
      loadMoreBtn = document.createElement('button')
      loadMoreBtn.className = 'session-load-more'
      loadMoreBtn.type = 'button'
      loadMoreBtn.textContent = `Ver más (${visibleSessions.length - rendered} restantes)`
      loadMoreBtn.addEventListener('click', renderPage)
      sessionsList.appendChild(loadMoreBtn)
    }
  }
  renderPage()

  // Búsqueda en el contenido (main/session-content-search.js). Debounce de
  // 350ms y token contra respuestas fuera de orden; <3 letras = lista entera.
  if (sessionsSearchInput) {
    sessionsSearchInput.value = ''
    let searchTimer = null
    let searchToken = 0
    const applySearch = async (queryRaw) => {
      const query = String(queryRaw || '').trim()
      const token = ++searchToken
      let next = sessions
      if (query.length >= 3) {
        const hits = await window.api.searchSessionContent(cwd, query)
        if (token !== searchToken) return
        const byId = new Map((hits || []).map((h) => [h.id, h]))
        next = sessions.filter((s) => byId.has(s.id))
        for (const s of next) s.searchSnippet = byId.get(s.id)?.snippet || ''
      } else {
        for (const s of sessions) delete s.searchSnippet
      }
      visibleSessions = next
      sessionsList.innerHTML = ''
      rendered = 0
      sessionsEmpty.textContent = query.length >= 3 ? 'Sin coincidencias en el contenido.' : 'Sin sesiones para esta carpeta.'
      sessionsEmpty.classList.toggle('hidden', visibleSessions.length > 0)
      renderPage()
    }
    sessionsSearchInput.oninput = () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => { applySearch(sessionsSearchInput.value).catch(() => {}) }, 350)
    }
  }
}

btnSessions.addEventListener('click', openSessions)
btnCloseSessions.addEventListener('click', () => sessionsModal.classList.add('hidden'))
sessionsModal.querySelector('.modal-backdrop').addEventListener('click', () => sessionsModal.classList.add('hidden'))
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && proposalModal && !proposalModal.classList.contains('hidden')) {
    closeProposalModal()
    return
  }
  if (e.key === 'Escape' && !profilesModal.classList.contains('hidden')) {
    closeProfilesModal()
    return
  }
  if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
    settingsModal.classList.add('hidden')
    return
  }
  if (e.key === 'Escape' && !sessionsModal.classList.contains('hidden')) {
    sessionsModal.classList.add('hidden')
    return
  }
  if (e.key === 'Escape' && profilePopoverOpen) {
    closeProfilePopover()
    return
  }
  if (e.key === 'Escape' && healthPopoverOpen) {
    closeHealthPopover()
  }
})

// ── PTY bridge ──
// PERF telemetry (flag-gated). Activar: localStorage.setItem('poweragent_perf','1') y recargar.
const PERF = (() => { try { return localStorage.getItem('poweragent_perf') === '1' } catch { return false } })()
const perfKeyQueue = PERF ? [] : null // FIFO de { t, bytes }, máx 50
const perfGraphCounter = PERF ? { n: 0 } : null
if (PERF) {
  console.log('[PERF] renderer telemetry enabled (localStorage.poweragent_perf=1)')
  setInterval(() => {
    if (perfGraphCounter.n) {
      console.log(`[PERF renderer] graph:file-active received=${perfGraphCounter.n} (5s window)`)
      perfGraphCounter.n = 0
    }
  }, 5000)
}

// Captura del último prompt enviado al PTY (para "Programar este prompt"). Mantenemos
// un buffer heurístico: chars imprimibles, soporta backspace y bracketed paste, y al
// ver \r o \n cuajamos el buffer en lastUserPromptFromTerm.
let lastUserPromptFromTerm = ''
let _userInputBuffer = ''
let _inPaste = false
function _absorbUserInput(data) {
  if (typeof data !== 'string') return
  let i = 0
  while (i < data.length) {
    const c = data[i]
    // Bracketed paste start: ESC [ 2 0 0 ~
    if (c === '\x1b' && data.substr(i, 6) === '\x1b[200~') {
      _inPaste = true
      i += 6
      continue
    }
    if (c === '\x1b' && data.substr(i, 6) === '\x1b[201~') {
      _inPaste = false
      i += 6
      continue
    }
    if (_inPaste) {
      // Dentro del paste tratamos todo como texto literal (incluido \n).
      if (c === '\r' || c === '\n') _userInputBuffer += '\n'
      else _userInputBuffer += c
      i += 1
      continue
    }
    // ESC + secuencia (flechas, F-keys, etc.): saltar hasta letra final.
    if (c === '\x1b') {
      i += 1
      // skip CSI
      if (data[i] === '[') {
        i += 1
        while (i < data.length && !/[a-zA-Z~]/.test(data[i])) i += 1
        i += 1
      }
      continue
    }
    // Backspace o DEL
    if (c === '\x7f' || c === '\b') {
      if (_userInputBuffer.length) _userInputBuffer = _userInputBuffer.slice(0, -1)
      i += 1
      continue
    }
    // Enter
    if (c === '\r' || c === '\n') {
      const trimmed = _userInputBuffer.trim()
      if (trimmed.length >= 2) lastUserPromptFromTerm = trimmed
      _userInputBuffer = ''
      i += 1
      continue
    }
    // Ctrl chars: ignorar
    if (c.charCodeAt(0) < 0x20) { i += 1; continue }
    _userInputBuffer += c
    i += 1
  }
}

term.onData((data) => {
  if (PERF) {
    const bytes = (typeof data === 'string') ? new Blob([data]).size : (data?.length || 0)
    perfKeyQueue.push({ t: performance.now(), bytes })
    if (perfKeyQueue.length > 50) perfKeyQueue.shift()
  }
  try { _absorbUserInput(data) } catch {}
  window.api.writePty(data)
})
window.api.onPtyData((chunk) => {
  if (PERF && perfKeyQueue.length) {
    const item = perfKeyQueue.shift()
    const dt = performance.now() - item.t
    const chunkBytes = (typeof chunk === 'string') ? new Blob([chunk]).size : (chunk?.length || 0)
    console.log(`[PERF renderer] key→render=${dt.toFixed(1)}ms keyBytes=${item.bytes} chunkBytes=${chunkBytes}`)
  }
  term.write(chunk)
})
window.api.onInjectPath((p) => injectToPty(`@${p} `))

// Disparado desde el tasks-manager para abrir una sesión histórica en la ventana principal.
if (typeof window.api.onOpenSessionRequest === 'function') {
  window.api.onOpenSessionRequest(async (payload) => {
    if (!payload || !payload.sessionId) return
    try {
      const cwd = payload.cwd || await window.api.ptyCwd()
      await resumeSessionFromHistory({ id: payload.sessionId, preview: '' }, cwd)
    } catch (err) {
      console.error('[open-session]', err)
    }
  })
}
window.api.onGraphFileActive((p) => {
  if (PERF) perfGraphCounter.n++
  graphLastActivePath = p || graphLastActivePath
  if (graphInstance?.markActivePath) graphInstance.markActivePath(graphLastActivePath)
  if (graphInstance?.pulseNode) graphInstance.pulseNode(p)
  scheduleGraphRefresh()
})
window.api.onPtyExit(() => {
  term.write('\r\n\x1b[33m[cli terminó]\x1b[0m\r\n')
  refreshHealth(true)
  const termWrap = document.getElementById('terminal-wrap')
  if (termWrap) termWrap.classList.remove('has-pty')
  if (window.ProjectPicker) {
    window.ProjectPicker.show()
    window.ProjectPicker.showProject()
  }
})
if (typeof window.api.onPtyRestarting === 'function') {
  // El CLI se ha actualizado y se cierra pidiendo reinicio: main.js lo relanza,
  // así que no tocamos has-pty ni abrimos el picker.
  window.api.onPtyRestarting((payload) => {
    const name = payload?.cli === 'codex' ? 'Codex' : 'Claude'
    term.write(`\r\n\x1b[36m[${name} actualizado — reiniciando sesión…]\x1b[0m\r\n`)
    showStatus(`${name} actualizado, reiniciando sesión…`, 'info', 5000)
  })
}
window.api.onPtyError((message) => {
  const msg = (message || 'Error de terminal').toString()
  term.write(`\r\n\x1b[31m[error] ${msg}\x1b[0m\r\n`)
  showStatus(msg, 'error', 7000)
  refreshHealth(true)
})
if (typeof window.api.onPtyBusy === 'function') {
  window.api.onPtyBusy((message) => {
    showStatus(String(message || 'Relay activo en Telegram'), 'warn', 1800)
  })
}
window.api.onTelegramStatus((status) => {
  renderTelegramStatus(status)
  refreshHealth(false)
})

// ── CLI selector ──
cliSelector.addEventListener('change', async (e) => {
  const newCli = e.target.value
  const previousCli = await window.api.getActiveCli()
  if (newCli === previousCli) return

  const result = await window.api.setActiveCli(newCli)
  if (!result.ok) {
    alert(result.error)
    cliSelector.value = previousCli
    return
  }

  showStatus(`Cambiando a ${newCli.toUpperCase()}...`, 'busy')
  await new Promise(r => setTimeout(r, 300))
  try {
    await fullRestart()
    term.focus()
    localStorage.setItem(CLI_KEY, newCli)
    showStatus(`${newCli.toUpperCase()} cargado`, 'info', 1500)
    await updateVoiceCliAvailability(newCli)
  } catch (err) {
    showStatus(errorMessage(err), 'error', 7000)
    const rollback = await window.api.setActiveCli(previousCli)
    cliSelector.value = previousCli
    if (rollback.ok) {
      try {
        await fullRestart()
        term.focus()
      } catch {}
    }
    await updateVoiceCliAvailability(previousCli)
  }
})

;(async () => {
  await initTheme()
  fitAndSync()

  const saved = localStorage.getItem(ROOT_KEY)
  const home = await window.api.homeDir()
  await refreshProfilesState()
  renderProfileSelector()
  renderProfileReminder()
  const activeProfile = getActiveProfile()
  const initialRoot = activeProfile?.cwd || saved || home

  const activeCli = await window.api.getActiveCli()
  const appConfig = await window.api.getAppConfig()
  const savedCli = localStorage.getItem(CLI_KEY) || appConfig?.cli?.defaultCli || 'claude'
  let initialCli = activeCli
  if (savedCli !== activeCli) {
    const setResult = await window.api.setActiveCli(savedCli)
    if (setResult.ok) {
      initialCli = savedCli
    } else {
      showStatus(setResult.error, 'warn', 5000)
    }
  }
  cliSelector.value = initialCli
  // Se sincroniza con el `initialCli` ya asentado (tras el posible restore de
  // localStorage arriba), no con un `getActiveCli()` propio: pedirlo aparte
  // podría leer el valor de transición y dejar el botón mintiendo si el
  // restore cambia de CLI justo después.
  await updateVoiceCliAvailability(initialCli)
  await syncVoiceButtonFromState()
  renderProfileSelector()
  renderProfileReminder()
  renderTelegramStatus(await window.api.getTelegramStatus())
  await refreshSessionStrip(true)
  await refreshHealth(true)
  setRemoteSessionsUserVisible(remoteSessionsUserVisible, { persist: false })
  await refreshLanServerStatus(true)
  setProposalBadge(pendingProposal ? 1 : 0)
  if (typeof window.api.getPendingProposal === 'function') {
    try {
      const state = await window.api.getPendingProposal()
      if (state?.pending) {
        setPendingProposal(state.pending)
        openProposalModal()
      }
    } catch {}
  }

  // ── Flujo cwd-first: NO arrancamos PTY automáticamente ──
  // Mostramos el project-picker. El PTY se inicia solo cuando el usuario
  // confirma cwd + cli + sesión (nueva o reutilizada).
  const spawnFromPicker = async ({ cwd, cli, sessionId }) => {
    if (!cwd) throw new Error('Falta cwd')
    try {
      term.reset()
      term.clear()
      await window.api.startPty(term.cols, term.rows, cwd, { cli, sessionId })
      await refreshHealth(true)
      await setRoot(cwd)
      await updateCwdLabel()
      await refreshSessionStrip(true)
      applyView(currentView)
      if (cli) {
        cliSelector.value = cli
        localStorage.setItem(CLI_KEY, cli)
      }
      const termWrap = document.getElementById('terminal-wrap')
      if (termWrap) termWrap.classList.add('has-pty')
      term.focus()
    } catch (err) {
      showStatus(errorMessage(err), 'error', 7000)
      throw err
    }
  }

  if (window.ProjectPicker) {
    await window.ProjectPicker.start({ onSpawn: spawnFromPicker })
  } else {
    showStatus('Picker no disponible. Recarga la app.', 'error', 7000)
  }
  setInterval(() => { refreshSessionStrip(false) }, 6000)
  setInterval(() => { refreshHealth(false) }, HEALTH_POLL_MS)
  setInterval(() => { refreshLanServerStatus(false) }, 5000)

  window.api.onTreeChanged(() => {
    scheduleTreeRefresh()
    scheduleGraphRefresh()
  })

  document.getElementById('btn-tasks')?.addEventListener('click', () => {
    try { window.api.openTasksManager?.() } catch {}
  })

  // ── Botón "Programar este prompt" → modal ──
  document.getElementById('btn-schedule-prompt')?.addEventListener('click', () => {
    openSchedulePromptModal().catch((e) => console.error('[schedule-prompt] error:', e))
  })

  async function openSchedulePromptModal() {
    if (document.getElementById('schedule-prompt-backdrop')) return
    const activeCli = await (window.api.getActiveCli ? window.api.getActiveCli() : Promise.resolve('claude'))
    let cwd = ''
    try { cwd = await window.api.ptyCwd() } catch {}

    const backdrop = document.createElement('div')
    backdrop.id = 'schedule-prompt-backdrop'
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;'
    const isLight = document.body.classList.contains('light')
    const bg = isLight ? '#ffffff' : '#1f2127'
    const fg = isLight ? '#1a1a1d' : '#f0f0f3'
    const border = isLight ? '#d8d8de' : '#33363d'
    const inputBg = isLight ? '#f5f5f7' : '#15171b'
    const accent = '#3fb950'

    const modal = document.createElement('div')
    modal.style.cssText = `background:${bg};color:${fg};border:1px solid ${border};border-radius:10px;width:min(560px,100%);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.5);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;`
    modal.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid ${border};font-size:14px;font-weight:600;">Programar este prompt</div>
      <div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;">
        <label style="display:flex;flex-direction:column;gap:5px;">
          <span style="font-size:11px;color:${isLight ? '#666' : '#aaa'};text-transform:uppercase;letter-spacing:0.4px;">Nombre</span>
          <input id="sp-name" type="text" style="background:${inputBg};color:${fg};border:1px solid ${border};border-radius:6px;padding:8px 10px;font:13px inherit;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:5px;">
          <span style="font-size:11px;color:${isLight ? '#666' : '#aaa'};text-transform:uppercase;letter-spacing:0.4px;">Frecuencia</span>
          <select id="sp-freq" style="background:${inputBg};color:${fg};border:1px solid ${border};border-radius:6px;padding:8px 10px;font:13px inherit;">
            <option value="0 9 * * *">Cada día a las 09:00</option>
            <option value="0 9-21/4 * * *">Cada 4 horas (9 a 21)</option>
            <option value="0 * * * *">Cada hora en punto</option>
            <option value="0 9 * * 1">Cada lunes a las 09:00</option>
            <option value="__custom">Personalizado (cron)</option>
          </select>
          <input id="sp-cron" type="text" placeholder="m h dom mon dow" style="display:none;background:${inputBg};color:${fg};border:1px solid ${border};border-radius:6px;padding:8px 10px;font:13px monospace;margin-top:6px;" />
        </label>
        <label style="display:flex;flex-direction:column;gap:5px;">
          <span style="font-size:11px;color:${isLight ? '#666' : '#aaa'};text-transform:uppercase;letter-spacing:0.4px;">Prompt</span>
          <textarea id="sp-prompt" rows="7" style="background:${inputBg};color:${fg};border:1px solid ${border};border-radius:6px;padding:8px 10px;font:13px inherit;resize:vertical;min-height:120px;"></textarea>
        </label>
        <div id="sp-error" style="display:none;color:#f87171;font-size:12px;"></div>
      </div>
      <div style="padding:12px 18px;border-top:1px solid ${border};display:flex;justify-content:flex-end;gap:8px;">
        <button id="sp-cancel" style="background:transparent;color:${fg};border:1px solid ${border};border-radius:6px;padding:7px 14px;cursor:pointer;font:13px inherit;">Cancelar</button>
        <button id="sp-save" style="background:${accent};color:#fff;border:none;border-radius:6px;padding:7px 14px;cursor:pointer;font:13px inherit;font-weight:600;">Guardar y cerrar</button>
      </div>`
    backdrop.appendChild(modal)
    document.body.appendChild(backdrop)

    const $ = (id) => modal.querySelector('#' + id)
    $('sp-name').value = 'Tarea sin nombre'
    $('sp-prompt').value = lastUserPromptFromTerm || ''
    const freq = $('sp-freq')
    const cron = $('sp-cron')
    freq.addEventListener('change', () => {
      cron.style.display = freq.value === '__custom' ? '' : 'none'
      if (freq.value === '__custom' && !cron.value) cron.value = '0 * * * *'
    })

    function close() { try { backdrop.remove() } catch {} }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close() })
    $('sp-cancel').addEventListener('click', close)
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler) }
    })

    $('sp-save').addEventListener('click', async () => {
      const errBox = $('sp-error')
      errBox.style.display = 'none'
      const name = ($('sp-name').value || '').trim() || 'Tarea sin nombre'
      const cronExpr = freq.value === '__custom' ? ($('sp-cron').value || '').trim() : freq.value
      const prompt = ($('sp-prompt').value || '').trim()
      if (!prompt) { errBox.textContent = 'El prompt no puede estar vacío.'; errBox.style.display = ''; return }
      if (!cronExpr) { errBox.textContent = 'Frecuencia inválida.'; errBox.style.display = ''; return }
      $('sp-save').disabled = true
      try {
        const res = await window.api.tasksCreateFromPrompt?.({ name, cron: cronExpr, prompt, cli: activeCli, cwd })
        if (!res || res.ok === false) {
          errBox.textContent = (res && res.error) || 'No se pudo crear la tarea.'
          errBox.style.display = ''
          $('sp-save').disabled = false
          return
        }
        close()
        showTaskToast('Tarea creada', 'ok')
      } catch (e) {
        errBox.textContent = 'Error: ' + (e && e.message ? e.message : e)
        errBox.style.display = ''
        $('sp-save').disabled = false
      }
    })

    setTimeout(() => $('sp-name').focus(), 30)
  }

  // ── Toasts para runs programados ──
  function ensureToastContainer() {
    let el = document.getElementById('task-toast-container')
    if (el) return el
    el = document.createElement('div')
    el.id = 'task-toast-container'
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none'
    document.body.appendChild(el)
    return el
  }
  function showTaskToast(msg, kind) {
    const c = ensureToastContainer()
    const t = document.createElement('div')
    const bg = kind === 'ok' ? '#1d6f3b' : kind === 'err' ? '#7f1d1d' : '#1f2937'
    t.style.cssText = 'background:' + bg + ';color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.4);opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s;pointer-events:auto;max-width:340px;word-wrap:break-word'
    t.textContent = msg
    c.appendChild(t)
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)' })
    setTimeout(() => {
      t.style.opacity = '0'
      t.style.transform = 'translateY(8px)'
      setTimeout(() => { try { t.remove() } catch {} }, 300)
    }, 3700)
  }
  if (window.api.onTaskRunFinished) {
    window.api.onTaskRunFinished(({ status, durationMs } = {}) => {
      const dur = typeof durationMs === 'number' ? (durationMs / 1000).toFixed(1) : '?'
      const kind = status === 'ok' ? 'ok' : (status === 'cancelled' ? 'info' : 'err')
      const label = status === 'ok' ? 'OK' : (status === 'cancelled' ? 'Cancelada' : 'ERR')
      showTaskToast('Tarea ' + label + ' · ' + dur + 's', kind)
    })
  }

  term.focus()
})()

// === Bandeja de respuestas de tareas ===
;(function setupTasksInbox() {
  if (!btnTasksInbox || !window.api?.tasksInbox) return

  const api = window.api.tasksInbox
  let dropdown = null
  let outputModal = null
  let lastItems = []

  function fmtRelativeInbox(ts) {
    if (!ts) return ''
    const date = new Date(ts)
    if (isNaN(date.getTime())) return ''
    const now = Date.now()
    const diff = now - date.getTime()
    if (diff < 60_000) return 'ahora'
    if (diff < 3600_000) return 'hace ' + Math.floor(diff / 60_000) + ' min'
    const today = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const hhmm = pad(date.getHours()) + ':' + pad(date.getMinutes())
    if (date.toDateString() === today.toDateString()) return 'hoy ' + hhmm
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) return 'ayer ' + hhmm
    return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + ' ' + hhmm
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function updateBadge(count) {
    const n = Math.max(0, Number(count) || 0)
    if (!tasksInboxBadge) return
    tasksInboxBadge.textContent = String(n > 99 ? '99+' : n)
    tasksInboxBadge.classList.toggle('hidden', n <= 0)
  }

  async function refreshBadge() {
    try {
      const res = await api.get({ unreadOnly: true, limit: 1 })
      updateBadge(res?.unreadCount || 0)
    } catch {}
  }

  function ensureOutputModal() {
    if (outputModal) return outputModal
    outputModal = document.createElement('div')
    outputModal.id = 'tasks-inbox-output-modal'
    outputModal.className = 'hidden'
    outputModal.innerHTML = `
      <div class="tio-card">
        <div class="tio-header">
          <span class="tio-title">Salida de tarea</span>
          <button type="button" class="tio-close" aria-label="Cerrar">Cerrar</button>
        </div>
        <div class="tio-body"><pre class="tio-output"></pre></div>
      </div>
    `
    document.body.appendChild(outputModal)
    const close = () => outputModal.classList.add('hidden')
    outputModal.addEventListener('click', (e) => {
      if (e.target === outputModal) close()
    })
    outputModal.querySelector('.tio-close').addEventListener('click', close)
    return outputModal
  }

  function showOutputModal(item) {
    const m = ensureOutputModal()
    m.querySelector('.tio-title').textContent = 'Salida · ' + (item?.taskName || 'Tarea')
    m.querySelector('.tio-output').textContent = String(item?.output || item?.summary || '(sin salida)')
    m.classList.remove('hidden')
  }

  function ensureDropdown() {
    if (dropdown) return dropdown
    dropdown = document.createElement('div')
    dropdown.id = 'tasks-inbox-dropdown'
    dropdown.className = 'hidden'
    dropdown.innerHTML = `
      <div class="tasks-inbox-header">
        <span>Respuestas pendientes</span>
        <button type="button" class="tasks-inbox-clear" title="Marcar todo como leído">Marcar todo leído</button>
      </div>
      <div class="tasks-inbox-list"></div>
      <div class="tasks-inbox-footer"><a class="tasks-inbox-open-manager">Ver todas en Tareas programadas</a></div>
    `
    document.body.appendChild(dropdown)
    dropdown.addEventListener('click', (e) => e.stopPropagation())
    dropdown.querySelector('.tasks-inbox-clear').addEventListener('click', async () => {
      try {
        const res = await api.markAllRead()
        updateBadge(res?.unreadCount || 0)
        await loadAndRender()
      } catch (err) {
        console.error('[tasksInbox] markAllRead error:', err)
      }
    })
    dropdown.querySelector('.tasks-inbox-open-manager').addEventListener('click', () => {
      hideDropdown()
      try { document.getElementById('btn-tasks')?.click() } catch {}
    })
    return dropdown
  }

  function positionDropdown() {
    if (!dropdown || !btnTasksInbox) return
    const rect = btnTasksInbox.getBoundingClientRect()
    const dw = 360
    let left = rect.left
    if (left + dw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - dw - 8)
    dropdown.style.left = left + 'px'
    dropdown.style.top = (rect.bottom + 6) + 'px'
  }

  function renderItems(items) {
    const dd = ensureDropdown()
    const list = dd.querySelector('.tasks-inbox-list')
    if (!items || !items.length) {
      list.innerHTML = '<div class="tasks-inbox-empty">Sin respuestas pendientes.</div>'
      return
    }
    const html = items.map((it) => {
      const cls = 'tasks-inbox-item' + (it.read ? '' : ' unread')
      const time = escapeHtml(fmtRelativeInbox(it.finishedAt))
      const cli = escapeHtml((it.cli || '').toLowerCase())
      const name = escapeHtml(it.taskName || '(sin nombre)')
      const statusErr = it.status && it.status !== 'ok' ? ' ti-status-err' : ''
      const sum = escapeHtml(it.summary || '')
      return `<div class="tasks-inbox-item${it.read ? '' : ' unread'}" data-run-id="${escapeHtml(it.runId || '')}">
        <div class="ti-line1"><span class="ti-name${statusErr}">${name}</span>${cli ? `<span class="ti-cli">${cli}</span>` : ''}</div>
        <div class="ti-time">${time}</div>
        <div class="ti-summary">${sum}</div>
      </div>`
    }).join('')
    list.innerHTML = html
    list.querySelectorAll('.tasks-inbox-item').forEach((row) => {
      row.addEventListener('click', async () => {
        const runId = row.dataset.runId
        if (!runId) return
        const item = lastItems.find((x) => x.runId === runId)
        if (!item) return
        try { await api.markRead(runId) } catch {}
        try { await refreshBadge() } catch {}
        hideDropdown()
        if (item.sessionId) {
          try {
            const res = await api.openTaskSession({
              sessionId: item.sessionId,
              cwd: item.cwd,
              cli: item.cli,
              taskName: item.taskName
            })
            if (!res?.ok) {
              const msg = res?.error || 'No pude abrir la sesión'
              try { showStatus && showStatus(msg, 'error', 5000) } catch {}
              showOutputModal(item)
            }
          } catch (err) {
            try { showStatus && showStatus(err?.message || String(err), 'error', 5000) } catch {}
            showOutputModal(item)
          }
        } else {
          try { showStatus && showStatus('Esta tarea no guarda sesión continuable. Abriendo el output.', 'info', 4000) } catch {}
          showOutputModal(item)
        }
      })
    })
  }

  async function loadAndRender() {
    try {
      const res = await api.get({ limit: 50 })
      const items = Array.isArray(res?.items) ? res.items : []
      lastItems = items
      updateBadge(res?.unreadCount || 0)
      renderItems(items)
    } catch (err) {
      console.error('[tasksInbox] load error:', err)
      lastItems = []
      const dd = ensureDropdown()
      dd.querySelector('.tasks-inbox-list').innerHTML = '<div class="tasks-inbox-empty">Sin respuestas pendientes.</div>'
    }
  }

  function showDropdown() {
    ensureDropdown()
    dropdown.classList.remove('hidden')
    positionDropdown()
    loadAndRender()
  }

  function hideDropdown() {
    if (dropdown) dropdown.classList.add('hidden')
  }

  btnTasksInbox.addEventListener('click', (e) => {
    e.stopPropagation()
    if (dropdown && !dropdown.classList.contains('hidden')) {
      hideDropdown()
    } else {
      showDropdown()
    }
  })

  document.addEventListener('click', (e) => {
    if (!dropdown || dropdown.classList.contains('hidden')) return
    if (dropdown.contains(e.target) || btnTasksInbox.contains(e.target)) return
    hideDropdown()
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dropdown && !dropdown.classList.contains('hidden')) hideDropdown()
  })

  window.addEventListener('resize', () => {
    if (dropdown && !dropdown.classList.contains('hidden')) positionDropdown()
  })

  // Listener del broadcast del backend
  if (api.onUpdated) {
    api.onUpdated((payload) => {
      updateBadge(payload?.unreadCount || 0)
      if (dropdown && !dropdown.classList.contains('hidden')) loadAndRender()
    })
  }

  // Listener para abrir sesión desde main process
  if (api.onRequestOpenSession) {
    api.onRequestOpenSession(async ({ sessionId, cwd, cli } = {}) => {
      if (!sessionId || !cwd) return
      try {
        try { showStatus && showStatus('Continuando sesión…', 'busy') } catch {}
        try {
          if (cli && typeof window.api?.setActiveCli === 'function') {
            await window.api.setActiveCli(cli)
          }
        } catch {}
        try { term.reset() } catch {}
        try { term.clear() } catch {}
        try {
          await window.api.resumeSession(sessionId, cwd, term.cols, term.rows)
          try { hideStatus && hideStatus() } catch {}
          try { term.focus() } catch {}
        } finally {
          // En un `finally`, no tras el resume: si `setActiveCli` de arriba
          // tuvo éxito pero `resumeSession` lanza, el CLI YA cambió en main
          // aunque este flujo acabe en error — sin el `finally` el botón se
          // quedaría con el gate del CLI anterior. Se relee el activeCli
          // real en vez de fiarse del parámetro `cli`, porque el
          // `setActiveCli` de arriba pudo fallar en silencio (su try/catch
          // lo traga) o `cli` pudo venir vacío con el CLI ya cambiado por
          // otra vía.
          try { await updateVoiceCliAvailability(await window.api.getActiveCli()) } catch {}
        }
      } catch (err) {
        try { showStatus && showStatus(err?.message || String(err), 'error', 6000) } catch {}
      }
    })
  }

  // Carga inicial
  refreshBadge()
})()

// ── Modo voz ──
// Distinto del dictado (#btn-mic, arriba): el dictado transcribe y escribe en
// el prompt sin red; esto conversa con el helper Swift (main/voice-*.js).
// Lógica pura de estados/eventos en voice-ui-state.js (testeada); aquí solo
// se aplica al DOM.
const btnVoice = document.getElementById('btn-voice')
const btnVoiceMode = document.getElementById('btn-voice-mode')
const voiceHud = document.getElementById('voice-hud')
let voiceOn = false
let voiceHudTimer = null
// Destino de lo que dices. 'encargo' (la sesión de trabajo) es el defecto del
// router desde 2026-08-05; este botón es la ÚNICA forma de mandar un turno al
// sub-chat, porque ya no hay detección automática de intención.
let voiceMode = 'encargo'

function showVoiceHud(text, holdMs = 2600) {
  if (!voiceHud) return
  voiceHud.textContent = text
  voiceHud.classList.add('visible')
  clearTimeout(voiceHudTimer)
  if (holdMs > 0) voiceHudTimer = setTimeout(() => voiceHud.classList.remove('visible'), holdMs)
}

function setVoiceButtonState(state) {
  if (!btnVoice) return
  // `voice-broken` también se limpia aquí: cualquier evento `state` real
  // (idle/listening/thinking/speaking) es prueba de que el helper contestó,
  // así que ya no está roto aunque lo estuviera hace un momento.
  btnVoice.classList.remove('voice-listening', 'voice-thinking', 'voice-speaking', 'voice-broken')
  const cls = window.VoiceUIState?.classNameForVoiceState?.(state)
  if (cls) btnVoice.classList.add(cls)
}

function applyVoiceMode(mode) {
  const look = window.VoiceUIState?.voiceModeAppearance?.(mode) || { mode: 'encargo', icon: '⚡', title: '', ariaLabel: '' }
  voiceMode = look.mode
  if (!btnVoiceMode) return
  const icono = btnVoiceMode.querySelector('.voice-mode-icon')
  if (icono) icono.textContent = look.icon
  btnVoiceMode.title = look.title
  btnVoiceMode.setAttribute('aria-label', look.ariaLabel)
  btnVoiceMode.classList.toggle('voice-mode-charla', look.mode === 'charla')
}

function setVoiceOn(on) {
  voiceOn = !!on
  if (btnVoice) btnVoice.setAttribute('aria-pressed', voiceOn ? 'true' : 'false')
  // El toggle de destino solo tiene sentido con el modo voz encendido.
  if (btnVoiceMode) btnVoiceMode.hidden = !voiceOn
  if (!voiceOn) setVoiceButtonState('idle')
}

// La verdad del modo voz vive en main (voiceOwnerWcId + voiceSession). Hace
// falta releerla en tres casos: al arrancar (la ventana pudo recargar con el
// modo ya encendido de antes), tras un `error` (el evento no dice si fue
// fatal — solo lo fatal apaga, y asumir que sí o que no deja el botón
// mintiendo la mitad de las veces) y para enseñar `broken` (el helper se
// rindió tras 3 intentos: es un aspecto distinto de "apagado", no solo un
// booleano encendido/apagado — ver voiceStateAppearance).
async function syncVoiceButtonFromState() {
  if (!btnVoice || typeof window.api?.voice?.state !== 'function') return
  let s = null
  try { s = await window.api.voice.state() } catch { s = null }
  const appearance = window.VoiceUIState?.voiceStateAppearance?.(s) || { on: false, cssClass: null }
  setVoiceOn(appearance.on)
  btnVoice.classList.remove('voice-listening', 'voice-thinking', 'voice-speaking', 'voice-broken')
  if (appearance.cssClass) btnVoice.classList.add(appearance.cssClass)
  if (appearance.title) btnVoice.title = appearance.title
  if (appearance.ariaLabel) btnVoice.setAttribute('aria-label', appearance.ariaLabel)
}

// El modo voz solo sirve con claude (main/voice-router.js lo rechaza con
// codex). Si la sesión activa cambia mientras está encendido, se apaga aquí
// mismo: sin esto el botón se quedaría en "escuchando" hasta que el usuario
// hablara y el backend lo cortara en el turno siguiente — un estado zombi
// visible que el usuario vería antes de que nadie se lo dijera. Se llama
// desde CUALQUIER sitio del renderer que pueda cambiar el CLI o resumir una
// sesión: el selector de la topbar, el arranque, Ajustes → CLI por defecto
// (que main.js aplica en silencio, sin evento propio) y las dos vías de
// reanudar una sesión histórica.
async function updateVoiceCliAvailability(cli) {
  if (!btnVoice) return
  const info = window.VoiceUIState?.voiceCliAvailability?.(cli) || { available: cli === 'claude' }
  btnVoice.disabled = !info.available

  if (!info.available) {
    if (voiceOn) {
      try { await window.api.voice.disable() } catch {}
      setVoiceOn(false)
      const label = cli ? String(cli).toUpperCase() : 'este asistente'
      showVoiceHud(`Modo voz apagado — ${label} no lo soporta`)
    }
    // Fuera de claude no importa si el helper está `broken`: no se puede
    // pulsar, así que el motivo que se ve es "no disponible con este CLI".
    if (info.title) btnVoice.title = info.title
    if (info.ariaLabel) btnVoice.setAttribute('aria-label', info.ariaLabel)
    return
  }

  // Disponible: el título/borde NO se ponen a mano con el texto genérico de
  // `info` — se relee voice:state() y se deja decidir a voiceStateAppearance,
  // que sabe de `broken`. Poner aquí "Modo voz — hablar con el agente" a
  // ciegas pisaría el borde de aviso de un helper que sigue roto: el CLI
  // vuelve a ser compatible, pero cambiar de CLI no arregla el helper.
  await syncVoiceButtonFromState()
}

if (btnVoice) {
  btnVoice.addEventListener('click', async () => {
    if (voiceOn) {
      await window.api.voice.disable()
      setVoiceOn(false)
      showVoiceHud('Modo voz apagado')
      return
    }
    const res = await window.api.voice.enable()
    if (!res?.ok) { showStatus(`Modo voz: ${res?.reason || 'no se pudo activar'}`, 'error', 4000); return }
    // Por si venía de `broken` (el usuario reintenta a mano tras un fallo):
    // el próximo evento `state` ya lo limpiaría, pero no hay que esperarlo
    // para que el botón deje de anunciar un fallo que se está resolviendo.
    btnVoice.classList.remove('voice-broken')
    btnVoice.title = 'Modo voz — hablar con el agente'
    setVoiceOn(true)
    // Cada encendido arranca hablándole a la sesión de trabajo. `setForcedMode`
    // vive en el proceso main y sobrevive a un apagado, así que hay que fijarlo
    // explícitamente o el botón diría ⚡ mientras el backend sigue en charla.
    applyVoiceMode('encargo')
    try { await window.api.voice.setMode('encargo') } catch {}
    showVoiceHud('Modo voz activo — habla cuando quieras')
  })

  if (btnVoiceMode) {
    btnVoiceMode.addEventListener('click', async () => {
      const siguiente = window.VoiceUIState?.nextVoiceMode?.(voiceMode) || 'charla'
      let res = null
      try { res = await window.api.voice.setMode(siguiente) } catch { res = null }
      if (!res?.ok) {
        // El backend rechaza si el modo voz es de otra ventana: el botón NO se
        // mueve, o mentiría sobre dónde va a caer el turno siguiente.
        showStatus(`Modo voz: ${res?.reason || 'no se pudo cambiar el destino'}`, 'error', 4000)
        return
      }
      applyVoiceMode(siguiente)
      showVoiceHud(siguiente === 'charla' ? '💬 lo próximo va al sub-chat' : '⚡ lo próximo va a la sesión de trabajo')
    })
  }

  window.api.voice.onEvent(async (evt) => {
    const plan = window.VoiceUIState?.planForVoiceEvent?.(evt) || { action: 'none' }
    if (plan.action === 'set-state') {
      setVoiceButtonState(plan.state)
      if (plan.state === 'idle') setVoiceOn(false)
    } else if (plan.action === 'hud') {
      showVoiceHud(plan.text, plan.holdMs)
    } else if (plan.action === 'status') {
      showStatus(plan.message, plan.level, plan.level === 'error' ? 5000 : 4000)
      if (plan.recheckState) await syncVoiceButtonFromState()
    }
  })
}
