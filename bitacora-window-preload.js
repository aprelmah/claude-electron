const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bitacoraApi', {
  listEntries: (limit = 500) => ipcRenderer.invoke('bitacora:list', { limit }),
  exportCsv: (entries, name) => ipcRenderer.invoke('bitacora:export-csv', {
    entries: Array.isArray(entries) ? entries : [],
    name: typeof name === 'string' ? name : ''
  })
})
