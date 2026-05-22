function createSinks({ telegramBridge, broadcastToAllWindows }) {
  return {
    notifyMacOS: ({ task, run }) => {
      try {
        const { Notification } = require('electron')
        const ok = run.status === 'ok'
        const body = ok
          ? `OK · ${(run.durationMs / 1000).toFixed(1)}s`
          : `Error: ${run.error || 'desconocido'}`
        new Notification({
          title: `Tarea: ${task.name}`,
          body,
          silent: false
        }).show()
      } catch (err) {
        // No frenar el run por fallo de notificación
      }
    },

    telegram: async ({ task, run }) => {
      try {
        const bridge = telegramBridge
        if (!bridge || !bridge.running) return
        const cfg = bridge.config || {}
        const chatId = cfg.defaultChatId
          || (Array.isArray(cfg.allowedUsers) ? cfg.allowedUsers[0] : null)
        if (!chatId) return
        if (typeof bridge.sendMessage !== 'function') return
        const head = `⏰ ${task.name} — ${run.status === 'ok' ? 'OK' : 'ERROR'}`
        const body = run.status === 'ok'
          ? ((run.output && run.output.slice(0, 3500)) || '(sin salida)')
          : (run.error || '(error desconocido)')
        await bridge.sendMessage(chatId, `${head}\n\n${body}`)
      } catch {}
    },

    logApp: () => {
      // Cubierto por broadcast 'tasks:run-finished' + persistence.appendRun
    }
  }
}

function createInboxSink({ inbox, broadcast }) {
  if (!inbox) return null
  const bc = typeof broadcast === 'function' ? broadcast : () => {}
  return function inboxSink({ task, run }) {
    try {
      if (!run || run.status !== 'ok') return
      const sessionId = (task && task.sessionId) || (run && run.sessionId) || null
      inbox.appendUnread({
        runId: run.runId,
        taskId: task ? task.id : '',
        taskName: task ? task.name : '',
        cli: task ? task.cli : 'claude',
        sessionId,
        cwd: (task && task.cwd) || '',
        finishedAt: run.finishedAt,
        status: 'ok',
        output: run.output || ''
      })
      try {
        bc('tasks:inbox-updated', { unreadCount: inbox.count({ unreadOnly: true }) })
      } catch {}
    } catch {
      // Un fallo en el inbox no debe romper el scheduler
    }
  }
}

module.exports = { createSinks, createInboxSink }
