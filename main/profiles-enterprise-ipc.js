'use strict'

function registerProfilesEnterpriseIpc({
  ipcMain,
  dialog,
  winFromEvent,
  profilesApi,
  enterpriseApi
}) {
  const {
    listProfilesPayload,
    createProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile
  } = profilesApi

  const {
    listEnterprisePayload,
    saveEnterpriseConfig,
    createEnterpriseRole,
    updateEnterpriseRole,
    deleteEnterpriseRole,
    createEnterpriseOperator,
    updateEnterpriseOperator,
    deleteEnterpriseOperator
  } = enterpriseApi

  ipcMain.handle('profiles:list', () => listProfilesPayload())

  ipcMain.handle('profiles:create', (_event, profileInput) => {
    try { return { ok: true, ...createProfile(profileInput) } }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('profiles:update', (_event, { id, patch } = {}) => {
    try { return { ok: true, ...updateProfile(id, patch || {}) } }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('profiles:delete', (_event, id) => {
    try { return { ok: true, ...deleteProfile(id) } }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('profiles:set-active', (_event, id) => {
    try {
      const payload = setActiveProfile(id)
      return { ok: true, ...payload }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('enterprise:get-config', () => {
    const payload = listEnterprisePayload()
    return { ok: true, ...payload }
  })

  ipcMain.handle('enterprise:list', () => {
    const payload = listEnterprisePayload()
    return { ok: true, ...payload }
  })

  ipcMain.handle('enterprise:save-config', (_event, enterpriseInput = {}) => {
    try {
      const payload = saveEnterpriseConfig(enterpriseInput || {})
      return { ok: true, ...payload }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('enterprise:roles:create', (_event, roleInput = {}) => {
    try {
      const payload = createEnterpriseRole(roleInput || {})
      return { ok: true, ...payload }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('enterprise:roles:update', (_event, { id, patch } = {}) => {
    try {
      const payload = updateEnterpriseRole(id, patch || {})
      return { ok: true, ...payload }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('enterprise:roles:delete', (_event, id) => {
    try {
      const payload = deleteEnterpriseRole(id)
      return { ok: true, ...payload }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('enterprise:operators:create', (_event, operatorInput = {}) => {
    try {
      const payload = createEnterpriseOperator(operatorInput || {})
      return { ok: true, ...payload }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('enterprise:operators:update', (_event, { id, patch } = {}) => {
    try {
      const payload = updateEnterpriseOperator(id, patch || {})
      return { ok: true, ...payload }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('enterprise:operators:delete', (_event, id) => {
    try {
      const payload = deleteEnterpriseOperator(id)
      return { ok: true, ...payload }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('profiles:pick-claude-md', async (event) => {
    const result = await dialog.showOpenDialog(winFromEvent(event), {
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths.length) return ''
    return result.filePaths[0]
  })

  ipcMain.handle('profiles:pick-cwd', async (event) => {
    const result = await dialog.showOpenDialog(winFromEvent(event), {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return ''
    return result.filePaths[0]
  })
}

module.exports = { registerProfilesEnterpriseIpc }
