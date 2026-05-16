const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  startPty: (cols, rows, cwd) => ipcRenderer.invoke('pty-start', { cols, rows, cwd }),
  writePty: (data) => ipcRenderer.send('pty-input', data),
  resizePty: (cols, rows) => ipcRenderer.send('pty-resize', { cols, rows }),
  restartPty: (cwd, cols, rows) => ipcRenderer.invoke('pty-restart', { cwd, cols, rows }),
  ptyCwd: () => ipcRenderer.invoke('pty-cwd'),
  onPtyData: (cb) => ipcRenderer.on('pty-data', (_, d) => cb(d)),
  onPtyExit: (cb) => ipcRenderer.on('pty-exit', () => cb()),
  onPtyError: (cb) => ipcRenderer.on('pty-error', (_, message) => cb(message)),

  transcribeAudio: (arrayBuffer) => ipcRenderer.invoke('transcribe-audio', arrayBuffer),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  pickFile: () => ipcRenderer.invoke('pick-file'),

  readDir: (path) => ipcRenderer.invoke('fs-read-dir', path),
  pickFolder: () => ipcRenderer.invoke('fs-pick-folder'),
  homeDir: () => ipcRenderer.invoke('fs-home'),
  watchDir: (p) => ipcRenderer.invoke('fs-watch-dir', p),
  onTreeChanged: (cb) => ipcRenderer.on('tree-changed', (_, reason) => cb(reason)),

  listSessions: (cwd) => ipcRenderer.invoke('list-sessions', cwd),
  deleteSession: (cwd, sessionId) => ipcRenderer.invoke('delete-session', { cwd, sessionId }),
  resumeSession: (sessionId, cwd, cols, rows) => ipcRenderer.invoke('resume-session', { sessionId, cwd, cols, rows }),

  fileInfo: (p) => ipcRenderer.invoke('file-info', p),
  fileRead: (p) => ipcRenderer.invoke('file-read', p),
  fileWrite: (p, text) => ipcRenderer.invoke('file-write', { path: p, text }),

  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  getActiveCli: () => ipcRenderer.invoke('get-active-cli'),
  setActiveCli: (cli) => ipcRenderer.invoke('set-active-cli', cli),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  saveAppConfig: (config) => ipcRenderer.invoke('save-app-config', config),
  getTelegramStatus: () => ipcRenderer.invoke('get-telegram-status'),
  onTelegramStatus: (cb) => ipcRenderer.on('telegram-status', (_, status) => cb(status)),
  canSendSessionToTelegram: () => ipcRenderer.invoke('app:can-send-to-telegram'),
  sendSessionToTelegram: () => ipcRenderer.invoke('app:send-session-to-telegram'),
  onPtyTransferredToTelegram: (cb) => ipcRenderer.on('pty-transferred-to-telegram', (_, p) => cb(p)),

  closeWindow: () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  togglePin: () => ipcRenderer.send('window-toggle-pin'),
  isPinned: () => ipcRenderer.invoke('is-pinned'),
  newWindow: () => ipcRenderer.send('window-new'),

  openViewerWindow: (path, hint) => ipcRenderer.invoke('viewer-open', { path, hint }),
  onInjectPath: (cb) => ipcRenderer.on('inject-path', (_, p) => cb(p)),

  openTasksManager: () => ipcRenderer.invoke('tasks-manager:open'),
  onTaskRunStarted: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('tasks:run-started', h)
    return () => ipcRenderer.removeListener('tasks:run-started', h)
  },
  onTaskRunFinished: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('tasks:run-finished', h)
    return () => ipcRenderer.removeListener('tasks:run-finished', h)
  }
})
