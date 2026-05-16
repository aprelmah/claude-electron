'use strict'

/* global chatAPI */

const $ = (sel) => document.querySelector(sel)

const state = {
  automationId: null,
  automation: null,
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
      ? 'Proveedor fijado para este thread. Usa el botón 🔄 para cambiar.'
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
  // pequeño delay para que el reflow asiente
  requestAnimationFrame(() => {
    c.scrollTop = c.scrollHeight
  })
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

  if (m.proposedScript || m.proposedPlist) {
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

  const btnRetry = el('button', { class: 'btn' }, '↻ Reintentar con ' + provLabel)
  btnRetry.addEventListener('click', () => onRetryLast())
  actions.appendChild(btnRetry)

  const btnSwitch = el('button', { class: 'btn' }, '→ Continuar con ' + altLabel)
  btnSwitch.addEventListener('click', () => doSwitchProvider(altProvider, true))
  actions.appendChild(btnSwitch)

  const btnClear = el('button', { class: 'btn' }, '🗑 Empezar de cero')
  btnClear.addEventListener('click', () => onClearThread())
  actions.appendChild(btnClear)

  bubble.appendChild(actions)
  bubble.appendChild(el('div', { class: 'ts' }, fmtTime(m.timestamp)))
  row.appendChild(bubble)
  return row
}

function renderProposed(m) {
  const box = el('div', { class: 'proposed' })

  if (m.proposedScript) {
    box.appendChild(el('div', { class: 'title' }, 'Script propuesto'))
    const pre = el('pre', { class: 'preview-pre' })
    pre.textContent = m.proposedScript
    box.appendChild(pre)
  }
  if (m.proposedPlist) {
    box.appendChild(el('div', { class: 'title' }, 'Plist propuesto'))
    const pre = el('pre', { class: 'preview-pre' })
    pre.textContent = m.proposedPlist
    box.appendChild(pre)
  }

  const actions = el('div', { class: 'actions' })

  const btnReinstall = el('button', { class: 'btn btn-primary' }, 'Aplicar y reinstalar')
  btnReinstall.addEventListener('click', () => onApply(m, true))
  actions.appendChild(btnReinstall)

  const btnApply = el('button', { class: 'btn' }, 'Solo aplicar')
  btnApply.addEventListener('click', () => onApply(m, false))
  actions.appendChild(btnApply)

  box.appendChild(actions)
  return box
}

function appendMessage(m) {
  clearEmpty()
  state.messages = Array.isArray(state.messages) ? state.messages : []
  // Evitar duplicados por id (puede llegar primero por broadcast user-message y luego por el getHistory).
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
    // No mostrar bloques crudos <SCRIPT>... mientras llegan: oculta el contenido entre tags.
    text.textContent = state.streamingText
      .replace(/<SCRIPT>[\s\S]*?<\/SCRIPT>/gi, '[script propuesto…]')
      .replace(/<PLIST>[\s\S]*?<\/PLIST>/gi, '[plist propuesto…]')
      // Si hay tag abierto sin cerrar, ocultar a partir de ahí.
      .replace(/<SCRIPT>[\s\S]*$/i, '[generando script…]')
      .replace(/<PLIST>[\s\S]*$/i, '[generando plist…]')
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

async function onApply(message, alsoReinstall) {
  const btns = document.querySelectorAll(`.row[data-id="${message.id}"] .btn`)
  btns.forEach((b) => b.setAttribute('disabled', 'disabled'))
  try {
    const res = await chatAPI.applyChanges(state.automationId, {
      script: message.proposedScript || undefined,
      plist: message.proposedPlist || undefined,
      alsoReinstall: !!alsoReinstall
    })
    if (!res || res.ok === false) {
      const err = (res && res.error) || 'Error aplicando cambios'
      toast(err, 'error')
      if (res && res.lintIssues) {
        toast('shellcheck bloqueó la aplicación', 'error')
      }
      return
    }
    toast(alsoReinstall ? 'Aplicado y reinstalado' : 'Aplicado', 'ok')
    // refrescar automation cacheada
    try { state.automation = await chatAPI.getAutomation(state.automationId) } catch {}
  } catch (e) {
    toast('Error: ' + (e && e.message ? e.message : e), 'error')
  } finally {
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
  let fromInput = false
  if (typeof rawContent === 'string') {
    content = rawContent.trim()
  } else {
    const inp = $('#input')
    content = (inp.value || '').trim()
    fromInput = true
  }
  if (!content) return
  const includeLog = fromInput ? $('#opt-include-log').checked : false
  if (fromInput) {
    $('#input').value = ''
    autoresizeInput()
  }
  setBusy(true)
  try {
    const res = await chatAPI.send(state.automationId, content, {
      includeLog,
      provider: state.provider,
      model: state.modelPref || '',
      effort: state.effortPref || ''
    })
    if (res && res.ok === false && res.providerError) {
      // El error ya viene por broadcast onProviderError; toast por si acaso.
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
    const res = await chatAPI.retryLast(state.automationId, {
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
    await chatAPI.clearThread(state.automationId, { provider: state.provider })
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
    const res = await chatAPI.switchProvider(state.automationId, { toProvider, withSummary: !!withSummary })
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
      // Enviar el resumen como primer mensaje del nuevo thread.
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

async function loadAutomation() {
  try {
    const a = await chatAPI.getAutomation(state.automationId)
    state.automation = a
    if (a) {
      $('#title').textContent = 'Agente — ' + (a.name || a.slug || 'sin nombre')
      $('#subtitle').textContent = (a.status || '—') + ' · ' + (a.slug || '—')
      document.title = 'Agente — ' + (a.name || a.slug || 'POWER-AGENT')
    } else {
      $('#title').textContent = 'Agente'
      $('#subtitle').textContent = 'Automation no encontrada'
    }
  } catch (e) {
    $('#subtitle').textContent = 'Error: ' + (e && e.message ? e.message : e)
  }
}

async function loadHistory() {
  try {
    const msgs = await chatAPI.getHistory(state.automationId, { provider: state.provider })
    state.messages = Array.isArray(msgs) ? msgs : []
    const container = $('#messages')
    container.innerHTML = ''
    if (!state.messages.length) {
      const label = state.provider === 'codex' ? 'Codex' : 'Claude'
      container.appendChild(el('div', { class: 'empty', id: 'empty' },
        el('div', { class: 'title' }, `Habla con el agente (${label})`),
        el('div', {}, 'Te recuerda qué creó y puede proponer cambios al script.')
      ))
    } else {
      for (const m of state.messages) container.appendChild(renderMessage(m))
      scrollBottom()
    }
    refreshProviderLock()
  } catch (e) {
    toast('Error cargando historial: ' + (e && e.message ? e.message : e), 'error')
  }
}

async function loadPreferences() {
  try {
    const prefs = await chatAPI.getPreferences(state.automationId)
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
    await chatAPI.setPreferences(state.automationId, {
      provider: state.provider,
      model,
      effort
    })
  } catch (e) {
    toast('No se pudo guardar la preferencia', 'error')
  }
}

async function onProviderChange() {
  // Sólo opera cuando el select NO está bloqueado (thread vacío).
  const provSel = $('#provider-select')
  if (!provSel || provSel.disabled) return
  const newProvider = provSel.value
  if (newProvider !== 'claude' && newProvider !== 'codex') return
  if (newProvider === state.provider) return
  state.provider = newProvider

  refreshPrefSelects()

  try {
    const res = await chatAPI.setPreferences(state.automationId, {
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
  $('#btn-close').addEventListener('click', () => chatAPI.close())
  $('#btn-min').addEventListener('click', () => chatAPI.minimize())

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

  const inp = $('#input')
  inp.addEventListener('input', autoresizeInput)
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  })

  chatAPI.onUserMessage(({ automationId, message }) => {
    if (automationId !== state.automationId) return
    appendMessage(message)
  })

  chatAPI.onToken(({ automationId, messageId, token }) => {
    if (automationId !== state.automationId) return
    if (state.streamingMessageId !== messageId) {
      startStreamingPlaceholder(messageId)
    }
    appendStreamingToken(messageId, token)
  })

  chatAPI.onMessageDone(({ automationId, messageId, message }) => {
    if (automationId !== state.automationId) return
    if (state.streamingMessageId === messageId) {
      finalizeStreamingMessage(message)
    } else {
      appendMessage(message)
    }
    setBusy(false)
  })

  chatAPI.onError(({ automationId, error }) => {
    if (automationId !== state.automationId) return
    toast('Error: ' + (error || 'desconocido'), 'error')
    setBusy(false)
  })

  if (typeof chatAPI.onProviderError === 'function') {
    chatAPI.onProviderError(({ automationId, provider, error, lastUserMessage, messageId }) => {
      if (automationId !== state.automationId) return
      // Limpiar streaming placeholder si quedó colgado.
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

  if (typeof chatAPI.onThreadCleared === 'function') {
    chatAPI.onThreadCleared(({ automationId, provider }) => {
      if (automationId !== state.automationId) return
      if (provider !== state.provider) return
      state.messages = []
      loadHistory()
    })
  }
}

async function bootstrap() {
  applyTheme()
  try {
    const init = await chatAPI.init()
    if (!init || !init.automationId) {
      $('#subtitle').textContent = 'Sin automation asociada'
      return
    }
    state.automationId = init.automationId
    await loadAutomation()
    await loadPreferences()
    await loadHistory()
    wireEvents()
    setTimeout(() => $('#input').focus(), 100)
  } catch (e) {
    $('#subtitle').textContent = 'Error: ' + (e && e.message ? e.message : e)
  }
}

bootstrap()
