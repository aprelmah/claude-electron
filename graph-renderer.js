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
    if (d.isRoot) return ROOT_REACTOR_RADIUS
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
    if (d.isRoot) return 'glow-reactor'
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

  const ROOT_REACTOR_RADIUS = 18 * 3

  function init (svgEl, { nodes, edges }, { onDblClick, onContextMenu, forces = {}, autoPause = false, autoPauseDelay = 2500, onAutoPause = null } = {}) {
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

    const fReactor = defs.append('filter')
      .attr('id', 'glow-reactor')
      .attr('x', '-120%').attr('y', '-120%')
      .attr('width', '340%').attr('height', '340%')
    fReactor.append('feGaussianBlur').attr('stdDeviation', '4.8').attr('result', 'blur')
    const mr = fReactor.append('feMerge')
    mr.append('feMergeNode').attr('in', 'blur')
    mr.append('feMergeNode').attr('in', 'SourceGraphic')

    const fReactorSoft = defs.append('filter')
      .attr('id', 'glow-reactor-soft')
      .attr('x', '-120%').attr('y', '-120%')
      .attr('width', '340%').attr('height', '340%')
    fReactorSoft.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur')
    const mrs = fReactorSoft.append('feMerge')
    mrs.append('feMergeNode').attr('in', 'blur')
    mrs.append('feMergeNode').attr('in', 'SourceGraphic')

    const reactorCoreGrad = defs.append('radialGradient')
      .attr('id', 'reactor-core-grad')
      .attr('cx', '48%').attr('cy', '42%').attr('r', '62%')
    reactorCoreGrad.append('stop').attr('offset', '0%').attr('stop-color', '#102843').attr('stop-opacity', 1)
    reactorCoreGrad.append('stop').attr('offset', '62%').attr('stop-color', '#0a1630').attr('stop-opacity', 0.98)
    reactorCoreGrad.append('stop').attr('offset', '100%').attr('stop-color', '#060d1f').attr('stop-opacity', 0.98)

    const reactorInnerGrad = defs.append('radialGradient')
      .attr('id', 'reactor-inner-grad')
      .attr('cx', '54%').attr('cy', '44%').attr('r', '68%')
    reactorInnerGrad.append('stop').attr('offset', '0%').attr('stop-color', '#7cf2ff').attr('stop-opacity', 0.95)
    reactorInnerGrad.append('stop').attr('offset', '50%').attr('stop-color', '#9a9cff').attr('stop-opacity', 0.58)
    reactorInnerGrad.append('stop').attr('offset', '100%').attr('stop-color', '#ff8fd6').attr('stop-opacity', 0.14)

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
      target: nodeById.get(e.target) || e.target,
      // F-hier: preservar kind para que el worker aplique distance/strength por tipo.
      kind: e.kind || 'reference'
    }))

    // Simulación D3 force → ahora corre en Web Worker.
    // El main thread solo recibe posiciones y dibuja. Mantiene refs locales a nodos/edges
    // para que el render (linkSel, nodeG) siga leyendo n.x/n.y como antes.
    let repulsion = forces.repulsion ?? -220
    let linkDistance = forces.linkDistance ?? 80
    let compactness = forces.compactness ?? 0.06
    let paused = !!forces.paused

    // Nodo raíz fijo en el centro (en main, para fit/zoom y consistencia).
    nodes.forEach(d => {
      if (d.isRoot) { d.fx = width / 2; d.fy = height / 2 }
    })

    // Posición inicial razonable antes del primer tick del worker.
    nodes.forEach((d, i) => {
      if (d.x == null || d.y == null) {
        const a = i * 0.5
        d.x = width / 2 + Math.cos(a) * 50
        d.y = height / 2 + Math.sin(a) * 50
      }
    })

    // — Wrapper del worker (API equivalente a d3.forceSimulation usada por el render) —
    let workerIds = []
    let workerIndexById = new Map()
    let workerEnded = true
    const sim = createSimWorker()

    function createSimWorker () {
      const w = new Worker('graph-worker.js')
      const handlers = []
      let wDisposed = false
      // Errores del worker (p.ej. fallo al cargar). Loguear y dejar
      // workerEnded=true para que el renderer no se quede esperando ticks.
      w.onerror = (e) => {
        try { console.error('[graph-worker] error', e?.message || e) } catch {}
        workerEnded = true
      }
      w.onmessageerror = () => { workerEnded = true }
      w.onmessage = (ev) => {
        // Defensa anti-race: tras dispose() pueden seguir llegando mensajes
        // en cola del worker (init-ack/tick) antes de que el terminate surta efecto.
        // Ignorarlos evita aplicar posiciones a un grafo ya destruido.
        if (wDisposed) return
        const m = ev.data || {}
        if (m.type === 'init-ack') {
          workerIds = m.ids || []
          workerIndexById = new Map(workerIds.map((id, i) => [id, i]))
        } else if (m.type === 'tick') {
          workerEnded = false
          applyPositions(m.positions)
          handlers.forEach(fn => fn())
        } else if (m.type === 'end') {
          workerEnded = true
        }
      }

      function applyPositions (buf) {
        // buf: Float32Array [x0,y0,x1,y1,...] alineado con workerIds
        for (let i = 0; i < workerIds.length; i++) {
          const n = nodeById.get(workerIds[i])
          if (!n) continue
          n.x = buf[i * 2]
          n.y = buf[i * 2 + 1]
        }
      }

      // Estado interno (mock alpha para drag start/end semántica)
      let alphaTargetVal = 0
      let alphaVal = 0.6
      // Último factor de velocidad aplicado. Se reenvía al worker tras init
      // para sobrevivir a rebuilds internos (setForces rehace fuerzas).
      let lastSpeedFactor = null

      const api = {
        _worker: w,
        on (event, fn) {
          if (event === 'tick') handlers.push(fn)
          return api
        },
        stop () { if (wDisposed) return api; w.postMessage({ type: 'pause' }); return api },
        restart () { if (wDisposed) return api; w.postMessage({ type: 'resume', alpha: alphaVal }); return api },
        alpha (v) {
          if (v === undefined) return alphaVal
          alphaVal = +v
          if (wDisposed) return api
          w.postMessage({ type: 'reheat', alpha: alphaVal })
          return api
        },
        alphaTarget (v) {
          if (v === undefined) return alphaTargetVal
          alphaTargetVal = +v
          if (wDisposed) return api
          // Solo "reheat" si se sube el target (drag start). Bajar a 0 no debe reiniciar.
          w.postMessage({ type: 'alphaTarget', target: alphaTargetVal, restart: alphaTargetVal > 0 })
          return api
        },
        force (name, force) {
          // Compat shim para llamadas legacy: convertimos a setForces.
          // Solo nos importa interceptar lo que el caller usa.
          if (force == null) return undefined
          if (wDisposed) return api
          if (name === 'charge' && typeof force.strength === 'function') {
            const s = force.strength()
            w.postMessage({ type: 'setForces', repulsion: typeof s === 'number' ? s : repulsion })
          } else if (name === 'link') {
            const dist = typeof force.distance === 'function' ? force.distance() : linkDistance
            w.postMessage({ type: 'setForces', linkDistance: typeof dist === 'number' ? dist : linkDistance })
          } else if (name === 'x' || name === 'y') {
            const s = typeof force.strength === 'function' ? force.strength() : compactness
            w.postMessage({ type: 'setForces', compactness: typeof s === 'number' ? s : compactness })
          } else if (name === 'center') {
            // No-op: el worker recalcula center con setSize.
          }
          return api
        },
        setForcesDirect (patch) {
          if (wDisposed) return api
          w.postMessage({ type: 'setForces', ...patch })
          // setForces rebuilda fuerzas internas; reaplicar velocidad para no perderla.
          if (lastSpeedFactor != null) {
            w.postMessage({ type: 'setSpeed', factor: lastSpeedFactor })
          }
          return api
        },
        setSpeed (factor) {
          if (wDisposed) return api
          const f = Math.max(0.1, Math.min(1, Number(factor) || 1))
          lastSpeedFactor = f
          w.postMessage({ type: 'setSpeed', factor: f })
          return api
        },
        setSize (w_, h_) {
          if (wDisposed) return api
          w.postMessage({ type: 'setSize', width: w_, height: h_ })
          return api
        },
        setRootFixed (id) {
          if (wDisposed) return api
          w.postMessage({ type: 'setRootFixed', id })
          return api
        },
        dragStart (id) { if (wDisposed) return api; w.postMessage({ type: 'dragStart', id }); return api },
        drag (id, x, y) { if (wDisposed) return api; w.postMessage({ type: 'drag', id, x, y }); return api },
        dragEnd (id, keepFixed) { if (wDisposed) return api; w.postMessage({ type: 'dragEnd', id, keepFixed: !!keepFixed }); return api },
        dispose () {
          if (wDisposed) return
          wDisposed = true
          // Notificar al worker para que pare la sim y cierre self antes de terminate().
          // Si postMessage falla (worker ya muerto), seguimos a terminate igual.
          try { w.postMessage({ type: 'dispose' }) } catch {}
          // Limpiar handlers: si terminate tarda un microtask y entra un mensaje
          // en cola, no debe ejecutarse nada.
          try { w.onmessage = null } catch {}
          try { w.onerror = null } catch {}
          try { w.onmessageerror = null } catch {}
          handlers.length = 0
          try { w.terminate() } catch {}
        },
        isDisposed () { return wDisposed },
        init () {
          const initNodes = nodes.map(n => ({
            id: n.id,
            isRoot: !!n.isRoot,
            x: n.x,
            y: n.y,
            fx: n.fx,
            fy: n.fy,
            radiusPad: nodeRadius(n),
            // F-hier: parentId propaga al worker para forceCluster.
            parentId: n.parentId || null
          }))
          const initEdges = simEdges.map(e => ({
            source: typeof e.source === 'object' ? e.source.id : e.source,
            target: typeof e.target === 'object' ? e.target.id : e.target,
            // F-hier: kind propaga al worker para distance/strength por tipo.
            kind: e.kind || 'reference'
          }))
          w.postMessage({
            type: 'init',
            nodes: initNodes,
            edges: initEdges,
            width,
            height,
            forces: { repulsion, linkDistance, compactness },
            alpha: 0.6,
            speedFactor: lastSpeedFactor != null ? lastSpeedFactor : undefined
          })
        }
      }
      return api
    }

    sim.init()
    if (paused) sim.stop()

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
            else if (paused) sim.alpha(0.3).restart()
            d.fx = d.x
            d.fy = d.y
            sim.dragStart(d.id)
            d3.select(e.sourceEvent.target.closest('.node')).attr('cursor', 'grabbing')
          })
          .on('drag', (e, d) => {
            d.fx = e.x
            d.fy = e.y
            sim.drag(d.id, e.x, e.y)
          })
          .on('end', (e, d) => {
            if (!paused && !e.active) sim.alphaTarget(0)
            // Liberar nodo (no mantener fijo tras drag), excepto root.
            if (!d.isRoot) {
              d.fx = null
              d.fy = null
              sim.dragEnd(d.id, false)
            } else {
              sim.dragEnd(d.id, true)
            }
            // En pausa: volver a parar la sim tras el reheat del drag.
            if (paused) sim.stop()
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

    // Nodo protagonista: nucleo reactor (x3 de la bola maxima)
    const rootReactor = nodeG.filter(d => d.isRoot).append('g')
      .attr('class', 'root-reactor')
      .attr('pointer-events', 'none')

    rootReactor.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', ROOT_REACTOR_RADIUS * 1.15)
      .attr('fill', 'none')
      .attr('stroke', '#9fefff')
      .attr('stroke-width', 2.4)
      .attr('stroke-opacity', 0.24)
      .attr('filter', 'url(#glow-reactor-soft)')

    rootReactor.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', ROOT_REACTOR_RADIUS * 1.01)
      .attr('fill', 'none')
      .attr('stroke', '#d7fbff')
      .attr('stroke-width', 2.2)
      .attr('stroke-opacity', 0.95)
      .attr('filter', 'url(#glow-reactor)')

    rootReactor.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', ROOT_REACTOR_RADIUS * 0.98)
      .attr('fill', 'url(#reactor-core-grad)')
      .attr('stroke', '#dbfbff')
      .attr('stroke-width', 1.25)
      .attr('stroke-opacity', 0.84)

    rootReactor.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', ROOT_REACTOR_RADIUS * 0.58)
      .attr('fill', 'url(#reactor-inner-grad)')
      .attr('opacity', 0.88)
      .attr('filter', 'url(#glow-reactor-soft)')

    rootReactor.append('circle')
      .attr('cx', ROOT_REACTOR_RADIUS * 0.09).attr('cy', -ROOT_REACTOR_RADIUS * 0.1)
      .attr('r', ROOT_REACTOR_RADIUS * 0.16)
      .attr('fill', '#c9fbff')
      .attr('opacity', 0.93)
      .attr('filter', 'url(#glow-reactor-soft)')

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
    let reactorPhase = 0
    let prevAnimTs = Date.now()

    function animateParticles () {
      if (paused) {
        rafId = null
        return
      }
      const now = Date.now()
      const dt = Math.max(0, now - prevAnimTs)
      prevAnimTs = now
      reactorPhase += dt * 0.0035
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
      const bob = Math.sin(reactorPhase) * 0.85
      const tilt = Math.sin(reactorPhase * 0.72) * 1.6
      const pulse = 1 + Math.sin(reactorPhase * 0.55) * 0.045
      rootReactor.attr('transform', `translate(0,${bob.toFixed(2)}) rotate(${tilt.toFixed(2)}) scale(${pulse.toFixed(3)})`)

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

    // Auto-pause: tras montar y dejar que la fisica se asiente, parar simulacion.
    // Se desarma en cuanto el usuario interactua con play/pause manual.
    let autoPauseArmed = !!autoPause && !paused
    let autoPauseTimer = null

    function disarmAutoPause () {
      autoPauseArmed = false
      if (autoPauseTimer != null) {
        clearTimeout(autoPauseTimer)
        autoPauseTimer = null
      }
    }

    function setPaused (nextPaused, { fromAuto = false } = {}) {
      const p = !!nextPaused
      if (!fromAuto) disarmAutoPause()
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

    if (autoPauseArmed) {
      autoPauseTimer = setTimeout(() => {
        autoPauseTimer = null
        if (!autoPauseArmed) return
        autoPauseArmed = false
        setPaused(true, { fromAuto: true })
        if (typeof onAutoPause === 'function') {
          try { onAutoPause() } catch {}
        }
      }, Math.max(0, Number(autoPauseDelay) || 0))
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
        d3.select(this).attr('filter', d.isRoot ? null : `url(#${glowIdForNode(d)})`)
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
          .attr('stroke-width', activeNode.isRoot ? 0 : (activeNode.type === 'folder' ? 1.5 : 1))
          .attr('filter', activeNode.isRoot ? null : `url(#${glowIdForNode(activeNode)})`)
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

    // Estado para pausa por búsqueda. Guarda el `paused` previo para restaurarlo
    // al limpiar. No re-anima si el grafo estaba pausado por autoPause.
    let searchActive = false
    let searchPrevPaused = false

    function ensureSearchPause () {
      if (searchActive) return
      searchActive = true
      searchPrevPaused = paused
      if (!paused) setPaused(true)
    }

    function restoreFromSearch () {
      if (!searchActive) return
      searchActive = false
      // Si antes estaba en marcha, reanudar. Si estaba pausado (manual o autoPause), dejar pausado.
      if (!searchPrevPaused && paused) setPaused(false)
    }

    function focusByQuery (query, { resetCycle = false, scopeDir = null, step = 0 } = {}) {
      const qRaw = String(query || '').trim()
      const q = normalizeText(qRaw)
      if (!q) {
        queryCycle = { q: '', i: -1, matches: [] }
        return { total: 0, index: -1, node: null }
      }
      const terms = q.split(/\s+/).filter(Boolean)
      const scope = scopeDir ? String(scopeDir).replace(/\/+$/, '').toLowerCase() : null
      const scopePrefix = scope ? scope + '/' : null
      const matches = nodes.filter((n) => {
        if (scope) {
          const p = (n.path || '').toLowerCase()
          if (!p || (p !== scope && !p.startsWith(scopePrefix))) return false
        }
        const hay = normalizeText(`${n.label || ''} ${n.path || ''}`)
        return terms.every((term) => hay.includes(term))
      })
      if (!matches.length) {
        queryCycle = { q, i: -1, matches: [] }
        ensureSearchPause()
        return { total: 0, index: -1, node: null }
      }
      const sameMatchSet = queryCycle.matches.length === matches.length &&
        queryCycle.matches.every((n, i) => n.id === matches[i].id)
      let idx
      if (resetCycle || queryCycle.q !== q || !sameMatchSet) {
        idx = 0
      } else {
        const delta = Number(step) || 0
        idx = ((queryCycle.i + delta) % matches.length + matches.length) % matches.length
      }
      queryCycle = { q, i: idx, matches }
      const node = matches[idx]
      ensureSearchPause()
      focusNode(node)
      return { total: matches.length, index: idx, node }
    }

    function searchNext () {
      if (!queryCycle.matches.length) return { total: 0, index: -1, node: null }
      const idx = (queryCycle.i + 1) % queryCycle.matches.length
      queryCycle.i = idx
      const node = queryCycle.matches[idx]
      ensureSearchPause()
      focusNode(node)
      return { total: queryCycle.matches.length, index: idx, node }
    }

    function searchPrev () {
      if (!queryCycle.matches.length) return { total: 0, index: -1, node: null }
      const n = queryCycle.matches.length
      const idx = (queryCycle.i - 1 + n) % n
      queryCycle.i = idx
      const node = queryCycle.matches[idx]
      ensureSearchPause()
      focusNode(node)
      return { total: n, index: idx, node }
    }

    function searchClear () {
      queryCycle = { q: '', i: -1, matches: [] }
      restoreFromSearch()
    }

    function isSearching () {
      return !!queryCycle.matches.length
    }

    // ResizeObserver para adaptar el grafo al tamaño del sidebar
    const ro = new ResizeObserver(() => {
      // Anti-race: si destroy() corrió entre dos callbacks del RO, sim ya está dispuesto.
      if (sim.isDisposed && sim.isDisposed()) return
      width = svgEl.clientWidth
      height = svgEl.clientHeight
      nodes.forEach(d => { if (d.isRoot) { d.fx = width / 2; d.fy = height / 2 } })
      sim.setSize(width, height)
      const rootNode = nodes.find(d => d.isRoot)
      if (rootNode) sim.setRootFixed(rootNode.id)
      if (!paused) sim.alpha(0.3).restart()
    })
    ro.observe(svgEl)

    let destroyed = false
    return {
      destroy () {
        // Idempotente: si el caller llama destroy() dos veces (re-init rápido,
        // cambio de proyecto), no debe romper.
        if (destroyed) return
        destroyed = true
        disarmAutoPause()
        stopAnimationLoop()
        try { sim.stop() } catch {}
        try { sim.dispose() } catch {}
        try { ro.disconnect() } catch {}
        try { hoverCard.remove() } catch {}
        try { svg.on('.zoom', null) } catch {}
        try { svg.on('click.deselect', null) } catch {}
        try { svg.on('dblclick.reset', null) } catch {}
        try { svg.selectAll('*').remove() } catch {}
      },
      focusByQuery,
      searchPrev,
      searchNext,
      searchClear,
      isSearching,
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
            .attr('stroke-width', activeNode && activeNode.id === node.id ? 2.4 : (node.isRoot ? 0 : (node.type === 'folder' ? 1.5 : 1)))
            .attr('filter', () => {
              if (activeNode && activeNode.id === node.id) return 'url(#glow-strong)'
              return node.isRoot ? null : `url(#${glowIdForNode(node)})`
            })

        // Label siempre visible durante el pulso
        nodeG.filter(d => d.id === node.id).select('.node-label').attr('display', null)
      },
      setForces ({ repulsion: r, linkDistance: d, particleSpeed: p, compactness: c }) {
        const patch = {}
        if (r !== undefined) { repulsion = r; patch.repulsion = repulsion }
        if (d !== undefined) { linkDistance = d; patch.linkDistance = linkDistance }
        if (c !== undefined) { compactness = c; patch.compactness = compactness }
        if (p !== undefined) particleSpeed = p
        if (Object.keys(patch).length) sim.setForcesDirect(patch)
        if (!paused) sim.alpha(0.4).restart()
      },
      setSpeed (factor) {
        // factor ∈ [0.1, 1.0]. 1.0 = comportamiento default d3 (rápido).
        if (sim?.setSpeed) sim.setSpeed(factor)
      }
    }
  }

  window.GraphRenderer = { init }
})()
