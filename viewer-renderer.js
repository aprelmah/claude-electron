(() => {
  const state = {
    path: '',
    kind: null,
    originalText: '',
    dirty: false,
    textarea: null,
  }

  const el = {
    body: document.body,
    dot: document.getElementById('dirty-dot'),
    name: document.getElementById('file-name'),
    fullPath: document.getElementById('file-path'),
    host: document.getElementById('content-host'),
    btnSend: document.getElementById('btn-send'),
    btnSave: document.getElementById('btn-save'),
    btnMin: document.getElementById('btn-minimize'),
    btnClose: document.getElementById('btn-close'),
    toast: document.getElementById('toast'),
  }

  let toastTimer = null
  function showToast(msg) {
    el.toast.textContent = msg
    el.toast.classList.add('show')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1500)
  }

  function basename(p) {
    if (!p) return ''
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] || p
  }

  function setDirty(d) {
    state.dirty = d
    if (d) {
      el.dot.classList.add('on')
      el.btnSave.disabled = false
      el.name.textContent = '● ' + basename(state.path)
    } else {
      el.dot.classList.remove('on')
      el.btnSave.disabled = state.kind !== 'text'
      el.name.textContent = basename(state.path)
    }
  }

  async function applyTheme() {
    try {
      let t = localStorage.getItem('claude-electron-theme')
      if (t !== 'dark' && t !== 'light') t = await window.api.getSystemTheme()
      el.body.classList.remove('dark', 'light')
      el.body.classList.add(t === 'light' ? 'light' : 'dark')
    } catch {
      el.body.classList.add('dark')
    }
  }

  function renderImage(res, p) {
    const ext = (p.split('.').pop() || '').toLowerCase()
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    el.host.innerHTML = `<div id="image-wrap"><img src="data:${mime};base64,${res.base64}" alt=""/></div>`
    el.btnSave.disabled = true
  }

  function renderBinary(res) {
    const kb = (res.size / 1024).toFixed(1)
    el.host.innerHTML = `<div id="binary-msg"><strong>Archivo binario</strong><span>${kb} KB · no editable</span></div>`
    el.btnSave.disabled = true
  }

  function renderText(res) {
    state.originalText = res.text || ''
    const ta = document.createElement('textarea')
    ta.className = 'viewer-editor'
    ta.value = state.originalText
    ta.spellcheck = false
    ta.addEventListener('input', () => setDirty(ta.value !== state.originalText))
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        const s = ta.selectionStart, en = ta.selectionEnd
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en)
        ta.selectionStart = ta.selectionEnd = s + 2
        setDirty(ta.value !== state.originalText)
      }
    })
    el.host.innerHTML = ''
    el.host.appendChild(ta)
    state.textarea = ta
    setDirty(false)
    setTimeout(() => ta.focus(), 30)
  }

  async function loadFile(p) {
    state.path = p
    el.name.textContent = basename(p)
    el.fullPath.textContent = p

    let res
    try {
      res = await window.api.fileRead(p)
    } catch (err) {
      el.host.innerHTML = `<div id="binary-msg"><strong>Error</strong><span>${String(err && err.message || err)}</span></div>`
      return
    }

    if (!res || !res.ok) {
      el.host.innerHTML = `<div id="binary-msg"><strong>Error</strong><span>${(res && res.error) || 'No se pudo leer el archivo'}</span></div>`
      return
    }

    state.kind = res.kind
    if (res.kind === 'image') renderImage(res, p)
    else if (res.kind === 'binary') renderBinary(res)
    else renderText(res)
  }

  async function doSave() {
    if (!state.dirty || state.kind !== 'text' || !state.textarea) return
    const content = state.textarea.value
    try {
      const res = await window.api.fileWrite(state.path, content)
      if (res && res.ok) {
        state.originalText = content
        setDirty(false)
        showToast('Guardado')
      } else {
        showToast('Error al guardar')
      }
    } catch {
      showToast('Error al guardar')
    }
  }

  function confirmCloseIfDirty() {
    if (!state.dirty) return true
    return window.confirm('Tienes cambios sin guardar. ¿Cerrar igual?')
  }

  function doClose() {
    if (!confirmCloseIfDirty()) return
    window.api.viewerClose()
  }

  el.btnSend.addEventListener('click', () => {
    if (!state.path) return
    window.api.viewerInject(state.path)
    window.api.viewerClose()
  })
  el.btnSave.addEventListener('click', doSave)
  el.btnMin.addEventListener('click', () => window.api.viewerMinimize())
  el.btnClose.addEventListener('click', doClose)

  window.addEventListener('keydown', (e) => {
    if (e.metaKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      doSave()
      return
    }
    if (e.metaKey && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      doClose()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      doClose()
    }
  })

  applyTheme()
  window.api.viewerInit((data) => {
    if (data && data.path) loadFile(data.path)
  })
})()
