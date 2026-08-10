'use strict'
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => {
    try { return webUtils?.getPathForFile?.(file) || '' } catch { return '' }
  },
  kb: {
    list: (cwd) => ipcRenderer.invoke('kb:list', { cwd }),
    toggle: (cwd, relPath, active) => ipcRenderer.invoke('kb:toggle', { cwd, relPath, active }),
    addFile: (cwd, filePath) => ipcRenderer.invoke('kb:add-file', { cwd, filePath }),
    distill: (cwd, source) => ipcRenderer.invoke('kb:distill', { cwd, source }),
    applyToSession: (cwd, relPaths) => ipcRenderer.invoke('kb:apply-to-session', { cwd, relPaths }),
    addShortcut: (cwd, entry) => ipcRenderer.invoke('kb:add-shortcut', { cwd, ...entry }),
    reveal: (cwd, relPath) => ipcRenderer.invoke('kb:reveal', { cwd, relPath }),
    remove: (cwd, relPath, deleteFile) => ipcRenderer.invoke('kb:remove', { cwd, relPath, deleteFile }),
    readFicha: (cwd, relPath) => ipcRenderer.invoke('kb:read-ficha', { cwd, relPath }),
    writeFicha: (cwd, relPath, text) => ipcRenderer.invoke('kb:write-ficha', { cwd, relPath, text }),
    onProgress: (cb) => {
      const h = (_e, payload) => cb(payload)
      ipcRenderer.on('kb:progress', h)
      return () => ipcRenderer.removeListener('kb:progress', h)
    }
  }
})
