'use strict'

function registerDelegationIpc({ ipcMain, getManager, getDefaultCwd } = {}) {
  function manager() {
    const value = getManager()
    if (!value) throw new Error('Delegaciones no inicializadas')
    return value
  }

  ipcMain.handle('delegations:list', () => manager().list())
  ipcMain.handle('delegations:get', (_event, { id } = {}) => manager().get(id))
  ipcMain.handle('delegations:start', async (_event, payload = {}) => {
    const data = { ...payload }
    if (!data.cwd && typeof getDefaultCwd === 'function') data.cwd = getDefaultCwd()
    return manager().dispatch(data)
  })
  ipcMain.handle('delegations:cancel', async (_event, { id } = {}) => manager().cancel(id))
}

module.exports = { registerDelegationIpc }
