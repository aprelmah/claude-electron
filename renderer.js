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
const btnOpenGraphWindow = document.getElementById('btn-open-graph-window')
const btnSendTelegram = document.getElementById('btn-send-telegram')
const btnSendTelegramWrap = document.getElementById('btn-send-telegram-wrap')
const cliSelector = document.getElementById('cli-selector')
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
const graphCanvas = document.getElementById('graph-canvas')
const graphFilters = document.getElementById('graph-filters')
const btnViewTree = document.getElementById('btn-view-tree')
const btnViewGraph = document.getElementById('btn-view-graph')
const btnWorkHere = document.getElementById('btn-work-here')
const cwdValue = document.getElementById('cwd-value')
const btnSessions = document.getElementById('btn-sessions')
const sessionsModal = document.getElementById('sessions-modal')
const sessionsList = document.getElementById('sessions-list')
const sessionsCwd = document.getElementById('sessions-cwd')
const sessionsEmpty = document.getElementById('sessions-empty')
const btnCloseSessions = document.getElementById('btn-close-sessions')
const settingsModal = document.getElementById('settings-modal')
const btnCloseSettings = document.getElementById('btn-close-settings')
const btnSaveSettings = document.getElementById('btn-save-settings')
const btnRefreshTelegramStatus = document.getElementById('btn-refresh-telegram-status')
const cfgDefaultCli = document.getElementById('cfg-default-cli')
const cfgClaudeBin = document.getElementById('cfg-claude-bin')
const cfgCodexBin = document.getElementById('cfg-codex-bin')
const cfgWhisperBin = document.getElementById('cfg-whisper-bin')
const cfgTelegramEnabled = document.getElementById('cfg-telegram-enabled')
const cfgTelegramToken = document.getElementById('cfg-telegram-token')
const cfgTelegramUsers = document.getElementById('cfg-telegram-users')
const cfgTelegramClaudeModel = document.getElementById('cfg-telegram-claude-model')
const cfgTelegramClaudeEffort = document.getElementById('cfg-telegram-claude-effort')
const cfgTelegramCodexModel = document.getElementById('cfg-telegram-codex-model')
const cfgTelegramCodexEffort = document.getElementById('cfg-telegram-codex-effort')
const cfgTelegramStatus = document.getElementById('cfg-telegram-status')
const sessionStripCli = document.getElementById('session-strip-cli')
const sessionStripTitle = document.getElementById('session-strip-title')
const sessionStripId = document.getElementById('session-strip-id')

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

function fitAndSync() {
  try {
    fitAddon.fit()
    window.api.resizePty(term.cols, term.rows)
  } catch {}
}

let resizeDebounceId = null
function fitAndSyncDebounced() {
  if (resizeDebounceId) clearTimeout(resizeDebounceId)
  resizeDebounceId = setTimeout(() => {
    fitAndSync()
    resizeDebounceId = null
  }, 140)
}

window.addEventListener('resize', fitAndSyncDebounced)

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

function errorMessage(err) {
  return err?.message || String(err)
}

let sessionMetaRefreshInFlight = false
let sessionMetaLastKey = ''

function ellipsize(text, max = 110) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function renderSessionStrip(meta) {
  if (!sessionStripCli || !sessionStripTitle || !sessionStripId) return
  const cli = meta?.cli === 'codex' ? 'codex' : 'claude'
  const sid = meta?.sessionId ? String(meta.sessionId).trim() : ''
  const title = ellipsize(meta?.title || '(sin título)', 140)
  const displayCli = cli === 'codex' ? 'Codex' : 'Claude'

  sessionStripCli.textContent = displayCli
  sessionStripCli.classList.toggle('codex', cli === 'codex')
  sessionStripTitle.textContent = `Sesión: ${title}`
  sessionStripTitle.title = `${displayCli} · ${meta?.title || '(sin título)'}`

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
    const key = `${meta?.cli || ''}|${meta?.sessionId || ''}|${meta?.title || ''}`
    if (force || key !== sessionMetaLastKey) {
      sessionMetaLastKey = key
      renderSessionStrip(meta || null)
    }
  } catch {}
  sessionMetaRefreshInFlight = false
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

async function refreshSettings() {
  const config = await window.api.getAppConfig()
  cfgDefaultCli.value = config?.cli?.defaultCli || 'claude'
  cfgClaudeBin.value = config?.cli?.claudeBin || ''
  cfgCodexBin.value = config?.cli?.codexBin || ''
  cfgWhisperBin.value = config?.cli?.whisperBin || ''
  cfgTelegramEnabled.checked = Boolean(config?.telegram?.enabled)
  cfgTelegramToken.value = config?.telegram?.botToken || ''
  cfgTelegramUsers.value = Array.isArray(config?.telegram?.allowedUsers) ? config.telegram.allowedUsers.join(', ') : ''
  cfgTelegramClaudeModel.value = config?.telegram?.claudeModel || ''
  cfgTelegramClaudeEffort.value = config?.telegram?.claudeEffort || ''
  cfgTelegramCodexModel.value = config?.telegram?.codexModel || ''
  cfgTelegramCodexEffort.value = config?.telegram?.codexEffort || ''
  renderTelegramStatus(await window.api.getTelegramStatus())
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
  fitAndSync()
  term.reset()
  term.clear()
  await window.api.restartPty(cwd, term.cols, term.rows)
  await refreshSessionStrip(true)
  fitAndSync()
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

btnSettings.addEventListener('click', async () => {
  await refreshSettings()
  settingsModal.classList.remove('hidden')
})

btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'))
settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => settingsModal.classList.add('hidden'))

btnRefreshTelegramStatus.addEventListener('click', async () => {
  renderTelegramStatus(await window.api.getTelegramStatus())
})

btnSaveSettings.addEventListener('click', async () => {
  showStatus('Guardando configuracion…', 'busy')
  const payload = {
    cli: {
      defaultCli: cfgDefaultCli.value,
      claudeBin: cfgClaudeBin.value.trim(),
      codexBin: cfgCodexBin.value.trim(),
      whisperBin: cfgWhisperBin.value.trim()
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
      codexEffort: cfgTelegramCodexEffort.value
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
  try {
    await window.api.restartPty(await window.api.ptyCwd(), term.cols, term.rows)
    await refreshSessionStrip(true)
    fitAndSync()
    term.focus()
  } catch (err) {
    showStatus(errorMessage(err), 'error', 7000)
    await refreshSettings()
    return
  }

  await refreshSettings()
  if (result.warnings?.length) {
    showStatus(result.warnings.join(' | '), 'warn', 6500)
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
  const paths = files.map(f => `@${f.path}`).join(' ') + ' '
  injectToPty(paths)
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
  if (picked) await setRoot(picked)
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

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
    settingsModal.classList.add('hidden')
  }
})

// ── Sesiones (historial) ──

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

  for (const s of sessions) {
    const row = document.createElement('div')
    row.className = 'session-row'
    row.innerHTML = `
      <div class="session-main">
        <div class="session-name-row">
          <button class="btn-rename" title="Editar título original">
            <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-edit-content" title="Editar contenido original (.jsonl)">✎</button>
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
      sessionsModal.classList.add('hidden')
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
      } catch (err) {
        showStatus(errorMessage(err), 'error', 6000)
      }
    })

    row.querySelector('.btn-delete').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`¿Borrar esta sesión?\n\n${s.preview}`)) return
      await window.api.deleteSession(cwd, s.id)
      row.remove()
      if (!sessionsList.children.length) sessionsEmpty.classList.remove('hidden')
    })

    sessionsList.appendChild(row)
  }
}

btnSessions.addEventListener('click', openSessions)
btnCloseSessions.addEventListener('click', () => sessionsModal.classList.add('hidden'))
sessionsModal.querySelector('.modal-backdrop').addEventListener('click', () => sessionsModal.classList.add('hidden'))
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
    settingsModal.classList.add('hidden')
    return
  }
  if (e.key === 'Escape' && !sessionsModal.classList.contains('hidden')) {
    sessionsModal.classList.add('hidden')
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

term.onData((data) => {
  if (PERF) {
    const bytes = (typeof data === 'string') ? new Blob([data]).size : (data?.length || 0)
    perfKeyQueue.push({ t: performance.now(), bytes })
    if (perfKeyQueue.length > 50) perfKeyQueue.shift()
  }
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
window.api.onGraphFileActive((p) => {
  if (PERF) perfGraphCounter.n++
  graphLastActivePath = p || graphLastActivePath
  if (graphInstance?.markActivePath) graphInstance.markActivePath(graphLastActivePath)
  if (graphInstance?.pulseNode) graphInstance.pulseNode(p)
  scheduleGraphRefresh()
})
window.api.onPtyExit(() => term.write('\r\n\x1b[33m[cli terminó — pulsa ↻ para reiniciar]\x1b[0m\r\n'))
window.api.onPtyError((message) => {
  const msg = (message || 'Error de terminal').toString()
  term.write(`\r\n\x1b[31m[error] ${msg}\x1b[0m\r\n`)
  showStatus(msg, 'error', 7000)
})
if (typeof window.api.onPtyBusy === 'function') {
  window.api.onPtyBusy((message) => {
    showStatus(String(message || 'Relay activo en Telegram'), 'warn', 1800)
  })
}
window.api.onTelegramStatus((status) => {
  renderTelegramStatus(status)
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
  term.reset()
  term.clear()
  fitAndSync()
  try {
    await window.api.restartPty(await window.api.ptyCwd(), term.cols, term.rows)
    await refreshSessionStrip(true)
    fitAndSync()
    term.focus()
    localStorage.setItem(CLI_KEY, newCli)
    showStatus(`${newCli.toUpperCase()} cargado`, 'info', 1500)
  } catch (err) {
    showStatus(errorMessage(err), 'error', 7000)
    const rollback = await window.api.setActiveCli(previousCli)
    cliSelector.value = previousCli
    if (rollback.ok) {
      try {
        term.reset()
        term.clear()
        fitAndSync()
        await window.api.restartPty(await window.api.ptyCwd(), term.cols, term.rows)
        await refreshSessionStrip(true)
        fitAndSync()
        term.focus()
      } catch {}
    }
  }
})

;(async () => {
  await initTheme()
  fitAndSync()

  const saved = localStorage.getItem(ROOT_KEY)
  const home = await window.api.homeDir()
  const initialRoot = saved || home

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
  renderTelegramStatus(await window.api.getTelegramStatus())
  await refreshSessionStrip(true)

  try {
    await window.api.startPty(term.cols, term.rows, initialRoot)
  } catch (err) {
    showStatus(errorMessage(err), 'error')
    return
  }
  await setRoot(initialRoot)
  await updateCwdLabel()
  await refreshSessionStrip(true)
  applyView(currentView)
  setInterval(() => { refreshSessionStrip(false) }, 6000)

  window.api.onTreeChanged(() => {
    scheduleTreeRefresh()
    scheduleGraphRefresh()
  })

  document.getElementById('btn-tasks')?.addEventListener('click', () => {
    try { window.api.openTasksManager?.() } catch {}
  })

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
