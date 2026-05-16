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

agentPty.onBlocks((payload) => {
  if (!payload || !payload.blocks) return
  state.lastBlocks = payload.blocks
  renderBlocksPanel(payload.blocks)
})

// ── Panel de bloques ──
function renderBlocksPanel(blocks) {
  const panel = $('#blocks-panel')
  const actions = $('#blocks-actions')
  const summary = $('#blocks-summary')
  if (!blocks) {
    panel.classList.remove('visible')
    return
  }
  const parts = []
  if (blocks.description) parts.push('DESCRIPCION')
  if (blocks.script) parts.push('SCRIPT')
  if (blocks.plist) parts.push('PLIST')
  summary.textContent = parts.length
    ? 'Detectado: ' + parts.join(' + ')
    : 'sin bloques'

  actions.innerHTML = ''
  if (!parts.length) {
    panel.classList.remove('visible')
    return
  }

  const btnApply = document.createElement('button')
  btnApply.className = 'btn btn-primary'
  btnApply.textContent = '✓ Aplicar al borrador'
  btnApply.addEventListener('click', onApplyBlocks)
  actions.appendChild(btnApply)

  const btnIgnore = document.createElement('button')
  btnIgnore.className = 'btn'
  btnIgnore.textContent = 'Descartar propuesta'
  btnIgnore.addEventListener('click', () => {
    state.lastBlocks = null
    renderBlocksPanel(null)
  })
  actions.appendChild(btnIgnore)

  panel.classList.add('visible')
}

async function onApplyBlocks() {
  if (!state.lastBlocks || !state.automationId) return
  const payload = {
    automationId: state.automationId,
    blocks: state.lastBlocks
  }
  try {
    const res = await agentPty.applyBlocks(payload)
    if (!res || res.ok === false) {
      toast((res && res.error) || 'No se pudo aplicar', 'error')
      return
    }
    toast('Aplicado al borrador ✓', 'ok')
    state.lastBlocks = null
    renderBlocksPanel(null)
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
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
    toast('Aplicado al borrador ✓', 'ok')
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

// ── Botón "Extraer propuesta" (headless) ──
$('#btn-extract').addEventListener('click', async () => {
  const btn = $('#btn-extract')
  if (btn.disabled) return
  btn.disabled = true
  const originalText = btn.textContent
  btn.textContent = 'Extrayendo…'
  toast('Pidiendo al CLI headless que extraiga la propuesta…', 'warn')
  try {
    const res = await agentPty.extract()
    if (!res || res.ok === false) {
      const err = (res && res.error) || 'No se pudo extraer'
      // NO abrir modal vacío automáticamente — confunde.
      // Pregunta a Luismi si quiere ir a "Pegar a mano" o cancelar.
      const wantManual = confirm(
        'No he podido extraer la propuesta automáticamente:\n\n' +
        err + '\n\n' +
        'Posibles causas:\n' +
        '• El agente todavía no ha emitido los bloques (sigue pensando o investigando).\n' +
        '• La conversación no contiene una propuesta completa con script + plist.\n\n' +
        '¿Quieres abrir el modal en modo "Pegar a mano" para pegar tú el contenido?'
      )
      if (wantManual) {
        openPreviewModal({
          description: '',
          script: '',
          plist: '',
          statusText: 'Modo manual. Pega el script y el plist que veas en la terminal del agente.',
          statusKind: 'bad'
        })
      }
      return
    }
    openPreviewModal({
      description: res.blocks.description || '',
      script: res.blocks.script || '',
      plist: res.blocks.plist || '',
      statusText: 'Propuesta extraída del CLI. Revisa antes de aplicar.',
      statusKind: 'ok'
    })
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
})

// ── Botón "Pegar a mano" ──
$('#btn-manual').addEventListener('click', () => {
  openPreviewModal({
    description: '',
    script: '',
    plist: '',
    statusText: 'Pega el script y el plist que te dio el agente.',
    statusKind: ''
  })
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
  } catch (e) {
    $('#subtitle').textContent = 'Error: ' + (e && e.message ? e.message : e)
    setPtyStatus('dead')
  }
}

bootstrap()
