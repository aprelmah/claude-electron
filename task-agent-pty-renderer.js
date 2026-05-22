'use strict'

/* global Terminal, FitAddon, WebLinksAddon, taskAgentPty */

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
  mode: 'create',       // 'create' | 'iterate' | 'resume'
  taskId: null,
  ptyAlive: false,
  lastProposal: null,
  applying: false,
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

function setPtyStatus(status) {
  const badge = $('#pty-status')
  const text = $('#pty-status-text')
  badge.classList.remove('live', 'busy', 'dead')
  badge.classList.add(status)
  text.textContent = status === 'live' ? 'vivo' : status === 'busy' ? 'currando…' : 'parado'
  state.ptyAlive = status !== 'dead'
}

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

term.onData((data) => taskAgentPty.write(data))

function fitAndSync() {
  try {
    fitAddon.fit()
    taskAgentPty.resize(term.cols, term.rows)
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

taskAgentPty.onData((chunk) => {
  if (typeof chunk !== 'string') return
  term.write(chunk)
  setPtyStatus('busy')
  scheduleLiveSettle()
})

let settleId = null
function scheduleLiveSettle() {
  if (settleId) clearTimeout(settleId)
  settleId = setTimeout(() => {
    if (state.ptyAlive) setPtyStatus('live')
    settleId = null
  }, 800)
}

taskAgentPty.onExit(() => {
  setPtyStatus('dead')
  term.write('\r\n\x1b[31m[Agente terminado]\x1b[0m\r\n')
})

taskAgentPty.onError(({ error } = {}) => {
  toast(error || 'Error del agente', 'error')
  setPtyStatus('dead')
})

taskAgentPty.onStatus(({ status } = {}) => {
  if (status === 'live' || status === 'busy' || status === 'dead') setPtyStatus(status)
})

// Push: el main puede empujar proposal detectada (filesystem o stream).
taskAgentPty.onProposal((payload) => {
  if (!payload || !payload.proposal) return
  state.lastProposal = payload.proposal
  setSaveButton(true)
})

// Pull: cada 1.5s preguntamos al main si hay propuesta lista.
let proposalPollId = null
function startProposalPolling() {
  if (proposalPollId) clearInterval(proposalPollId)
  proposalPollId = setInterval(async () => {
    try {
      const res = await taskAgentPty.checkProposal()
      if (res && res.available && res.proposal) {
        state.lastProposal = res.proposal
        setSaveButton(true)
      } else if (!state.applying) {
        setSaveButton(false)
      }
    } catch {}
  }, 1500)
}

function setSaveButton(ready) {
  const btn = $('#btn-save-top')
  if (!btn) return
  if (ready) {
    if (btn.classList.contains('ready')) return
    btn.classList.add('ready')
    btn.disabled = false
    btn.textContent = state.mode === 'iterate' ? '✓ Guardar cambios y cerrar' : '✓ Guardar tarea y cerrar'
    btn.title = 'Pulsa para guardar la tarea propuesta por el agente.'
    toast('Propuesta lista · pulsa el botón verde de arriba', 'ok')
  } else {
    btn.classList.remove('ready')
    btn.disabled = true
    btn.textContent = '⌛ Esperando propuesta…'
    btn.title = 'Esperando a que el agente termine la propuesta'
  }
}

async function onSaveProposal() {
  if (!state.lastProposal) return
  if (state.applying) return
  state.applying = true
  const btn = $('#btn-save-top')
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…' }
  try {
    const res = await taskAgentPty.applyProposal({
      sessionId: state.sessionId,
      taskId: state.taskId,
      mode: state.mode,
      task: state.lastProposal.task
    })
    if (!res || res.ok === false) {
      toast((res && res.error) || 'No se pudo guardar', 'error')
      state.applying = false
      return
    }
    toast('Tarea guardada ✓', 'ok')
    setTimeout(() => taskAgentPty.closeSelf(), 600)
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
    state.applying = false
  }
}

$('#btn-save-top').addEventListener('click', () => {
  const btn = $('#btn-save-top')
  if (!btn || btn.disabled) return
  onSaveProposal()
})

$('#btn-min').addEventListener('click', () => taskAgentPty.minimizeSelf())
$('#btn-close').addEventListener('click', () => taskAgentPty.closeSelf())
$('#cli-select').addEventListener('change', async (ev) => {
  const cli = ev.target.value
  if (!cli) return
  const ok = confirm(`Cambiar a ${cli} reinicia el agente (pierde el contexto del chat actual). ¿Continuar?`)
  if (!ok) {
    try {
      const info = await taskAgentPty.init()
      ev.target.value = info && info.cli ? info.cli : 'claude'
    } catch {}
    return
  }
  try {
    setPtyStatus('busy')
    term.reset(); term.clear()
    const res = await taskAgentPty.setCli(cli)
    if (!res || res.ok === false) {
      toast((res && res.error) || 'No se pudo cambiar CLI', 'error')
      setPtyStatus('dead')
      return
    }
    fitAndSync()
    setPtyStatus('live')
    toast('Agente cambiado a ' + cli, 'ok')
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  }
})
$('#btn-restart').addEventListener('click', async () => {
  try {
    setPtyStatus('busy')
    term.reset(); term.clear()
    await taskAgentPty.restart(term.cols, term.rows)
    fitAndSync()
    toast('Agente reiniciado', 'ok')
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  }
})

async function bootstrap() {
  inheritThemeFromQuery()
  try {
    const info = await taskAgentPty.init()
    if (!info || !info.sessionId) {
      $('#subtitle').textContent = 'Sesión no inicializada'
      return
    }
    state.sessionId = info.sessionId
    state.mode = info.mode || 'create'
    state.taskId = info.taskId || null
    if (state.mode === 'iterate' && info.taskName) {
      $('#title').textContent = 'Agente — iterar tarea'
      $('#subtitle').textContent = info.taskName
      document.title = 'Agente — ' + info.taskName
    } else if (state.mode === 'resume') {
      $('#title').textContent = 'Sesión — ' + (info.taskName || 'tarea')
      $('#subtitle').textContent = 'reanudando sesión'
    } else {
      $('#title').textContent = 'Agente — Crear tarea programada'
      $('#subtitle').textContent = 'Describe lo que quieres automatizar'
    }
    if (info.cli) {
      const cliSel = $('#cli-select')
      if (cliSel) cliSel.value = info.cli
    }
    fitAndSync()
    await taskAgentPty.start(term.cols, term.rows)
    setPtyStatus('live')
    setTimeout(fitAndSync, 200)
    term.focus()
    if (state.mode !== 'resume') startProposalPolling()
  } catch (e) {
    $('#subtitle').textContent = 'Error: ' + (e && e.message ? e.message : e)
    setPtyStatus('dead')
  }
}

bootstrap()
