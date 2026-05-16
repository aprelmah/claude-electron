const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getGraphWindowData: () => ipcRenderer.invoke('graph-window:get-data'),
  closeWindow: () => ipcRenderer.send('window-close')
})
