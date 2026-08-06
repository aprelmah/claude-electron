function createSinks({ telegramBridge, broadcastToAllWindows, onEnsureHiddenPty, getNotifyBot, getNotifyChatId }) {
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
      const log = (msg) => {
        try { require('fs').appendFileSync('/tmp/poweragent-tg-sink.log', `[${new Date().toISOString()}] ${msg}\n`) } catch {}
      }
      try {
        const bridge = telegramBridge
        const cfg = (bridge && bridge.config) || {}
        const users = cfg.allowedUsers
        let firstUser = null
        if (users instanceof Set) firstUser = [...users][0]
        else if (Array.isArray(users)) firstUser = users[0]
        else if (users && typeof users === 'object') firstUser = Object.values(users)[0]
        const notifyChatId = typeof getNotifyChatId === 'function' ? getNotifyChatId() : null
        const chatId = notifyChatId || cfg.defaultChatId || firstUser
        if (!chatId) { log(`task=${task.name}: no chatId (defaultChatId=${cfg.defaultChatId} usersType=${users?.constructor?.name})`); return }

        // Bot de avisos separado: el aviso sale por él y el estado del bridge
        // principal (binding de sesión, pool oculto) queda intacto. Continuar
        // la sesión del run es opt-in vía botón inline, nunca efecto colateral.
        const notify = typeof getNotifyBot === 'function' ? getNotifyBot() : null
        if (notify && notify.running) {
          const nHead = `⏰ ${task.name} — ${run.status === 'ok' ? 'OK' : 'ERROR'}`
          const nBody = run.status === 'ok'
            ? ((run.output && run.output.slice(0, 3500)) || '(sin salida)')
            : (run.error || '(error desconocido)')
          const nSid = (run && run.status === 'ok' && (run.sessionId || (task && task.sessionId))) || null
          const session = nSid
            ? {
                sessionId: nSid,
                cli: task.cli || 'claude',
                cwd: (run && run.cwd) || (task && task.cwd) || '',
                taskName: task.name || '',
                runId: run.runId
              }
            : null
          const nHint = session ? '\n\nPulsa «Continuar esta sesión» para engancharla al bot principal.' : ''
          log(`task=${task.name}: sending via notify bot to chatId=${chatId}`)
          await notify.sendTaskNotification({ chatId, text: `${nHead}\n\n${nBody}${nHint}`, session })
          return
        }

        if (!bridge) { log(`task=${task.name}: bridge=null`); return }
        if (!bridge.running) { log(`task=${task.name}: bridge.running=false`); return }
        const send = bridge.sendMessageTo || bridge.sendMessage
        if (typeof send !== 'function') { log(`task=${task.name}: no send fn (typeof sendMessageTo=${typeof bridge.sendMessageTo} sendMessage=${typeof bridge.sendMessage})`); return }
        const head = `⏰ ${task.name} — ${run.status === 'ok' ? 'OK' : 'ERROR'}`
        const body = run.status === 'ok'
          ? ((run.output && run.output.slice(0, 3500)) || '(sin salida)')
          : (run.error || '(error desconocido)')
        const sessionId = (run && run.sessionId) || (task && task.sessionId) || null
        if (sessionId && typeof bridge.rememberRunForChat === 'function') {
          try {
            bridge.rememberRunForChat(chatId, {
              sessionId,
              cli: task.cli || 'claude',
              cwd: (run && run.cwd) || (task && task.cwd) || '',
              taskName: task.name || '',
              runId: run.runId
            })
          } catch {}
        }
        if (run.status === 'ok' && sessionId && typeof onEnsureHiddenPty === 'function') {
          try {
            const res = await onEnsureHiddenPty({
              chatId,
              sessionId,
              cli: task.cli || 'claude',
              cwd: (run && run.cwd) || (task && task.cwd) || '',
              taskName: task.name || ''
            })
            if (res && res.ok === false) log(`task=${task.name}: ensureHiddenPty falló: ${res.error || 'unknown'}`)
          } catch (err) {
            log(`task=${task.name}: ensureHiddenPty EXCEPTION ${err?.message || err}`)
          }
        }
        const hint = (run.status === 'ok' && sessionId) ? '\n\nResponde directamente en este chat para continuar la sesión, o /abrir para verla en el Mac.' : ''
        log(`task=${task.name}: sending to chatId=${chatId} (length=${head.length + body.length + hint.length + 2})`)
        const result = await send.call(bridge, chatId, `${head}\n\n${body}${hint}`)
        log(`task=${task.name}: send OK result=${JSON.stringify(result).slice(0,200)}`)
      } catch (err) {
        log(`task=${task.name}: EXCEPTION ${err && err.stack ? err.stack : (err && err.message) || String(err)}`)
      }
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
