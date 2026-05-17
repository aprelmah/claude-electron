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

  function init (svgEl, { nodes, edges }, { onDblClick, onContextMenu, forces = {} } = {}) {
    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    let width = svgEl.clientWidth || 260
    let height = svgEl.clientHeight || 400
    let rafId = null
    let selectedNode = null

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
      .attr('fill', d => nodeColor(d) + '2a')
      .attr('stroke', d => nodeColor(d))
      .attr('stroke-width', d => d.type === 'folder' ? 1.5 : 1)
      .attr('filter', d => {
        if (d.type === 'folder') return 'url(#glow-folder)'
        const ext = (d.label.split('.').pop() || '').toLowerCase()
        const glowKey = (ext === 'mjs' || ext === 'cjs') ? 'js' : ext
        return `url(#glow-${COLORS[glowKey] ? glowKey : 'default'})`
      })

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
          .attr('filter', () => {
            if (d.type === 'folder') return 'url(#glow-folder)'
            const ext = (d.label.split('.').pop() || '').toLowerCase()
            const glowKey = (ext === 'mjs' || ext === 'cjs') ? 'js' : ext
            return `url(#glow-${COLORS[glowKey] ? glowKey : 'default'})`
          })
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

    function animateParticles () {
      const now = Date.now()
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
        if (d.type === 'folder') {
          d3.select(this).attr('filter', 'url(#glow-folder)')
          return
        }
        const ext = (d.label.split('.').pop() || '').toLowerCase()
        const glowKey = (ext === 'mjs' || ext === 'cjs') ? 'js' : ext
        d3.select(this).attr('filter', `url(#glow-${COLORS[glowKey] ? glowKey : 'default'})`)
      })
      linkSel.attr('stroke-opacity', 0.22)
      particleSel.attr('opacity', 0.75)
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
            .attr('stroke-width', node.type === 'folder' ? 1.5 : 1)
            .attr('filter', () => {
              if (node.type === 'folder') return 'url(#glow-folder)'
              const ext = (node.label.split('.').pop() || '').toLowerCase()
              const glowKey = (ext === 'mjs' || ext === 'cjs') ? 'js' : ext
              return `url(#glow-${COLORS[glowKey] ? glowKey : 'default'})`
            })

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
