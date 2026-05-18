const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  closeWindow: () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  fileWrite: (p, text) => ipcRenderer.invoke('file-write', { path: p, text }),

  whatsapp: {
    status: () => ipcRenderer.invoke('whatsapp:status'),
    getStatus: () => ipcRenderer.invoke('whatsapp:status'),
    getQr: () => ipcRenderer.invoke('whatsapp:get-qr'),
    getQR: () => ipcRenderer.invoke('whatsapp:get-qr'),
    getChats: () => ipcRenderer.invoke('whatsapp:get-chats'),
    getHistory: (jid, opts) => ipcRenderer.invoke('whatsapp:get-history', jid, opts || {}),
    sendText: (jid, text) => ipcRenderer.invoke('whatsapp:send-text', jid, text),
    sendImage: (jid, filePath, caption) => ipcRenderer.invoke('whatsapp:send-image', jid, filePath, caption || ''),
    sendAudio: (jid, filePath, ptt) => ipcRenderer.invoke('whatsapp:send-audio', jid, filePath, ptt !== false),
    sendDocument: (jid, filePath, caption) => ipcRenderer.invoke('whatsapp:send-document', jid, filePath, caption || ''),
    requestPhone: (jid) => ipcRenderer.invoke('whatsapp:request-phone', jid),
    setMode: (jid, mode) => ipcRenderer.invoke('whatsapp:set-mode', jid, mode),
    markRead: (jid) => ipcRenderer.invoke('whatsapp:mark-read', jid),
    getConfig: () => ipcRenderer.invoke('whatsapp:get-config'),
    saveConfig: (cfg) => ipcRenderer.invoke('whatsapp:save-config', cfg || {}),
    transcribeAudio: (mediaPath) => ipcRenderer.invoke('whatsapp:transcribe-audio', mediaPath),
    onNewMessage: (cb) => {
      const h = (_e, payload) => cb(payload)
      ipcRenderer.on('whatsapp:new-message', h)
      return () => ipcRenderer.removeListener('whatsapp:new-message', h)
    },
    onChatUpdated: (cb) => {
      const h = (_e, payload) => cb(payload)
      ipcRenderer.on('whatsapp:chat-updated', h)
      return () => ipcRenderer.removeListener('whatsapp:chat-updated', h)
    },
    onStatusChanged: (cb) => {
      const h = (_e, status) => cb(status)
      ipcRenderer.on('whatsapp:status-changed', h)
      return () => ipcRenderer.removeListener('whatsapp:status-changed', h)
    }
  }
})
