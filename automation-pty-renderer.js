'use strict'

/* global Terminal, FitAddon, WebLinksAddon, agentPty */

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
  automationId: null,
  automation: null,
  ptyAlive: false,
  lastBlocks: null,
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
  // status: 'live' | 'busy' | 'dead'
  const badge = $('#pty-status')
  const text = $('#pty-status-text')
  badge.classList.remove('live', 'busy', 'dead')
  badge.classList.add(status)
  text.textContent = status === 'live' ? 'vivo' : status === 'busy' ? 'currando…' : 'parado'
  state.ptyAlive = status !== 'dead'
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

term.onData((data) => agentPty.write(data))

function fitAndSync() {
  try {
    fitAddon.fit()
    agentPty.resize(term.cols, term.rows)
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

// ── Eventos PTY ──
agentPty.onData((chunk) => {
  if (typeof chunk !== 'string') return
  term.write(chunk)
  // Mientras llegan datos, marca "currando".
  setPtyStatus('busy')
  // Vuelta a "vivo" tras pequeño quiet period.
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

agentPty.onExit(() => {
  setPtyStatus('dead')
  term.write('\r\n\x1b[31m[Agente terminado]\x1b[0m\r\n')
})

agentPty.onError(({ error } = {}) => {
  toast(error || 'Error del agente', 'error')
  setPtyStatus('dead')
})

agentPty.onStatus(({ status } = {}) => {
  if (status === 'live' || status === 'busy' || status === 'dead') setPtyStatus(status)
})

// Listener de respaldo (push) — el método principal es polling pull-based más abajo.
agentPty.onBlocks((payload) => {
  if (!payload || !payload.blocks) return
  state.lastBlocks = payload.blocks
  setApplyButton(true)
})

// ── Polling pull-based: cada 1.5s preguntamos al main si hay propuesta en disco.
// Es el mecanismo principal: robusto al timing y a eventos perdidos.
let proposalPollId = null
function startProposalPolling() {
  if (proposalPollId) clearInterval(proposalPollId)
  proposalPollId = setInterval(async () => {
    try {
      const res = await agentPty.checkProposal()
      if (res && res.available && res.blocks) {
        state.lastBlocks = res.blocks
        setApplyButton(true)
      } else if (!state.applying) {
        // Si no hay propuesta y no estamos aplicando, apagar el botón.
        setApplyButton(false)
      }
    } catch {}
  }, 1500)
}

function stopProposalPolling() {
  if (proposalPollId) { clearInterval(proposalPollId); proposalPollId = null }
}

function setApplyButton(ready) {
  const btn = document.getElementById('btn-apply-top')
  if (!btn) return
  if (ready) {
    if (btn.classList.contains('ready')) return  // ya estaba
    btn.classList.add('ready')
    btn.disabled = false
    btn.textContent = '✓ Aplicar al borrador'
    btn.title = 'El agente tiene la propuesta lista. Pulsa para aplicarla a la automatización.'
    toast('Propuesta lista · pulsa el botón verde de arriba', 'ok')
  } else {
    btn.classList.remove('ready')
    btn.disabled = true
    btn.textContent = '⌛ Esperando propuesta…'
    btn.title = 'Esperando a que el agente termine la propuesta'
  }
}

// ── Panel de bloques (legacy, sustituido por el botón del header) ──
// Mantenido como no-op para no romper llamadas residuales.
function renderBlocksPanel(_blocks) { /* noop */ }

async function onApplyBlocks() {
  if (!state.lastBlocks || !state.automationId) return
  if (state.applying) return
  state.applying = true
  const btn = document.getElementById('btn-apply-top')
  if (btn) { btn.disabled = true; btn.textContent = 'Aplicando…' }
  const payload = { automationId: state.automationId, blocks: state.lastBlocks }
  try {
    const res = await agentPty.applyBlocks(payload)
    if (!res || res.ok === false) {
      toast((res && res.error) || 'No se pudo aplicar', 'error')
      return
    }
    if (res.reinstallError) {
      toast('Aplicado al borrador, pero la reinstalación falló: ' + res.reinstallError, 'error')
    } else if (res.reinstalled) {
      toast('Aplicado y reinstalado en launchd ✓', 'ok')
    } else {
      toast('Aplicado al borrador ✓', 'ok')
    }
    state.lastBlocks = null
    setApplyButton(false)
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  } finally {
    state.applying = false
  }
}

// ── Modal preview ──
function openPreviewModal({ description, script, plist, statusText, statusKind }) {
  $('#prev-desc').value = description || ''
  $('#prev-script').value = script || ''
  $('#prev-plist').value = plist || ''
  const st = $('#preview-status')
  st.textContent = statusText || ''
  st.className = 'preview-status' + (statusKind ? ' ' + statusKind : '')
  $('#preview-modal').classList.add('visible')
  setTimeout(() => $('#prev-desc').focus(), 50)
}

function closePreviewModal() {
  $('#preview-modal').classList.remove('visible')
}

$('#prev-cancel').addEventListener('click', closePreviewModal)
$('#preview-modal').addEventListener('click', (ev) => {
  if (ev.target.id === 'preview-modal') closePreviewModal()
})
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && $('#preview-modal').classList.contains('visible')) closePreviewModal()
})

$('#prev-apply').addEventListener('click', async () => {
  if (!state.automationId) {
    toast('Sin automation asociada', 'error')
    return
  }
  const blocks = {
    description: $('#prev-desc').value.trim(),
    script: $('#prev-script').value,
    plist: $('#prev-plist').value
  }
  if (!blocks.script.includes('#!')) {
    toast('El script no parece bash (falta shebang #!)', 'error')
    return
  }
  if (!/<plist[\s>]/i.test(blocks.plist) || !/<\/plist>/i.test(blocks.plist)) {
    toast('El plist parece incompleto (falta <plist> o </plist>)', 'error')
    return
  }
  const btn = $('#prev-apply')
  btn.disabled = true
  try {
    const res = await agentPty.applyBlocks({ automationId: state.automationId, blocks })
    if (!res || res.ok === false) {
      toast((res && res.error) || 'No se pudo aplicar', 'error')
      return
    }
    if (res.reinstallError) {
      toast('Aplicado al borrador, pero la reinstalación falló: ' + res.reinstallError, 'error')
    } else if (res.reinstalled) {
      toast('Aplicado y reinstalado en launchd ✓', 'ok')
    } else {
      toast('Aplicado al borrador ✓', 'ok')
    }
    closePreviewModal()
    // Limpia panel de detección automática si lo había.
    state.lastBlocks = null
    renderBlocksPanel(null)
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  } finally {
    btn.disabled = false
  }
})

// ── Botón principal: Aplicar al borrador ──
$('#btn-apply-top').addEventListener('click', () => {
  const btn = document.getElementById('btn-apply-top')
  if (!btn || btn.disabled) return
  onApplyBlocks()
})

// ── Botones header ──
$('#btn-min').addEventListener('click', () => agentPty.minimizeSelf())
$('#btn-close').addEventListener('click', () => agentPty.closeSelf())
$('#cli-select').addEventListener('change', async (ev) => {
  const cli = ev.target.value
  if (!cli) return
  const ok = confirm(`Cambiar a ${cli} reinicia el agente (pierde el contexto del chat actual). ¿Continuar?`)
  if (!ok) {
    // Revertir selector visualmente.
    try {
      const info = await agentPty.init()
      ev.target.value = info && info.cli ? info.cli : 'claude'
    } catch {}
    return
  }
  try {
    setPtyStatus('busy')
    term.reset(); term.clear()
    const res = await agentPty.setCli(cli)
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
    term.reset()
    term.clear()
    await agentPty.restart(term.cols, term.rows)
    fitAndSync()
    toast('Agente reiniciado', 'ok')
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  }
})

// ── Bootstrap ──
async function bootstrap() {
  inheritThemeFromQuery()
  try {
    const info = await agentPty.init()
    if (!info || !info.automationId) {
      $('#subtitle').textContent = 'Sin automation asociada'
      return
    }
    state.automationId = info.automationId
    state.automation = info.automation || null
    const a = state.automation
    if (a) {
      $('#title').textContent = 'Agente — ' + (a.name || a.slug || 'sin nombre')
      $('#subtitle').textContent = (a.status || '—') + ' · ' + (a.slug || '—')
      document.title = 'Agente — ' + (a.name || a.slug || 'POWER-AGENT')
    }
    if (info.cli) {
      const cliSel = $('#cli-select')
      if (cliSel) cliSel.value = info.cli
    }
    fitAndSync()
    await agentPty.start(term.cols, term.rows)
    setPtyStatus('live')
    setTimeout(fitAndSync, 200)
    term.focus()
    // Arrancar polling para encender el botón cuando haya propuesta en disco.
    startProposalPolling()
  } catch (e) {
    $('#subtitle').textContent = 'Error: ' + (e && e.message ? e.message : e)
    setPtyStatus('dead')
  }
}

bootstrap()
