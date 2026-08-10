'use strict'

const params = new URLSearchParams(window.location.search)
const theme = params.get('theme')
document.body.classList.add(theme === 'light' ? 'light' : 'dark')
const projectDir = params.get('projectDir') || ''
document.getElementById('project-name').textContent = projectDir.split('/').pop() || projectDir

const colSources = document.getElementById('col-sources')
let kbBusy = false

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function refreshSources() {
  const data = await window.api.kb.list(projectDir)
  colSources.innerHTML = ''
  if (!data.ok) {
    colSources.innerHTML = `<div class="empty">${data.error}</div>`
    return
  }
  if (!data.fichas.length) {
    colSources.innerHTML = '<div class="empty">Sin fichas todavía.</div>'
  }
  for (const ficha of data.fichas) {
    const row = document.createElement('div')
    row.className = 'source-item'
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = ficha.active
    check.title = ficha.active ? 'Desactivar' : 'Activar'
    check.addEventListener('change', async () => {
      check.disabled = true
      const res = await window.api.kb.toggle(projectDir, ficha.relPath, check.checked)
      if (!res.ok) {
        alert(res.error)
        await refreshSources()
        return
      }
      check.disabled = false
    })
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = ficha.name + (ficha.missing ? ' (falta el fichero)' : '')
    name.title = ficha.relPath
    name.addEventListener('dblclick', () => window.api.kb.reveal(projectDir, ficha.relPath))
    const meta = document.createElement('span')
    meta.className = 'meta'
    meta.textContent = fmtSize(ficha.size)
    const del = document.createElement('button')
    del.textContent = '🗑'
    del.title = 'Quitar (a la Papelera si es una ficha del panel)'
    del.addEventListener('click', async () => {
      if (!confirm(`¿Quitar «${ficha.name}»?`)) return
      await window.api.kb.remove(projectDir, ficha.relPath, true)
      refreshSources()
    })
    row.append(check, name, meta, del)
    colSources.appendChild(row)
  }

  const drop = document.createElement('div')
  drop.className = 'kb-drop'
  drop.textContent = kbBusy ? '⏳ Destilando…' : '⬇ Arrastra un PDF, documento o audio · o haz clic para elegir · o pega una URL y pulsa Enter'
  drop.addEventListener('click', () => { if (!kbBusy) pickAndDistillFile() })
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover') })
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'))
  drop.addEventListener('drop', async (e) => {
    e.preventDefault()
    drop.classList.remove('dragover')
    const file = e.dataTransfer.files[0]
    if (!file || kbBusy) return
    const filePath = window.api.getPathForFile(file)
    if (filePath) await addAndDistillFile(filePath)
  })
  colSources.appendChild(drop)

  const urlRow = document.createElement('div')
  urlRow.style.cssText = 'padding:4px;'
  const urlInput = document.createElement('input')
  urlInput.type = 'text'
  urlInput.placeholder = 'https://… (web o YouTube)'
  urlInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || kbBusy || !urlInput.value.trim()) return
    const url = urlInput.value.trim()
    urlInput.value = ''
    await runDistill({ kind: 'url', url })
  })
  urlRow.appendChild(urlInput)
  colSources.appendChild(urlRow)
}

async function pickAndDistillFile() {
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
  const added = await window.api.kb.addFile(projectDir, filePath)
  if (!added.ok) { alert(added.error); return }
  await runDistill({ kind: 'file', relPath: added.relPath })
}

async function runDistill(source) {
  kbBusy = true
  await refreshSources()
  const stop = window.api.kb.onProgress(({ stage, detail }) => {
    const drop = colSources.querySelector('.kb-drop')
    if (drop) drop.textContent = `⏳ ${stage}${detail ? ' — ' + detail : ''}`
  })
  try {
    const res = await window.api.kb.distill(projectDir, source)
    if (!res.ok) alert(res.error)
  } finally {
    stop()
    kbBusy = false
    await refreshSources()
  }
}

refreshSources()

const chatMessages = document.getElementById('col-chat-messages')
const chatForm = document.getElementById('col-chat-form')
const chatInput = document.getElementById('col-chat-input')
const btnClearChat = document.getElementById('btn-clear-chat')

function renderCitations(citations) {
  const div = document.createElement('div')
  div.className = 'citations'
  if (!citations?.length) return div
  for (const c of citations) {
    const btn = document.createElement('button')
    btn.className = 'citation-chip'
    btn.dataset.relpath = c.relPath
    btn.title = c.location || ''
    btn.textContent = c.title
    div.appendChild(btn)
  }
  return div
}

function renderEditCard(edit) {
  if (!edit) return null
  const card = document.createElement('div')
  card.className = 'edit-card'

  const header = document.createElement('div')
  const strong = document.createElement('strong')
  strong.textContent = 'Propuesta de corrección'
  header.append(strong, document.createTextNode(' — ' + edit.relPath))
  card.appendChild(header)

  const before = document.createElement('div')
  before.className = 'diff-before'
  before.textContent = '− ' + edit.find
  card.appendChild(before)

  const after = document.createElement('div')
  after.className = 'diff-after'
  after.textContent = '+ ' + edit.replace
  card.appendChild(after)

  if (edit.reason) {
    const reason = document.createElement('div')
    reason.style.cssText = 'color:var(--muted);font-size:11px;'
    reason.textContent = edit.reason
    card.appendChild(reason)
  }

  const actions = document.createElement('div')
  actions.className = 'actions'
  const acceptBtn = document.createElement('button')
  acceptBtn.className = 'primary'
  acceptBtn.textContent = 'Aceptar'
  const discardBtn = document.createElement('button')
  discardBtn.textContent = 'Descartar'
  actions.append(acceptBtn, discardBtn)
  card.appendChild(actions)

  discardBtn.addEventListener('click', () => card.remove())
  acceptBtn.addEventListener('click', async () => {
    const res = await window.api.kb.editApply(projectDir, edit.relPath, edit.find, edit.replace)
    if (!res.ok) { alert(res.error); return }
    card.innerHTML = ''
    const ok = document.createElement('div')
    ok.style.color = 'var(--ok)'
    ok.textContent = '✓ Aplicado'
    card.appendChild(ok)
    refreshSources()
  })

  return card
}

function appendMessage({ role, content, citations, edit }) {
  const wrap = document.createElement('div')
  wrap.className = `msg ${role}`
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = content
  wrap.appendChild(bubble)
  if (role === 'assistant' && citations?.length) {
    wrap.appendChild(renderCitations(citations))
  }
  if (role === 'assistant' && edit) {
    const card = renderEditCard(edit)
    if (card) wrap.appendChild(card)
  }
  chatMessages.appendChild(wrap)
  chatMessages.scrollTop = chatMessages.scrollHeight
}

async function loadChatHistory() {
  const data = await window.api.kb.history(projectDir)
  chatMessages.innerHTML = ''
  if (data.ok) {
    for (const entry of data.history) appendMessage(entry)
  }
}

async function submitQuestion() {
  const question = chatInput.value.trim()
  if (!question) return
  chatInput.value = ''
  appendMessage({ role: 'user', content: question })
  const pending = document.createElement('div')
  pending.className = 'msg assistant'
  pending.innerHTML = '<div class="bubble">…</div>'
  chatMessages.appendChild(pending)
  chatMessages.scrollTop = chatMessages.scrollHeight
  try {
    const result = await window.api.kb.ask(projectDir, question, [], document.getElementById('project-name').textContent)
    pending.remove()
    if (!result.ok) { appendMessage({ role: 'assistant', content: result.error }); return }
    appendMessage({ role: 'assistant', content: result.answer, citations: result.citations, edit: result.edit })
  } catch (e) {
    pending.remove()
    appendMessage({ role: 'assistant', content: String(e?.message || e) })
  }
}

chatForm.addEventListener('submit', (e) => { e.preventDefault(); submitQuestion() })
chatInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitQuestion() }
})
btnClearChat.addEventListener('click', async () => {
  if (!confirm('¿Borrar esta conversación?')) return
  await window.api.kb.clearHistory(projectDir)
  chatMessages.innerHTML = ''
})

const colShortcuts = document.getElementById('col-shortcuts')
const btnAddShortcut = document.getElementById('btn-add-shortcut')
const ATAJOS_RELPATH = 'kb/fichas/atajos.md'

async function refreshShortcuts() {
  const data = await window.api.kb.list(projectDir)
  colShortcuts.innerHTML = ''
  if (!data.ok) { colShortcuts.innerHTML = `<div class="empty">${data.error}</div>`; return }
  if (!data.shortcuts.entries.length) {
    colShortcuts.innerHTML = '<div class="empty">Sin atajos todavía.</div>'
  }
  for (const entry of data.shortcuts.entries) {
    const row = document.createElement('div')
    row.className = 'shortcut-item'
    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = `${entry.num} · ${entry.title}`
    title.title = 'Click: usar en el chat · doble click: editar a mano'
    title.addEventListener('click', () => {
      chatInput.value = `${entry.num}`
      submitQuestion()
    })
    title.addEventListener('dblclick', () => editFichaFile(ATAJOS_RELPATH))
    row.appendChild(title)
    colShortcuts.appendChild(row)
  }
}

async function editFichaFile(relPath) {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;inset:40px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;z-index:1000;display:flex;flex-direction:column;gap:8px;'
  const textarea = document.createElement('textarea')
  textarea.rows = 16
  textarea.value = 'Cargando…'
  textarea.disabled = true
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;'
  const save = document.createElement('button')
  save.className = 'primary'
  save.textContent = 'Guardar'
  const cancel = document.createElement('button')
  cancel.textContent = 'Cancelar'
  cancel.addEventListener('click', () => box.remove())
  actions.append(cancel, save)
  box.append(textarea, actions)
  document.body.appendChild(box)

  const raw = await window.api.kb.readFicha(projectDir, relPath)
  textarea.value = raw.ok ? raw.text : ''
  textarea.disabled = false

  save.addEventListener('click', async () => {
    const res = await window.api.kb.writeFicha(projectDir, relPath, textarea.value)
    if (!res.ok) { alert(res.error); return }
    box.remove()
    refreshShortcuts()
    refreshSources()
  })
}

btnAddShortcut.addEventListener('click', async () => {
  const title = prompt('Título del atajo:')
  if (!title) return
  const body = prompt('Contenido:')
  if (!body) return
  const res = await window.api.kb.addShortcut(projectDir, { title, body, related: [] })
  if (!res.ok) { alert(res.error); return }
  refreshShortcuts()
})

refreshShortcuts()

loadChatHistory()
