document.getElementById('btn-close-graph').addEventListener('click', () => window.api.closeWindow())

// Filtros de extensión estables para evitar listas enormes con sufijos
// accidentales cuando la raíz no es el proyecto esperado.
const ALL_TYPES = ['md', 'js', 'ts', 'json', 'css', 'html', 'py', 'php', 'go', 'otros']
const KNOWN_TYPES = new Set(ALL_TYPES.filter((t) => t !== 'otros'))
const COLORS_BY_TYPE = {
  md: '#a78bfa',
  js: '#fbbf24',
  ts: '#38bdf8',
  json: '#34d399',
  css: '#fb7185',
  html: '#f97316',
  py: '#22c55e',
  php: '#4f7cf5',
  go: '#06b6d4',
  otros: '#6b7280'
}
function colorForExt (type) { return COLORS_BY_TYPE[type] || COLORS_BY_TYPE.otros }
function extLabel (type) { return type }

let allNodes = [], allEdges = [], allDirs = []
let graphMode = 'refs'
let presentExts = ALL_TYPES.slice()
let refsInactiveTypes = (() => {
  try {
    const raw = localStorage.getItem('poweragent_graph_refs_exts_inactive')
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch { return new Set() }
})()
let structureInactiveTypes = (() => {
  try {
    const raw = localStorage.getItem('poweragent_graph_structure_exts_inactive')
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch { return new Set() }
})()
function persistRefsInactive () {
  try { localStorage.setItem('poweragent_graph_refs_exts_inactive', JSON.stringify(Array.from(refsInactiveTypes))) } catch {}
}
function persistStructureInactive () {
  try { localStorage.setItem('poweragent_graph_structure_exts_inactive', JSON.stringify(Array.from(structureInactiveTypes))) } catch {}
}
function activeTypesFor (mode) {
  const inactive = mode === 'structure' ? structureInactiveTypes : refsInactiveTypes
  return new Set(ALL_TYPES.filter((t) => !inactive.has(t)))
}
function recomputePresentExts (nodes) {
  presentExts = ALL_TYPES.slice()
}
let graphInstance = null
let forcePanelOpen = false
let graphForces = { repulsion: -80, linkDistance: 40, particleSpeed: 4000, compactness: 0.06 }
let graphSearchQuery = ''
let graphSearchNo = 0
let graphSearchIdx = -1
let graphHotOnly = false
let graphPaused = false
let scopeDir = ''
let graphSpeedSlider = (() => {
  const raw = Number(localStorage.getItem('poweragent_graph_speed'))
  if (!Number.isFinite(raw) || raw < 1 || raw > 10) return 5
  return Math.round(raw)
})()
function graphSpeedFactor () { return graphSpeedSlider / 10 }

const graphCanvas = document.getElementById('graph-canvas')
const modeRow = document.getElementById('mode-row')
const chipsRow = document.getElementById('chips-row')
const forcesRow = document.getElementById('forces-row')
const controls = document.getElementById('controls')

function extType (label) {
  const name = String(label || '')
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return 'otros'
  }
  const ext = name.slice(lastDot + 1).toLowerCase()
  if (!ext) return 'otros'
  if (ext === 'mjs' || ext === 'cjs') return 'js'
  if (ext === 'tsx') return 'ts'
  if (ext === 'jsx') return 'js'
  return KNOWN_TYPES.has(ext) ? ext : 'otros'
}

function pathDir (p) {
  if (!p) return ''
  const idx = p.lastIndexOf('/')
  return idx > 0 ? p.slice(0, idx) : ''
}

function pathBase (p) {
  if (!p) return ''
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? (p.slice(idx + 1) || p) : p
}

function commonRoot (nodes, dirs = []) {
  const explicitRoot = (dirs || []).find((d) => (typeof d === 'string' ? false : d?.isRoot))
  if (explicitRoot && explicitRoot.path) return explicitRoot.path
  if (!nodes.length) return ''
  let root = pathDir(nodes[0].path)
  for (const n of nodes) {
    while (root && !n.path.startsWith(root + '/')) {
      const parent = pathDir(root)
      if (!parent || parent === root) break
      root = parent
    }
  }
  return root
}

function buildStructureGraph (nodes, dirs = []) {
  const root = commonRoot(nodes, dirs)
  const folderMap = new Map()
  const ensureFolder = (dirPath) => {
    if (!dirPath || folderMap.has(dirPath)) return
    folderMap.set(dirPath, {
      id: dirPath,
      label: pathBase(dirPath),
      path: dirPath,
      connections: 0,
      type: 'folder',
      isRoot: dirPath === root
    })
  }
  const ensureDirChain = (startDir) => {
    let dir = startDir
    while (dir) {
      if (root && !(dir === root || dir.startsWith(root + '/'))) break
      ensureFolder(dir)
      if (root && dir === root) break
      const parent = pathDir(dir)
      if (!parent || parent === dir) break
      dir = parent
    }
  }

  if (root) ensureFolder(root)
  for (const d of (dirs || [])) {
    const p = typeof d === 'string' ? d : d?.path
    if (!p) continue
    ensureDirChain(p)
  }

  nodes.forEach(n => {
    ensureDirChain(pathDir(n.path) || root)
  })

  const folderNodes = Array.from(folderMap.values())
  const fileNodes = nodes.map((n) => ({ ...n, showLabelAlways: true }))
  const structNodes = [...folderNodes, ...fileNodes]
  const edges = []

  nodes.forEach(n => {
    const parentDir = pathDir(n.path) || root
    if (folderMap.has(parentDir)) edges.push({ source: n.id, target: parentDir })
  })

  folderNodes.forEach(f => {
    if (f.id === root) return
    const parentDir = pathDir(f.id)
    const targetId = folderMap.has(parentDir) ? parentDir : root
    if (targetId && targetId !== f.id) edges.push({ source: f.id, target: targetId })
  })

  return { nodes: structNodes, edges }
}

function pickHotNodeIds (nodes) {
  const files = (nodes || []).filter((n) => n && !n.type)
  if (!files.length) return new Set()
  const now = Date.now()
  const sorted = [...files].sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
  const fresh = sorted.filter((n) => n.mtimeMs && (now - n.mtimeMs) <= 24 * 60 * 60 * 1000)
  const picked = (fresh.length >= 6 ? fresh.slice(0, 120) : sorted.slice(0, 40))
  return new Set(picked.map((n) => n.id))
}

const BINARY_EXTS = new Set([
  'jpg','jpeg','png','gif','webp','bmp','ico','tif','tiff','svgz',
  'pdf','zip','tar','gz','tgz','rar','7z','bz2','xz',
  'mp3','wav','m4a','ogg','flac','aac',
  'mp4','mov','webm','mkv','avi','wmv',
  'exe','dmg','app','pkg','deb','rpm',
  'woff','woff2','ttf','otf','eot',
  'so','dylib','dll','class','jar','o','a',
  'sqlite','db','bin'
])

function isLikelyBinaryByExt (filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  return BINARY_EXTS.has(ext)
}

// Context menu
let graphCtxMenuOpen = false
let graphCtxMenuCloseHandler = null

function closeGraphContextMenu () {
  const menu = document.getElementById('graph-context-menu')
  if (!menu) return
  menu.classList.add('hidden')
  menu.innerHTML = ''
  graphCtxMenuOpen = false
  if (graphCtxMenuCloseHandler) {
    document.removeEventListener('click', graphCtxMenuCloseHandler, true)
    document.removeEventListener('contextmenu', graphCtxMenuCloseHandler, true)
    window.removeEventListener('blur', graphCtxMenuCloseHandler)
    window.removeEventListener('resize', graphCtxMenuCloseHandler)
    graphCtxMenuCloseHandler = null
  }
}

function showGraphContextMenu (node, x, y) {
  try { console.log('[graph-ctx] open', { path: node?.path, type: node?.type, x, y }) } catch {}
  const menu = document.getElementById('graph-context-menu')
  if (!menu) { try { console.warn('[graph-ctx] missing #graph-context-menu element') } catch {}; return }
  if (graphCtxMenuOpen) closeGraphContextMenu()
  menu.innerHTML = ''

  const isFolder = node.type === 'folder'

  if (!isFolder) {
    const openItem = document.createElement('div')
    openItem.className = 'ctx-menu-item'
    openItem.textContent = 'Abrir'
    openItem.addEventListener('click', (e) => {
      e.stopPropagation()
      closeGraphContextMenu()
      openGraphFileModal(node)
    })
    menu.appendChild(openItem)
  } else {
    // Solo carpeta: sin acción (no hay PTY local en standalone)
    const noop = document.createElement('div')
    noop.className = 'ctx-menu-item'
    noop.style.opacity = '0.5'
    noop.textContent = 'Carpeta'
    menu.appendChild(noop)
  }

  menu.classList.remove('hidden')
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rect = menu.getBoundingClientRect()
  const px = Math.min(x, vw - rect.width - 4)
  const py = Math.min(y, vh - rect.height - 4)
  menu.style.left = Math.max(4, px) + 'px'
  menu.style.top = Math.max(4, py) + 'px'

  graphCtxMenuOpen = true
  graphCtxMenuCloseHandler = (ev) => {
    if (ev && ev.target && menu.contains(ev.target)) return
    closeGraphContextMenu()
  }
  setTimeout(() => {
    document.addEventListener('click', graphCtxMenuCloseHandler, true)
    document.addEventListener('contextmenu', graphCtxMenuCloseHandler, true)
    window.addEventListener('blur', graphCtxMenuCloseHandler)
    window.addEventListener('resize', graphCtxMenuCloseHandler)
  }, 0)
}

// File modal
let graphFileModalState = { path: null, originalText: null, editable: false }

async function openGraphFileModal (node) {
  try { console.log('[graph-modal] open', { path: node?.path }) } catch {}
  const modal = document.getElementById('graph-file-modal')
  const title = document.getElementById('graph-file-modal-title')
  const sub = document.getElementById('graph-file-modal-sub')
  const textarea = document.getElementById('graph-file-modal-textarea')
  const notice = document.getElementById('graph-file-modal-notice')
  const saveBtn = document.getElementById('graph-file-modal-save')
  const statusEl = document.getElementById('graph-file-modal-status')
  if (!modal) { try { console.warn('[graph-modal] missing #graph-file-modal element') } catch {}; return }
  if (!node || !node.path) { try { console.warn('[graph-modal] node has no path', node) } catch {}; return }

  title.textContent = node.label || node.path.split('/').pop()
  sub.textContent = node.path
  statusEl.textContent = ''
  textarea.value = ''
  notice.textContent = ''

  graphFileModalState = { path: node.path, originalText: null, editable: false }

  if (isLikelyBinaryByExt(node.path)) {
    textarea.classList.add('hidden')
    notice.textContent = 'No editable (archivo binario)'
    notice.classList.remove('hidden')
    saveBtn.disabled = true
    modal.classList.remove('hidden')
    modal.style.display = 'flex'
    return
  }

  textarea.classList.remove('hidden')
  notice.classList.add('hidden')
  textarea.value = 'Cargando…'
  textarea.disabled = true
  saveBtn.disabled = true
  modal.classList.remove('hidden')

  const res = await window.api.fileRead(node.path)
  if (!res || !res.ok) {
    textarea.classList.add('hidden')
    notice.textContent = 'No editable: ' + (res?.error || 'no se pudo leer')
    notice.classList.remove('hidden')
    return
  }
  if (res.kind === 'image' || res.kind === 'binary') {
    textarea.classList.add('hidden')
    notice.textContent = 'No editable (' + res.kind + ')'
    notice.classList.remove('hidden')
    return
  }

  textarea.disabled = false
  textarea.value = res.text || ''
  saveBtn.disabled = false
  graphFileModalState.originalText = res.text || ''
  graphFileModalState.editable = true
}

function closeGraphFileModal () {
  const modal = document.getElementById('graph-file-modal')
  if (!modal) return
  modal.classList.add('hidden')
  modal.style.display = ''
  graphFileModalState = { path: null, originalText: null, editable: false }
}

document.getElementById('graph-file-modal-close')?.addEventListener('click', closeGraphFileModal)
document.getElementById('graph-file-modal-cancel')?.addEventListener('click', closeGraphFileModal)
document.querySelector('#graph-file-modal .modal-backdrop')?.addEventListener('click', closeGraphFileModal)
document.getElementById('graph-file-modal-save')?.addEventListener('click', async () => {
  if (!graphFileModalState.editable || !graphFileModalState.path) return
  const textarea = document.getElementById('graph-file-modal-textarea')
  const statusEl = document.getElementById('graph-file-modal-status')
  const saveBtn = document.getElementById('graph-file-modal-save')
  const content = textarea.value
  saveBtn.disabled = true
  statusEl.textContent = 'Guardando…'
  const res = await window.api.fileWrite(graphFileModalState.path, content)
  if (res && res.ok) {
    graphFileModalState.originalText = content
    statusEl.textContent = '✓ Guardado'
    saveBtn.disabled = false
    setTimeout(() => { statusEl.textContent = '' }, 2000)
  } else {
    statusEl.textContent = '✗ ' + (res?.error || 'error')
    saveBtn.disabled = false
  }
})

// Search counter helper (refreshed by buildControls; updated externally via runSearch)
let refreshSearchCount = (_idx, _total) => {}

function renderFiltered () {
  let nodes, edges
  let sourceNodes = allNodes
  const activeSet = activeTypesFor(graphMode)
  const applyExtFilter = activeSet.size > 0 && activeSet.size < ALL_TYPES.length
  if (applyExtFilter) {
    sourceNodes = sourceNodes.filter(n => activeSet.has(extType(n.label)))
  }
  if (graphHotOnly) {
    const hotIds = pickHotNodeIds(sourceNodes)
    if (hotIds.size > 0) sourceNodes = sourceNodes.filter((n) => hotIds.has(n.id))
  }
  if (graphMode === 'structure') {
    const allOn = !applyExtFilter
    const dirsArg = allOn ? allDirs : []
    const s = buildStructureGraph(sourceNodes, dirsArg)
    nodes = s.nodes
    edges = s.edges
  } else {
    nodes = sourceNodes
    const ids = new Set(nodes.map(n => n.id))
    edges = allEdges.filter(e => ids.has(e.source) && ids.has(e.target))
  }
  if (graphInstance) { graphInstance.destroy(); graphInstance = null }
  graphInstance = window.GraphRenderer.init(
    graphCanvas,
    { nodes, edges },
    {
      onContextMenu: (node, x, y) => showGraphContextMenu(node, x, y),
      forces: graphForces,
      autoPause: false
    }
  )
  if (graphInstance?.setSpeed) graphInstance.setSpeed(graphSpeedFactor())
  if (graphPaused && graphInstance?.setPaused) graphInstance.setPaused(graphPaused)
  if (graphSearchQuery && graphInstance?.focusByQuery) {
    const info = graphInstance.focusByQuery(graphSearchQuery, {
      resetCycle: true,
      scopeDir: scopeDir || null
    })
    graphSearchNo = Number(info?.total || 0)
    graphSearchIdx = Number(info?.index ?? -1)
    refreshSearchCount(graphSearchIdx, graphSearchNo)
  } else {
    graphSearchNo = 0
    graphSearchIdx = -1
    refreshSearchCount(-1, 0)
  }
}

function adjustCanvasTop () {
  const h = controls.getBoundingClientRect().height
  graphCanvas.style.top = (32 + h) + 'px'
  graphCanvas.style.height = `calc(100% - ${32 + h}px)`
}

function buildControls () {
  modeRow.innerHTML = ''
  ;[['refs', 'Referencias'], ['structure', 'Estructura']].forEach(([mode, label]) => {
    const btn = document.createElement('button')
    btn.className = 'graph-mode-btn' + (graphMode === mode ? ' active' : '')
    btn.textContent = label
    btn.addEventListener('click', () => { graphMode = mode; buildControls(); renderFiltered() })
    modeRow.appendChild(btn)
  })

  const btnForces = document.createElement('button')
  btnForces.className = 'btn-graph-forces' + (forcePanelOpen ? ' active' : '')
  btnForces.textContent = '⚙ Fuerzas'
  btnForces.addEventListener('click', () => { forcePanelOpen = !forcePanelOpen; buildControls() })
  modeRow.appendChild(btnForces)

  const btnHot = document.createElement('button')
  btnHot.className = 'btn-graph-hot' + (graphHotOnly ? ' active' : '')
  btnHot.textContent = '🔥 Calientes'
  btnHot.title = 'Mostrar solo archivos recientes (último día o top más tocados)'
  btnHot.addEventListener('click', () => {
    graphHotOnly = !graphHotOnly
    buildControls()
    renderFiltered()
  })
  modeRow.appendChild(btnHot)

  const btnPause = document.createElement('button')
  btnPause.className = 'btn-graph-pause' + (graphPaused ? ' active' : '')
  btnPause.textContent = graphPaused ? '▶ Reanudar' : '⏸ Pausar'
  btnPause.title = graphPaused ? 'Reanudar movimiento del grafo' : 'Parar movimiento del grafo'
  btnPause.addEventListener('click', () => {
    graphPaused = !graphPaused
    if (graphInstance?.setPaused) graphInstance.setPaused(graphPaused)
    buildControls()
  })
  modeRow.appendChild(btnPause)

  // Slider de velocidad (1-10). Default 5 = factor 0.5.
  const speedWrap = document.createElement('label')
  speedWrap.className = 'graph-speed-wrap'
  speedWrap.title = 'Velocidad de la animación del grafo'
  const speedLbl = document.createElement('span')
  speedLbl.className = 'graph-speed-label'
  speedLbl.textContent = 'Velocidad'
  const speedInput = document.createElement('input')
  speedInput.type = 'range'
  speedInput.className = 'graph-speed-input'
  speedInput.min = '1'
  speedInput.max = '10'
  speedInput.step = '1'
  speedInput.value = String(graphSpeedSlider)
  const speedVal = document.createElement('span')
  speedVal.className = 'graph-speed-val'
  speedVal.textContent = String(graphSpeedSlider)
  speedInput.addEventListener('input', () => {
    const v = Math.max(1, Math.min(10, Number(speedInput.value) || 5))
    graphSpeedSlider = v
    speedVal.textContent = String(v)
    localStorage.setItem('poweragent_graph_speed', String(v))
    if (graphInstance?.setSpeed) graphInstance.setSpeed(graphSpeedFactor())
  })
  speedWrap.append(speedLbl, speedInput, speedVal)
  modeRow.appendChild(speedWrap)

  const searchRow = document.getElementById('search-row')
  if (!searchRow) return
  searchRow.innerHTML = ''
  const searchInput = document.createElement('input')
  searchInput.className = 'graph-search-input'
  searchInput.type = 'search'
  searchInput.placeholder = scopeDir ? 'Buscar en el directorio actual' : 'Buscar por nombre, ruta o palabras'
  searchInput.value = graphSearchQuery
  const btnPrev = document.createElement('button')
  btnPrev.className = 'btn-graph-search-nav'
  btnPrev.type = 'button'
  btnPrev.textContent = '◀'
  btnPrev.title = 'Coincidencia anterior'
  const btnNext = document.createElement('button')
  btnNext.className = 'btn-graph-search-nav'
  btnNext.type = 'button'
  btnNext.textContent = '▶'
  btnNext.title = 'Coincidencia siguiente'
  const countEl = document.createElement('span')
  countEl.id = 'graph-search-count'
  countEl.className = 'graph-search-count'

  refreshSearchCount = (idx, total) => {
    if (total > 0) {
      countEl.textContent = `${idx + 1}/${total}`
      countEl.style.visibility = 'visible'
    } else if (graphSearchQuery) {
      countEl.textContent = '0/0'
      countEl.style.visibility = 'visible'
    } else {
      countEl.textContent = ''
      countEl.style.visibility = 'hidden'
    }
  }

  const runSearch = ({ cycle = false } = {}) => {
    graphSearchQuery = searchInput.value.trim()
    if (!graphInstance) return
    if (!graphSearchQuery) {
      graphSearchNo = 0
      graphSearchIdx = -1
      graphInstance.searchClear?.()
      refreshSearchCount(-1, 0)
      return
    }
    const info = graphInstance.focusByQuery?.(graphSearchQuery, {
      resetCycle: !cycle,
      scopeDir: scopeDir || null,
      step: cycle ? 1 : 0
    }) || null
    graphSearchNo = Number(info?.total || 0)
    graphSearchIdx = Number(info?.index ?? -1)
    refreshSearchCount(graphSearchIdx, graphSearchNo)
  }
  searchInput.addEventListener('input', () => runSearch({ cycle: false }))
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch({ cycle: true }) }
  })
  btnPrev.addEventListener('click', () => {
    if (!graphInstance?.searchPrev) return
    const info = graphInstance.searchPrev()
    graphSearchNo = Number(info?.total || 0)
    graphSearchIdx = Number(info?.index ?? -1)
    refreshSearchCount(graphSearchIdx, graphSearchNo)
  })
  btnNext.addEventListener('click', () => {
    if (!graphInstance?.searchNext) return
    const info = graphInstance.searchNext()
    graphSearchNo = Number(info?.total || 0)
    graphSearchIdx = Number(info?.index ?? -1)
    refreshSearchCount(graphSearchIdx, graphSearchNo)
  })
  searchRow.append(searchInput, btnPrev, btnNext, countEl)
  refreshSearchCount(graphSearchIdx, graphSearchQuery ? graphSearchNo : 0)

  chipsRow.innerHTML = ''
  if (graphMode === 'refs' || graphMode === 'structure') {
    const inactive = graphMode === 'refs' ? refsInactiveTypes : structureInactiveTypes
    const persist = graphMode === 'refs' ? persistRefsInactive : persistStructureInactive
    ALL_TYPES.forEach(type => {
      const chip = document.createElement('button')
      const isActive = !inactive.has(type)
      chip.className = 'graph-chip' + (isActive ? ' active' : '')
      chip.textContent = extLabel(type)
      chip.style.setProperty('--chip-color', colorForExt(type))
      chip.addEventListener('click', () => {
        if (inactive.has(type)) {
          inactive.delete(type)
          chip.classList.add('active')
        } else {
          inactive.add(type)
          chip.classList.remove('active')
        }
        persist()
        renderFiltered()
      })
      chipsRow.appendChild(chip)
    })
  }

  forcesRow.innerHTML = ''
  forcesRow.className = 'graph-forces-panel' + (forcePanelOpen ? ' visible' : '')
  ;[
    ['Repulsión', 'repulsion', -800, -20, 10, v => -v],
    ['Distancia', 'linkDistance', 20, 300, 10, v => v],
    ['Partículas', 'particleSpeed', 500, 10000, 100, v => v],
    ['Compactar', 'compactness', 0, 0.2, 0.005, v => `${Math.round(Number(v) * 100)}%`]
  ].forEach(([label, key, min, max, step, display]) => {
    const row = document.createElement('div')
    row.className = 'graph-force-row'
    const lbl = document.createElement('label')
    lbl.textContent = label
    const input = document.createElement('input')
    input.type = 'range'
    input.min = min; input.max = max; input.step = step
    input.value = graphForces[key]
    const val = document.createElement('span')
    val.textContent = display(graphForces[key])
    input.addEventListener('input', () => {
      graphForces[key] = Number(input.value)
      val.textContent = display(graphForces[key])
      if (graphInstance) graphInstance.setForces(graphForces)
    })
    row.append(lbl, input, val)
    forcesRow.appendChild(row)
  })

  adjustCanvasTop()
}

function shortenCwdPath(p, max = 36) {
  if (!p) return ''
  if (p.length <= max) return p
  const parts = p.split('/')
  if (parts.length <= 3) return '…/' + parts.slice(-2).join('/')
  return '…/' + parts.slice(-2).join('/')
}

async function bootstrapGraphWindow () {
  let data = await window.api.getGraphWindowData()
  const needsFetch = !!(data && data.selfFetch) ||
    !data ||
    (!Array.isArray(data.nodes) || data.nodes.length === 0)
  if (needsFetch) {
    try {
      const loadingEl = document.getElementById('loading')
      if (loadingEl) loadingEl.textContent = 'Calculando grafo del proyecto…'
    } catch {}
    try {
      const fetched = await window.api.fetchGraph(data?.cwd || null)
      if (fetched && fetched.ok) {
        data = {
          ...(data || {}),
          nodes: fetched.nodes || [],
          edges: fetched.edges || [],
          dirs: fetched.dirs || [],
          cwd: fetched.cwd || data?.cwd || ''
        }
      } else if (fetched && !fetched.ok) {
        const loadingEl = document.getElementById('loading')
        if (loadingEl) loadingEl.textContent = 'No se pudo cargar el grafo: ' + (fetched.error || 'error desconocido')
        return
      }
    } catch (err) {
      const loadingEl = document.getElementById('loading')
      if (loadingEl) loadingEl.textContent = 'Error cargando grafo: ' + (err?.message || err)
      return
    }
  }
  const loadingEl = document.getElementById('loading')
  if (loadingEl) loadingEl.remove()
  allNodes = data.nodes || []
  allEdges = data.edges || []
  allDirs = data.dirs || []
  graphMode = data.mode || 'refs'
  // Los arrays vienen como "INACTIVAS" del renderer principal (override del
  // estado persistido en localStorage de esta ventana). Si la ventana padre no
  // los pasa, se mantiene lo que ya leyó esta ventana de localStorage.
  if (Array.isArray(data.activeTypes)) {
    refsInactiveTypes = new Set(data.activeTypes)
  }
  if (Array.isArray(data.structureActiveTypes)) {
    structureInactiveTypes = new Set(data.structureActiveTypes)
  }
  recomputePresentExts(allNodes)
  if (data.forces) graphForces = { ...graphForces, ...data.forces }
  graphSearchQuery = data?.ui?.search ? String(data.ui.search) : ''
  graphHotOnly = !!data?.ui?.hotOnly
  graphPaused = !!data?.ui?.paused
  scopeDir = data?.cwd ? String(data.cwd) : ''
  // Si la ventana padre pasa explícitamente "speed", prevalece sobre el localStorage de esta ventana.
  if (data?.ui && typeof data.ui.speed === 'number') {
    const v = Math.max(1, Math.min(10, Math.round(data.ui.speed)))
    graphSpeedSlider = v
    localStorage.setItem('poweragent_graph_speed', String(v))
  }
  try {
    const lbl = document.getElementById('cwd-label')
    if (lbl && scopeDir) {
      lbl.textContent = 'claude cwd: ' + shortenCwdPath(scopeDir, 32)
      lbl.title = scopeDir
    }
  } catch {}
  buildControls()
  renderFiltered()
}

bootstrapGraphWindow()
