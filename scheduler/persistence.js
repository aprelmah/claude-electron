const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')

const MAX_RUNS = 500
const TASKS_FILE = 'scheduled-tasks.json'
const RUNS_FILE = 'scheduled-tasks-runs.json'
const CWD_HISTORY_FILE = 'scheduled-tasks-cwd-history.json'

const VALID_CLI = new Set(['claude', 'codex'])

function nowIso() {
  return new Date().toISOString()
}

function defaultsForTask(input) {
  return {
    id: input.id || crypto.randomUUID(),
    name: typeof input.name === 'string' ? input.name.trim() : '',
    enabled: input.enabled !== false,
    cron: typeof input.cron === 'string' ? input.cron.trim() : '',
    cli: VALID_CLI.has(input.cli) ? input.cli : 'claude',
    cwd: typeof input.cwd === 'string' ? input.cwd : '',
    prompt: typeof input.prompt === 'string' ? input.prompt : '',
    model: typeof input.model === 'string' ? input.model : '',
    effort: typeof input.effort === 'string' ? input.effort : '',
    resume: input.resume === true,
    sessionId: input.sessionId || null,
    sinks: {
      logApp: input.sinks?.logApp !== false,
      notifyMacOS: input.sinks?.notifyMacOS === true,
      telegram: input.sinks?.telegram === true
    },
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
    lastRunAt: input.lastRunAt || null,
    lastStatus: input.lastStatus || null,
    lastDurationMs: typeof input.lastDurationMs === 'number' ? input.lastDurationMs : 0,
    nextRunAt: input.nextRunAt || null
  }
}

function validateTaskShape(task) {
  if (!task.name) throw new Error('Tarea sin nombre')
  if (!task.cron) throw new Error('Tarea sin expresión cron')
  if (!VALID_CLI.has(task.cli)) throw new Error(`CLI inválido: ${task.cli}`)
  if (!task.prompt) throw new Error('Tarea sin prompt')
}

function createMutex() {
  let chain = Promise.resolve()
  return function run(fn) {
    const next = chain.then(() => fn(), () => fn())
    chain = next.catch(() => {})
    return next
  }
}

async function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp`
  const json = JSON.stringify(data, null, 2)
  await fsp.writeFile(tmp, json, 'utf8')
  await fsp.rename(tmp, filePath)
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

function createPersistence({ userDataDir }) {
  if (!userDataDir) throw new Error('persistence: userDataDir requerido')
  try { fs.mkdirSync(userDataDir, { recursive: true }) } catch {}

  const tasksPath = path.join(userDataDir, TASKS_FILE)
  const runsPath = path.join(userDataDir, RUNS_FILE)
  const cwdHistoryPath = path.join(userDataDir, CWD_HISTORY_FILE)

  const writeLock = createMutex()

  async function loadTasks() {
    const data = await readJsonOrDefault(tasksPath, [])
    return Array.isArray(data) ? data : []
  }

  async function saveTasks(tasks) {
    return writeLock(() => atomicWriteJson(tasksPath, tasks))
  }

  async function getTask(id) {
    const tasks = await loadTasks()
    return tasks.find(t => t.id === id) || null
  }

  async function upsertTask(taskData) {
    const tasks = await loadTasks()
    const idx = taskData.id ? tasks.findIndex(t => t.id === taskData.id) : -1
    let merged
    if (idx >= 0) {
      merged = defaultsForTask({ ...tasks[idx], ...taskData, createdAt: tasks[idx].createdAt })
    } else {
      merged = defaultsForTask(taskData)
    }
    validateTaskShape(merged)
    if (idx >= 0) tasks[idx] = merged
    else tasks.push(merged)
    await saveTasks(tasks)
    return merged
  }

  async function updateTask(id, patch) {
    const tasks = await loadTasks()
    const idx = tasks.findIndex(t => t.id === id)
    if (idx < 0) throw new Error(`Tarea no encontrada: ${id}`)
    const next = { ...tasks[idx], ...patch, id: tasks[idx].id, createdAt: tasks[idx].createdAt, updatedAt: nowIso() }
    if (patch.sinks) {
      next.sinks = { ...tasks[idx].sinks, ...patch.sinks }
    }
    tasks[idx] = next
    await saveTasks(tasks)
    return next
  }

  async function deleteTask(id) {
    const tasks = await loadTasks()
    const next = tasks.filter(t => t.id !== id)
    await saveTasks(next)
    return { ok: true }
  }

  async function loadRuns() {
    const data = await readJsonOrDefault(runsPath, [])
    return Array.isArray(data) ? data : []
  }

  async function appendRun(run) {
    return writeLock(async () => {
      const runs = await readJsonOrDefault(runsPath, [])
      const list = Array.isArray(runs) ? runs : []
      list.push(run)
      // Cap circular: nos quedamos con los últimos MAX_RUNS
      const trimmed = list.length > MAX_RUNS ? list.slice(list.length - MAX_RUNS) : list
      await atomicWriteJson(runsPath, trimmed)
      return run
    })
  }

  async function getRuns({ taskId, limit = 100 } = {}) {
    const runs = await loadRuns()
    const filtered = taskId ? runs.filter(r => r.taskId === taskId) : runs
    // más recientes primero
    const sorted = filtered.slice().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    return sorted.slice(0, limit)
  }

  async function loadCwdHistory() {
    const data = await readJsonOrDefault(cwdHistoryPath, [])
    return Array.isArray(data) ? data : []
  }

  async function pushCwdHistory(cwd) {
    if (!cwd || typeof cwd !== 'string') return []
    return writeLock(async () => {
      const list = await loadCwdHistory()
      const filtered = list.filter(p => p !== cwd)
      filtered.unshift(cwd)
      const trimmed = filtered.slice(0, 20)
      await atomicWriteJson(cwdHistoryPath, trimmed)
      return trimmed
    })
  }

  return {
    loadTasks,
    getTask,
    upsertTask,
    updateTask,
    deleteTask,
    appendRun,
    getRuns,
    loadCwdHistory,
    pushCwdHistory,
    _paths: { tasksPath, runsPath, cwdHistoryPath }
  }
}

module.exports = { createPersistence }
