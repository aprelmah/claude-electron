'use strict'

function registerAutomationsIpc({
  ipcMain,
  shell,
  getAutomationManager,
  getAutomationChat,
  getAgentPtyWindowByAutomation,
  getChatWindows
}) {
  function automationsNotReady() {
    return { ok: false, error: 'AutomationManager no inicializado' }
  }

  ipcMain.handle('automations:list', async () => {
    const mgr = getAutomationManager()
    try {
      if (!mgr) return []
      return await mgr.list()
    } catch (err) {
      console.error('[automations:list] error:', err?.message || err)
      return []
    }
  })

  ipcMain.handle('automations:get', async (_e, { id } = {}) => {
    const mgr = getAutomationManager()
    try {
      if (!mgr) return null
      return await mgr.get(id)
    } catch (err) {
      console.error('[automations:get] error:', err?.message || err)
      return null
    }
  })

  ipcMain.handle('automations:generate-draft', async (_e, payload = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.generateDraft(payload) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:regenerate', async (_e, { id, patch } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.regenerate(id, patch || {}) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:update-draft', async (_e, { id, scriptText, plistText } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.updateDraft(id, { scriptText, plistText }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:install', async (_e, { id, force } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.install(id, { force: !!force }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:shellcheck-status', async () => {
    const mgr = getAutomationManager()
    if (!mgr) return { available: false, path: null, installHint: 'brew install shellcheck' }
    try { return await mgr.getShellcheckStatus() }
    catch { return { available: false, path: null, installHint: 'brew install shellcheck' } }
  })

  ipcMain.handle('automations:lint', async (_e, { id } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return { ok: false, error: 'AutomationManager no inicializado' }
    try { return await mgr.lintAutomation(id) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:uninstall', async (_e, { id } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.uninstall(id) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:run-once', async (_e, { id } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.runOnce(id) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:read-log', async (_e, { id, opts } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return { ok: false, error: 'AutomationManager no inicializado', content: '' }
    try {
      const content = await mgr.readLog(id, opts || {})
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), content: '' }
    }
  })

  ipcMain.handle('automations:create-draft-shell', async (_e, payload = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.createDraftShell(payload || {}) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:remove', async (_e, { id } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try {
      const res = await mgr.remove(id)
      // Limpieza: ventana PTY + ventana chat + persistencia de chat.
      const pw = getAgentPtyWindowByAutomation().get(id)
      if (pw && !pw.isDestroyed()) { try { pw.close() } catch {} }
      const w = getChatWindows().get(id)
      if (w && !w.isDestroyed()) { try { w.close() } catch {} }
      const chat = getAutomationChat()
      if (chat) { try { await chat.deleteChat(id) } catch {} }
      return res
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('automations:pause', async (_e, { id } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.pause(id) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:resume', async (_e, { id } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.resume(id) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automations:get-running', async () => {
    const mgr = getAutomationManager()
    if (!mgr) return []
    try { return await mgr.getRunningIds() }
    catch (err) {
      console.error('[automations:get-running] error:', err?.message || err)
      return []
    }
  })

  ipcMain.handle('automations:stop-run', async (_e, { id } = {}) => {
    const mgr = getAutomationManager()
    if (!mgr) return automationsNotReady()
    try { return await mgr.stopRun(id) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('shell:reveal-in-finder', async (_e, { path: target } = {}) => {
    try {
      if (!target) return { ok: false, error: 'path requerido' }
      shell.showItemInFolder(target)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerAutomationsIpc }
