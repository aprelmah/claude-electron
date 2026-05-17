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
    py:      '#22c55e',
    php:     '#4f7cf5',
    go:      '#06b6d4',
    folder:  '#94a3b8',
    default: '#6b7280'
  }

  function nodeColor (d) {
    if (d.type === 'folder') return COLORS.folder
    const ext = (d.label.split('.').pop() || '').toLowerCase()
    return COLORS[ext] || COLORS.default
  }

  function nodeRadius (d) {
    if (d.isRoot) return 22
    if (d.type === 'folder') return 14
    return Math.max(6, Math.min(18, 6 + d.connections * 1.5))
  }

  function hoverRadius (d) {
    const base = nodeRadius(d)
    if (d.isRoot) return base * 1.12
    if (d.type === 'folder') return base * 1.28
    if (base <= 8) return base * 2.15
    if (base <= 11) return base * 1.75
    if (base <= 14) return base * 1.45
    return base * 1.25
  }

  function glowIdForNode (d) {
    if (d.isRoot) return 'glow-brain'
    if (d.type === 'folder') return 'glow-folder'
    const ext = (d.label.split('.').pop() || '').toLowerCase()
    const glowKey = (ext === 'mjs' || ext === 'cjs') ? 'js' : ext
    return `glow-${COLORS[glowKey] ? glowKey : 'default'}`
  }

  function init (svgEl, { nodes, edges }, { onDblClick, onContextMenu, forces = {} } = {}) {
    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    let width = svgEl.clientWidth || 260
    let height = svgEl.clientHeight || 400
    let rafId = null
    let selectedNode = null
    let queryCycle = { q: '', i: -1, matches: [] }

    // Defs: filtros glow por tipo de archivo
    const defs = svg.append('defs')
    Object.entries(COLORS).forEach(([key]) => {
      const f = defs.append('filter')
        .attr('id', `glow-${key}`)
        .attr('x', '-50%').attr('y', '-50%')
        .attr('width', '200%').attr('height', '200%')
      f.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
      const merge = f.append('feMerge')
      merge.append('feMergeNode').attr('in', 'blur')
      merge.append('feMergeNode').attr('in', 'SourceGraphic')
    })

    // Filtro glow fuerte para selección y hover
    const fStrong = defs.append('filter')
      .attr('id', 'glow-strong')
      .attr('x', '-100%').attr('y', '-100%')
      .attr('width', '300%').attr('height', '300%')
    fStrong.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur')
    const ms = fStrong.append('feMerge')
    ms.append('feMergeNode').attr('in', 'blur')
    ms.append('feMergeNode').attr('in', 'SourceGraphic')

    const fBrain = defs.append('filter')
      .attr('id', 'glow-brain')
      .attr('x', '-90%').attr('y', '-90%')
      .attr('width', '280%').attr('height', '280%')
    fBrain.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur')
    const mb = fBrain.append('feMerge')
    mb.append('feMergeNode').attr('in', 'blur')
    mb.append('feMergeNode').attr('in', 'SourceGraphic')

    const brainGrad = defs.append('radialGradient')
      .attr('id', 'brain-grad')
      .attr('cx', '50%').attr('cy', '42%').attr('r', '60%')
    brainGrad.append('stop').attr('offset', '0%').attr('stop-color', '#e7fbff').attr('stop-opacity', 0.95)
    brainGrad.append('stop').attr('offset', '100%').attr('stop-color', '#8acbe0').attr('stop-opacity', 0.4)

    // Gradiente nebulosa en el centro
    const radGrad = defs.append('radialGradient')
      .attr('id', 'nebula')
      .attr('cx', '50%').attr('cy', '50%').attr('r', '50%')
    radGrad.append('stop').attr('offset', '0%').attr('stop-color', '#0d0d1a')
    radGrad.append('stop').attr('offset', '100%').attr('stop-color', '#050508')

    // Fondo
    svg.append('rect')
      .attr('width', '100%').attr('height', '100%')
      .attr('fill', '#050508')

    svg.append('ellipse')
      .attr('cx', width / 2).attr('cy', height / 2)
      .attr('rx', width * 0.6).attr('ry', height * 0.5)
      .attr('fill', 'url(#nebula)')

    // Grupo principal para zoom/pan
    const g = svg.append('g')

    const zoom = d3.zoom()
      .scaleExtent([0.08, 4])
      .on('zoom', e => g.attr('transform', e.transform))

    svg.call(zoom)
    svg.on('dblclick.zoom', null)
    svg.on('click.deselect', () => deselect())
    let _dblClickState = 'fit' // alterna entre 'fit' y 'root'
    svg.on('dblclick.reset', (e) => {
      if (e.target.closest && e.target.closest('.node')) return
      if (_dblClickState === 'fit') {
        // Fit-to-bounds: ver todos los nodos
        const xs = nodes.map(d => d.x).filter(x => x != null)
        const ys = nodes.map(d => d.y).filter(y => y != null)
        if (!xs.length) return
        const pad = 60
        const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad
        const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
        const scale = Math.min(width / (maxX - minX), height / (maxY - minY), 2)
        const tx = width / 2 - scale * (minX + maxX) / 2
        const ty = height / 2 - scale * (minY + maxY) / 2
        svg.transition().duration(700).ease(d3.easeCubicOut)
          .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
        _dblClickState = 'root'
      } else {
        // Zoom al nodo raíz centrado
        const root = nodes.find(d => d.isRoot)
        const k = 1.4
        const tx = root ? width / 2 - k * root.x : width / 2
        const ty = root ? height / 2 - k * root.y : height / 2
        svg.transition().duration(700).ease(d3.easeCubicOut)
          .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k))
        _dblClickState = 'fit'
      }
    })

    // Clonar edges con refs de objeto para que D3 forceLink pueda mutar source/target
    const nodeById = new Map(nodes.map(n => [n.id, n]))
    const simEdges = edges.map(e => ({
      source: nodeById.get(e.source) || e.source,
      target: nodeById.get(e.target) || e.target
    }))

    // Simulación D3 force
    let repulsion = forces.repulsion ?? -220
    let linkDistance = forces.linkDistance ?? 80

    // Nodo raíz fijo en el centro
    nodes.forEach(d => {
      if (d.isRoot) { d.fx = width / 2; d.fy = height / 2 }
    })

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(simEdges).id(d => d.id).distance(linkDistance))
      .force('charge', d3.forceManyBody().strength(repulsion))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(d => nodeRadius(d) + 10))

    // Capa de aristas
    const linkSel = g.append('g').attr('class', 'links')
      .selectAll('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', d => nodeColor(d.source))
      .attr('stroke-opacity', 0.22)
      .attr('stroke-width', 1.2)

    // Partículas que viajan por las aristas
    const particleSel = g.append('g').attr('class', 'particles')
      .selectAll('circle')
      .data(simEdges)
      .join('circle')
      .attr('r', 2)
      .attr('fill', d => nodeColor(d.source))
      .attr('opacity', 0.75)
      .attr('pointer-events', 'none')

    // Nodos
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
            d.fx = d.x
            d.fy = d.y
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
      .on('contextmenu', (e, d) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(d, e.clientX, e.clientY)
      })

    nodeG.append('circle')
      .attr('class', 'node-circle')
      .attr('r', d => nodeRadius(d))
      .attr('fill', d => d.isRoot ? 'rgba(170, 236, 255, 0.08)' : (nodeColor(d) + '2a'))
      .attr('stroke', d => d.isRoot ? '#c6f4ff' : nodeColor(d))
      .attr('stroke-width', d => d.isRoot ? 1.8 : (d.type === 'folder' ? 1.5 : 1))
      .attr('filter', d => `url(#${glowIdForNode(d)})`)

    // Nodo protagonista: cerebro luminoso girando
    const rootBrain = nodeG.filter(d => d.isRoot).append('g')
      .attr('class', 'root-brain')
      .attr('pointer-events', 'none')
      .attr('filter', 'url(#glow-brain)')

    rootBrain.append('ellipse')
      .attr('cx', 0).attr('cy', 0).attr('rx', 17).attr('ry', 14)
      .attr('fill', 'url(#brain-grad)')
      .attr('stroke', '#dff7ff')
      .attr('stroke-opacity', 0.95)
      .attr('stroke-width', 1.2)

    rootBrain.append('line')
      .attr('x1', 0).attr('y1', -13).attr('x2', 0).attr('y2', 14)
      .attr('stroke', '#dff7ff')
      .attr('stroke-opacity', 0.75)
      .attr('stroke-width', 1)

    const gyri = [
      'M-13,-2 C-16,-8 -10,-13 -6,-10 C-2,-8 -4,-3 -8,-1',
      'M-10,4 C-14,1 -12,-6 -6,-6 C-2,-6 -1,0 -5,3',
      'M-2,-11 C-6,-9 -6,-4 -2,-2 C1,-1 2,-5 1,-8',
      'M8,-10 C5,-8 5,-3 9,-1 C13,1 13,-5 11,-8',
      'M11,3 C7,0 8,-6 13,-6 C16,-5 17,0 14,3',
      'M3,9 C0,7 0,3 4,2 C8,1 9,5 7,8',
      'M-5,9 C-8,7 -8,3 -4,2 C0,1 1,5 -1,8'
    ]
    gyri.forEach((d) => {
      rootBrain.append('path')
        .attr('d', d)
        .attr('fill', 'none')
        .attr('stroke', '#ecfeff')
        .attr('stroke-opacity', 0.88)
        .attr('stroke-width', 1)
    })

    rootBrain.append('path')
      .attr('d', 'M0,14 L0,23')
      .attr('fill', 'none')
      .attr('stroke', '#d2f3ff')
      .attr('stroke-opacity', 0.85)
      .attr('stroke-width', 1.2)

    nodeG.append('text')
      .attr('class', 'node-label')
      .text(d => d.label)
      .attr('y', d => nodeRadius(d) + 11)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-family', 'system-ui, sans-serif')
      .attr('fill', 'rgba(255,255,255,0.55)')
      .attr('pointer-events', 'none')

    // Ocultar labels en nodos con pocas conexiones (carpetas siempre visibles)
    nodeG.each(function (d) {
      if (d.type !== 'folder' && d.connections < 3) d3.select(this).select('.node-label').attr('display', 'none')
    })

    // Hover: agrandar y glow fuerte
    nodeG
      .on('mouseenter', function (e, d) {
        d3.select(this).select('.node-circle')
          .interrupt()
          .transition().duration(120).ease(d3.easeCubicOut)
          .attr('r', hoverRadius(d))
          .attr('filter', 'url(#glow-strong)')
        d3.select(this).select('.node-label').attr('display', null)
      })
      .on('mouseleave', function (e, d) {
        d3.select(this).select('.node-circle')
          .interrupt()
          .transition().duration(140).ease(d3.easeCubicOut)
          .attr('r', nodeRadius(d))
          .attr('filter', () => `url(#${glowIdForNode(d)})`)
        if (d.type !== 'folder' && d.connections < 3 && d !== selectedNode) {
          d3.select(this).select('.node-label').attr('display', 'none')
        }
      })

    // Tick de la simulación: actualiza posiciones
    sim.on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
      nodeG.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    // Loop de animación de partículas independiente de la simulación
    let particleSpeed = forces.particleSpeed ?? 4000
    let brainAngle = 0
    let prevAnimTs = Date.now()

    function animateParticles () {
      const now = Date.now()
      const dt = Math.max(0, now - prevAnimTs)
      prevAnimTs = now
      brainAngle = (brainAngle + dt * 0.018) % 360
      particleSel.each(function (d, i) {
        const sx = d.source.x
        const sy = d.source.y
        const tx = d.target.x
        const ty = d.target.y
        if (sx == null || tx == null) return
        const t = ((now + i * 1337) % particleSpeed) / particleSpeed
        d3.select(this)
          .attr('cx', sx + (tx - sx) * t)
          .attr('cy', sy + (ty - sy) * t)
      })
      rootBrain.attr('transform', `rotate(${brainAngle})`)
      rafId = requestAnimationFrame(animateParticles)
    }
    animateParticles()

    // Selección: atenúa todo excepto el nodo y sus vecinos
    function selectNode (d) {
      selectedNode = d
      const connectedIds = new Set([d.id])
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

    // Deselección: restaura opacidades normales
    function deselect () {
      selectedNode = null
      nodeG.attr('opacity', 1)
      nodeG.selectAll('.node-circle').each(function (d) {
        d3.select(this).attr('filter', `url(#${glowIdForNode(d)})`)
      })
      linkSel.attr('stroke-opacity', 0.22)
      particleSel.attr('opacity', 0.75)
    }

    function focusNode (node, scale = null) {
      if (!node || node.x == null || node.y == null) return false
      selectNode(node)
      const currentK = d3.zoomTransform(svgEl).k
      const k = scale != null ? scale : Math.max(currentK, 1.25)
      svg.transition().duration(560).ease(d3.easeCubicOut)
        .call(zoom.transform, d3.zoomIdentity
          .translate(width / 2 - k * node.x, height / 2 - k * node.y)
          .scale(k))
      nodeG.filter(d => d.id === node.id).select('.node-label').attr('display', null)
      return true
    }

    function focusByQuery (query, { resetCycle = false } = {}) {
      const q = String(query || '').trim().toLowerCase()
      if (!q) {
        queryCycle = { q: '', i: -1, matches: [] }
        return { total: 0, index: -1, node: null }
      }
      const matches = nodes.filter((n) => {
        const label = String(n.label || '').toLowerCase()
        const p = String(n.path || '').toLowerCase()
        return label.includes(q) || p.includes(q)
      })
      if (!matches.length) {
        queryCycle = { q, i: -1, matches: [] }
        return { total: 0, index: -1, node: null }
      }
      let idx = 0
      if (!resetCycle && queryCycle.q === q && queryCycle.matches.length === matches.length) {
        idx = (queryCycle.i + 1) % matches.length
      }
      queryCycle = { q, i: idx, matches }
      const node = matches[idx]
      focusNode(node)
      return { total: matches.length, index: idx, node }
    }

    // ResizeObserver para adaptar el grafo al tamaño del sidebar
    const ro = new ResizeObserver(() => {
      width = svgEl.clientWidth
      height = svgEl.clientHeight
      nodes.forEach(d => { if (d.isRoot) { d.fx = width / 2; d.fy = height / 2 } })
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
      },
      focusByQuery,
      pulseNode (filePath) {
        const node = nodes.find(n => n.path === filePath)
        if (!node || node.x == null) return

        // Zoom suave hacia el nodo
        const k = Math.max(d3.zoomTransform(svgEl).k, 1.2)
        svg.transition().duration(900).ease(d3.easeCubicOut)
          .call(zoom.transform, d3.zoomIdentity
            .translate(width / 2 - k * node.x, height / 2 - k * node.y)
            .scale(k))

        // Pulso: escala → glow fuerte → vuelta a normal
        const r = nodeRadius(node)
        const circle = nodeG.filter(d => d.id === node.id).select('.node-circle')
        circle.interrupt()
          .transition().duration(220).ease(d3.easeBackOut)
            .attr('r', r * 3.2)
            .attr('filter', 'url(#glow-strong)')
            .attr('stroke-width', 2.5)
          .transition().duration(350)
            .attr('r', r * 1.8)
          .transition().duration(700).ease(d3.easeCubicInOut)
            .attr('r', r)
            .attr('stroke-width', node.isRoot ? 1.8 : (node.type === 'folder' ? 1.5 : 1))
            .attr('filter', () => `url(#${glowIdForNode(node)})`)

        // Label siempre visible durante el pulso
        nodeG.filter(d => d.id === node.id).select('.node-label').attr('display', null)
      },
      setForces ({ repulsion: r, linkDistance: d, particleSpeed: p }) {
        if (r !== undefined) {
          repulsion = r
          sim.force('charge', d3.forceManyBody().strength(repulsion))
        }
        if (d !== undefined) {
          linkDistance = d
          sim.force('link', d3.forceLink(simEdges).id(n => n.id).distance(linkDistance))
        }
        if (p !== undefined) particleSpeed = p
        sim.alpha(0.4).restart()
      }
    }
  }

  window.GraphRenderer = { init }
})()
