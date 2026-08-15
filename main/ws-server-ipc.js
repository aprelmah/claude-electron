'use strict'

function registerWsServerIpc({
  ipcMain,
  startLanServer,
  stopLanServer,
  getLanServerStatus,
  createLanSessionInvite,
  getLanWsServer,
  getLanTunnel,
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

  ipcMain.handle('ws-server:create-session-invite', async (event, payload = {}) => {
    try {
      return createLanSessionInvite(event, payload)
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  // Túnel efímero (botón "Compartir por internet"). Handlers finos a propósito:
  // todo lo que decide vive en main/lan-tunnel.js, que la suite cubre sin Electron.
  ipcMain.handle('lan-tunnel:start', async () => {
    try {
      const result = await getLanTunnel().start({ serverRunning: !!getLanServerStatus().running })
      return { ...result, ...getLanServerStatus() }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), ...getLanServerStatus() }
    }
  })

  ipcMain.handle('lan-tunnel:stop', async () => {
    try {
      getLanTunnel().stop()
      return { ok: true, ...getLanServerStatus() }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), ...getLanServerStatus() }
    }
  })
}

module.exports = { registerWsServerIpc }
