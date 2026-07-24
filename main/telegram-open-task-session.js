'use strict'

// Lógica pura del callback onOpenTaskSession del bridge Telegram.
// Extraído para hacer testeable la regla PTY-C1: tras hit del pool oculto,
// el binding chat→wcId DEBE re-poblarse (porque /abrir llama onUnlinkRelay
// inmediatamente antes y deja telegramRelayByChat vacío).

function isValidSid(sid, validate) {
  if (!sid) return false
  return typeof validate === 'function' ? Boolean(validate(sid)) : true
}

async function handleOpenTaskSession({ sessionId, cli, cwd, taskName, chatId }, deps) {
  const {
    isValidSessionId,
    normalizeTelegramChatKey,
    telegramHiddenPtyPool,
    taskSessionStateByWc,
    telegramRelayByChat,
    openTaskSessionWindow
  } = deps

  if (!isValidSid(sessionId, isValidSessionId)) {
    return { ok: false, error: 'sessionId inválido' }
  }
  const targetCli = cli === 'codex' ? 'codex' : 'claude'
  const key = normalizeTelegramChatKey
    ? normalizeTelegramChatKey(chatId)
    : (chatId ? String(chatId) : '')

  if (key && telegramHiddenPtyPool) {
    const existing = telegramHiddenPtyPool.getHiddenPtyForChat(key)
    if (existing && existing.sessionId === sessionId && existing.cli === targetCli) {
      const shown = telegramHiddenPtyPool.showHiddenPty(key)
      if (shown) {
        const st = taskSessionStateByWc ? taskSessionStateByWc.get(existing.wcId) : null
        if (st) st.hidden = false
        // PTY-C1: re-bindear chat → wcId.
        try {
          if (telegramRelayByChat) telegramRelayByChat.set(key, existing.wcId)
        } catch {}
        return { ok: true, fromPool: true, wcId: existing.wcId }
      }
    }
  }
  const win = await openTaskSessionWindow({
    sessionId,
    cwd: cwd || '',
    cli: targetCli,
    taskName: taskName || '',
    chatId: key
  })
  if (!win) return { ok: false, error: 'No se pudo abrir la ventana' }
  if (key) {
    try { telegramRelayByChat.set(key, win.webContents.id) } catch {}
  }
  return { ok: true, wcId: win.webContents.id }
}

module.exports = { handleOpenTaskSession }
