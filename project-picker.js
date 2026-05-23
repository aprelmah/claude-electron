'use strict'

;(() => {
  const overlay = document.getElementById('project-picker-overlay')
  if (!overlay) return

  const viewProject = document.getElementById('picker-view-project')
  const viewSession = document.getElementById('picker-view-session')
  const titleEl = document.getElementById('picker-title')
  const subtitleEl = document.getElementById('picker-subtitle')
  const btnPickCwd = document.getElementById('btn-pick-cwd')
  const recentListEl = document.getElementById('picker-recent-list')
  const recentEmptyEl = document.getElementById('picker-recent-empty')
  const cwdValueEl = document.getElementById('picker-cwd-value')
  const btnChangeCwd = document.getElementById('btn-picker-change-cwd')
  const btnCliClaude = document.getElementById('btn-cli-claude')
  const btnCliCodex = document.getElementById('btn-cli-codex')
  const sessionsListEl = document.getElementById('picker-sessions-list')
  const sessionsEmptyEl = document.getElementById('picker-sessions-empty')
  const sessionsLoadingEl = document.getElementById('picker-sessions-loading')
  const btnNewSession = document.getElementById('btn-picker-new-session')

  const state = {
    cwd: null,
    cli: 'claude',
    onSpawn: null,
    dragDepth: 0
  }

  function shorten(p, max = 56) {
    if (!p) return ''
    return p.length > max ? '…' + p.slice(p.length - max + 1) : p
  }

  function showOverlay() { overlay.classList.remove('hidden') }
  function hideOverlay() { overlay.classList.add('hidden') }

  function showViewProject() {
    viewProject.classList.remove('hidden')
    viewSession.classList.add('hidden')
    titleEl.textContent = 'Elige proyecto'
    subtitleEl.textContent = 'Selecciona una carpeta para empezar.'
    refreshRecents().catch(() => {})
  }

  function showViewSession() {
    viewProject.classList.add('hidden')
    viewSession.classList.remove('hidden')
    titleEl.textContent = 'Elige sesión'
    subtitleEl.textContent = 'Continúa una sesión previa o crea una nueva.'
    cwdValueEl.textContent = state.cwd || ''
    cwdValueEl.title = state.cwd || ''
    setActiveCliButton(state.cli)
    refreshSessions().catch(() => {})
  }

  function setActiveCliButton(cli) {
    state.cli = cli === 'codex' ? 'codex' : 'claude'
    btnCliClaude.classList.toggle('active', state.cli === 'claude')
    btnCliClaude.setAttribute('aria-selected', String(state.cli === 'claude'))
    btnCliCodex.classList.toggle('active', state.cli === 'codex')
    btnCliCodex.setAttribute('aria-selected', String(state.cli === 'codex'))
  }

  async function refreshRecents() {
    const recents = await window.api.recentCwds.list().catch(() => [])
    recentListEl.innerHTML = ''
    if (!recents.length) {
      recentEmptyEl.classList.remove('hidden')
      return
    }
    recentEmptyEl.classList.add('hidden')
    for (const entry of recents) {
      const li = document.createElement('li')
      li.setAttribute('role', 'button')
      li.setAttribute('tabindex', '0')
      const path = document.createElement('span')
      path.className = 'recent-path'
      path.textContent = shorten(entry.cwd, 60)
      path.title = entry.cwd
      const remove = document.createElement('button')
      remove.className = 'recent-remove'
      remove.setAttribute('aria-label', `Quitar ${entry.cwd}`)
      remove.textContent = '×'
      remove.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        try { await window.api.recentCwds.remove(entry.cwd) } catch {}
        await refreshRecents()
      })
      li.appendChild(path)
      li.appendChild(remove)
      li.addEventListener('click', () => selectCwd(entry.cwd))
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectCwd(entry.cwd) }
      })
      recentListEl.appendChild(li)
    }
  }

  async function refreshSessions() {
    if (!state.cwd) return
    sessionsListEl.innerHTML = ''
    sessionsEmptyEl.classList.add('hidden')
    sessionsLoadingEl.classList.remove('hidden')

    let rows = []
    try {
      rows = await window.api.listSessions(state.cwd, state.cli)
    } catch {}

    sessionsLoadingEl.classList.add('hidden')

    if (!Array.isArray(rows) || !rows.length) {
      sessionsEmptyEl.classList.remove('hidden')
      return
    }

    const PAGE_SIZE = 50
    let rendered = 0
    let loadMoreLi = null

    const appendRow = (row) => {
      const li = document.createElement('li')
      li.setAttribute('role', 'button')
      li.setAttribute('tabindex', '0')
      const preview = document.createElement('div')
      preview.className = 'session-preview'
      preview.textContent = row.preview || '(sin contenido)'
      const meta = document.createElement('div')
      meta.className = 'session-meta'
      const when = row.mtime ? new Date(row.mtime).toLocaleString() : ''
      const msgCount = Number(row.msgCount || 0)
      meta.textContent = msgCount
        ? `${msgCount} turnos · ${when}`
        : when
      li.appendChild(preview)
      li.appendChild(meta)
      li.addEventListener('click', () => resumeSession(row.id))
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); resumeSession(row.id) }
      })
      sessionsListEl.appendChild(li)
    }

    const renderNextPage = () => {
      if (loadMoreLi) { loadMoreLi.remove(); loadMoreLi = null }
      const end = Math.min(rendered + PAGE_SIZE, rows.length)
      for (let i = rendered; i < end; i++) appendRow(rows[i])
      rendered = end
      if (rendered < rows.length) {
        loadMoreLi = document.createElement('li')
        loadMoreLi.className = 'picker-load-more'
        loadMoreLi.textContent = `Ver más (${rows.length - rendered} restantes)`
        loadMoreLi.setAttribute('role', 'button')
        loadMoreLi.setAttribute('tabindex', '0')
        loadMoreLi.addEventListener('click', renderNextPage)
        loadMoreLi.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); renderNextPage() }
        })
        sessionsListEl.appendChild(loadMoreLi)
      }
    }
    renderNextPage()
  }

  async function selectCwd(cwd) {
    if (!cwd) return
    state.cwd = cwd
    // Determinar CLI inicial: si hay last-context para este cwd, usarlo
    try {
      const last = await window.api.lastContext.mostRecent()
      if (last && last.cwd === cwd && last.cli) {
        state.cli = last.cli === 'codex' ? 'codex' : 'claude'
      }
    } catch {}
    showViewSession()
  }

  async function pickFolderViaDialog() {
    try {
      const res = await window.api.pickFolder()
      if (res && typeof res === 'string') {
        await window.api.recentCwds.push(res).catch(() => {})
        await selectCwd(res)
      }
    } catch {}
  }

  async function spawn(opts = {}) {
    if (!state.cwd) return
    const cb = typeof state.onSpawn === 'function' ? state.onSpawn : null
    if (!cb) return
    try {
      await cb({ cwd: state.cwd, cli: state.cli, sessionId: opts.sessionId || null })
      hideOverlay()
    } catch (err) {
      console.error('[picker] spawn failed:', err)
    }
  }

  function resumeSession(sessionId) {
    spawn({ sessionId })
  }

  function newSession() {
    spawn({ sessionId: null })
  }

  // ── Drag&drop carpeta sobre el overlay ──
  // Usamos capture phase + stopImmediatePropagation para ganar al
  // listener global del renderer (que inyecta @path al PTY).
  const overlayVisible = () => !overlay.classList.contains('hidden')

  window.addEventListener('dragenter', (e) => {
    if (!overlayVisible()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    state.dragDepth++
    overlay.classList.add('drop-target')
  }, true)
  window.addEventListener('dragover', (e) => {
    if (!overlayVisible()) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }, true)
  window.addEventListener('dragleave', (e) => {
    if (!overlayVisible()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    state.dragDepth--
    if (state.dragDepth <= 0) {
      state.dragDepth = 0
      overlay.classList.remove('drop-target')
    }
  }, true)
  window.addEventListener('drop', async (e) => {
    if (!overlayVisible()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    state.dragDepth = 0
    overlay.classList.remove('drop-target')
    const items = Array.from(e.dataTransfer?.items || [])
    const files = Array.from(e.dataTransfer?.files || [])
    let candidatePath = ''
    // Preferir webUtils.getPathForFile (Electron 32+)
    if (files.length) {
      try { candidatePath = window.api?.getPathForFile?.(files[0]) || '' } catch {}
      if (!candidatePath) candidatePath = files[0].path || ''
    }
    if (!candidatePath && items.length) {
      // Fallback: webkitGetAsEntry/getAsFile
      for (const it of items) {
        if (it.kind !== 'file') continue
        const f = it.getAsFile?.()
        if (!f) continue
        try { candidatePath = window.api?.getPathForFile?.(f) || '' } catch {}
        if (!candidatePath) candidatePath = f.path || ''
        if (candidatePath) break
      }
    }
    if (!candidatePath) return
    const isDir = await window.api.isDir(candidatePath).catch(() => false)
    if (!isDir) return
    await window.api.recentCwds.push(candidatePath).catch(() => {})
    await selectCwd(candidatePath)
  }, true)

  btnPickCwd.addEventListener('click', pickFolderViaDialog)
  btnChangeCwd.addEventListener('click', () => showViewProject())
  btnCliClaude.addEventListener('click', () => { setActiveCliButton('claude'); refreshSessions() })
  btnCliCodex.addEventListener('click', () => { setActiveCliButton('codex'); refreshSessions() })
  btnNewSession.addEventListener('click', newSession)

  // ── Atajo Cmd+O / Ctrl+O ──
  window.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toLowerCase().includes('mac')
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      if (overlay.classList.contains('hidden')) {
        showOverlay()
        showViewProject()
      } else {
        pickFolderViaDialog()
      }
    }
  })

  window.ProjectPicker = {
    async start({ onSpawn } = {}) {
      state.onSpawn = onSpawn || null
      state.cwd = null
      showOverlay()
      showViewProject()
    },
    show() { showOverlay() },
    hide() { hideOverlay() },
    showProject() { showViewProject() },
    showSession(cwd) {
      if (cwd) selectCwd(cwd)
      else showViewSession()
    }
  }
})()
