'use strict'

// IPC del agente PTY que crea tareas programadas.
//
// Tres modos:
// - 'create': bootstrap pidiendo al usuario qué automatizar. El agente devuelve
//   <TASK>{...json...}</TASK> con el schema completo. apply-proposal hace upsert.
// - 'iterate': la tarea ya existe. Bootstrap inyecta los campos actuales y pide
//   al agente que ayude a ajustar. apply-proposal hace update sobre id existente.
// - 'resume': abre PTY con --resume <sessionId> de la tarea para iterar la
//   sesión Claude viva. NO emite proposal — es el "Hablar con el agente".

function registerTaskAgentIpc({
  ipcMain,
  BrowserWindow,
  getTaskAgentSessions,
  startTaskAgentPty,
  killTaskAgentPty,
  ensureTaskProposalDir,
  clearTaskProposalFromDisk,
  readTaskProposalFromDisk,
  getScheduler,
  ensureCliAvailable,
  openTaskAgentPtyWindow,
  broadcast
}) {
  function sessionByEvent(event) {
    return getTaskAgentSessions().get(event.sender.id) || null
  }

  // Llamado desde tasks-manager (panel) para abrir la ventana del agente.
  ipcMain.handle('task-agent:open', async (_e, payload = {}) => {
    const mode = payload.mode === 'iterate' ? 'iterate'
      : payload.mode === 'resume' ? 'resume'
      : 'create'
    const win = await openTaskAgentPtyWindow({
      mode,
      taskId: payload.taskId || null
    })
    return win ? { ok: true } : { ok: false, error: 'No se pudo abrir la ventana del agente' }
  })

  ipcMain.handle('task-agent-pty:init', async (event) => {
    const s = sessionByEvent(event)
    if (!s) return { sessionId: null }
    let taskName = ''
    if (s.taskId) {
      try {
        const task = await getScheduler()?.persistence.getTask(s.taskId)
        if (task) taskName = task.name || ''
      } catch {}
    }
    return {
      sessionId: s.sessionId,
      mode: s.mode,
      taskId: s.taskId,
      taskName,
      cli: s.activeCli
    }
  })

  ipcMain.handle('task-agent-pty:start', (event, { cols, rows } = {}) => {
    const s = sessionByEvent(event)
    if (!s) return { ok: false, error: 'No session' }
    if (cols && rows) { s.cols = cols; s.rows = rows }
    try {
      startTaskAgentPty(s)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.on('task-agent-pty:write', (event, data) => {
    const s = sessionByEvent(event)
    if (!s || !s.pty) return
    try { s.pty.write(data) } catch {}
  })

  ipcMain.on('task-agent-pty:resize', (event, { cols, rows } = {}) => {
    const s = sessionByEvent(event)
    if (!s) return
    if (cols && rows) { s.cols = cols; s.rows = rows }
    try { s.pty?.resize(cols, rows) } catch {}
  })

  ipcMain.handle('task-agent-pty:restart', (event, { cols, rows } = {}) => {
    const s = sessionByEvent(event)
    if (!s) return { ok: false, error: 'No session' }
    killTaskAgentPty(s)
    s.buffer = ''
    s.lastProposal = null
    s.bootstrapInjected = false
    s.detectFromOffset = null
    ensureTaskProposalDir(s.sessionId)
    if (cols && rows) { s.cols = cols; s.rows = rows }
    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          startTaskAgentPty(s)
          resolve({ ok: true })
        } catch (err) {
          resolve({ ok: false, error: err?.message || String(err) })
        }
      }, 200)
    })
  })

  ipcMain.handle('task-agent-pty:set-cli', (event, { cli } = {}) => {
    const s = sessionByEvent(event)
    if (!s) return { ok: false, error: 'No session' }
    if (cli !== 'claude' && cli !== 'codex') return { ok: false, error: 'CLI inválido' }
    if (s.activeCli === cli) return { ok: true, cli }
    const check = ensureCliAvailable(cli)
    if (!check.ok) return { ok: false, error: check.error }
    killTaskAgentPty(s)
    s.activeCli = cli
    s.buffer = ''
    s.lastProposal = null
    s.bootstrapInjected = false
    s.detectFromOffset = null
    ensureTaskProposalDir(s.sessionId)
    try {
      startTaskAgentPty(s)
      return { ok: true, cli }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.on('task-agent-pty:close-self', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (w && !w.isDestroyed()) w.close()
  })

  ipcMain.on('task-agent-pty:minimize-self', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (w && !w.isDestroyed()) w.minimize()
  })

  ipcMain.handle('task-agent-pty:check-proposal', (event) => {
    const s = sessionByEvent(event)
    if (!s || !s.sessionId) return { available: false }
    if (s.mode === 'resume') return { available: false }
    // Vía push (stream parser) primero
    if (s.lastProposal) return { available: true, proposal: s.lastProposal }
    // Vía pull (filesystem)
    const found = readTaskProposalFromDisk(s.sessionId)
    if (!found) return { available: false }
    s.lastProposal = found
    return { available: true, proposal: found }
  })

  ipcMain.handle('task-agent:apply-proposal', async (_event, payload = {}) => {
    const sched = getScheduler()
    if (!sched) return { ok: false, error: 'Scheduler no inicializado' }
    const task = payload && payload.task
    if (!task || typeof task !== 'object') return { ok: false, error: 'Propuesta vacía' }

    const data = {
      name: String(task.name || '').trim(),
      enabled: task.enabled !== false,
      cron: String(task.cron || '').trim(),
      cli: task.cli === 'codex' ? 'codex' : 'claude',
      cwd: typeof task.cwd === 'string' ? task.cwd : '',
      prompt: String(task.prompt || '').trim(),
      model: typeof task.model === 'string' ? task.model : '',
      effort: typeof task.effort === 'string' ? task.effort : '',
      resume: task.resume !== false,
      sinks: {
        logApp: task.sinks?.logApp !== false,
        notifyMacOS: !!task.sinks?.notifyMacOS,
        telegram: !!task.sinks?.telegram
      }
    }
    if (!data.name) return { ok: false, error: 'Falta nombre' }
    if (!data.cron) return { ok: false, error: 'Falta cron' }
    if (!data.prompt) return { ok: false, error: 'Falta prompt' }

    // Validar cron contra el scheduler
    const v = sched.validateCron(data.cron)
    if (!v || v.ok === false) {
      return { ok: false, error: 'Cron inválido: ' + (v && v.error ? v.error : data.cron) }
    }

    // Modo iterate: hacer update sobre el id existente
    if (payload.mode === 'iterate' && payload.taskId) {
      const current = await sched.persistence.getTask(payload.taskId)
      if (current) {
        const merged = Object.assign({}, current, data, { id: payload.taskId })
        const saved = await sched.upsertTask(merged)
        clearTaskProposalFromDisk(payload.sessionId)
        broadcast('tasks:list-changed')
        return { ok: true, task: saved, mode: 'updated' }
      }
    }

    // Crear nueva
    const saved = await sched.upsertTask(data)
    clearTaskProposalFromDisk(payload.sessionId)
    broadcast('tasks:list-changed')
    return { ok: true, task: saved, mode: 'created' }
  })
}

module.exports = { registerTaskAgentIpc }
