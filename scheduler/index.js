const crypto = require('crypto')
const cron = require('node-cron')
let cronParser = null
try { cronParser = require('cron-parser') } catch {}

class TaskScheduler {
  constructor({ executor, sinks, persistence, broadcast }) {
    if (typeof executor !== 'function') throw new Error('TaskScheduler: executor requerido')
    if (!persistence) throw new Error('TaskScheduler: persistence requerido')
    this.executor = executor
    this.sinks = sinks || {}
    this.persistence = persistence
    this.broadcast = typeof broadcast === 'function' ? broadcast : () => {}
    this.jobs = new Map()
    this.activeRuns = new Map()
  }

  async init() {
    const tasks = await this.persistence.loadTasks()
    for (const task of tasks) {
      if (task.enabled) this._schedule(task)
    }
  }

  _schedule(task) {
    if (!task || !task.cron) return
    if (!cron.validate(task.cron)) return
    if (this.jobs.has(task.id)) {
      try { this.jobs.get(task.id).stop() } catch {}
      this.jobs.delete(task.id)
    }
    const job = cron.schedule(task.cron, () => {
      this.runNow(task.id).catch(() => {})
    }, { scheduled: true })
    this.jobs.set(task.id, job)
    this._updateNextRun(task).catch(() => {})
  }

  async _updateNextRun(task) {
    if (!cronParser) return
    try {
      const it = cronParser.parseExpression(task.cron)
      const nextRunAt = it.next().toDate().toISOString()
      await this.persistence.updateTask(task.id, { nextRunAt })
    } catch {}
  }

  validateCron(expr) {
    if (typeof expr !== 'string' || !expr.trim()) {
      return { ok: false, error: 'Expresión vacía' }
    }
    if (!cron.validate(expr)) {
      return { ok: false, error: 'Expresión cron inválida' }
    }
    const nextRunsPreview = []
    if (cronParser) {
      try {
        const it = cronParser.parseExpression(expr)
        for (let i = 0; i < 3; i++) nextRunsPreview.push(it.next().toDate().toISOString())
      } catch (err) {
        return { ok: false, error: err.message || 'Error al parsear' }
      }
    }
    return { ok: true, nextRunsPreview }
  }

  async runNow(taskId) {
    const task = await this.persistence.getTask(taskId)
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`)
    if (this.activeRuns.has(taskId)) {
      throw new Error('Ya hay una ejecución en curso para esta tarea')
    }

    const runId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const abort = new AbortController()
    this.activeRuns.set(taskId, abort)
    this.broadcast('tasks:run-started', { taskId, runId, startedAt })

    let output = ''
    let error = null
    let status = 'ok'
    const t0 = Date.now()

    try {
      const result = await this.executor(task, {
        signal: abort.signal,
        onProgress: (partial) => {
          output = partial
          this.broadcast('tasks:run-progress', {
            taskId,
            runId,
            partialText: typeof partial === 'string' ? partial.slice(-2000) : ''
          })
        }
      })
      if (result && typeof result.output === 'string') output = result.output
      if (task.resume && result && result.sessionId && result.sessionId !== task.sessionId) {
        try { await this.persistence.updateTask(taskId, { sessionId: result.sessionId }) } catch {}
      }
    } catch (e) {
      if (e && (e.name === 'AbortError' || /cancel/i.test(e.message || ''))) {
        status = 'cancelled'
      } else {
        status = 'error'
        error = (e && e.message) ? e.message : String(e)
      }
    } finally {
      this.activeRuns.delete(taskId)
    }

    const finishedAt = new Date().toISOString()
    const durationMs = Date.now() - t0
    const truncatedOutput = typeof output === 'string' ? output.slice(0, 8192) : ''

    const run = {
      runId,
      taskId,
      taskName: task.name,
      cli: task.cli,
      startedAt,
      finishedAt,
      durationMs,
      status,
      output: truncatedOutput,
      error
    }

    try { await this.persistence.appendRun(run) } catch {}
    try {
      await this.persistence.updateTask(taskId, {
        lastRunAt: finishedAt,
        lastStatus: status,
        lastDurationMs: durationMs
      })
    } catch {}

    this.broadcast('tasks:run-finished', {
      taskId,
      runId,
      status,
      durationMs,
      output: truncatedOutput,
      error
    })

    if (task.sinks && task.sinks.notifyMacOS && this.sinks.notifyMacOS) {
      try { this.sinks.notifyMacOS({ task, run }) } catch {}
    }
    if (task.sinks && task.sinks.telegram && this.sinks.telegram) {
      try { await this.sinks.telegram({ task, run }) } catch {}
    }

    // Recalcular nextRunAt tras el run (cron sigue activo)
    if (task.enabled) this._updateNextRun(task).catch(() => {})

    return { ok: true, runId, status }
  }

  cancel(taskId) {
    const ac = this.activeRuns.get(taskId)
    if (ac) {
      try { ac.abort() } catch {}
      return { ok: true }
    }
    return { ok: false, reason: 'no-active-run' }
  }

  async upsertTask(taskData) {
    const task = await this.persistence.upsertTask(taskData)
    if (this.jobs.has(task.id)) {
      try { this.jobs.get(task.id).stop() } catch {}
      this.jobs.delete(task.id)
    }
    if (task.enabled) this._schedule(task)
    this.broadcast('tasks:list-changed')
    return task
  }

  async deleteTask(id) {
    if (this.jobs.has(id)) {
      try { this.jobs.get(id).stop() } catch {}
      this.jobs.delete(id)
    }
    this.cancel(id)
    await this.persistence.deleteTask(id)
    this.broadcast('tasks:list-changed')
    return { ok: true }
  }

  async toggle(id, enabled) {
    const task = await this.persistence.updateTask(id, { enabled: !!enabled })
    if (this.jobs.has(id)) {
      try { this.jobs.get(id).stop() } catch {}
      this.jobs.delete(id)
    }
    if (task.enabled) this._schedule(task)
    this.broadcast('tasks:list-changed')
    return task
  }

  destroy() {
    for (const [, job] of this.jobs) {
      try { job.stop() } catch {}
    }
    this.jobs.clear()
    for (const [, ac] of this.activeRuns) {
      try { ac.abort() } catch {}
    }
    this.activeRuns.clear()
  }
}

module.exports = TaskScheduler
module.exports.TaskScheduler = TaskScheduler
