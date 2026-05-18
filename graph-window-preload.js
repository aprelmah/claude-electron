const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getGraphWindowData: () => ipcRenderer.invoke('graph-window:get-data'),
  fetchGraph: (rootPath) => ipcRenderer.invoke('graph-window:fetch-graph', rootPath || null),
  closeWindow: () => ipcRenderer.send('window-close'),
  fileRead: (p) => ipcRenderer.invoke('file-read', p),
  fileWrite: (p, text) => ipcRenderer.invoke('file-write', { path: p, text })
})
