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

module.exports = { createSinks }
