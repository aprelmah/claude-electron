'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function listener(channel) {
  return (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('taskAgentPty', {
  init:           ()           => ipcRenderer.invoke('task-agent-pty:init'),
  start:          (cols, rows) => ipcRenderer.invoke('task-agent-pty:start', { cols, rows }),
  write:          (data)       => ipcRenderer.send('task-agent-pty:write', data),
  resize:         (cols, rows) => ipcRenderer.send('task-agent-pty:resize', { cols, rows }),
  restart:        (cols, rows) => ipcRenderer.invoke('task-agent-pty:restart', { cols, rows }),
  setCli:         (cli)        => ipcRenderer.invoke('task-agent-pty:set-cli', { cli }),
  checkProposal:  ()           => ipcRenderer.invoke('task-agent-pty:check-proposal'),
  applyProposal:  (payload)    => ipcRenderer.invoke('task-agent:apply-proposal', payload),
  closeSelf:      ()           => ipcRenderer.send('task-agent-pty:close-self'),
  minimizeSelf:   ()           => ipcRenderer.send('task-agent-pty:minimize-self'),

  onData:     listener('task-agent-pty:data'),
  onExit:     listener('task-agent-pty:exit'),
  onError:    listener('task-agent-pty:error'),
  onProposal: listener('task-agent-pty:proposal-detected'),
  onStatus:   listener('task-agent-pty:status')
})
