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
  const profileSelectEl = document.getElementById('picker-profile-selector')
  const profileHintEl = document.getElementById('picker-profile-hint')
  const profileBarEl = document.querySelector('.picker-profile-bar')
  const kbToggleEl = document.getElementById('picker-kb-toggle')
  const kbHintEl = document.getElementById('picker-kb-hint')

  // Espeja KB_PREFS_DEFAULT de main/kb-prefs.js (el picker no puede hacer require).
  const KB_DEFAULT = false

  const state = {
    cwd: null,
    cli: 'claude',
    onSpawn: null,
    dragDepth: 0,
    activeProfileId: '',
    kbEnabled: KB_DEFAULT
  }

  function shorten(p, max = 56) {
    if (!p) return ''
    return p.length > max ? '…' + p.slice(p.length - max + 1) : p
  }

  function showOverlay() { overlay.classList.remove('hidden') }
  function hideOverlay() { overlay.classList.add('hidden') }

  // ── Conocimiento (Casos/Fichas) por carpeta ──
  // La pref vive atada al cwd porque el conocimiento vive en la carpeta. Si se
  // toca la casilla ANTES de elegir carpeta, queda pendiente y se aplica a la
  // que se abra a continuación; con carpeta ya elegida se guarda al momento.
  let kbPending = null

  function paintKbToggle(enabled, { hasCwd }) {
    state.kbEnabled = Boolean(enabled)
    if (kbToggleEl) kbToggleEl.checked = state.kbEnabled
    if (!kbHintEl) return
    kbHintEl.textContent = hasCwd
      ? (state.kbEnabled ? 'Este proyecto muestra Casos y Fichas.' : 'Este proyecto va sin Casos ni Fichas.')
      : 'Pestañas Casos y Fichas del proyecto que abras.'
  }

  async function loadKbForCwd(cwd) {
    if (!cwd) return
    if (kbPending !== null) {
      const wanted = kbPending
      kbPending = null
      await saveKbForCwd(cwd, wanted)
      return
    }
    let enabled = KB_DEFAULT
    try { enabled = await window.api.kbPrefs.get(cwd) } catch {}
    paintKbToggle(enabled, { hasCwd: true })
  }

  async function saveKbForCwd(cwd, enabled) {
    paintKbToggle(enabled, { hasCwd: true })
    try { await window.api.kbPrefs.set(cwd, enabled) } catch {}
    window.dispatchEvent(new CustomEvent('poweragent:kb-pref-changed', { detail: { cwd, enabled: Boolean(enabled) } }))
  }

  if (kbToggleEl) {
    kbToggleEl.addEventListener('change', (e) => {
      const enabled = Boolean(e?.target?.checked)
      if (!state.cwd) {
        kbPending = enabled
        paintKbToggle(enabled, { hasCwd: false })
        return
      }
      saveKbForCwd(state.cwd, enabled).catch(() => {})
    })
  }

  // El popover AGENTE también cambia esta pref: mantenemos la casilla en sintonía.
  window.addEventListener('poweragent:kb-pref-changed-external', (ev) => {
    const detail = ev?.detail || {}
    if (!state.cwd || detail.cwd !== state.cwd) return
    paintKbToggle(detail.enabled, { hasCwd: true })
  })

  function showViewProject() {
    viewProject.classList.remove('hidden')
    viewSession.classList.add('hidden')
    titleEl.textContent = 'Elige proyecto'
    subtitleEl.textContent = 'Selecciona una carpeta para empezar.'
    // Entrar aquí es empezar de cero: sin cwd la casilla opera en modo
    // "pendiente para la carpeta que elijas" y nunca escribe contra la
    // carpeta anterior. refreshProfiles decide si la barra se ve.
    state.cwd = null
    kbPending = null
    profileBarEl?.classList.remove('hidden')
    paintKbToggle(KB_DEFAULT, { hasCwd: false })
    refreshProfiles().catch(() => {})
    refreshRecents().catch(() => {})
  }

  function showViewSession() {
    viewProject.classList.add('hidden')
    viewSession.classList.remove('hidden')
    titleEl.textContent = 'Elige sesión'
    subtitleEl.textContent = 'Continúa una sesión previa o crea una nueva.'
    // Personalidad y conocimiento se deciden en el paso de proyecto (valen
    // para el proyecto entero); dentro de la app se cambian en AGENTE.
    profileBarEl?.classList.add('hidden')
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

  function setProfileHint(text, tone = '') {
    if (!profileHintEl) return
    profileHintEl.textContent = text
    profileHintEl.classList.toggle('picker-profile-hint-error', tone === 'error')
  }

  async function refreshProfiles() {
    if (!profileSelectEl) return
    const bar = profileSelectEl.closest('.picker-profile-bar')
    if (typeof window.api?.listProfiles !== 'function') {
      bar?.classList.add('hidden')
      return
    }
    let payload = null
    try {
      payload = await window.api.listProfiles()
    } catch {}
    const profiles = Array.isArray(payload?.profiles) ? payload.profiles : []
    if (!profiles.length) {
      bar?.classList.add('hidden')
      return
    }
    bar?.classList.remove('hidden')
    state.activeProfileId = String(payload?.activeProfile || profiles[0].id || '')
    profileSelectEl.innerHTML = ''
    for (const profile of profiles) {
      const opt = document.createElement('option')
      opt.value = profile.id
      opt.textContent = profile.name || profile.id
      profileSelectEl.appendChild(opt)
    }
    const known = profiles.some((p) => p.id === state.activeProfileId)
    if (!known) state.activeProfileId = profiles[0].id
    profileSelectEl.value = state.activeProfileId
    setProfileHint('Se usará en la sesión que abras.')
  }

  async function selectProfile(profileId) {
    const wanted = String(profileId || '').trim()
    if (!wanted || wanted === state.activeProfileId) return
    if (typeof window.api?.setActiveProfile !== 'function') return
    let result = null
    try {
      result = await window.api.setActiveProfile(wanted)
    } catch (err) {
      result = { ok: false, error: err?.message || String(err) }
    }
    if (!result?.ok) {
      profileSelectEl.value = state.activeProfileId
      setProfileHint(result?.error || 'No se pudo cambiar la personalidad', 'error')
      return
    }
    state.activeProfileId = wanted
    const name = profileSelectEl.selectedOptions?.[0]?.textContent || wanted
    setProfileHint(`${name} quedará activa al abrir.`)
    window.dispatchEvent(new CustomEvent('poweragent:profile-changed', { detail: { profileId: wanted } }))
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
    await loadKbForCwd(cwd)
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

  if (profileSelectEl) {
    profileSelectEl.addEventListener('change', (e) => {
      selectProfile(e?.target?.value).catch(() => {})
    })
  }

  // El perfil también se puede cambiar desde la barra superior mientras el
  // picker está abierto: mantenemos el selector en sintonía.
  window.addEventListener('poweragent:profile-changed-external', () => {
    refreshProfiles().catch(() => {})
  })

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
