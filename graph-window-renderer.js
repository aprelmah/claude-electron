document.getElementById('btn-close-graph').addEventListener('click', () => window.api.closeWindow())

const ALL_TYPES = ['md', 'js', 'ts', 'json', 'css', 'html', 'otros']
const COLORS_BY_TYPE = { md: '#a78bfa', js: '#fbbf24', ts: '#38bdf8', json: '#34d399', css: '#fb7185', html: '#f97316', otros: '#6b7280' }

let allNodes = [], allEdges = []
let graphMode = 'refs'
let activeTypes = new Set(ALL_TYPES)
let graphInstance = null

const graphCanvas = document.getElementById('graph-canvas')
const modeRow = document.getElementById('mode-row')
const chipsRow = document.getElementById('chips-row')
const controls = document.getElementById('controls')

function extType (label) {
  const ext = (label.split('.').pop() || '').toLowerCase()
  if (ext === 'mjs' || ext === 'cjs') return 'js'
  return ALL_TYPES.includes(ext) ? ext : 'otros'
}

function commonRoot (nodes) {
  if (!nodes.length) return ''
  const parts = nodes[0].path.split('/')
  let root = parts.slice(0, parts.length - 1).join('/')
  for (const n of nodes) {
    while (!n.path.startsWith(root + '/') && root.length > 1) {
      root = root.substring(0, root.lastIndexOf('/'))
    }
  }
  return root
}

function buildStructureGraph (nodes) {
  const root = commonRoot(nodes)
  const folderMap = new Map()
  if (root) folderMap.set(root, { id: root, label: root.split('/').pop() || root, path: root, connections: 0, type: 'folder' })

  nodes.forEach(n => {
    let dir = n.path ? n.path.substring(0, n.path.lastIndexOf('/')) : root
    while (dir && dir.length >= root.length) {
      if (!folderMap.has(dir)) {
        folderMap.set(dir, { id: dir, label: dir.split('/').pop(), path: dir, connections: 0, type: 'folder' })
      }
      if (dir === root) break
      dir = dir.substring(0, dir.lastIndexOf('/'))
    }
  })

  const folderNodes = Array.from(folderMap.values())
  const structNodes = [...folderNodes, ...nodes]
  const edges = []

  nodes.forEach(n => {
    const parentDir = n.path ? n.path.substring(0, n.path.lastIndexOf('/')) : root
    if (folderMap.has(parentDir)) edges.push({ source: n.id, target: parentDir })
  })

  folderNodes.forEach(f => {
    if (f.id === root) return
    const parentDir = f.id.substring(0, f.id.lastIndexOf('/'))
    const targetId = folderMap.has(parentDir) ? parentDir : root
    if (targetId !== f.id) edges.push({ source: f.id, target: targetId })
  })

  return { nodes: structNodes, edges }
}

function renderFiltered () {
  let nodes, edges
  if (graphMode === 'structure') {
    const s = buildStructureGraph(allNodes)
    nodes = s.nodes
    edges = s.edges
  } else {
    nodes = allNodes.filter(n => activeTypes.has(extType(n.label)))
    const ids = new Set(nodes.map(n => n.id))
    edges = allEdges.filter(e => ids.has(e.source) && ids.has(e.target))
  }
  if (graphInstance) { graphInstance.destroy(); graphInstance = null }
  graphInstance = window.GraphRenderer.init(graphCanvas, { nodes, edges }, {})
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
    btn.addEventListener('click', () => {
      graphMode = mode
      buildControls()
      renderFiltered()
    })
    modeRow.appendChild(btn)
  })

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

  adjustCanvasTop()
}

window.api.getGraphWindowData().then(data => {
  document.getElementById('loading').remove()
  allNodes = data.nodes || []
  allEdges = data.edges || []
  graphMode = data.mode || 'refs'
  activeTypes = data.activeTypes ? new Set(data.activeTypes) : new Set(ALL_TYPES)
  buildControls()
  renderFiltered()
})
