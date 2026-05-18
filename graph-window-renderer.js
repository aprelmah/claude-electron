document.getElementById('btn-close-graph').addEventListener('click', () => window.api.closeWindow())

const ALL_TYPES = ['md', 'js', 'ts', 'json', 'css', 'html', 'py', 'php', 'go', 'otros']
const COLORS_BY_TYPE = { md: '#a78bfa', js: '#fbbf24', ts: '#38bdf8', json: '#34d399', css: '#fb7185', html: '#f97316', py: '#22c55e', php: '#4f7cf5', go: '#06b6d4', otros: '#6b7280' }

let allNodes = [], allEdges = [], allDirs = []
let graphMode = 'refs'
let activeTypes = new Set(ALL_TYPES)
let graphInstance = null
let forcePanelOpen = false
let graphForces = { repulsion: -80, linkDistance: 40, particleSpeed: 4000 }
let graphSearchQuery = ''
let graphSearchNo = 0
let graphHotOnly = false

const graphCanvas = document.getElementById('graph-canvas')
const modeRow = document.getElementById('mode-row')
const chipsRow = document.getElementById('chips-row')
const forcesRow = document.getElementById('forces-row')
const controls = document.getElementById('controls')

function extType (label) {
  const ext = (label.split('.').pop() || '').toLowerCase()
  if (ext === 'mjs' || ext === 'cjs') return 'js'
  return ALL_TYPES.includes(ext) ? ext : 'otros'
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

function renderFiltered () {
  let nodes, edges
  let sourceNodes = allNodes
  if (graphMode === 'refs') {
    sourceNodes = sourceNodes.filter(n => activeTypes.has(extType(n.label)))
  }
  if (graphHotOnly) {
    const hotIds = pickHotNodeIds(sourceNodes)
    if (hotIds.size > 0) sourceNodes = sourceNodes.filter((n) => hotIds.has(n.id))
  }
  if (graphMode === 'structure') {
    const s = buildStructureGraph(sourceNodes, allDirs)
    nodes = s.nodes
    edges = s.edges
  } else {
    nodes = sourceNodes
    const ids = new Set(nodes.map(n => n.id))
    edges = allEdges.filter(e => ids.has(e.source) && ids.has(e.target))
  }
  if (graphInstance) { graphInstance.destroy(); graphInstance = null }
  graphInstance = window.GraphRenderer.init(graphCanvas, { nodes, edges }, { forces: graphForces })
  if (graphSearchQuery && graphInstance?.focusByQuery) {
    const info = graphInstance.focusByQuery(graphSearchQuery, { resetCycle: true })
    graphSearchNo = Number(info?.total || 0)
  } else {
    graphSearchNo = 0
  }
  const sb = document.querySelector('.btn-graph-search')
  if (sb) sb.textContent = graphSearchNo > 0 ? `Buscar (${graphSearchNo})` : 'Buscar'
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

  const searchRow = document.getElementById('search-row')
  if (!searchRow) return
  searchRow.innerHTML = ''
  const searchInput = document.createElement('input')
  searchInput.className = 'graph-search-input'
  searchInput.type = 'search'
  searchInput.placeholder = 'Buscar por nombre, ruta o palabras'
  searchInput.value = graphSearchQuery
  const btnSearch = document.createElement('button')
  btnSearch.className = 'btn-graph-search'
  btnSearch.textContent = graphSearchNo > 0 ? `Buscar (${graphSearchNo})` : 'Buscar'
  const runSearch = ({ cycle = false } = {}) => {
    graphSearchQuery = searchInput.value.trim()
    if (!graphInstance || !graphSearchQuery) {
      graphSearchNo = 0
      btnSearch.textContent = 'Buscar'
      return
    }
    const info = graphInstance.focusByQuery?.(graphSearchQuery, { resetCycle: !cycle }) || null
    graphSearchNo = Number(info?.total || 0)
    btnSearch.textContent = graphSearchNo > 0 ? `Buscar (${graphSearchNo})` : 'Buscar'
  }
  searchInput.addEventListener('input', () => runSearch({ cycle: false }))
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch({ cycle: true }) }
  })
  btnSearch.addEventListener('click', () => runSearch({ cycle: true }))
  searchRow.append(searchInput, btnSearch)

  chipsRow.innerHTML = ''
  if (graphMode === 'refs') {
    ALL_TYPES.forEach(type => {
      const chip = document.createElement('button')
      chip.className = 'graph-chip' + (activeTypes.has(type) ? ' active' : '')
      chip.textContent = type
      chip.style.setProperty('--chip-color', COLORS_BY_TYPE[type])
      chip.addEventListener('click', () => {
        if (activeTypes.has(type)) {
          if (activeTypes.size > 1) activeTypes.delete(type)
        } else {
          activeTypes.add(type)
        }
        chip.classList.toggle('active', activeTypes.has(type))
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
    ['Partículas', 'particleSpeed', 500, 10000, 100, v => v]
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

window.api.getGraphWindowData().then(data => {
  document.getElementById('loading').remove()
  allNodes = data.nodes || []
  allEdges = data.edges || []
  allDirs = data.dirs || []
  graphMode = data.mode || 'refs'
  activeTypes = data.activeTypes ? new Set(data.activeTypes) : new Set(ALL_TYPES)
  if (data.forces) graphForces = { ...graphForces, ...data.forces }
  graphSearchQuery = data?.ui?.search ? String(data.ui.search) : ''
  graphHotOnly = !!data?.ui?.hotOnly
  buildControls()
  renderFiltered()
})
