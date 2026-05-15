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
async function fullRestart(cwd) {
  fitAndSync()
  term.reset()
  term.clear()
  await window.api.restartPty(cwd, term.cols, term.rows)
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
const CLI_KEY = `claude-electron-cli:${WID}`

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

async function setRoot(newRoot) {
  rootPath = newRoot
  localStorage.setItem(ROOT_KEY, newRoot)
  sidebarTitle.textContent = newRoot.split('/').pop() || newRoot
  sidebarTitle.title = newRoot
  treeEl.innerHTML = ''
  await renderTreeInto(treeEl, newRoot, 0)
  if (typeof updateCwdLabel === 'function') await updateCwdLabel()
  try { window.api.watchDir(newRoot) } catch {}
  try { lastTreeSignature = await computeTreeSignature() } catch {}
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
        openViewer(entry.path)
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


btnSidebar.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed')
  divider.classList.toggle('hidden', sidebar.classList.contains('collapsed'))
  btnSidebar.classList.toggle('active', !sidebar.classList.contains('collapsed'))
  setTimeout(fitAndSync, 50)
})

// Divider resize
let isResizing = false
divider.addEventListener('mousedown', (e) => {
  isResizing = true
  document.body.style.cursor = 'col-resize'
  e.preventDefault()
})
window.addEventListener('mousemove', (e) => {
  if (!isResizing) return
  const newWidth = Math.max(160, Math.min(480, e.clientX))
  sidebar.style.width = newWidth + 'px'
})
window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false
    document.body.style.cursor = ''
    fitAndSync()
  }
})

// ── Viewer de archivos ──
const viewerModal = document.getElementById('viewer-modal')
const viewerName = document.getElementById('viewer-name')
const viewerMeta = document.getElementById('viewer-meta')
const viewerBody = document.getElementById('viewer-body')
const btnViewerSave = document.getElementById('btn-viewer-save')
const btnViewerSend = document.getElementById('btn-viewer-send')
const btnViewerClose = document.getElementById('btn-viewer-close')

let viewerState = { path: null, originalText: '', dirty: false, kind: null }

function setDirty(dirty) {
  viewerState.dirty = dirty
  btnViewerSave.disabled = !dirty
  viewerName.textContent = (dirty ? '● ' : '') + (viewerState.path ? viewerState.path.split('/').pop() : '')
}

function closeViewer() {
  if (viewerState.dirty) {
    if (!confirm('Tienes cambios sin guardar. ¿Cerrar igual?')) return
  }
  viewerModal.classList.add('hidden')
  viewerBody.innerHTML = ''
  viewerState = { path: null, originalText: '', dirty: false, kind: null }
}

async function openViewer(p) {
  viewerState.path = p
  viewerName.textContent = p.split('/').pop()
  viewerMeta.textContent = p
  viewerMeta.title = p
  viewerBody.innerHTML = '<div class="viewer-loading">Cargando…</div>'
  btnViewerSave.disabled = true
  viewerModal.classList.remove('hidden')

  const res = await window.api.fileRead(p)
  if (!res.ok) {
    viewerBody.innerHTML = `<div class="viewer-error">⚠ ${res.error}</div>`
    return
  }

  viewerState.kind = res.kind

  if (res.kind === 'image') {
    const ext = p.split('.').pop().toLowerCase()
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    viewerBody.innerHTML = `<div class="viewer-image-wrap"><img src="data:${mime};base64,${res.base64}" alt=""/></div>`
  } else if (res.kind === 'binary') {
    viewerBody.innerHTML = `<div class="viewer-binary">Archivo binario (${(res.size/1024).toFixed(1)} KB). No editable.</div>`
  } else {
    viewerState.originalText = res.text
    const ta = document.createElement('textarea')
    ta.className = 'viewer-editor'
    ta.value = res.text
    ta.spellcheck = false
    ta.addEventListener('input', () => setDirty(ta.value !== viewerState.originalText))
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        const s = ta.selectionStart, end = ta.selectionEnd
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(end)
        ta.selectionStart = ta.selectionEnd = s + 2
        setDirty(ta.value !== viewerState.originalText)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        saveViewer()
      }
    })
    viewerBody.innerHTML = ''
    viewerBody.appendChild(ta)
    ta.focus()
  }
}

async function saveViewer() {
  if (!viewerState.path || viewerState.kind !== 'text') return
  const ta = viewerBody.querySelector('.viewer-editor')
  if (!ta) return
  const res = await window.api.fileWrite(viewerState.path, ta.value)
  if (!res.ok) {
    showStatus(`Error guardando: ${res.error}`, 'error', 4000)
    return
  }
  viewerState.originalText = ta.value
  setDirty(false)
  showStatus('Guardado', 'info', 1500)
}

btnViewerSave.addEventListener('click', saveViewer)
btnViewerSend.addEventListener('click', () => {
  if (!viewerState.path) return
  injectToPty(`@${viewerState.path} `)
  closeViewer()
})
btnViewerClose.addEventListener('click', closeViewer)
viewerModal.querySelector('.modal-backdrop').addEventListener('click', closeViewer)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
    settingsModal.classList.add('hidden')
    return
  }
  if (e.key === 'Escape' && !viewerModal.classList.contains('hidden')) {
    closeViewer()
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
    row.querySelector('.session-preview').textContent = s.preview
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
term.onData((data) => window.api.writePty(data))
window.api.onPtyData((chunk) => term.write(chunk))
window.api.onPtyExit(() => term.write('\r\n\x1b[33m[cli terminó — pulsa ↻ para reiniciar]\x1b[0m\r\n'))
window.api.onPtyError((message) => {
  const msg = (message || 'Error de terminal').toString()
  term.write(`\r\n\x1b[31m[error] ${msg}\x1b[0m\r\n`)
  showStatus(msg, 'error', 7000)
})
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

  try {
    await window.api.startPty(term.cols, term.rows, initialRoot)
  } catch (err) {
    showStatus(errorMessage(err), 'error')
    return
  }
  await setRoot(initialRoot)
  await updateCwdLabel()

  window.api.onTreeChanged(() => scheduleTreeRefresh())

  term.focus()
})()
