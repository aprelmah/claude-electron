'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function listener(channel) {
  return (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('taskChatAPI', {
  init:           ()                => ipcRenderer.invoke('task-chat:init'),
  getHistory:     (threadId, opts)  => {
    const provider = (opts && typeof opts === 'object' && typeof opts.provider === 'string') ? opts.provider : undefined
    return ipcRenderer.invoke('task-chat:get-history', { threadId, provider })
  },
  send:           (threadId, contentOrPayload, opts) => {
    let content = ''
    let merged = opts && typeof opts === 'object' ? { ...opts } : {}
    if (contentOrPayload && typeof contentOrPayload === 'object') {
      content = String(contentOrPayload.content || '')
      if (typeof contentOrPayload.provider === 'string') merged.provider = contentOrPayload.provider
      if (typeof contentOrPayload.model === 'string') merged.model = contentOrPayload.model
      if (typeof contentOrPayload.effort === 'string') merged.effort = contentOrPayload.effort
    } else {
      content = String(contentOrPayload || '')
    }
    return ipcRenderer.invoke('task-chat:send', { threadId, content, opts: merged })
  },
  applyChanges:   (threadId, payload = {}) => ipcRenderer.invoke('task-chat:apply-changes', { threadId, ...payload }),
  getPreferences: (threadId)        => ipcRenderer.invoke('task-chat:get-preferences', { threadId }),
  setPreferences: (threadId, { provider, model, effort } = {}) => ipcRenderer.invoke('task-chat:set-preferences', { threadId, provider, model, effort }),
  switchProvider: (threadId, { toProvider, withSummary } = {}) => ipcRenderer.invoke('task-chat:switch-provider', { threadId, toProvider, withSummary: !!withSummary }),
  clearThread:    (threadId, { provider } = {}) => ipcRenderer.invoke('task-chat:clear-thread', { threadId, provider }),
  retryLast:      (threadId, opts = {}) => ipcRenderer.invoke('task-chat:retry-last', { threadId, opts }),
  close:          ()                => ipcRenderer.invoke('task-chat:window-close'),
  minimize:       ()                => ipcRenderer.invoke('task-chat:window-minimize'),

  onToken:        listener('task-chat:token'),
  onMessageDone:  listener('task-chat:message-done'),
  onUserMessage:  listener('task-chat:user-message'),
  onError:        listener('task-chat:error'),
  onProviderError: listener('task-chat:provider-error'),
  onThreadCleared: listener('task-chat:thread-cleared')
})
