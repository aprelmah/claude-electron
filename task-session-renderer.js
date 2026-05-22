'use strict'

/* global Terminal, FitAddon, WebLinksAddon, taskSessionApi */

const THEMES = {
  dark: {
    background: '#1a1a1d',
    foreground: '#e8e8ea',
    cursor: '#4a8cf7',
    selectionBackground: '#3a4a6a'
  },
  light: {
    background: '#f7f7fa',
    foreground: '#1a1a1d',
    cursor: '#2563eb',
    selectionBackground: '#cfe0ff'
  }
}

const state = {
  sessionId: null,
  cwd: null,
  cli: 'claude',
  taskName: '',
  theme: 'dark'
}

const $ = (sel) => document.querySelector(sel)

function applyTheme(name) {
  state.theme = (name === 'light') ? 'light' : 'dark'
  document.body.classList.toggle('theme-light', state.theme === 'light')
  if (term) term.options.theme = THEMES[state.theme]
}

function inheritThemeFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('theme')
    if (t === 'light' || t === 'dark') applyTheme(t)
    else applyTheme('dark')
  } catch { applyTheme('dark') }
}

function toast(msg, kind) {
  const t = $('#toast')
  t.textContent = msg
  t.className = 'toast show ' + (kind || '')
  setTimeout(() => { t.className = 'toast ' + (kind || '') }, 2400)
}

function shortSid(sid) {
  if (!sid || typeof sid !== 'string') return ''
  return sid.length > 10 ? sid.slice(0, 8) + '…' : sid
}

function refreshSidBadge() {
  const badge = $('#sid-badge')
  if (!badge) return
  if (!state.sessionId) {
    badge.textContent = ''
    badge.style.display = 'none'
    return
  }
  badge.style.display = 'inline-flex'
  badge.textContent = (state.cli || 'claude') + ' · ' + shortSid(state.sessionId)
  badge.title = (state.cli || 'claude') + ' · ' + state.sessionId
}

// ── xterm init ──
const termEl = $('#terminal')
const term = new Terminal({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
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

term.onData((data) => taskSessionApi.write(data))

function fitAndSync() {
  try {
    fitAddon.fit()
    taskSessionApi.resize(term.cols, term.rows)
  } catch {}
}

let resizeDebounceId = null
let resizeRafId = null
window.addEventListener('resize', () => {
  if (resizeDebounceId) clearTimeout(resizeDebounceId)
  resizeDebounceId = setTimeout(() => {
    if (resizeRafId) cancelAnimationFrame(resizeRafId)
    resizeRafId = requestAnimationFrame(() => {
      fitAndSync()
      resizeRafId = null
    })
    resizeDebounceId = null
  }, 220)
})

// ── PTY eventos ──
taskSessionApi.onData((chunk) => {
  if (typeof chunk !== 'string') return
  term.write(chunk)
})

taskSessionApi.onExit(() => {
  term.write('\r\n\x1b[33m[sesión terminada — cierra esta ventana]\x1b[0m\r\n')
})

taskSessionApi.onError(({ error } = {}) => {
  toast(error || 'Error en la sesión', 'error')
  term.write('\r\n\x1b[31m[error]\x1b[0m ' + (error || 'desconocido') + '\r\n')
})

taskSessionApi.onSidUpdated((payload = {}) => {
  if (payload.sessionId && payload.sessionId !== state.sessionId) {
    state.sessionId = payload.sessionId
    refreshSidBadge()
  }
})

// ── Botones header ──
$('#btn-min').addEventListener('click', () => taskSessionApi.minimizeSelf())
$('#btn-close').addEventListener('click', () => taskSessionApi.closeSelf())

// ── Bootstrap ──
async function bootstrap() {
  inheritThemeFromQuery()
  try {
    const info = await taskSessionApi.init()
    if (!info || !info.sessionId) {
      $('#subtitle').textContent = 'Sin sesión asociada'
      return
    }
    state.sessionId = info.sessionId
    state.cwd = info.cwd || ''
    state.cli = info.cli === 'codex' ? 'codex' : 'claude'
    state.taskName = info.taskName || ''

    const titleStr = state.taskName ? 'Sesión: ' + state.taskName : 'Sesión'
    $('#title').textContent = titleStr
    document.title = titleStr + ' — POWER-AGENT'
    $('#subtitle').textContent = state.cwd ? state.cwd : '(cwd desconocido)'
    refreshSidBadge()

    if (info.theme === 'light' || info.theme === 'dark') applyTheme(info.theme)

    fitAndSync()
    const startRes = await taskSessionApi.start(term.cols, term.rows)
    if (startRes && startRes.ok === false) {
      toast(startRes.error || 'No se pudo iniciar la sesión', 'error')
      term.write('\r\n\x1b[31m[error]\x1b[0m ' + (startRes.error || 'no se pudo iniciar') + '\r\n')
      return
    }
    setTimeout(fitAndSync, 200)
    term.focus()
  } catch (e) {
    $('#subtitle').textContent = 'Error: ' + (e && e.message ? e.message : e)
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  }
}

bootstrap()
