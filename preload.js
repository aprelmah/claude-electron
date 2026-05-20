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
  onPtyBusy: (cb) => ipcRenderer.on('pty-busy', (_, message) => cb(message)),

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
  updateSessionTitle: (cwd, sessionId, title) => ipcRenderer.invoke('update-session-title', { cwd, sessionId, title }),
  resumeSession: (sessionId, cwd, cols, rows) => ipcRenderer.invoke('resume-session', { sessionId, cwd, cols, rows }),

  fileInfo: (p) => ipcRenderer.invoke('file-info', p),
  fileRead: (p) => ipcRenderer.invoke('file-read', p),
  fileWrite: (p, text) => ipcRenderer.invoke('file-write', { path: p, text }),

  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  getActiveCli: () => ipcRenderer.invoke('get-active-cli'),
  getCurrentSessionMeta: () => ipcRenderer.invoke('get-current-session-meta'),
  setActiveCli: (cli) => ipcRenderer.invoke('set-active-cli', cli),
  copyText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  saveAppConfig: (config) => ipcRenderer.invoke('save-app-config', config),
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  createProfile: (profile) => ipcRenderer.invoke('profiles:create', profile),
  updateProfile: (id, patch) => ipcRenderer.invoke('profiles:update', { id, patch }),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  setActiveProfile: (id) => ipcRenderer.invoke('profiles:set-active', id),
  pickProfileClaudeMd: () => ipcRenderer.invoke('profiles:pick-claude-md'),
  pickProfileCwd: () => ipcRenderer.invoke('profiles:pick-cwd'),
  getTelegramStatus: () => ipcRenderer.invoke('get-telegram-status'),
  getHealth: () => ipcRenderer.invoke('health:get'),
  wsServerStart: (port) => ipcRenderer.invoke('ws-server:start', { port }),
  wsServerStop: () => ipcRenderer.invoke('ws-server:stop'),
  wsServerSessions: () => ipcRenderer.invoke('ws-server:sessions'),
  wsServerCloseSession: (id) => ipcRenderer.invoke('ws-server:close-session', { id }),
  getPendingProposal: () => ipcRenderer.invoke('proposal:get-pending'),
  proposalApprove: (id) => ipcRenderer.invoke('proposal:approve', { id }),
  proposalReject: (id) => ipcRenderer.invoke('proposal:reject', { id }),
  onProposalNew: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('proposal:new', h)
    return () => ipcRenderer.removeListener('proposal:new', h)
  },
  onProposalCleared: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('proposal:cleared', h)
    return () => ipcRenderer.removeListener('proposal:cleared', h)
  },
  onUpdateAvailable: (cb) => {
    const h = () => cb()
    ipcRenderer.on('update:available', h)
    return () => ipcRenderer.removeListener('update:available', h)
  },
  onUpdateDownloaded: (cb) => {
    const h = () => cb()
    ipcRenderer.on('update:downloaded', h)
    return () => ipcRenderer.removeListener('update:downloaded', h)
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onTelegramStatus: (cb) => ipcRenderer.on('telegram-status', (_, status) => cb(status)),
  canSendSessionToTelegram: () => ipcRenderer.invoke('app:can-send-to-telegram'),
  sendSessionToTelegram: () => ipcRenderer.invoke('app:send-session-to-telegram'),
  disconnectSessionFromTelegram: () => ipcRenderer.invoke('app:disconnect-session-from-telegram'),
  onPtyTransferredToTelegram: (cb) => ipcRenderer.on('pty-transferred-to-telegram', (_, p) => cb(p)),

  closeWindow: () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  togglePin: () => ipcRenderer.send('window-toggle-pin'),
  isPinned: () => ipcRenderer.invoke('is-pinned'),
  newWindow: () => ipcRenderer.send('window-new'),

  openViewerWindow: (path, hint) => ipcRenderer.invoke('viewer-open', { path, hint }),
  onInjectPath: (cb) => ipcRenderer.on('inject-path', (_, p) => cb(p)),
  onGraphFileActive: (cb) => ipcRenderer.on('graph:file-active', (_, p) => cb(p)),

  openTasksManager: () => ipcRenderer.invoke('tasks-manager:open'),
  openBitacoraWindow: () => ipcRenderer.invoke('bitacora:open'),
  onTaskRunStarted: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('tasks:run-started', h)
    return () => ipcRenderer.removeListener('tasks:run-started', h)
  },
  onTaskRunFinished: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('tasks:run-finished', h)
    return () => ipcRenderer.removeListener('tasks:run-finished', h)
  },

  sidebarGetGraph: (rootPath) => ipcRenderer.invoke('sidebar:get-graph', rootPath),
  openGraphWindow: (nodes, edges, dirs, mode, activeTypes, forces, ui, structureActiveTypes) => ipcRenderer.invoke('graph-window:open', { nodes, edges, dirs, mode, activeTypes, forces, ui, structureActiveTypes }),
  openGraphWindowStandalone: (rootPath) => ipcRenderer.invoke('graph-window:open', { selfFetch: true, rootPath: rootPath || null }),
  openWhatsappWindow: () => ipcRenderer.invoke('whatsapp-window:open'),

  whatsapp: {
    status: () => ipcRenderer.invoke('whatsapp:status'),
    getStatus: () => ipcRenderer.invoke('whatsapp:status'),
    getQr: () => ipcRenderer.invoke('whatsapp:get-qr'),
    getQR: () => ipcRenderer.invoke('whatsapp:get-qr'),
    getChats: () => ipcRenderer.invoke('whatsapp:get-chats'),
    getHistory: (jid, opts) => ipcRenderer.invoke('whatsapp:get-history', jid, opts || {}),
    sendText: (jid, text, opts) => ipcRenderer.invoke('whatsapp:send-text', jid, text, opts),
    sendImage: (jid, filePath, caption) => ipcRenderer.invoke('whatsapp:send-image', jid, filePath, caption || ''),
    sendAudio: (jid, filePath, ptt) => ipcRenderer.invoke('whatsapp:send-audio', jid, filePath, ptt !== false),
    sendDocument: (jid, filePath, caption) => ipcRenderer.invoke('whatsapp:send-document', jid, filePath, caption || ''),
    requestPhone: (jid) => ipcRenderer.invoke('whatsapp:request-phone', jid),
    setMode: (jid, mode) => ipcRenderer.invoke('whatsapp:set-mode', jid, mode),
    markRead: (jid) => ipcRenderer.invoke('whatsapp:mark-read', jid),
    getConfig: () => ipcRenderer.invoke('whatsapp:get-config'),
    saveConfig: (cfg) => ipcRenderer.invoke('whatsapp:save-config', cfg || {}),
    transcribeAudio: (mediaPath) => ipcRenderer.invoke('whatsapp:transcribe-audio', mediaPath),
    getPersona: () => ipcRenderer.invoke('whatsapp:get-persona'),
    savePersona: (text) => ipcRenderer.invoke('whatsapp:save-persona', text),
    onNewMessage: (cb) => {
      const h = (_e, payload) => cb(payload)
      ipcRenderer.on('whatsapp:new-message', h)
      return () => ipcRenderer.removeListener('whatsapp:new-message', h)
    },
    onChatUpdated: (cb) => {
      const h = (_e, payload) => cb(payload)
      ipcRenderer.on('whatsapp:chat-updated', h)
      return () => ipcRenderer.removeListener('whatsapp:chat-updated', h)
    },
    onStatusChanged: (cb) => {
      const h = (_e, status) => cb(status)
      ipcRenderer.on('whatsapp:status-changed', h)
      return () => ipcRenderer.removeListener('whatsapp:status-changed', h)
    }
  }
})
