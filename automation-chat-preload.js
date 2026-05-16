'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function listener(channel) {
  return (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('chatAPI', {
  init:           ()           => ipcRenderer.invoke('automation-chat:init'),
  getHistory:     (automationId, opts) => {
    const provider = (opts && typeof opts === 'object' && typeof opts.provider === 'string') ? opts.provider : undefined
    return ipcRenderer.invoke('automation-chat:get-history', { automationId, provider })
  },
  send:           (automationId, contentOrPayload, opts) => {
    // Acepta send(aid, "texto", { includeLog, provider, model, effort })
    // o send(aid, { content, provider, model, effort, includeLog })
    let content = ''
    let merged = opts && typeof opts === 'object' ? { ...opts } : {}
    if (contentOrPayload && typeof contentOrPayload === 'object') {
      content = String(contentOrPayload.content || '')
      if (typeof contentOrPayload.provider === 'string') merged.provider = contentOrPayload.provider
      if (typeof contentOrPayload.model === 'string') merged.model = contentOrPayload.model
      if (typeof contentOrPayload.effort === 'string') merged.effort = contentOrPayload.effort
      if (typeof contentOrPayload.includeLog === 'boolean') merged.includeLog = contentOrPayload.includeLog
    } else {
      content = String(contentOrPayload || '')
    }
    return ipcRenderer.invoke('automation-chat:send', { automationId, content, opts: merged })
  },
  applyChanges:   (automationId, payload) => ipcRenderer.invoke('automation-chat:apply-changes', { automationId, ...payload }),
  getAutomation:  (automationId) => ipcRenderer.invoke('automations:get', { id: automationId }),
  readLog:        (automationId, lines) => ipcRenderer.invoke('automations:read-log', { id: automationId, opts: { lines: lines || 100 } }),
  getPreferences: (automationId) => ipcRenderer.invoke('automation-chat:get-preferences', { automationId }),
  setPreferences: (automationId, { provider, model, effort } = {}) => ipcRenderer.invoke('automation-chat:set-preferences', { automationId, provider, model, effort }),
  switchProvider: (automationId, { toProvider, withSummary } = {}) => ipcRenderer.invoke('automation-chat:switch-provider', { automationId, toProvider, withSummary: !!withSummary }),
  clearThread:    (automationId, { provider } = {}) => ipcRenderer.invoke('automation-chat:clear-thread', { automationId, provider }),
  retryLast:      (automationId, opts = {}) => ipcRenderer.invoke('automation-chat:retry-last', { automationId, opts }),
  close:          ()           => ipcRenderer.invoke('automation-chat:window-close'),
  minimize:       ()           => ipcRenderer.invoke('automation-chat:window-minimize'),

  onToken:        listener('automation-chat:token'),
  onMessageDone:  listener('automation-chat:message-done'),
  onUserMessage:  listener('automation-chat:user-message'),
  onError:        listener('automation-chat:error'),
  onProviderError: listener('automation-chat:provider-error'),
  onThreadCleared: listener('automation-chat:thread-cleared')
})
