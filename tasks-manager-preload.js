const { contextBridge, ipcRenderer } = require('electron');

function listener(channel) {
  return (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('tasksAPI', {
  list:        ()          => ipcRenderer.invoke('tasks:list'),
  get:         (id)        => ipcRenderer.invoke('tasks:get', { id }),
  create:      (data)      => ipcRenderer.invoke('tasks:create', data),
  update:      (id, patch) => ipcRenderer.invoke('tasks:update', { id, patch }),
  remove:      (id)        => ipcRenderer.invoke('tasks:delete', { id }),
  toggle:      (id, on)    => ipcRenderer.invoke('tasks:toggle', { id, enabled: on }),
  runNow:      (id)        => ipcRenderer.invoke('tasks:run-now', { id }),
  cancel:      (id)        => ipcRenderer.invoke('tasks:cancel', { id }),
  getRuns:     (opts)      => ipcRenderer.invoke('tasks:get-runs', opts || {}),
  validateCron:(expr)      => ipcRenderer.invoke('tasks:validate-cron', { expr }),
  listCwds:    ()          => ipcRenderer.invoke('tasks:list-cwds'),
  getCronPresets: ()       => ipcRenderer.invoke('tasks:get-cron-presets'),
  pickFolder:  ()          => ipcRenderer.invoke('tasks:pick-folder'),
  getTheme:    ()          => ipcRenderer.invoke('tasks:get-theme'),
  getTelegramConfigured: () => ipcRenderer.invoke('tasks:get-telegram-configured'),
  getDefaultModelEffort: () => ipcRenderer.invoke('tasks:get-default-model-effort'),

  close:       ()          => ipcRenderer.invoke('tasks:window-close'),
  minimize:    ()          => ipcRenderer.invoke('tasks:window-minimize'),

  onListChanged:  listener('tasks:list-changed'),
  onRunStarted:   listener('tasks:run-started'),
  onRunProgress:  listener('tasks:run-progress'),
  onRunFinished:  listener('tasks:run-finished'),

  // ---------- Automations (system-level) ----------
  automationsList:           ()        => ipcRenderer.invoke('automations:list'),
  automationsGet:            (id)      => ipcRenderer.invoke('automations:get', { id }),
  automationsGenerateDraft:  (payload) => ipcRenderer.invoke('automations:generate-draft', payload),
  automationsCreateDraftShell: (payload) => ipcRenderer.invoke('automations:create-draft-shell', payload),
  automationsRegenerate:     (payload) => ipcRenderer.invoke('automations:regenerate', payload),
  automationsUpdateDraft:    (payload) => ipcRenderer.invoke('automations:update-draft', payload),
  automationsInstall:        (payload) => ipcRenderer.invoke('automations:install', payload),
  automationsUninstall:      (payload) => ipcRenderer.invoke('automations:uninstall', payload),
  automationsRunOnce:        (payload) => ipcRenderer.invoke('automations:run-once', payload),
  automationsReadLog:        (payload) => ipcRenderer.invoke('automations:read-log', payload),
  automationsRemove:         (payload) => ipcRenderer.invoke('automations:remove', payload),
  automationsPause:          (payload) => ipcRenderer.invoke('automations:pause', payload),
  automationsResume:         (payload) => ipcRenderer.invoke('automations:resume', payload),
  automationsGetRunning:     ()        => ipcRenderer.invoke('automations:get-running'),
  automationsStopRun:        (payload) => ipcRenderer.invoke('automations:stop-run', payload),
  automationsShellcheckStatus: ()      => ipcRenderer.invoke('automations:shellcheck-status'),
  automationsLint:           (payload) => ipcRenderer.invoke('automations:lint', payload),
  openAutomationChat:        (payload) => ipcRenderer.invoke('automation-chat:open', payload),
  revealInFinder:            (path)    => ipcRenderer.invoke('shell:reveal-in-finder', { path }),

  onAutomationsListChanged:  listener('automations:list-changed'),
  onAutomationRunStarted:    listener('automations:run-started'),
  onAutomationRunFinished:   listener('automations:run-finished'),
});
