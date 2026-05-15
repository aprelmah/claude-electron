const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  viewerInit: (cb) => ipcRenderer.on('viewer-init', (_, data) => cb(data)),
  viewerInject: (path) => ipcRenderer.send('viewer-inject-to-active', path),
  viewerClose: () => ipcRenderer.send('viewer-close-self'),
  viewerMinimize: () => ipcRenderer.send('viewer-minimize-self'),

  fileRead: (p) => ipcRenderer.invoke('file-read', p),
  fileWrite: (p, text) => ipcRenderer.invoke('file-write', { path: p, text }),
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
})
