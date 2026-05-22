'use strict'

const { DEFAULT_THREAD_ID } = require('../tasks/chat')

function registerTaskChatIpc({
  ipcMain,
  BrowserWindow,
  getTaskChat,
  getTaskChatWcToThread
}) {
  function resolveThreadId(event, payloadThreadId) {
    if (typeof payloadThreadId === 'string' && payloadThreadId.trim()) return payloadThreadId
    const map = getTaskChatWcToThread && getTaskChatWcToThread()
    if (map) {
      const tid = map.get(event.sender.id)
      if (tid) return tid
    }
    return DEFAULT_THREAD_ID
  }

  ipcMain.handle('task-chat:init', (event) => {
    const tid = resolveThreadId(event, null)
    return { threadId: tid }
  })

  ipcMain.handle('task-chat:get-history', async (event, { threadId, provider } = {}) => {
    const chat = getTaskChat()
    if (!chat) return []
    const tid = resolveThreadId(event, threadId)
    try { return await chat.getHistory(tid, { provider }) }
    catch (err) { console.error('[task-chat:get-history]', err?.message || err); return [] }
  })

  ipcMain.handle('task-chat:send', async (event, { threadId, content, opts } = {}) => {
    const chat = getTaskChat()
    if (!chat) return { ok: false, error: 'Chat no inicializado' }
    const tid = resolveThreadId(event, threadId)
    try {
      const safeOpts = (opts && typeof opts === 'object') ? { ...opts } : {}
      if (typeof safeOpts.provider !== 'string') safeOpts.provider = ''
      if (typeof safeOpts.model !== 'string') safeOpts.model = ''
      if (typeof safeOpts.effort !== 'string') safeOpts.effort = ''
      const res = await chat.sendMessage(tid, content, safeOpts)
      if (res && res.ok === false) {
        return { ok: false, error: res.error, providerError: true, provider: res.provider, messageId: res.messageId }
      }
      return { ok: true, messageId: res.messageId, provider: res.provider }
    } catch (err) {
      return { ok: false, providerError: true, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('task-chat:switch-provider', async (event, { threadId, toProvider, withSummary } = {}) => {
    const chat = getTaskChat()
    if (!chat) return { ok: false, error: 'Chat no inicializado' }
    const tid = resolveThreadId(event, threadId)
    try {
      const res = await chat.switchProvider(tid, { toProvider, withSummary: !!withSummary })
      return res
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('task-chat:clear-thread', async (event, { threadId, provider } = {}) => {
    const chat = getTaskChat()
    if (!chat) return { ok: false, error: 'Chat no inicializado' }
    const tid = resolveThreadId(event, threadId)
    try { return await chat.clearThread(tid, { provider }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('task-chat:retry-last', async (event, { threadId, opts } = {}) => {
    const chat = getTaskChat()
    if (!chat) return { ok: false, error: 'Chat no inicializado' }
    const tid = resolveThreadId(event, threadId)
    try {
      const prefs = await chat.getPreferences(tid)
      const last = await chat.getLastUserMessage(tid, { provider: prefs.provider })
      if (!last) return { ok: false, error: 'Sin mensaje previo del usuario para reintentar' }
      const safeOpts = (opts && typeof opts === 'object') ? { ...opts } : {}
      safeOpts.provider = prefs.provider
      if (typeof safeOpts.model !== 'string') safeOpts.model = prefs.model || ''
      if (typeof safeOpts.effort !== 'string') safeOpts.effort = prefs.effort || ''
      const res = await chat.sendMessage(tid, last, safeOpts)
      if (res && res.ok === false) {
        return { ok: false, error: res.error, providerError: true, provider: res.provider, messageId: res.messageId }
      }
      return { ok: true, messageId: res.messageId, provider: res.provider }
    } catch (err) {
      return { ok: false, providerError: true, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('task-chat:get-preferences', async (event, { threadId } = {}) => {
    const chat = getTaskChat()
    if (!chat) return { provider: 'claude', model: '', effort: '' }
    const tid = resolveThreadId(event, threadId)
    try { return await chat.getPreferences(tid) }
    catch (err) {
      console.error('[task-chat:get-preferences]', err?.message || err)
      return { provider: 'claude', model: '', effort: '' }
    }
  })

  ipcMain.handle('task-chat:set-preferences', async (event, { threadId, provider, model, effort } = {}) => {
    const chat = getTaskChat()
    if (!chat) return { ok: false, error: 'Chat no inicializado' }
    const tid = resolveThreadId(event, threadId)
    try {
      const res = await chat.setPreferences(tid, { provider, model, effort })
      return { ok: true, ...res }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('task-chat:apply-changes', async (event, payload = {}) => {
    const chat = getTaskChat()
    if (!chat) return { ok: false, error: 'Chat no inicializado' }
    const { threadId, taskJson, taskOverride } = payload
    const tid = resolveThreadId(event, threadId)
    try {
      const res = await chat.applyChanges(tid, { taskJson, taskOverride })
      // Cerrar la ventana si OK (UX: el usuario vuelve al panel y ve la nueva tarea).
      if (res && res.ok) {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (win && !win.isDestroyed()) {
          // Pequeño delay para que el renderer pueda mostrar toast antes de cerrar.
          setTimeout(() => { try { win.close() } catch {} }, 400)
        }
      }
      return res
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('task-chat:window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.close()
    return { ok: true }
  })

  ipcMain.handle('task-chat:window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.minimize()
    return { ok: true }
  })
}

module.exports = { registerTaskChatIpc }
