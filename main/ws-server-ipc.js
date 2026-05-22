'use strict'

function registerWsServerIpc({
  ipcMain,
  startLanServer,
  stopLanServer,
  getLanServerStatus,
  getLanWsServer,
  clampLanPort,
  getAppConfig,
  DEFAULT_LAN_WS_PORT
}) {
  ipcMain.handle('ws-server:start', async (_event, payload = {}) => {
    try {
      const port = clampLanPort(payload?.port ?? getAppConfig()?.lanServer?.port ?? DEFAULT_LAN_WS_PORT)
      const result = await startLanServer({ port, persist: true })
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), ...getLanServerStatus() }
    }
  })

  ipcMain.handle('ws-server:stop', async () => {
    try {
      const result = await stopLanServer({ persist: true })
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), ...getLanServerStatus() }
    }
  })

  ipcMain.handle('ws-server:sessions', async () => {
    const status = getLanServerStatus()
    return { ok: true, ...status, sessions: Array.isArray(status.sessions) ? status.sessions : [] }
  })

  ipcMain.handle('ws-server:close-session', async (_event, payload = {}) => {
    const sessionId = String(payload?.id || '').trim()
    if (!sessionId) return { ok: false, error: 'Falta id de sesión', ...getLanServerStatus() }
    const lanWsServer = getLanWsServer()
    if (!lanWsServer || !lanWsServer.isRunning()) {
      return { ok: false, error: 'Servidor LAN detenido', ...getLanServerStatus() }
    }
    const closed = lanWsServer.closeSession(sessionId, 'closed-by-operator')
    if (!closed) return { ok: false, error: 'Sesión no encontrada', ...getLanServerStatus() }
    return { ok: true, ...getLanServerStatus() }
  })
}

module.exports = { registerWsServerIpc }
