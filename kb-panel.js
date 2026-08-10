'use strict'
// Pestañas hermanas 📚 Casos/Fichas (Fase 3). Antes eran una caja lateral
// dockeada junto al terminal (Fase 2, retirada); ahora Chat/Casos/Fichas son
// tres pestañas del mismo nivel dentro de #terminal-row — cada una ocupa
// TODO el ancho disponible, una a la vez. El terminal nunca se destruye al
// cambiar de pestaña (solo se oculta), igual que ya hacía el sub-chat.
// Todo el estado vive en este IIFE para no chocar con los `const`/`let` de
// nivel superior de renderer.js y compañía (los <script> sueltos comparten
// ámbito global).
;(function () {
  const tabBtnChat = document.getElementById('tab-btn-chat')
  const tabBtnCasos = document.getElementById('tab-btn-casos')
  const tabBtnFichas = document.getElementById('tab-btn-fichas')
  const viewChat = document.getElementById('tab-view-chat')
  const viewCasos = document.getElementById('tab-view-casos')
  const viewFichas = document.getElementById('tab-view-fichas')
  if (!tabBtnChat || !tabBtnCasos || !tabBtnFichas || !viewChat || !viewCasos || !viewFichas) return

  const paneProject = document.getElementById('content-tabs-project')
  const btnApplySession = document.getElementById('kb-btn-apply-session')

  const casosList = document.getElementById('kb-casos-list')
  const btnNewCaso = document.getElementById('kb-btn-new-caso')
  const caseEditorEmpty = document.getElementById('kb-casos-editor-empty')
  const caseEditorView = document.getElementById('kb-casos-editor-view')
  const caseTitleInput = document.getElementById('kb-case-title')
  const caseBodyInput = document.getElementById('kb-case-body')
  const caseTitleMicBtn = document.getElementById('kb-case-title-mic')
  const caseBodyMicBtn = document.getElementById('kb-case-body-mic')
  const btnCaseSave = document.getElementById('kb-case-save')
  const btnCaseDelete = document.getElementById('kb-case-delete')
  const btnCaseCancel = document.getElementById('kb-case-cancel')

  const fichasList = document.getElementById('kb-fichas-list')
  const btnNewFicha = document.getElementById('kb-btn-new-ficha')
  const fichaDrop = document.getElementById('kb-ficha-drop')
  const fichaUrlInput = document.getElementById('kb-ficha-url')
  const fichaEditorEmpty = document.getElementById('kb-fichas-editor-empty')
  const fichaEditorView = document.getElementById('kb-fichas-editor-view')
  const fichaEditorLabel = document.getElementById('kb-ficha-editor-label')
  const fichaEditorText = document.getElementById('kb-ficha-editor-text')
  const btnFichaEditorSave = document.getElementById('kb-ficha-editor-save')
  const btnFichaEditorCancel = document.getElementById('kb-ficha-editor-cancel')

  let activeTab = 'chat'
  let currentCwd = ''
  let kbBusy = false
  let currentCaseId = null
  let currentFichaRelPath = null
  let stopProgress = null

  function fmtSize(bytes) {
    if (!Number.isFinite(bytes)) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function resolveActiveCwd() {
    if (typeof window.__resolveProjectCwd === 'function') {
      try { return await window.__resolveProjectCwd() } catch { return '' }
    }
    return ''
  }

  async function setActiveTab(tab) {
    activeTab = tab
    tabBtnChat.classList.toggle('active', tab === 'chat')
    tabBtnCasos.classList.toggle('active', tab === 'casos')
    tabBtnFichas.classList.toggle('active', tab === 'fichas')
    viewChat.classList.toggle('hidden', tab !== 'chat')
    viewCasos.classList.toggle('hidden', tab !== 'casos')
    viewFichas.classList.toggle('hidden', tab !== 'fichas')

    if (tab === 'chat') {
      if (typeof scheduleTerminalRefit === 'function') scheduleTerminalRefit()
      return
    }

    const cwd = await resolveActiveCwd()
    currentCwd = cwd
    paneProject.textContent = cwd ? (cwd.split('/').pop() || cwd) : ''
    paneProject.title = cwd

    if (tab === 'casos') {
      closeCaseEditor()
      await refreshCasos()
    } else if (tab === 'fichas') {
      closeFichaEditor()
      await refreshFichas()
    }
  }

  tabBtnChat.addEventListener('click', () => setActiveTab('chat'))
  tabBtnCasos.addEventListener('click', () => setActiveTab('casos'))
  tabBtnFichas.addEventListener('click', () => setActiveTab('fichas'))

  // --- Casos -------------------------------------------------------------

  function showCasoEmpty() {
    caseEditorEmpty.classList.remove('hidden')
    caseEditorView.classList.add('hidden')
  }

  function showCasoEditorView() {
    caseEditorEmpty.classList.add('hidden')
    caseEditorView.classList.remove('hidden')
  }

  function insertTranscribedText(el, text) {
    if (!el || !text) return
    const clean = String(text).trim()
    if (!clean) return
    const needsSpace = el.value.length > 0 && !/\s$/.test(el.value)
    el.value = el.value + (needsSpace ? ' ' : '') + clean
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function flashMicError(btn, msg) {
    console.error('[kb-panel mic]', msg)
    const original = btn.dataset.baseTitle || btn.title
    btn.title = msg
    btn.classList.add('kb-mic-error')
    setTimeout(() => {
      btn.classList.remove('kb-mic-error')
      btn.title = original
    }, 3000)
  }

  function attachDictationButton(btn, targetEl) {
    if (!btn || !targetEl) return { stop() {} }
    btn.dataset.baseTitle = btn.title
    let mediaRecorder = null
    let chunks = []
    let recording = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        chunks = []
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          const blob = new Blob(chunks, { type: 'audio/webm' })
          if (blob.size < 500) return
          btn.classList.add('busy')
          try {
            const buf = await blob.arrayBuffer()
            const text = await window.api.transcribeAudio(buf)
            insertTranscribedText(targetEl, text)
          } catch (err) {
            flashMicError(btn, `Error transcripción: ${err.message || err}`)
          } finally {
            btn.classList.remove('busy')
          }
        }
        mediaRecorder.start()
        recording = true
        btn.classList.add('recording')
        btn.setAttribute('aria-pressed', 'true')
      } catch (err) {
        flashMicError(btn, `Sin micro: ${err.message || err}`)
      }
    }

    function stop() {
      if (!recording) return
      recording = false
      btn.classList.remove('recording')
      btn.setAttribute('aria-pressed', 'false')
      if (mediaRecorder) mediaRecorder.stop()
    }

    btn.addEventListener('click', () => { recording ? stop() : start() })
    return { stop }
  }

  const caseTitleDictation = attachDictationButton(caseTitleMicBtn, caseTitleInput)
  const caseBodyDictation = attachDictationButton(caseBodyMicBtn, caseBodyInput)

  function openCaseEditor(entry) {
    currentCaseId = entry ? entry.num : null
    caseTitleInput.value = entry ? entry.title : ''
    caseBodyInput.value = entry ? entry.body : ''
    btnCaseDelete.classList.toggle('hidden', !entry)
    showCasoEditorView()
    caseTitleInput.focus()
  }

  function closeCaseEditor() {
    currentCaseId = null
    caseTitleDictation.stop()
    caseBodyDictation.stop()
    showCasoEmpty()
  }

  async function saveCaseEditor() {
    const title = caseTitleInput.value.trim()
    const body = caseBodyInput.value.trim()
    if (!title || !body) { alert('Título y resolución son obligatorios'); return }
    btnCaseSave.disabled = true
    try {
      const res = currentCaseId
        ? await window.api.kb.updateShortcut(currentCwd, currentCaseId, { title, body })
        : await window.api.kb.addShortcut(currentCwd, { title, body, related: [] })
      if (!res.ok) { alert(res.error); return }
      closeCaseEditor()
      await refreshCasos()
    } finally {
      btnCaseSave.disabled = false
    }
  }

  async function deleteCaseEditor() {
    if (currentCaseId == null) return
    if (!confirm(`¿Borrar el caso ${currentCaseId}?`)) return
    const res = await window.api.kb.deleteShortcut(currentCwd, currentCaseId)
    if (!res.ok) { alert(res.error); return }
    closeCaseEditor()
    await refreshCasos()
  }

  btnNewCaso.addEventListener('click', () => openCaseEditor(null))
  btnCaseSave.addEventListener('click', () => saveCaseEditor())
  btnCaseDelete.addEventListener('click', () => deleteCaseEditor())
  btnCaseCancel.addEventListener('click', () => closeCaseEditor())

  function previewOf(body) {
    const flat = String(body || '').replace(/\s+/g, ' ').trim()
    return flat.length > 80 ? flat.slice(0, 80) + '…' : flat
  }

  async function refreshCasos() {
    if (!currentCwd) return
    const data = await window.api.kb.list(currentCwd)
    casosList.innerHTML = ''
    if (!data.ok) {
      casosList.innerHTML = `<div class="kb-list-empty">${data.error}</div>`
      return
    }
    const entries = data.shortcuts?.entries || []
    if (!entries.length) {
      casosList.innerHTML = '<div class="kb-list-empty">Sin casos todavía.</div>'
      return
    }
    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'kb-case-item'
      const main = document.createElement('div')
      main.className = 'kb-case-item-main'
      const title = document.createElement('div')
      title.className = 'kb-case-item-title'
      title.textContent = `${entry.num} · ${entry.title}`
      const preview = document.createElement('div')
      preview.className = 'kb-case-item-preview'
      preview.textContent = previewOf(entry.body)
      main.append(title, preview)
      row.appendChild(main)
      row.addEventListener('click', () => openCaseEditor(entry))
      casosList.appendChild(row)
    }
  }

  // --- Fichas --------------------------------------------------------------

  function showFichaEmpty() {
    fichaEditorEmpty.classList.remove('hidden')
    fichaEditorView.classList.add('hidden')
  }

  function showFichaEditorView() {
    fichaEditorEmpty.classList.add('hidden')
    fichaEditorView.classList.remove('hidden')
  }

  async function openFichaEditor(relPath) {
    currentFichaRelPath = relPath
    fichaEditorLabel.textContent = relPath
    fichaEditorText.value = 'Cargando…'
    fichaEditorText.disabled = true
    showFichaEditorView()
    const raw = await window.api.kb.readFicha(currentCwd, relPath)
    fichaEditorText.value = raw.ok ? raw.text : ''
    fichaEditorText.disabled = false
  }

  function closeFichaEditor() {
    currentFichaRelPath = null
    showFichaEmpty()
  }

  async function saveFichaEditor() {
    if (!currentFichaRelPath) return
    btnFichaEditorSave.disabled = true
    try {
      const res = await window.api.kb.writeFicha(currentCwd, currentFichaRelPath, fichaEditorText.value)
      if (!res.ok) { alert(res.error); return }
      closeFichaEditor()
      await refreshFichas()
    } finally {
      btnFichaEditorSave.disabled = false
    }
  }

  btnFichaEditorSave.addEventListener('click', () => saveFichaEditor())
  btnFichaEditorCancel.addEventListener('click', () => closeFichaEditor())

  async function refreshFichas() {
    if (!currentCwd) return
    const data = await window.api.kb.list(currentCwd)
    fichasList.innerHTML = ''
    if (!data.ok) {
      fichasList.innerHTML = `<div class="kb-list-empty">${data.error}</div>`
      return
    }
    if (!data.fichas.length) {
      fichasList.innerHTML = '<div class="kb-list-empty">Sin fichas todavía.</div>'
    }
    for (const ficha of data.fichas) {
      const row = document.createElement('div')
      row.className = 'kb-ficha-item'
      const check = document.createElement('input')
      check.type = 'checkbox'
      check.checked = ficha.active
      check.title = ficha.active ? 'Desactivar' : 'Activar'
      check.addEventListener('change', async () => {
        check.disabled = true
        const res = await window.api.kb.toggle(currentCwd, ficha.relPath, check.checked)
        if (!res.ok) { alert(res.error); await refreshFichas(); return }
        check.disabled = false
      })
      const name = document.createElement('span')
      name.className = 'kb-ficha-name'
      name.textContent = ficha.name + (ficha.missing ? ' (falta el fichero)' : '')
      name.title = ficha.relPath
      name.addEventListener('dblclick', () => openFichaEditor(ficha.relPath))
      const meta = document.createElement('span')
      meta.className = 'kb-ficha-meta'
      meta.textContent = fmtSize(ficha.size)
      const del = document.createElement('button')
      del.className = 'kb-mini-btn'
      del.textContent = '🗑'
      del.title = 'Quitar (a la Papelera si es una ficha del panel)'
      del.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm(`¿Quitar «${ficha.name}»?`)) return
        await window.api.kb.remove(currentCwd, ficha.relPath, true)
        refreshFichas()
      })
      row.append(check, name, meta, del)
      fichasList.appendChild(row)
    }
  }

  function pickAndDistillFile() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.md,.txt,.html,.htm,.vtt,.srt,.mp3,.wav,.m4a,.aac,.flac,.ogg'
    input.addEventListener('change', async () => {
      const file = input.files[0]
      if (!file) return
      const filePath = window.api.getPathForFile(file)
      if (filePath) await addAndDistillFile(filePath)
    })
    input.click()
  }

  async function addAndDistillFile(filePath) {
    const added = await window.api.kb.addFile(currentCwd, filePath)
    if (!added.ok) { alert(added.error); return }
    await runDistill({ kind: 'file', relPath: added.relPath })
  }

  async function runDistill(source) {
    kbBusy = true
    fichaDrop.classList.add('dragover')
    if (stopProgress) { stopProgress(); stopProgress = null }
    stopProgress = window.api.kb.onProgress(({ stage, detail }) => {
      fichaDrop.textContent = `⏳ ${stage}${detail ? ' — ' + detail : ''}`
    })
    try {
      const res = await window.api.kb.distill(currentCwd, source)
      if (!res.ok) alert(res.error)
    } finally {
      if (stopProgress) { stopProgress(); stopProgress = null }
      kbBusy = false
      fichaDrop.classList.remove('dragover')
      fichaDrop.textContent = '⬇ Arrastra un PDF, documento o audio · o haz clic para elegir'
      await refreshFichas()
    }
  }

  btnNewFicha.addEventListener('click', () => {
    showFichaEmpty()
    fichaUrlInput.scrollIntoView({ block: 'nearest' })
    fichaUrlInput.focus()
  })

  fichaDrop.addEventListener('click', () => { if (!kbBusy) pickAndDistillFile() })
  fichaDrop.addEventListener('dragover', (e) => { e.preventDefault(); if (!kbBusy) fichaDrop.classList.add('dragover') })
  fichaDrop.addEventListener('dragleave', () => { if (!kbBusy) fichaDrop.classList.remove('dragover') })
  fichaDrop.addEventListener('drop', async (e) => {
    e.preventDefault()
    if (!kbBusy) fichaDrop.classList.remove('dragover')
    if (kbBusy) return
    const file = e.dataTransfer.files[0]
    if (!file) return
    const filePath = window.api.getPathForFile(file)
    if (filePath) await addAndDistillFile(filePath)
  })
  fichaUrlInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || kbBusy || !fichaUrlInput.value.trim()) return
    const url = fichaUrlInput.value.trim()
    fichaUrlInput.value = ''
    await runDistill({ kind: 'url', url })
  })

  // --- Aplicar a sesión ------------------------------------------------------

  btnApplySession.addEventListener('click', async () => {
    const cwd = currentCwd || await resolveActiveCwd()
    if (!cwd) return
    const data = await window.api.kb.list(cwd)
    const relPaths = data.ok ? data.fichas.filter((f) => f.active).map((f) => f.relPath) : []
    if (!relPaths.length) { alert('No hay fichas activas que aplicar'); return }
    const res = await window.api.kb.applyToSession(cwd, relPaths)
    if (!res.ok) { alert(res.error); return }
    const original = btnApplySession.textContent
    btnApplySession.textContent = '✓ Aplicado'
    setTimeout(() => { btnApplySession.textContent = original }, 1500)
  })

  window.__contentTabs = { setActiveTab }
})()
