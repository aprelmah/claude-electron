'use strict'

const os = require('os')
const cronPresets = require('../scheduler/cron-presets')

function registerTasksIpc({
  ipcMain,
  BrowserWindow,
  dialog,
  nativeTheme,
  getScheduler,
  getAppConfig,
  getSessions,
  getTasksManagerWin,
  openTasksManager
}) {
  function assertScheduler() {
    const sched = getScheduler()
    if (!sched) throw new Error('Scheduler no inicializado')
    return sched
  }

  ipcMain.handle('tasks-manager:open', async () => {
    await openTasksManager()
    return { ok: true }
  })

  ipcMain.handle('tasks:list', async () => {
    const sched = getScheduler()
    if (!sched) return []
    return sched.persistence.loadTasks()
  })

  ipcMain.handle('tasks:get', async (_event, { id }) => {
    const sched = getScheduler()
    if (!sched) return null
    return sched.persistence.getTask(id)
  })

  ipcMain.handle('tasks:create', async (_event, data) => {
    return assertScheduler().upsertTask(data)
  })

  ipcMain.handle('tasks:update', async (_event, { id, patch }) => {
    const sched = assertScheduler()
    const current = await sched.persistence.getTask(id)
    if (!current) throw new Error('Tarea no encontrada')
    return sched.upsertTask({ ...current, ...patch, id })
  })

  ipcMain.handle('tasks:delete', async (_event, { id }) => {
    await assertScheduler().deleteTask(id)
    return { ok: true }
  })

  ipcMain.handle('tasks:toggle', async (_event, { id, enabled }) => {
    return assertScheduler().toggle(id, enabled)
  })

  ipcMain.handle('tasks:run-now', async (_event, { id }) => {
    const sched = assertScheduler()
    const runId = require('crypto').randomUUID()
    Promise.resolve().then(() => sched.runNow(id)).catch((err) => {
      console.error('[tasks:run-now] error:', err?.message || err)
    })
    return { ok: true, runId }
  })

  ipcMain.handle('tasks:cancel', async (_event, { id }) => {
    assertScheduler().cancel(id)
    return { ok: true }
  })

  ipcMain.handle('tasks:get-runs', async (_event, payload = {}) => {
    const sched = getScheduler()
    if (!sched) return []
    const { taskId, limit = 100 } = payload
    return sched.persistence.getRuns({ taskId, limit })
  })

  ipcMain.handle('tasks:validate-cron', async (_event, { expr }) => {
    const sched = getScheduler()
    if (!sched) return { ok: false, error: 'Scheduler no listo' }
    return sched.validateCron(expr)
  })

  ipcMain.handle('tasks:list-cwds', async () => {
    let history = []
    try {
      const sched = getScheduler()
      if (sched) history = await sched.persistence.loadCwdHistory()
    } catch {}
    const liveCwds = []
    for (const s of getSessions().values()) {
      if (s?.cwd) liveCwds.push(s.cwd)
    }
    const all = Array.from(new Set([...(Array.isArray(history) ? history : []), ...liveCwds]))
    if (!all.length) return [os.homedir()]
    return all
  })

  ipcMain.handle('tasks:get-cron-presets', () => cronPresets)

  ipcMain.handle('tasks:pick-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || getTasksManagerWin()
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true }
    return { path: result.filePaths[0], canceled: false }
  })

  ipcMain.handle('tasks:get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

  ipcMain.handle('tasks:get-telegram-configured', () => {
    const tg = getAppConfig()?.telegram || {}
    return !!(tg.botToken && Array.isArray(tg.allowedUsers) && tg.allowedUsers.length)
  })

  ipcMain.handle('tasks:get-default-model-effort', () => {
    const tg = getAppConfig()?.telegram || {}
    return {
      claude: { model: tg.claudeModel || '', effort: tg.claudeEffort || '' },
      codex: { model: tg.codexModel || '', effort: tg.codexEffort || '' }
    }
  })

  ipcMain.handle('tasks:window-close', () => {
    const w = getTasksManagerWin()
    if (w && !w.isDestroyed()) w.close()
    return { ok: true }
  })

  ipcMain.handle('tasks:window-minimize', () => {
    const w = getTasksManagerWin()
    if (w && !w.isDestroyed()) w.minimize()
    return { ok: true }
  })
}

module.exports = { registerTasksIpc }
