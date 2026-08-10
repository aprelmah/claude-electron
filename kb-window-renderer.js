'use strict'

const params = new URLSearchParams(window.location.search)
const theme = params.get('theme')
document.body.classList.add(theme === 'light' ? 'light' : 'dark')
const projectDir = params.get('projectDir') || ''
document.getElementById('project-name').textContent = projectDir.split('/').pop() || projectDir

const colSources = document.getElementById('col-sources')
const btnApplySession = document.getElementById('btn-apply-session')
let kbBusy = false

if (btnApplySession) {
  btnApplySession.addEventListener('click', async () => {
    const data = await window.api.kb.list(projectDir)
    const relPaths = data.ok ? data.fichas.filter(f => f.active).map(f => f.relPath) : []
    if (!relPaths.length) { alert('No hay fichas activas que aplicar'); return }
    const res = await window.api.kb.applyToSession(projectDir, relPaths)
    if (!res.ok) { alert(res.error); return }
    const original = btnApplySession.textContent
    btnApplySession.textContent = '✓ Aplicado'
    setTimeout(() => { btnApplySession.textContent = original }, 1500)
  })
}

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
    name.addEventListener('dblclick', () => editFichaFile(ficha.relPath))
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
    title.title = 'Doble click: editar a mano'
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

function promptAddShortcut() {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;inset:40px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;z-index:1000;display:flex;flex-direction:column;gap:8px;'
  const titleLabel = document.createElement('label')
  titleLabel.textContent = 'Título del atajo'
  const titleInput = document.createElement('input')
  titleInput.type = 'text'
  const bodyLabel = document.createElement('label')
  bodyLabel.textContent = 'Contenido'
  const bodyInput = document.createElement('textarea')
  bodyInput.rows = 10
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;'
  const save = document.createElement('button')
  save.className = 'primary'
  save.textContent = 'Guardar'
  const cancel = document.createElement('button')
  cancel.textContent = 'Cancelar'
  cancel.addEventListener('click', () => box.remove())
  actions.append(cancel, save)
  box.append(titleLabel, titleInput, bodyLabel, bodyInput, actions)
  document.body.appendChild(box)
  titleInput.focus()

  save.addEventListener('click', async () => {
    const title = titleInput.value.trim()
    const body = bodyInput.value.trim()
    if (!title || !body) { alert('Título y contenido son obligatorios'); return }
    const res = await window.api.kb.addShortcut(projectDir, { title, body, related: [] })
    if (!res.ok) { alert(res.error); return }
    box.remove()
    refreshShortcuts()
  })
}

btnAddShortcut.addEventListener('click', () => promptAddShortcut())

refreshShortcuts()
