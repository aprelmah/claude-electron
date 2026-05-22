'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function listener(channel) {
  return (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('taskSessionApi', {
  init:         ()             => ipcRenderer.invoke('task-session:init'),
  start:        (cols, rows)   => ipcRenderer.invoke('task-session:start', { cols, rows }),
  write:        (data)         => ipcRenderer.send('task-session:write', data),
  resize:       (cols, rows)   => ipcRenderer.send('task-session:resize', { cols, rows }),
  closeSelf:    ()             => ipcRenderer.send('task-session:close-self'),
  minimizeSelf: ()             => ipcRenderer.send('task-session:minimize-self'),

  onData:    listener('task-session:data'),
  onExit:    listener('task-session:exit'),
  onError:   listener('task-session:error'),
  onSidUpdated: listener('task-session:session-id-updated')
})
