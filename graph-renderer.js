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
    if (d.isRoot) return 86
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

  function normalizeText (value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  const ROOT_PHOTO_HREF = './assets/graph-root-photo.png'
  const ROOT_PHOTO_SCALE = 4
  const ROOT_PHOTO_RX = 20 * ROOT_PHOTO_SCALE
  const ROOT_PHOTO_RY = 22 * ROOT_PHOTO_SCALE

  function init (svgEl, { nodes, edges }, { onDblClick, onContextMenu, forces = {} } = {}) {
    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    let width = svgEl.clientWidth || 260
    let height = svgEl.clientHeight || 400
    let rafId = null
    let selectedNode = null
    let queryCycle = { q: '', i: -1, matches: [] }
    let activeNode = null
    let activeCircleSel = null
    let activeLabelSel = null
    let activePhase = 0

    const rootForRel = nodes.find((n) => n?.isRoot && n?.path)?.path || ''
    const hoverCard = document.createElement('div')
    hoverCard.style.cssText = [
      'position:fixed',
      'z-index:999999',
      'pointer-events:none',
      'max-width:420px',
      'background:rgba(10,14,22,0.96)',
      'border:1px solid rgba(148,163,184,0.35)',
      'box-shadow:0 8px 30px rgba(0,0,0,0.45)',
      'backdrop-filter:blur(4px)',
      'color:#e5eefb',
      'font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'border-radius:10px',
      'padding:9px 10px',
      'opacity:0',
      'transform:translateY(3px)',
      'transition:opacity .08s linear, transform .08s ease-out',
      'display:none'
    ].join(';')
    document.body.appendChild(hoverCard)

    const escHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

    const relPath = (p) => {
      const s = String(p || '')
      if (!s || !rootForRel) return s
      if (s === rootForRel) return '.'
      return s.startsWith(rootForRel + '/') ? s.slice(rootForRel.length + 1) : s
    }

    const fmtDate = (ms) => {
      if (!ms || Number.isNaN(Number(ms))) return '—'
      try { return new Date(Number(ms)).toLocaleString('es-ES') } catch { return '—' }
    }

    const showHoverCard = (ev, d) => {
      const kind = d.type === 'folder' ? 'Carpeta' : 'Archivo'
      const conn = Number(d.connections || 0)
      const pathText = escHtml(relPath(d.path))
      const fullText = escHtml(d.path || '')
      const title = escHtml(d.label || '')
      const updated = fmtDate(d.mtimeMs)
      hoverCard.innerHTML = [
        `<div style="font-weight:700;color:#f8fbff;margin-bottom:4px;white-space:normal;word-break:break-word">${title}</div>`,
        `<div style="font-size:11px;color:#9fb3d8;margin-bottom:2px">${kind}</div>`,
        `<div style="font-size:11px;color:#d7e5ff;margin-bottom:3px;white-space:normal;word-break:break-word"><b>Ruta:</b> ${pathText}</div>`,
        `<div style="font-size:10px;color:#8fa3c6;margin-bottom:3px;white-space:normal;word-break:break-word">${fullText}</div>`,
        `<div style="font-size:11px;color:#c9daf8"><b>Conexiones:</b> ${conn} · <b>Actualizado:</b> ${escHtml(updated)}</div>`
      ].join('')
      hoverCard.style.display = 'block'
      hoverCard.style.opacity = '1'
      hoverCard.style.transform = 'translateY(0)'
      moveHoverCard(ev)
    }

    const hideHoverCard = () => {
      hoverCard.style.opacity = '0'
      hoverCard.style.transform = 'translateY(3px)'
      hoverCard.style.display = 'none'
    }

    function moveHoverCard (ev) {
      const x = ev?.clientX ?? 0
      const y = ev?.clientY ?? 0
      const vw = window.innerWidth || document.documentElement.clientWidth || 1280
      const vh = window.innerHeight || document.documentElement.clientHeight || 800
      const rect = hoverCard.getBoundingClientRect()
      const gap = 14
      let left = x + gap
      let top = y + gap
      if (left + rect.width > vw - 8) left = x - rect.width - gap
      if (top + rect.height > vh - 8) top = y - rect.height - gap
      if (left < 8) left = 8
      if (top < 8) top = 8
      hoverCard.style.left = `${Math.round(left)}px`
      hoverCard.style.top = `${Math.round(top)}px`
    }

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

    const brainPhotoClip = defs.append('clipPath')
      .attr('id', 'brain-photo-clip')
      .attr('clipPathUnits', 'userSpaceOnUse')
    brainPhotoClip.append('ellipse')
      .attr('cx', 0).attr('cy', 0)
      .attr('rx', ROOT_PHOTO_RX).attr('ry', ROOT_PHOTO_RY)

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
    svg.on('click.deselect', () => { deselect(); hideHoverCard() })
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
    let compactness = forces.compactness ?? 0.06
    let paused = !!forces.paused

    // Nodo raíz fijo en el centro
    nodes.forEach(d => {
      if (d.isRoot) { d.fx = width / 2; d.fy = height / 2 }
    })

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(simEdges).id(d => d.id).distance(linkDistance))
      .force('charge', d3.forceManyBody().strength(repulsion))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(compactness))
      .force('y', d3.forceY(height / 2).strength(compactness))
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
            if (!paused && !e.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
            d3.select(e.sourceEvent.target.closest('.node')).attr('cursor', 'grabbing')
          })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end', (e, d) => {
            if (!paused && !e.active) sim.alphaTarget(0)
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
      .attr('fill', d => d.isRoot ? 'transparent' : (nodeColor(d) + '2a'))
      .attr('stroke', d => d.isRoot ? 'none' : nodeColor(d))
      .attr('stroke-width', d => d.isRoot ? 0 : (d.type === 'folder' ? 1.5 : 1))
      .attr('filter', d => d.isRoot ? null : `url(#${glowIdForNode(d)})`)

    // Nodo protagonista: cerebro frontal luminoso (más fiel a referencia)
    const rootBrain = nodeG.filter(d => d.isRoot).append('g')
      .attr('class', 'root-brain')
      .attr('pointer-events', 'none')

    rootBrain.append('image')
      .attr('href', ROOT_PHOTO_HREF)
      .attr('xlink:href', ROOT_PHOTO_HREF)
      .attr('x', -ROOT_PHOTO_RX).attr('y', -ROOT_PHOTO_RY)
      .attr('width', ROOT_PHOTO_RX * 2).attr('height', ROOT_PHOTO_RY * 2)
      .attr('preserveAspectRatio', 'xMidYMid slice')
      .attr('clip-path', 'url(#brain-photo-clip)')
      .attr('opacity', 0.98)

    const brainShape = rootBrain.append('g')
      .attr('transform', `translate(0,${-2 * ROOT_PHOTO_SCALE}) scale(${1.12 * ROOT_PHOTO_SCALE})`)
      .attr('opacity', 0)

    brainShape.append('path')
      .attr('d', 'M0,-20 C-8.6,-20 -15.8,-15 -17.6,-8.2 C-19.4,-2.3 -18.8,4 -15.4,9.1 C-12.4,13.5 -7.8,16.6 -3.2,17.6 L-3.1,19.8 C-3,22.1 -1.8,24 0,24.4 C1.8,24 3,22.1 3.1,19.8 L3.2,17.6 C7.8,16.6 12.4,13.5 15.4,9.1 C18.8,4 19.4,-2.3 17.6,-8.2 C15.8,-15 8.6,-20 0,-20 Z')
      .attr('fill', 'url(#brain-grad)')
      .attr('stroke', '#dff7ff')
      .attr('stroke-width', 1.25)
      .attr('stroke-opacity', 0.95)

    brainShape.append('path')
      .attr('d', 'M0,-18.5 C-0.8,-15.6 -0.8,-12.8 0,-10 C0.8,-7.4 0.8,-4.4 0,-1.8 C-0.7,0.8 -0.7,3.8 0,6.3 C0.7,8.8 0.7,11.8 0,14.6')
      .attr('fill', 'none')
      .attr('stroke', '#f3feff')
      .attr('stroke-width', 1.05)
      .attr('stroke-opacity', 0.92)

    const gyri = [
      'M-12.8,-7.8 C-14.3,-12 -9.8,-16.1 -5.7,-13.8 C-2.8,-12.1 -2.9,-8.1 -6.2,-6.6',
      'M-12.2,1 C-14.2,-2.4 -11.7,-7.2 -7.5,-7 C-3.9,-6.9 -2.5,-2.7 -5.4,0.2',
      'M-9.8,8.6 C-11.8,5.8 -10.7,2 -6.9,1.3 C-3.2,0.7 -1.4,4.3 -3.8,7',
      'M12.8,-7.8 C14.3,-12 9.8,-16.1 5.7,-13.8 C2.8,-12.1 2.9,-8.1 6.2,-6.6',
      'M12.2,1 C14.2,-2.4 11.7,-7.2 7.5,-7 C3.9,-6.9 2.5,-2.7 5.4,0.2',
      'M9.8,8.6 C11.8,5.8 10.7,2 6.9,1.3 C3.2,0.7 1.4,4.3 3.8,7'
    ]
    for (const d of gyri) {
      brainShape.append('path')
        .attr('d', d)
        .attr('fill', 'none')
        .attr('stroke', '#ecfeff')
        .attr('stroke-opacity', 0.86)
        .attr('stroke-width', 0.95)
    }

    brainShape.append('path')
      .attr('d', 'M-2.1,24.1 C-2.1,28.1 -1.8,31.2 0,33 C1.8,31.2 2.1,28.1 2.1,24.1')
      .attr('fill', 'rgba(218,247,255,0.84)')
      .attr('stroke', '#dff7ff')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.8)

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
      if (d.type !== 'folder' && d.connections < 3 && !d.showLabelAlways) {
        d3.select(this).select('.node-label').attr('display', 'none')
      }
    })

    // Hover: agrandar y glow fuerte
    nodeG
      .on('mouseenter', function (e, d) {
        showHoverCard(e, d)
        d3.select(this).select('.node-circle')
          .interrupt()
          .transition().duration(120).ease(d3.easeCubicOut)
          .attr('r', hoverRadius(d))
          .attr('filter', 'url(#glow-strong)')
        d3.select(this).select('.node-label').attr('display', null)
      })
      .on('mousemove', function (e) {
        moveHoverCard(e)
      })
      .on('mouseleave', function (e, d) {
        hideHoverCard()
        if (activeNode && d.id === activeNode.id) return
        d3.select(this).select('.node-circle')
          .interrupt()
          .transition().duration(140).ease(d3.easeCubicOut)
          .attr('r', nodeRadius(d))
          .attr('filter', () => `url(#${glowIdForNode(d)})`)
        if (d.type !== 'folder' && d.connections < 3 && !d.showLabelAlways && d !== selectedNode) {
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
    let brainPhase = 0
    let prevAnimTs = Date.now()

    function animateParticles () {
      if (paused) {
        rafId = null
        return
      }
      const now = Date.now()
      const dt = Math.max(0, now - prevAnimTs)
      prevAnimTs = now
      brainPhase += dt * 0.0035
      activePhase += dt * 0.014
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
      const bob = Math.sin(brainPhase) * 1.25
      const tilt = Math.sin(brainPhase * 0.72) * 4.8
      const pulse = 1 + Math.sin(brainPhase * 0.55) * 0.035
      rootBrain.attr('transform', `translate(0,${bob.toFixed(2)}) rotate(${tilt.toFixed(2)}) scale(${pulse.toFixed(3)})`)

      if (activeNode && activeCircleSel) {
        const base = nodeRadius(activeNode)
        const beat = Math.max(0, Math.sin(activePhase))
        const glowR = base * (1 + 0.34 * beat)
        activeCircleSel
          .attr('r', glowR)
          .attr('filter', 'url(#glow-strong)')
          .attr('stroke-width', 2.2 + beat * 1.4)
      }
      rafId = requestAnimationFrame(animateParticles)
    }

    function startAnimationLoop () {
      if (rafId != null || paused) return
      prevAnimTs = Date.now()
      rafId = requestAnimationFrame(animateParticles)
    }

    function stopAnimationLoop () {
      if (rafId == null) return
      cancelAnimationFrame(rafId)
      rafId = null
    }

    function setPaused (nextPaused) {
      const p = !!nextPaused
      if (p === paused) return paused
      paused = p
      if (paused) {
        sim.stop()
        stopAnimationLoop()
      } else {
        sim.alpha(0.42).restart()
        startAnimationLoop()
      }
      return paused
    }

    if (paused) {
      sim.stop()
      stopAnimationLoop()
    } else {
      startAnimationLoop()
    }

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
      if (activeNode && activeCircleSel) {
        activeCircleSel.attr('filter', 'url(#glow-strong)')
        if (activeLabelSel) activeLabelSel.attr('display', null)
      }
    }

    function markActivePath (filePath) {
      const node = nodes.find((n) => n.path === filePath)
      if (!node) return false

      if (activeNode && activeNode.id !== node.id && activeCircleSel) {
        activeCircleSel
          .interrupt()
          .attr('r', nodeRadius(activeNode))
          .attr('stroke-width', activeNode.isRoot ? 1.8 : (activeNode.type === 'folder' ? 1.5 : 1))
          .attr('filter', `url(#${glowIdForNode(activeNode)})`)
      }

      activeNode = node
      activePhase = 0
      activeCircleSel = nodeG.filter((d) => d.id === node.id).select('.node-circle')
      activeLabelSel = nodeG.filter((d) => d.id === node.id).select('.node-label')
      if (activeLabelSel) activeLabelSel.attr('display', null)
      if (activeCircleSel) {
        activeCircleSel
          .interrupt()
          .attr('filter', 'url(#glow-strong)')
          .attr('stroke-width', 2.5)
      }
      return true
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
      const qRaw = String(query || '').trim()
      const q = normalizeText(qRaw)
      if (!q) {
        queryCycle = { q: '', i: -1, matches: [] }
        return { total: 0, index: -1, node: null }
      }
      const terms = q.split(/\s+/).filter(Boolean)
      const matches = nodes.filter((n) => {
        const hay = normalizeText(`${n.label || ''} ${n.path || ''}`)
        return terms.every((term) => hay.includes(term))
      })
      if (!matches.length) {
        queryCycle = { q, i: -1, matches: [] }
        return { total: 0, index: -1, node: null }
      }
      let idx = 0
      const sameMatchSet = queryCycle.matches.length === matches.length &&
        queryCycle.matches.every((n, i) => n.id === matches[i].id)
      if (!resetCycle && queryCycle.q === q && sameMatchSet) {
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
      sim.force('x', d3.forceX(width / 2).strength(compactness))
      sim.force('y', d3.forceY(height / 2).strength(compactness))
      if (!paused) sim.alpha(0.3).restart()
    })
    ro.observe(svgEl)

    return {
      destroy () {
        stopAnimationLoop()
        sim.stop()
        ro.disconnect()
        try { hoverCard.remove() } catch {}
        svg.selectAll('*').remove()
      },
      focusByQuery,
      markActivePath,
      setPaused,
      pulseNode (filePath) {
        const node = nodes.find(n => n.path === filePath)
        if (!node || node.x == null) return
        markActivePath(filePath)

        // Pulso inmediato adicional sobre el latido persistente
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
            .attr('stroke-width', activeNode && activeNode.id === node.id ? 2.4 : (node.isRoot ? 1.8 : (node.type === 'folder' ? 1.5 : 1)))
            .attr('filter', () => (activeNode && activeNode.id === node.id) ? 'url(#glow-strong)' : `url(#${glowIdForNode(node)})`)

        // Label siempre visible durante el pulso
        nodeG.filter(d => d.id === node.id).select('.node-label').attr('display', null)
      },
      setForces ({ repulsion: r, linkDistance: d, particleSpeed: p, compactness: c }) {
        if (r !== undefined) {
          repulsion = r
          sim.force('charge', d3.forceManyBody().strength(repulsion))
        }
        if (d !== undefined) {
          linkDistance = d
          sim.force('link', d3.forceLink(simEdges).id(n => n.id).distance(linkDistance))
        }
        if (p !== undefined) particleSpeed = p
        if (c !== undefined) {
          compactness = c
          sim.force('x', d3.forceX(width / 2).strength(compactness))
          sim.force('y', d3.forceY(height / 2).strength(compactness))
        }
        if (!paused) sim.alpha(0.4).restart()
      }
    }
  }

  window.GraphRenderer = { init }
})()
