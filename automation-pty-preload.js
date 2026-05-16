'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function listener(channel) {
  return (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('agentPty', {
  init:       ()             => ipcRenderer.invoke('automation-pty:init'),
  start:      (cols, rows)   => ipcRenderer.invoke('automation-pty:start', { cols, rows }),
  write:      (data)         => ipcRenderer.send('automation-pty:write', data),
  resize:     (cols, rows)   => ipcRenderer.send('automation-pty:resize', { cols, rows }),
  restart:    (cols, rows)   => ipcRenderer.invoke('automation-pty:restart', { cols, rows }),
  applyBlocks: (payload)     => ipcRenderer.invoke('automation-pty:apply-blocks', payload),
  extract:    (runner)       => ipcRenderer.invoke('automation-pty:extract', { runner }),
  setCli:     (cli)          => ipcRenderer.invoke('automation-pty:set-cli', { cli }),
  closeSelf:  ()             => ipcRenderer.send('automation-pty:close-self'),
  minimizeSelf: ()           => ipcRenderer.send('automation-pty:minimize-self'),

  onData:     listener('automation-pty:data'),
  onExit:     listener('automation-pty:exit'),
  onError:    listener('automation-pty:error'),
  onBlocks:   listener('automation-pty:blocks-detected'),
  onStatus:   listener('automation-pty:status')
})
