# Graph View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir una vista de grafo conmutable en el sidebar de POWER-AGENT — D3 force simulation con glassmorphism, glow SVG, partículas en aristas y física flotante tipo Obsidian.

**Architecture:** IPC handler en main.js parsea el filesystem (wikilinks + imports) y devuelve `{ nodes, edges }`. El renderer alterna entre `#tree` y `#graph-canvas` (SVG). `graph-renderer.js` contiene todo el motor D3 independiente, expuesto como `window.GraphRenderer`.

**Tech Stack:** Electron 28+, D3 v7 (npm local), SVG, `requestAnimationFrame` para partículas.

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `main.js` | Modificar (después de línea 1611) | IPC handler `sidebar:get-graph` |
| `preload.js` | Modificar (final del objeto) | Exponer `sidebarGetGraph()` |
| `index.html` | Modificar (sidebar-header + scripts) | Botones toggle + `#graph-canvas` + script D3 |
| `graph-renderer.js` | Crear | Motor D3: nodos, física, glow, partículas |
| `renderer.js` | Modificar (tras declaraciones iniciales) | Toggle árbol/grafo + init graph |
| `styles.css` | Modificar (final del archivo) | Estilos grafo, toggle buttons, fondo |

---

## Task 1: Instalar D3 y añadir IPC handler `sidebar:get-graph` en main.js

**Files:**
- Modify: `package.json` (npm install)
- Modify: `main.js` (después de línea 1611, tras el handler `fs-read-dir`)

- [ ] **Step 1: Instalar D3**

```bash
cd /Users/isabel/Desktop/LUISMI/claude-electron
npm install d3
```

Verificar que aparece en `node_modules/d3/dist/d3.min.js`.

- [ ] **Step 2: Añadir el IPC handler en main.js**

Insertar justo después de la línea `1611` (cierre del handler `fs-read-dir`), antes del handler `fs-pick-folder`:

```js
ipcMain.handle('sidebar:get-graph', (event, rootPath) => {
  if (!rootPath) return { ok: false, error: 'no rootPath' }

  const SKIP = new Set(['.DS_Store', '.git', 'node_modules', '.next', '.cache',
    '__pycache__', '.venv', 'venv', 'dist', 'build', '.idea', '.vscode', 'coverage'])
  const BIN_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.dmg', '.app', '.zip', '.tar', '.gz', '.pdf', '.ttf', '.woff', '.woff2',
    '.eot', '.mp3', '.mp4', '.wav', '.ogg', '.db', '.sqlite'])

  const allFiles = []

  function walk(dir, depth) {
    if (depth > 5) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (!BIN_EXTS.has(ext)) allFiles.push(full)
      }
    }
  }

  walk(rootPath, 0)

  const fileByBasename = new Map()
  for (const f of allFiles) {
    const base = path.basename(f, path.extname(f)).toLowerCase()
    if (!fileByBasename.has(base)) fileByBasename.set(base, f)
  }

  const connectionCount = new Map(allFiles.map(f => [f, 0]))
  const edges = []

  for (const filePath of allFiles) {
    let content
    try { content = fs.readFileSync(filePath, 'utf8') } catch { continue }
    const ext = path.extname(filePath).toLowerCase()

    if (ext === '.md') {
      const re = /\[\[([^\]|#]+?)(?:[|#][^\]]+)?\]\]/g
      let m
      while ((m = re.exec(content)) !== null) {
        const target = m[1].trim().toLowerCase()
        const targetFile = fileByBasename.get(target) ||
          fileByBasename.get(target.split('/').pop())
        if (targetFile && targetFile !== filePath) {
          edges.push({ source: filePath, target: targetFile })
          connectionCount.set(filePath, (connectionCount.get(filePath) || 0) + 1)
          connectionCount.set(targetFile, (connectionCount.get(targetFile) || 0) + 1)
        }
      }
    }

    if (['.js', '.ts', '.mjs', '.cjs'].includes(ext)) {
      const re = /(?:import\s+(?:[^'"]+?\s+from\s+)?|require\s*\(\s*)['"](\.[^'"]+)['"]/g
      let m
      while ((m = re.exec(content)) !== null) {
        let targetFile = path.resolve(path.dirname(filePath), m[1])
        if (!path.extname(targetFile)) {
          for (const tryExt of ['.js', '.ts', '.mjs', '/index.js', '/index.ts']) {
            if (allFiles.includes(targetFile + tryExt)) {
              targetFile = targetFile + tryExt
              break
            }
          }
        }
        if (allFiles.includes(targetFile) && targetFile !== filePath) {
          edges.push({ source: filePath, target: targetFile })
          connectionCount.set(filePath, (connectionCount.get(filePath) || 0) + 1)
          connectionCount.set(targetFile, (connectionCount.get(targetFile) || 0) + 1)
        }
      }
    }
  }

  const edgeSet = new Set()
  const uniqueEdges = edges.filter(e => {
    const key = [e.source, e.target].sort().join('|||')
    if (edgeSet.has(key)) return false
    edgeSet.add(key)
    return true
  })

  const nodes = allFiles.map(f => ({
    id: f,
    label: path.basename(f),
    path: f,
    connections: connectionCount.get(f) || 0
  }))

  return { ok: true, nodes, edges: uniqueEdges }
})
```

- [ ] **Step 3: Verificar que main.js no tiene errores de sintaxis**

```bash
node --check /Users/isabel/Desktop/LUISMI/claude-electron/main.js
```

Expected: sin output (sin errores).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json main.js
git commit -m "feat(graph): instalar D3 + IPC handler sidebar:get-graph"
```

---

## Task 2: Exponer `sidebarGetGraph` en preload.js

**Files:**
- Modify: `preload.js` (antes del cierre `})`  del objeto, línea 62)

- [ ] **Step 1: Añadir la exposición del handler**

En `preload.js`, antes del cierre del objeto (`})` en la línea 62), añadir:

```js
  sidebarGetGraph: (rootPath) => ipcRenderer.invoke('sidebar:get-graph', rootPath),
```

El resultado final de las últimas líneas del objeto debe quedar:

```js
  onTaskRunFinished: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('tasks:run-finished', h)
    return () => ipcRenderer.removeListener('tasks:run-finished', h)
  },

  sidebarGetGraph: (rootPath) => ipcRenderer.invoke('sidebar:get-graph', rootPath),
})
```

- [ ] **Step 2: Verificar sintaxis**

```bash
node --check /Users/isabel/Desktop/LUISMI/claude-electron/preload.js
```

Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add preload.js
git commit -m "feat(graph): exponer sidebarGetGraph en preload"
```

---

## Task 3: Modificar index.html — botones toggle + #graph-canvas + script D3

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Añadir botones toggle en el sidebar-header**

Localizar el bloque `<div id="sidebar-header">` (líneas 65-78). Añadir los botones de toggle dentro de `<div class="side-actions">`, justo antes del cierre `</div>` de ese div:

```html
      <div id="sidebar-header">
        <span id="sidebar-title" title="">Explorador</span>
        <div class="side-actions">
          <button id="btn-view-tree" class="icon-btn small active" title="Vista árbol">
            <svg viewBox="0 0 24 24" width="14" height="14"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </button>
          <button id="btn-view-graph" class="icon-btn small" title="Vista grafo">
            <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="3"/><circle cx="3" cy="6" r="2"/><circle cx="21" cy="6" r="2"/><circle cx="3" cy="18" r="2"/><circle cx="21" cy="18" r="2"/><line x1="5" y1="7" x2="10" y2="10"/><line x1="19" y1="7" x2="14" y2="10"/><line x1="5" y1="17" x2="10" y2="14"/><line x1="19" y1="17" x2="14" y2="14"/></svg>
          </button>
          <button id="btn-work-here" class="icon-btn small" title="Reiniciar Claude en esta carpeta">
            <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>
          </button>
          <button id="btn-open-folder" class="icon-btn small" title="Abrir otra carpeta">
            <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button id="btn-refresh-tree" class="icon-btn small" title="Recargar árbol">
            <svg viewBox="0 0 24 24"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Añadir `#graph-canvas` justo después de `#tree`**

Localizar `<div id="tree"></div>` (línea 79). Reemplazarlo por:

```html
      <div id="tree"></div>
      <svg id="graph-canvas" class="hidden"></svg>
```

- [ ] **Step 3: Añadir script de D3 y graph-renderer antes de `</body>`**

Al final del body, antes de `</body>`, añadir (después de todos los scripts existentes si los hay, o antes del cierre del body):

```html
  <script src="node_modules/d3/dist/d3.min.js"></script>
  <script src="graph-renderer.js"></script>
```

- [ ] **Step 4: Verificar que el HTML abre sin error en el editor**

```bash
node --check /Users/isabel/Desktop/LUISMI/claude-electron/renderer.js
```

Expected: sin errores (verifica que renderer.js sigue siendo válido antes de tocarlo).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(graph): añadir toggle árbol/grafo y #graph-canvas en sidebar"
```

---

## Task 4: Crear graph-renderer.js

**Files:**
- Create: `graph-renderer.js`

- [ ] **Step 1: Crear el archivo**

```js
;(function () {
  const COLORS = {
    md:      '#a78bfa',
    js:      '#fbbf24',
    ts:      '#38bdf8',
    mjs:     '#fbbf24',
    cjs:     '#fbbf24',
    json:    '#34d399',
    css:     '#fb7185',
    html:    '#f97316',
    default: '#6b7280'
  }

  function nodeColor (label) {
    const ext = (label.split('.').pop() || '').toLowerCase()
    return COLORS[ext] || COLORS.default
  }

  function nodeRadius (connections) {
    return Math.max(6, Math.min(18, 6 + connections * 1.5))
  }

  function init (svgEl, { nodes, edges }, { onDblClick } = {}) {
    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    let width = svgEl.clientWidth || 260
    let height = svgEl.clientHeight || 400
    let rafId = null
    let selectedNode = null

    // ── Defs: filtros glow ──────────────────────────────────────────────
    const defs = svg.append('defs')
    Object.entries(COLORS).forEach(([key, color]) => {
      const f = defs.append('filter')
        .attr('id', `glow-${key}`)
        .attr('x', '-50%').attr('y', '-50%')
        .attr('width', '200%').attr('height', '200%')
      f.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
      const merge = f.append('feMerge')
      merge.append('feMergeNode').attr('in', 'blur')
      merge.append('feMergeNode').attr('in', 'SourceGraphic')
    })

    // Filtro glow fuerte (selección)
    const fStrong = defs.append('filter')
      .attr('id', 'glow-strong')
      .attr('x', '-100%').attr('y', '-100%')
      .attr('width', '300%').attr('height', '300%')
    fStrong.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur')
    const ms = fStrong.append('feMerge')
    ms.append('feMergeNode').attr('in', 'blur')
    ms.append('feMergeNode').attr('in', 'SourceGraphic')

    // ── Fondo ───────────────────────────────────────────────────────────
    svg.append('rect')
      .attr('width', '100%').attr('height', '100%')
      .attr('fill', '#050508')

    // Nebulosa sutil en el centro
    const radGrad = defs.append('radialGradient')
      .attr('id', 'nebula')
      .attr('cx', '50%').attr('cy', '50%').attr('r', '50%')
    radGrad.append('stop').attr('offset', '0%').attr('stop-color', '#0d0d1a')
    radGrad.append('stop').attr('offset', '100%').attr('stop-color', '#050508')

    svg.append('ellipse')
      .attr('cx', width / 2).attr('cy', height / 2)
      .attr('rx', width * 0.6).attr('ry', height * 0.5)
      .attr('fill', 'url(#nebula)')

    // ── Grupo principal (zoom/pan) ──────────────────────────────────────
    const g = svg.append('g')

    const zoom = d3.zoom()
      .scaleExtent([0.08, 4])
      .on('zoom', e => g.attr('transform', e.transform))

    svg.call(zoom)
    svg.on('click.deselect', () => deselect())

    // ── Clonar edges con refs de objeto para D3 ─────────────────────────
    // D3 forceLink mutará source/target a objetos — clonar para no corromper los originales
    const nodeById = new Map(nodes.map(n => [n.id, n]))
    const simEdges = edges.map(e => ({
      source: nodeById.get(e.source) || e.source,
      target: nodeById.get(e.target) || e.target
    }))

    // ── Simulación ──────────────────────────────────────────────────────
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(simEdges).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(d => nodeRadius(d.connections) + 10))

    // ── Capa de aristas ─────────────────────────────────────────────────
    const linkSel = g.append('g').attr('class', 'links')
      .selectAll('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', d => nodeColor(d.source.label || ''))
      .attr('stroke-opacity', 0.22)
      .attr('stroke-width', 1.2)

    // ── Partículas ──────────────────────────────────────────────────────
    const particleSel = g.append('g').attr('class', 'particles')
      .selectAll('circle')
      .data(simEdges)
      .join('circle')
      .attr('r', 2)
      .attr('fill', d => nodeColor(d.source.label || ''))
      .attr('opacity', 0.75)

    // ── Nodos ───────────────────────────────────────────────────────────
    const nodeG = g.append('g').attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('cursor', 'grab')
      .call(
        d3.drag()
          .on('start', (e, d) => {
            if (!e.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
            d3.select(e.sourceEvent.target.closest('.node')).attr('cursor', 'grabbing')
          })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end', (e, d) => {
            if (!e.active) sim.alphaTarget(0)
            d3.select(e.sourceEvent.target.closest('.node')).attr('cursor', 'grab')
          })
      )
      .on('click', (e, d) => { e.stopPropagation(); selectNode(d) })
      .on('dblclick', (e, d) => { e.stopPropagation(); onDblClick?.(d.path) })

    nodeG.append('circle')
      .attr('class', 'node-circle')
      .attr('r', d => nodeRadius(d.connections))
      .attr('fill', d => nodeColor(d.label) + '2a')
      .attr('stroke', d => nodeColor(d.label))
      .attr('stroke-width', 1)
      .attr('filter', d => {
        const ext = (d.label.split('.').pop() || '').toLowerCase()
        return `url(#glow-${COLORS[ext] ? ext : 'default'})`
      })

    nodeG.append('text')
      .attr('class', 'node-label')
      .text(d => d.label)
      .attr('y', d => nodeRadius(d.connections) + 11)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-family', 'system-ui, sans-serif')
      .attr('fill', 'rgba(255,255,255,0.55)')
      .attr('pointer-events', 'none')

    // Ocultar labels en nodos con pocas conexiones (se muestran en hover/zoom)
    nodeG.each(function (d) {
      if (d.connections < 3) d3.select(this).select('.node-label').attr('display', 'none')
    })

    // Hover
    nodeG
      .on('mouseenter', function (e, d) {
        d3.select(this).select('.node-circle')
          .attr('r', nodeRadius(d.connections) * 1.3)
          .attr('filter', 'url(#glow-strong)')
        d3.select(this).select('.node-label').attr('display', null)
      })
      .on('mouseleave', function (e, d) {
        d3.select(this).select('.node-circle')
          .attr('r', nodeRadius(d.connections))
          .attr('filter', () => {
            const ext = (d.label.split('.').pop() || '').toLowerCase()
            return `url(#glow-${COLORS[ext] ? ext : 'default'})`
          })
        if (d.connections < 3 && d !== selectedNode) {
          d3.select(this).select('.node-label').attr('display', 'none')
        }
      })

    // ── Tick ────────────────────────────────────────────────────────────
    sim.on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      nodeG.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    // ── Loop de partículas (independiente de la sim) ─────────────────────
    const PARTICLE_SPEED = 4000

    function animateParticles () {
      const now = Date.now()
      particleSel.each(function (d, i) {
        const sx = d.source.x, sy = d.source.y
        const tx = d.target.x, ty = d.target.y
        if (sx == null || tx == null) return
        const t = ((now + i * 1337) % PARTICLE_SPEED) / PARTICLE_SPEED
        d3.select(this)
          .attr('cx', sx + (tx - sx) * t)
          .attr('cy', sy + (ty - sy) * t)
      })
      rafId = requestAnimationFrame(animateParticles)
    }
    animateParticles()

    // ── Selección / deselección ──────────────────────────────────────────
    function selectNode (d) {
      selectedNode = d
      const connectedIds = new Set()
      connectedIds.add(d.id)
      simEdges.forEach(e => {
        if (e.source.id === d.id || e.target.id === d.id) {
          connectedIds.add(e.source.id)
          connectedIds.add(e.target.id)
        }
      })
      nodeG.attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.05)
      nodeG.filter(n => n.id === d.id).select('.node-circle')
        .attr('filter', 'url(#glow-strong)')
      linkSel.attr('stroke-opacity', e =>
        e.source.id === d.id || e.target.id === d.id ? 0.9 : 0)
      particleSel.attr('opacity', e =>
        e.source.id === d.id || e.target.id === d.id ? 1 : 0)
    }

    function deselect () {
      selectedNode = null
      nodeG.attr('opacity', 1)
      nodeG.selectAll('.node-circle').attr('filter', function (d) {
        const ext = (d.label.split('.').pop() || '').toLowerCase()
        return `url(#glow-${COLORS[ext] ? ext : 'default'})`
      })
      linkSel.attr('stroke-opacity', 0.22)
      particleSel.attr('opacity', 0.75)
    }

    // ── Resize ───────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      width = svgEl.clientWidth
      height = svgEl.clientHeight
      sim.force('center', d3.forceCenter(width / 2, height / 2))
      sim.alpha(0.3).restart()
    })
    ro.observe(svgEl)

    return {
      destroy () {
        cancelAnimationFrame(rafId)
        sim.stop()
        ro.disconnect()
        svg.selectAll('*').remove()
      }
    }
  }

  window.GraphRenderer = { init }
})()
```

- [ ] **Step 2: Verificar que el archivo existe**

```bash
ls /Users/isabel/Desktop/LUISMI/claude-electron/graph-renderer.js
```

- [ ] **Step 3: Commit**

```bash
git add graph-renderer.js
git commit -m "feat(graph): motor D3 — glassmorphism, glow SVG, partículas animadas"
```

---

## Task 5: Modificar renderer.js — lógica toggle + inicializar graph

**Files:**
- Modify: `renderer.js`

- [ ] **Step 1: Añadir referencias a los nuevos elementos**

Localizar el bloque de declaraciones de constantes al principio de `renderer.js` (líneas 14-28 aprox). Añadir después de las declaraciones de `sidebar`, `treeEl`, etc.:

```js
const graphCanvas = document.getElementById('graph-canvas')
const btnViewTree = document.getElementById('btn-view-tree')
const btnViewGraph = document.getElementById('btn-view-graph')
```

- [ ] **Step 2: Añadir la lógica de toggle árbol/grafo**

Añadir este bloque después de las declaraciones anteriores (antes de los event listeners):

```js
// ── Toggle árbol / grafo ─────────────────────────────────────────────────
let graphInstance = null
let currentView = localStorage.getItem('poweragent.sidebar.view') || 'tree'

function applyView (view) {
  currentView = view
  localStorage.setItem('poweragent.sidebar.view', view)

  if (view === 'graph') {
    treeEl.classList.add('hidden')
    graphCanvas.classList.remove('hidden')
    btnViewTree.classList.remove('active')
    btnViewGraph.classList.add('active')
    loadGraph()
  } else {
    graphCanvas.classList.add('hidden')
    treeEl.classList.remove('hidden')
    btnViewTree.classList.add('active')
    btnViewGraph.classList.remove('active')
    if (graphInstance) { graphInstance.destroy(); graphInstance = null }
  }
}

async function loadGraph () {
  if (graphInstance) { graphInstance.destroy(); graphInstance = null }
  const rootPath = sidebarRoot || await window.api.ptyCwd()
  if (!rootPath) return
  const result = await window.api.sidebarGetGraph(rootPath)
  if (!result.ok) return
  if (currentView !== 'graph') return
  graphInstance = window.GraphRenderer.init(
    graphCanvas,
    { nodes: result.nodes, edges: result.edges },
    { onDblClick: (filePath) => injectToPty(`@${filePath} `) }
  )
}

btnViewTree.addEventListener('click', () => applyView('tree'))
btnViewGraph.addEventListener('click', () => applyView('graph'))
```

- [ ] **Step 3: Recargar el grafo al cambiar de carpeta**

Localizar la función donde se actualiza `sidebarRoot` cuando el usuario abre una nueva carpeta (alrededor de la línea 468, donde se hace `sidebarTitle.textContent = newRoot...`). Después de esa actualización añadir:

```js
  if (currentView === 'graph') loadGraph()
```

- [ ] **Step 4: Recargar el grafo al pulsar btn-refresh-tree**

Localizar el listener de `btnRefreshTree`. Añadir al final de su handler:

```js
  if (currentView === 'graph') loadGraph()
```

- [ ] **Step 5: Aplicar la vista guardada al arrancar**

Al final del bloque de inicialización (cerca del final del archivo, cuando la app ya está lista), añadir:

```js
applyView(currentView)
```

- [ ] **Step 6: Verificar sintaxis**

```bash
node --check /Users/isabel/Desktop/LUISMI/claude-electron/renderer.js
```

Expected: sin output.

- [ ] **Step 7: Commit**

```bash
git add renderer.js
git commit -m "feat(graph): toggle árbol/grafo + loadGraph en renderer.js"
```

---

## Task 6: Estilos en styles.css

**Files:**
- Modify: `styles.css` (añadir al final)

- [ ] **Step 1: Añadir estilos al final de styles.css**

```css
/* ── Graph view ─────────────────────────────────────────────────────── */

#graph-canvas {
  width: 100%;
  flex: 1;
  display: block;
  background: #050508;
  cursor: default;
  user-select: none;
}

#graph-canvas.hidden {
  display: none;
}

#tree.hidden {
  display: none;
}

/* Botones toggle árbol/grafo */
#btn-view-tree,
#btn-view-graph {
  opacity: 0.45;
  transition: opacity 0.15s, color 0.15s;
}

#btn-view-tree.active,
#btn-view-graph.active {
  opacity: 1;
  color: var(--accent, #7c6ff7);
}

#btn-view-tree:not(.active):hover,
#btn-view-graph:not(.active):hover {
  opacity: 0.75;
}

/* Labels SVG de los nodos */
.node-label {
  transition: opacity 0.15s;
}
```

- [ ] **Step 2: Verificar que styles.css sigue siendo CSS válido**

```bash
node -e "require('fs').readFileSync('/Users/isabel/Desktop/LUISMI/claude-electron/styles.css','utf8'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat(graph): estilos de vista grafo y botones toggle"
```

---

## Task 7: Verificación manual en la app

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Arrancar la app**

```bash
npm run start
```

- [ ] **Step 2: Verificar el toggle**

- En el sidebar-header aparecen dos nuevos iconos pequeños (árbol y grafo).
- Al pulsar el icono de grafo, el árbol desaparece y aparece el canvas negro.
- Al pulsar árbol, vuelve el árbol.

- [ ] **Step 3: Verificar el grafo con un proyecto con archivos**

- Abrir la carpeta del propio proyecto (`/Users/isabel/Desktop/LUISMI/claude-electron`).
- Pulsar el icono de grafo.
- Deben aparecer nodos flotando con física.
- Los `.js` en ámbar, los `.md` en violeta, los `.json` en verde.
- Los nodos se mueven y se estabilizan.
- Las partículas viajan por las aristas.

- [ ] **Step 4: Verificar interacción**

- Click en un nodo → el resto se atenúa.
- Click en el fondo → todo vuelve a opacidad normal.
- Doble click en un nodo → la ruta aparece en el terminal precedida de `@`.
- Drag de un nodo → se mueve y queda fijo donde se suelta.
- Rueda del ratón → zoom.
- Drag en el fondo → pan.

- [ ] **Step 5: Commit final si todo OK**

```bash
git add -A
git commit -m "feat(graph): graph view funcional — D3 force, glassmorphism, partículas"
```

---

## Notas de implementación

- `sidebarRoot`: la variable que guarda el directorio actual del sidebar en `renderer.js`. Si el nombre real es diferente, buscar con `grep -n "sidebarRoot\|rootPath\|currentRoot" renderer.js | head -20` y ajustar las referencias en Task 5.
- El handler `sidebar:get-graph` es síncrono (readFileSync) pero corre en el main process, no bloquea el renderer.
- Para proyectos muy grandes (>500 archivos), el grafo puede tardar 1-2s en cargar — aceptable.
- Los nodos sin conexiones (archivos aislados) aparecen igualmente en el grafo, flotando solos.
