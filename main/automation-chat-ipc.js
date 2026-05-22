'use strict'

function registerAutomationChatIpc({
  ipcMain,
  BrowserWindow,
  getAutomationChat,
  getChatWcToAutomation
}) {
  ipcMain.handle('automation-chat:init', (event) => {
    const aid = getChatWcToAutomation().get(event.sender.id) || null
    return { automationId: aid }
  })

  ipcMain.handle('automation-chat:get-history', async (_e, { automationId, provider } = {}) => {
    const chat = getAutomationChat()
    if (!chat || !automationId) return []
    try { return await chat.getHistory(automationId, { provider }) }
    catch (err) { console.error('[automation-chat:get-history]', err?.message || err); return [] }
  })

  ipcMain.handle('automation-chat:send', async (_e, { automationId, content, opts } = {}) => {
    const chat = getAutomationChat()
    if (!chat) return { ok: false, error: 'Chat no inicializado' }
    try {
      const safeOpts = (opts && typeof opts === 'object') ? { ...opts } : {}
      if (typeof safeOpts.provider !== 'string') safeOpts.provider = ''
      if (typeof safeOpts.model !== 'string') safeOpts.model = ''
      if (typeof safeOpts.effort !== 'string') safeOpts.effort = ''
      const res = await chat.sendMessage(automationId, content, safeOpts)
      if (res && res.ok === false) {
        return { ok: false, error: res.error, providerError: true, provider: res.provider, messageId: res.messageId }
      }
      return { ok: true, messageId: res.messageId, provider: res.provider }
    } catch (err) {
      // Salvaguarda: no relanzar al renderer, devolver providerError.
      return { ok: false, providerError: true, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('automation-chat:switch-provider', async (_e, { automationId, toProvider, withSummary } = {}) => {
    const chat = getAutomationChat()
    if (!chat || !automationId) return { ok: false, error: 'Chat no inicializado' }
    try {
      const res = await chat.switchProvider(automationId, { toProvider, withSummary: !!withSummary })
      return res
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('automation-chat:clear-thread', async (_e, { automationId, provider } = {}) => {
    const chat = getAutomationChat()
    if (!chat || !automationId) return { ok: false, error: 'Chat no inicializado' }
    try { return await chat.clearThread(automationId, { provider }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('automation-chat:retry-last', async (_e, { automationId, opts } = {}) => {
    const chat = getAutomationChat()
    if (!chat || !automationId) return { ok: false, error: 'Chat no inicializado' }
    try {
      const prefs = await chat.getPreferences(automationId)
      const last = await chat.getLastUserMessage(automationId, { provider: prefs.provider })
      if (!last) return { ok: false, error: 'Sin mensaje previo del usuario para reintentar' }
      const safeOpts = (opts && typeof opts === 'object') ? { ...opts } : {}
      safeOpts.provider = prefs.provider
      if (typeof safeOpts.model !== 'string') safeOpts.model = prefs.model || ''
      if (typeof safeOpts.effort !== 'string') safeOpts.effort = prefs.effort || ''
      const res = await chat.sendMessage(automationId, last, safeOpts)
      if (res && res.ok === false) {
        return { ok: false, error: res.error, providerError: true, provider: res.provider, messageId: res.messageId }
      }
      return { ok: true, messageId: res.messageId, provider: res.provider }
    } catch (err) {
      return { ok: false, providerError: true, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('automation-chat:get-preferences', async (_e, { automationId } = {}) => {
    const chat = getAutomationChat()
    if (!chat || !automationId) return { provider: 'claude', model: '', effort: '' }
    try { return await chat.getPreferences(automationId) }
    catch (err) {
      console.error('[automation-chat:get-preferences]', err?.message || err)
      return { provider: 'claude', model: '', effort: '' }
    }
  })

  ipcMain.handle('automation-chat:set-preferences', async (_e, { automationId, provider, model, effort } = {}) => {
    const chat = getAutomationChat()
    if (!chat || !automationId) return { ok: false, error: 'Chat no inicializado' }
    try {
      const res = await chat.setPreferences(automationId, { provider, model, effort })
      return { ok: true, ...res }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('automation-chat:apply-changes', async (_e, payload = {}) => {
    const chat = getAutomationChat()
    if (!chat) return { ok: false, error: 'Chat no inicializado' }
    const { automationId, script, plist, alsoReinstall } = payload
    try {
      if (alsoReinstall) {
        return await chat.applyAndReinstall(automationId, { script, plist })
      }
      return await chat.applyProposedChanges(automationId, { script, plist })
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('automation-chat:window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.close()
    return { ok: true }
  })

  ipcMain.handle('automation-chat:window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.minimize()
    return { ok: true }
  })
}

module.exports = { registerAutomationChatIpc }
