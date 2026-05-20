const params = new URLSearchParams(window.location.search)
const theme = params.get('theme')
document.body.classList.add(theme === 'light' ? 'light' : 'dark')

const ROW_HEIGHT = 34
const OVERSCAN = 8

const btnReload = document.getElementById('btn-reload')
const btnExport = document.getElementById('btn-export')
const btnClearFilters = document.getElementById('btn-clear-filters')
const filterActions = document.getElementById('filter-actions')
const summary = document.getElementById('summary')
const logPath = document.getElementById('log-path')
const statusEl = document.getElementById('status')
const viewport = document.getElementById('rows-viewport')
const rowsSpacerTop = document.getElementById('rows-spacer-top')
const rowsContainer = document.getElementById('rows-container')
const rowsSpacerBottom = document.getElementById('rows-spacer-bottom')

const state = {
  allEntries: [],
  filteredEntries: []
}

function setStatus(message, kind = '') {
  statusEl.textContent = String(message || '')
  statusEl.className = `status ${kind}`.trim()
}

function normalizeEntry(raw) {
  const ev = raw && typeof raw === 'object' ? raw : {}
  return {
    ts: Number(ev.ts) || 0,
    session: String(ev.session || ''),
    cli: ev.cli === 'codex' ? 'codex' : 'claude',
    action: String(ev.action || 'evento'),
    detail: String(ev.detail || ''),
    ok: ev.ok !== false
  }
}

function formatTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  return d.toLocaleString('es-ES', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function shortSession(session) {
  const s = String(session || '').trim()
  if (!s) return '—'
  return s.length <= 8 ? s : `${s.slice(0, 8)}…`
}

function currentSelectedActions() {
  return new Set(Array.from(filterActions.selectedOptions).map((opt) => opt.value).filter(Boolean))
}

function rebuildActionOptions() {
  const previous = currentSelectedActions()
  const counts = new Map()
  for (const ev of state.allEntries) {
    counts.set(ev.action, (counts.get(ev.action) || 0) + 1)
  }
  const actions = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'es'))
  filterActions.innerHTML = ''
  for (const action of actions) {
    const opt = document.createElement('option')
    opt.value = action
    opt.textContent = `${action} (${counts.get(action) || 0})`
    opt.selected = previous.has(action)
    filterActions.appendChild(opt)
  }
}

function applyFilters() {
  const selected = currentSelectedActions()
  state.filteredEntries = selected.size
    ? state.allEntries.filter((ev) => selected.has(ev.action))
    : state.allEntries.slice()
  summary.textContent = `Mostrando ${state.filteredEntries.length} de ${state.allEntries.length} eventos (max 500)`
  viewport.scrollTop = 0
  renderVirtualRows()
}

function buildRow(ev) {
  const row = document.createElement('div')
  row.className = 'row'

  const time = document.createElement('div')
  time.className = 'mono'
  time.textContent = formatTime(ev.ts)

  const session = document.createElement('div')
  session.className = 'mono'
  session.title = ev.session || ''
  session.textContent = shortSession(ev.session)

  const action = document.createElement('div')
  action.className = 'mono'
  action.textContent = ev.action

  const detail = document.createElement('div')
  detail.className = 'cell-detail'
  detail.title = ev.detail || ''
  detail.textContent = ev.detail || '—'

  const ok = document.createElement('div')
  ok.className = ev.ok ? 'ok-true' : 'ok-false'
  ok.textContent = ev.ok ? 'OK' : 'ERR'

  row.append(time, session, action, detail, ok)
  return row
}

function renderVirtualRows() {
  const total = state.filteredEntries.length
  if (!total) {
    rowsSpacerTop.style.height = '0px'
    rowsSpacerBottom.style.height = '0px'
    rowsContainer.innerHTML = '<div class="empty">No hay eventos para el filtro actual.</div>'
    return
  }

  const viewportHeight = Math.max(viewport.clientHeight, ROW_HEIGHT)
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT)
  const rawStart = Math.floor(viewport.scrollTop / ROW_HEIGHT)
  const start = Math.max(0, rawStart - OVERSCAN)
  const end = Math.min(total, start + visibleCount + OVERSCAN * 2)

  rowsSpacerTop.style.height = `${start * ROW_HEIGHT}px`
  rowsSpacerBottom.style.height = `${Math.max(0, (total - end) * ROW_HEIGHT)}px`

  const frag = document.createDocumentFragment()
  for (let i = start; i < end; i++) {
    frag.appendChild(buildRow(state.filteredEntries[i]))
  }

  rowsContainer.innerHTML = ''
  rowsContainer.appendChild(frag)
}

function safeFileName() {
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `power-agent-log-${now}.csv`
}

async function loadEntries() {
  setStatus('Cargando bitácora...')
  try {
    const res = await window.bitacoraApi.listEntries(500)
    if (!res || res.ok === false) {
      setStatus(res?.error || 'No se pudo cargar la bitácora.', 'err')
      return
    }
    const items = Array.isArray(res.entries) ? res.entries : []
    state.allEntries = items.map(normalizeEntry)
    logPath.textContent = res.filePath || '—'
    rebuildActionOptions()
    applyFilters()
    setStatus(`Bitácora cargada (${state.allEntries.length} eventos).`, 'ok')
  } catch (err) {
    setStatus(err?.message || String(err), 'err')
  }
}

async function exportCurrentCsv() {
  const toExport = state.filteredEntries.slice()
  if (!toExport.length) {
    setStatus('No hay eventos para exportar.', 'err')
    return
  }
  setStatus('Exportando CSV...')
  try {
    const res = await window.bitacoraApi.exportCsv(toExport, safeFileName())
    if (!res || res.ok === false) {
      if (res?.cancelled) {
        setStatus('Exportación cancelada.')
      } else {
        setStatus(res?.error || 'No se pudo exportar CSV.', 'err')
      }
      return
    }
    setStatus(`CSV exportado (${res.count || toExport.length} filas) en ${res.path}`, 'ok')
  } catch (err) {
    setStatus(err?.message || String(err), 'err')
  }
}

let scrollRaf = 0
viewport.addEventListener('scroll', () => {
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    renderVirtualRows()
  })
})

window.addEventListener('resize', () => renderVirtualRows())
filterActions.addEventListener('change', () => applyFilters())
btnClearFilters.addEventListener('click', () => {
  for (const opt of filterActions.options) opt.selected = false
  applyFilters()
})
btnReload.addEventListener('click', () => loadEntries())
btnExport.addEventListener('click', () => exportCurrentCsv())

loadEntries()
