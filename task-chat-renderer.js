'use strict'

/* global taskChatAPI */

const $ = (sel) => document.querySelector(sel)

const state = {
  threadId: null,
  messages: [],
  streamingMessageId: null,
  streamingText: '',
  busy: false,
  theme: 'dark',
  provider: 'claude',
  modelPref: '',
  effortPref: ''
}

const MODEL_OPTIONS = {
  claude: [
    { value: '', label: 'Default' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' }
  ],
  codex: [
    { value: '', label: 'Default' },
    { value: 'gpt-5.4', label: 'gpt-5.4' },
    { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { value: 'o3-mini', label: 'o3-mini' },
    { value: 'o3', label: 'o3' }
  ]
}
const EFFORT_OPTIONS = {
  claude: [
    { value: '', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Xhigh' },
    { value: 'max', label: 'Max' }
  ],
  codex: [
    { value: '', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' }
  ]
}

function repopulateSelect(selectEl, options, preferred) {
  selectEl.innerHTML = ''
  let matched = false
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt.value
    o.textContent = opt.label
    if (opt.value === preferred) {
      o.selected = true
      matched = true
    }
    selectEl.appendChild(o)
  }
  if (!matched) selectEl.value = ''
  return selectEl.value
}

function refreshPrefSelects() {
  const modelSel = $('#model-select')
  const effortSel = $('#effort-select')
  const provSel = $('#provider-select')
  if (provSel) provSel.value = state.provider
  const newModel = repopulateSelect(modelSel, MODEL_OPTIONS[state.provider] || [], state.modelPref)
  const newEffort = repopulateSelect(effortSel, EFFORT_OPTIONS[state.provider] || [], state.effortPref)
  state.modelPref = newModel
  state.effortPref = newEffort
  refreshProviderLock()
}

function threadHasUserOrAssistantMessage() {
  if (!Array.isArray(state.messages)) return false
  return state.messages.some((m) => m && (m.role === 'user' || m.role === 'assistant'))
}

function refreshProviderLock() {
  const provSel = $('#provider-select')
  const switchBtn = $('#btn-switch-provider')
  const locked = threadHasUserOrAssistantMessage()
  if (provSel) {
    provSel.disabled = locked
    provSel.title = locked
      ? 'Proveedor fijado para este thread. Usa el botón para cambiar.'
      : 'Proveedor del agente'
  }
  if (switchBtn) {
    switchBtn.style.display = locked ? 'inline-flex' : 'none'
  }
}

function fmtTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v
    else if (k === 'style') node.setAttribute('style', v)
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v != null && v !== false) node.setAttribute(k, v)
  }
  for (const c of children) {
    if (c == null || c === false) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

function toast(msg, kind) {
  const t = $('#toast')
  t.textContent = msg
  t.className = 'toast show ' + (kind || '')
  setTimeout(() => { t.className = 'toast ' + (kind || '') }, 2400)
}

function applyTheme() {
  const params = new URLSearchParams(window.location.search)
  let theme = params.get('theme')
  if (theme !== 'light' && theme !== 'dark') {
    try { theme = localStorage.getItem('claude-electron-theme') || 'dark' } catch { theme = 'dark' }
  }
  if (theme !== 'light' && theme !== 'dark') theme = 'dark'
  state.theme = theme
  document.body.classList.toggle('theme-light', theme === 'light')
}

function clearEmpty() {
  const empty = $('#empty')
  if (empty) empty.remove()
}

function scrollBottom() {
  const c = $('#messages')
  requestAnimationFrame(() => {
    c.scrollTop = c.scrollHeight
  })
}

function describeSinks(s) {
  if (!s) return '—'
  const on = []
  if (s.logApp) on.push('logApp')
  if (s.notifyMacOS) on.push('macOS')
  if (s.telegram) on.push('telegram')
  return on.length ? on.join(', ') : 'ninguno'
}

function renderProposed(m) {
  const ok = !!m.proposedTask
  const box = el('div', { class: 'proposed' })

  const title = el('div', { class: 'title' + (ok ? '' : ' invalid') })
  title.appendChild(el('span', {}, 'Tarea propuesta'))
  title.appendChild(el('span', { class: 'badge' }, ok ? 'LISTA' : 'JSON INVÁLIDO'))
  box.appendChild(title)

  if (!ok && m.proposedTaskError) {
    box.appendChild(el('div', { class: 'err' }, 'Error: ' + m.proposedTaskError))
  }

  if (ok) {
    const t = m.proposedTask
    const f = el('div', { class: 'fields' })
    const addRow = (k, v) => {
      f.appendChild(el('div', { class: 'k' }, k))
      f.appendChild(el('div', { class: 'v' }, String(v == null ? '—' : v)))
    }
    addRow('name', t.name)
    addRow('cron', t.cron)
    addRow('cli', t.cli)
    addRow('cwd', t.cwd || '$HOME')
    addRow('model', t.model || '(default)')
    addRow('effort', t.effort || '(default)')
    addRow('resume', t.resume ? 'sí' : 'no')
    addRow('enabled', t.enabled ? 'sí' : 'no')
    addRow('sinks', describeSinks(t.sinks))
    box.appendChild(f)

    box.appendChild(el('div', { class: 'k', style: 'font-size:11px;color:var(--fg-muted);margin-top:4px;' }, 'prompt'))
    const pre = el('div', { class: 'prompt-pre' })
    pre.textContent = t.prompt
    box.appendChild(pre)
  } else if (m.proposedTaskRaw) {
    const pre = el('div', { class: 'prompt-pre' })
    pre.textContent = m.proposedTaskRaw
    box.appendChild(pre)
  }

  const actions = el('div', { class: 'actions' })
  const btnApply = el('button', { class: 'btn btn-primary' }, 'Aplicar (crear tarea)')
  if (!ok) btnApply.setAttribute('disabled', 'disabled')
  btnApply.addEventListener('click', () => onApply(m))
  actions.appendChild(btnApply)
  box.appendChild(actions)

  return box
}

function renderMessage(m) {
  if (m.role === 'system' && m.kind === 'provider-error') {
    return renderProviderErrorMessage(m)
  }
  const row = el('div', { class: 'row ' + (m.role === 'user' ? 'user' : 'agent'), 'data-id': m.id })
  const bubble = el('div', { class: 'bubble' })

  const textSpan = el('div', { class: 'text' })
  textSpan.textContent = m.content || ''
  bubble.appendChild(textSpan)

  if (m.proposedTask || m.proposedTaskRaw) {
    bubble.appendChild(renderProposed(m))
  }

  bubble.appendChild(el('div', { class: 'ts' }, fmtTime(m.timestamp)))
  row.appendChild(bubble)
  return row
}

function renderProviderErrorMessage(m) {
  const provLabel = (m.provider === 'codex') ? 'Codex' : 'Claude'
  const altProvider = m.provider === 'claude' ? 'codex' : 'claude'
  const altLabel = altProvider === 'codex' ? 'Codex' : 'Claude'
  const row = el('div', { class: 'row system', 'data-id': m.id })
  const bubble = el('div', { class: 'bubble' })
  bubble.appendChild(el('div', { class: 'err-title' }, `Fallo de ${provLabel}`))
  bubble.appendChild(el('div', { class: 'text' }, m.error || m.content || 'Error desconocido'))

  const actions = el('div', { class: 'err-actions' })

  const btnRetry = el('button', { class: 'btn' }, 'Reintentar con ' + provLabel)
  btnRetry.addEventListener('click', () => onRetryLast())
  actions.appendChild(btnRetry)

  const btnSwitch = el('button', { class: 'btn' }, 'Continuar con ' + altLabel)
  btnSwitch.addEventListener('click', () => doSwitchProvider(altProvider, true))
  actions.appendChild(btnSwitch)

  const btnClear = el('button', { class: 'btn' }, 'Empezar de cero')
  btnClear.addEventListener('click', () => onClearThread())
  actions.appendChild(btnClear)

  bubble.appendChild(actions)
  bubble.appendChild(el('div', { class: 'ts' }, fmtTime(m.timestamp)))
  row.appendChild(bubble)
  return row
}

function appendMessage(m) {
  clearEmpty()
  state.messages = Array.isArray(state.messages) ? state.messages : []
  const exists = state.messages.find((x) => x && x.id === m.id)
  if (!exists) state.messages.push(m)
  const node = renderMessage(m)
  $('#messages').appendChild(node)
  scrollBottom()
  refreshProviderLock()
}

function startStreamingPlaceholder(messageId) {
  clearEmpty()
  state.streamingMessageId = messageId
  state.streamingText = ''
  const row = el('div', { class: 'row agent', 'data-id': messageId, 'data-streaming': '1' })
  const bubble = el('div', { class: 'bubble' })
  const text = el('div', { class: 'text' })
  bubble.appendChild(text)
  const typing = el('span', { class: 'typing' })
  bubble.appendChild(typing)
  bubble.appendChild(el('div', { class: 'ts' }, fmtTime(new Date().toISOString())))
  row.appendChild(bubble)
  $('#messages').appendChild(row)
  scrollBottom()
}

function appendStreamingToken(messageId, token) {
  if (state.streamingMessageId !== messageId) return
  state.streamingText += token
  const row = document.querySelector(`.row[data-id="${messageId}"]`)
  if (!row) return
  const text = row.querySelector('.text')
  if (text) {
    // Oculta el bloque <TASK>...</TASK> mientras llega para no asustar con JSON crudo.
    text.textContent = state.streamingText
      .replace(/<TASK>[\s\S]*?<\/TASK>/gi, '[propuesta de tarea…]')
      .replace(/<TASK>[\s\S]*$/i, '[generando propuesta…]')
  }
  scrollBottom()
}

function finalizeStreamingMessage(m) {
  state.messages = Array.isArray(state.messages) ? state.messages : []
  if (!state.messages.find((x) => x && x.id === m.id)) state.messages.push(m)
  const row = document.querySelector(`.row[data-id="${m.id}"]`)
  if (!row) {
    const node = renderMessage(m)
    $('#messages').appendChild(node)
  } else {
    const replacement = renderMessage(m)
    row.replaceWith(replacement)
  }
  state.streamingMessageId = null
  state.streamingText = ''
  scrollBottom()
  refreshProviderLock()
}

async function onApply(message) {
  if (!message || !message.proposedTask) {
    toast('Propuesta inválida', 'error')
    return
  }
  const btns = document.querySelectorAll(`.row[data-id="${message.id}"] .btn`)
  btns.forEach((b) => b.setAttribute('disabled', 'disabled'))
  try {
    const res = await taskChatAPI.applyChanges(state.threadId, {
      taskOverride: message.proposedTask
    })
    if (!res || res.ok === false) {
      const err = (res && res.error) || 'Error creando tarea'
      toast(err, 'error')
      btns.forEach((b) => b.removeAttribute('disabled'))
      return
    }
    toast('Tarea creada', 'ok')
    // La ventana la cierra el handler tras un pequeño delay; aquí limpiamos por si acaso.
    setTimeout(() => { try { taskChatAPI.close() } catch {} }, 600)
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
    btns.forEach((b) => b.removeAttribute('disabled'))
  }
}

function setBusy(on) {
  state.busy = !!on
  $('#btn-send').disabled = !!on
  const inp = $('#input')
  if (on) inp.setAttribute('readonly', 'readonly')
  else inp.removeAttribute('readonly')
}

async function send(rawContent) {
  if (state.busy) return
  let content
  if (typeof rawContent === 'string') {
    content = rawContent.trim()
  } else {
    const inp = $('#input')
    content = (inp.value || '').trim()
    if (content) {
      $('#input').value = ''
      autoresizeInput()
    }
  }
  if (!content) return
  setBusy(true)
  try {
    const res = await taskChatAPI.send(state.threadId, content, {
      provider: state.provider,
      model: state.modelPref || '',
      effort: state.effortPref || ''
    })
    if (res && res.ok === false && res.providerError) {
      toast('Error de ' + (res.provider || state.provider) + ': ' + (res.error || 'desconocido'), 'error')
      setBusy(false)
    }
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
    setBusy(false)
  }
}

async function onRetryLast() {
  if (state.busy) return
  setBusy(true)
  try {
    const res = await taskChatAPI.retryLast(state.threadId, {
      model: state.modelPref || '',
      effort: state.effortPref || ''
    })
    if (res && res.ok === false) {
      toast('No se pudo reintentar: ' + (res.error || 'desconocido'), 'error')
      setBusy(false)
    }
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
    setBusy(false)
  }
}

async function onClearThread() {
  try {
    await taskChatAPI.clearThread(state.threadId, { provider: state.provider })
    state.messages = []
    await loadHistory()
    toast('Thread reiniciado', 'ok')
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  }
}

function openSwitchModal() {
  const ov = $('#switch-modal')
  if (ov) ov.classList.add('show')
}

function closeSwitchModal() {
  const ov = $('#switch-modal')
  if (ov) ov.classList.remove('show')
}

async function doSwitchProvider(toProvider, withSummary) {
  closeSwitchModal()
  if (!toProvider || (toProvider !== 'claude' && toProvider !== 'codex')) return
  try {
    const res = await taskChatAPI.switchProvider(state.threadId, { toProvider, withSummary: !!withSummary })
    if (!res || res.ok === false) {
      toast('No se pudo cambiar: ' + ((res && res.error) || 'desconocido'), 'error')
      return
    }
    state.provider = toProvider
    if (res.preferences) {
      if (typeof res.preferences.model === 'string') state.modelPref = res.preferences.model
      if (typeof res.preferences.effort === 'string') state.effortPref = res.preferences.effort
    }
    refreshPrefSelects()
    await loadHistory()
    const label = toProvider === 'claude' ? 'Claude' : 'Codex'
    toast('Cambiado a ' + label, 'warn')
    if (withSummary && res.summary) {
      await send(res.summary)
    }
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  }
}

function autoresizeInput() {
  const t = $('#input')
  t.style.height = 'auto'
  t.style.height = Math.min(160, t.scrollHeight) + 'px'
}

async function loadHistory() {
  try {
    const msgs = await taskChatAPI.getHistory(state.threadId, { provider: state.provider })
    state.messages = Array.isArray(msgs) ? msgs : []
    const container = $('#messages')
    container.innerHTML = ''
    if (!state.messages.length) {
      renderEmpty()
    } else {
      for (const m of state.messages) container.appendChild(renderMessage(m))
      scrollBottom()
    }
    refreshProviderLock()
  } catch (e) {
    toast('Error cargando historial: ' + (e && e.message ? e.message : e), 'error')
  }
}

function renderEmpty() {
  const container = $('#messages')
  const wrap = el('div', { class: 'empty', id: 'empty' })
  wrap.appendChild(el('div', { class: 'title' }, 'Asistente para crear una tarea programada'))
  wrap.appendChild(el('div', { class: 'hint' }, 'Dime qué quieres que la app haga sola y cada cuánto. Yo te propongo la tarea completa: cron, prompt, modelo, sinks. Tú confirmas con un clic.'))
  const examples = el('div', { class: 'examples', id: 'examples' })
  const ex = [
    'Quiero que cada mañana a las 9 me liste los eventos de hoy de Google Calendar.',
    'Revisa mi Gmail cada 4 horas, busca lo importante sin leer y mándame un resumen corto.',
    'Quiero un recordatorio de Telegram a las 19:00 los laborables para repasar tareas pendientes de Google Tasks.'
  ]
  const labels = [
    'Eventos de Google Calendar cada mañana',
    'Resumen de Gmail cada 4 horas',
    'Recordatorio diario de Google Tasks'
  ]
  for (let i = 0; i < ex.length; i++) {
    const b = el('button', { class: 'btn', 'data-example': ex[i] }, labels[i])
    b.addEventListener('click', () => send(ex[i]))
    examples.appendChild(b)
  }
  wrap.appendChild(examples)
  container.appendChild(wrap)
}

async function loadPreferences() {
  try {
    const prefs = await taskChatAPI.getPreferences(state.threadId)
    state.provider = (prefs && (prefs.provider === 'claude' || prefs.provider === 'codex')) ? prefs.provider : 'claude'
    state.modelPref = (prefs && typeof prefs.model === 'string') ? prefs.model : ''
    state.effortPref = (prefs && typeof prefs.effort === 'string') ? prefs.effort : ''
    refreshPrefSelects()
  } catch {}
}

async function persistPrefsFromSelects() {
  const ms = $('#model-select')
  const es = $('#effort-select')
  const model = ms ? ms.value : ''
  const effort = es ? es.value : ''
  state.modelPref = model
  state.effortPref = effort
  try {
    await taskChatAPI.setPreferences(state.threadId, {
      provider: state.provider,
      model,
      effort
    })
  } catch (e) {
    toast('No se pudo guardar la preferencia', 'error')
  }
}

async function onProviderChange() {
  const provSel = $('#provider-select')
  if (!provSel || provSel.disabled) return
  const newProvider = provSel.value
  if (newProvider !== 'claude' && newProvider !== 'codex') return
  if (newProvider === state.provider) return
  state.provider = newProvider
  refreshPrefSelects()
  try {
    const res = await taskChatAPI.setPreferences(state.threadId, {
      provider: state.provider,
      model: state.modelPref,
      effort: state.effortPref
    })
    if (res && typeof res.model === 'string') state.modelPref = res.model
    if (res && typeof res.effort === 'string') state.effortPref = res.effort
    refreshPrefSelects()
  } catch {}
  const label = state.provider === 'claude' ? 'Claude' : 'Codex'
  toast(`Proveedor: ${label}`, 'warn')
}

function wireEvents() {
  $('#btn-send').addEventListener('click', () => send())
  $('#btn-close').addEventListener('click', () => taskChatAPI.close())
  $('#btn-min').addEventListener('click', () => taskChatAPI.minimize())

  const ms = $('#model-select')
  const es = $('#effort-select')
  const ps = $('#provider-select')
  if (ms) ms.addEventListener('change', persistPrefsFromSelects)
  if (es) es.addEventListener('change', persistPrefsFromSelects)
  if (ps) ps.addEventListener('change', onProviderChange)

  const switchBtn = $('#btn-switch-provider')
  if (switchBtn) switchBtn.addEventListener('click', openSwitchModal)

  const mWith = $('#modal-with-summary')
  const mClean = $('#modal-clean')
  const mCancel = $('#modal-cancel')
  if (mWith) mWith.addEventListener('click', () => {
    const to = state.provider === 'claude' ? 'codex' : 'claude'
    doSwitchProvider(to, true)
  })
  if (mClean) mClean.addEventListener('click', () => {
    const to = state.provider === 'claude' ? 'codex' : 'claude'
    doSwitchProvider(to, false)
  })
  if (mCancel) mCancel.addEventListener('click', closeSwitchModal)
  const ov = $('#switch-modal')
  if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) closeSwitchModal() })

  // Quick-start examples del estado vacío inicial (los del HTML).
  const examplesInitial = document.querySelectorAll('#examples .btn[data-example]')
  examplesInitial.forEach((b) => {
    b.addEventListener('click', () => send(b.getAttribute('data-example') || ''))
  })

  const inp = $('#input')
  inp.addEventListener('input', autoresizeInput)
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  })

  taskChatAPI.onUserMessage(({ threadId, message }) => {
    if (threadId !== state.threadId) return
    appendMessage(message)
  })

  taskChatAPI.onToken(({ threadId, messageId, token }) => {
    if (threadId !== state.threadId) return
    if (state.streamingMessageId !== messageId) {
      startStreamingPlaceholder(messageId)
    }
    appendStreamingToken(messageId, token)
  })

  taskChatAPI.onMessageDone(({ threadId, messageId, message }) => {
    if (threadId !== state.threadId) return
    if (state.streamingMessageId === messageId) {
      finalizeStreamingMessage(message)
    } else {
      appendMessage(message)
    }
    setBusy(false)
  })

  taskChatAPI.onError(({ threadId, error }) => {
    if (threadId !== state.threadId) return
    toast('Error: ' + (error || 'desconocido'), 'error')
    setBusy(false)
  })

  if (typeof taskChatAPI.onProviderError === 'function') {
    taskChatAPI.onProviderError(({ threadId, provider, error, lastUserMessage, messageId }) => {
      if (threadId !== state.threadId) return
      if (state.streamingMessageId) {
        const row = document.querySelector(`.row[data-id="${state.streamingMessageId}"]`)
        if (row) row.remove()
        state.streamingMessageId = null
        state.streamingText = ''
      }
      const sysMsg = {
        id: messageId || ('err-' + Date.now()),
        role: 'system',
        kind: 'provider-error',
        content: error,
        error,
        lastUserMessage,
        timestamp: new Date().toISOString(),
        provider
      }
      appendMessage(sysMsg)
      toast(`Fallo de ${provider === 'codex' ? 'Codex' : 'Claude'}: ${error || 'desconocido'}`, 'error')
      setBusy(false)
    })
  }

  if (typeof taskChatAPI.onThreadCleared === 'function') {
    taskChatAPI.onThreadCleared(({ threadId, provider }) => {
      if (threadId !== state.threadId) return
      if (provider !== state.provider) return
      state.messages = []
      loadHistory()
    })
  }
}

async function bootstrap() {
  applyTheme()
  try {
    const init = await taskChatAPI.init()
    state.threadId = (init && init.threadId) || '__new_task__'
    await loadPreferences()
    await loadHistory()
    wireEvents()
    setTimeout(() => $('#input').focus(), 100)
  } catch (e) {
    $('#subtitle').textContent = 'Error: ' + (e && e.message ? e.message : e)
  }
}

bootstrap()
