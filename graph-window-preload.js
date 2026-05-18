const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getGraphWindowData: async () => {
    const initial = await ipcRenderer.invoke('graph-window:get-data')
    if (initial && Array.isArray(initial.nodes) && initial.nodes.length) return initial
    try {
      const fetched = await ipcRenderer.invoke('graph-window:fetch-graph', null)
      if (fetched && Array.isArray(fetched.nodes) && fetched.nodes.length) return fetched
    } catch {}
    return initial || { nodes: [], edges: [], dirs: [] }
  },
  closeWindow: () => ipcRenderer.send('window-close')
})
