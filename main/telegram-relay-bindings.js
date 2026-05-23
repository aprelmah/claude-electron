'use strict'

function createTelegramRelayBindings({
  telegramRelayByChat,
  getSessions,
  getPrimaryWcId,
  getTelegramBridge,
  killPty,
  startPty,
  updatePrimarySnapshot,
  getTaskSessionByWcId
}) {
  function resolveSessionByWcId(wcId) {
    if (wcId == null) return null
    const ses = getSessions().get(wcId)
    if (ses) return ses
    if (typeof getTaskSessionByWcId === 'function') {
      const taskState = getTaskSessionByWcId(wcId)
      if (taskState) return taskState
    }
    return null
  }
  function canRelayTelegramToPty(session, expectedCli = null) {
    if (!session?.pty) return false
    if (expectedCli && session.activeCli !== expectedCli) return false
    if (!expectedCli && session.activeCli !== 'claude' && session.activeCli !== 'codex') return false
    if (session.relayActive) return false
    return true
  }

  function normalizeTelegramChatKey(chatId) {
    if (chatId == null) return ''
    const key = String(chatId).trim()
    return key || ''
  }

  function getRelayBindingForChat(chatId) {
    const key = normalizeTelegramChatKey(chatId)
    if (!key) return { chatId: '', bound: false, wcId: null, session: null }
    const wcId = telegramRelayByChat.get(key)
    if (wcId == null) return { chatId: key, bound: false, wcId: null, session: null }
    const session = resolveSessionByWcId(wcId)
    if (!session) {
      telegramRelayByChat.delete(key)
      return { chatId: key, bound: false, wcId: null, session: null }
    }
    return { chatId: key, bound: true, wcId, session }
  }

  function getRelayBindingForSession(session, preferredChatId = null) {
    if (!session?.wcId) return { linked: false, chatId: null }
    const preferredKey = normalizeTelegramChatKey(preferredChatId)
    if (preferredKey && telegramRelayByChat.get(preferredKey) === session.wcId) {
      return { linked: true, chatId: preferredKey }
    }
    for (const [chatId, boundWcId] of telegramRelayByChat.entries()) {
      if (boundWcId === session.wcId) return { linked: true, chatId: String(chatId) }
    }
    return { linked: false, chatId: null }
  }

  function describeRelayUnavailable(session, requiredCli = null) {
    if (!session) return 'la ventana enlazada ya no existe'
    if (!session.pty) return 'el PTY de esa ventana no está iniciado'
    if (requiredCli && session.activeCli !== requiredCli) {
      return `esa ventana está en ${session.activeCli}, no en ${requiredCli}`
    }
    if (session.activeCli !== 'claude' && session.activeCli !== 'codex') {
      return `esa ventana usa un CLI no soportado (${session.activeCli})`
    }
    if (session.relayActive) return 'esa ventana está ocupada con otra petición'
    return 'falló la lectura de respuesta del PTY'
  }

  function pickRelaySession(expectedCli = null) {
    const wcId = getPrimaryWcId()
    const sessions = getSessions()
    const primary = wcId != null ? sessions.get(wcId) : null
    if (canRelayTelegramToPty(primary, expectedCli)) return primary
    for (const s of sessions.values()) {
      if (canRelayTelegramToPty(s, expectedCli)) return s
    }
    return null
  }

  function unbindRelaySessionsByWcId(wcId) {
    for (const [chatId, boundWcId] of telegramRelayByChat.entries()) {
      if (boundWcId === wcId) telegramRelayByChat.delete(chatId)
    }
  }

  function bindRelaySessionToTelegramChat(chatId, session) {
    const key = normalizeTelegramChatKey(chatId)
    if (!key || !session?.wcId) return
    unbindRelaySessionsByWcId(session.wcId)
    telegramRelayByChat.set(key, session.wcId)
  }

  function unbindRelaySessionForTelegramChat(chatId) {
    const key = normalizeTelegramChatKey(chatId)
    if (!key) return false
    return telegramRelayByChat.delete(key)
  }

  function pickRelaySessionForChat(chatId, allowFallback = true, expectedCli = null) {
    const binding = getRelayBindingForChat(chatId)
    if (binding.bound) {
      if (canRelayTelegramToPty(binding.session, expectedCli)) return binding.session
      return allowFallback ? pickRelaySession(expectedCli) : null
    }
    return allowFallback ? pickRelaySession(expectedCli) : null
  }

  async function syncSessionContextAfterTelegramDetach(session, chatId, cliHint = null) {
    if (!session) return { ok: false, refreshed: false, reason: 'no-session' }
    const targetCli = (cliHint === 'codex' || cliHint === 'claude')
      ? cliHint
      : (session.activeCli === 'codex' ? 'codex' : 'claude')
    const key = normalizeTelegramChatKey(chatId)
    const telegramBridge = getTelegramBridge()

    if (targetCli === 'codex') {
      const codexSessionId = telegramBridge?.getSessionId?.(key, 'codex') || null
      if (!codexSessionId) {
        return { ok: true, refreshed: false, mode: 'codex', reason: 'no-session-id' }
      }
      try {
        killPty(session)
        await new Promise((resolve) => setTimeout(resolve, 180))
        startPty(session, session.cols, session.rows, session.cwd, ['resume', codexSessionId])
        const sessions = getSessions()
        const wcId = getPrimaryWcId()
        if (session === sessions.get(wcId)) updatePrimarySnapshot()
        return { ok: true, refreshed: true, mode: 'codex', sessionId: codexSessionId }
      } catch (err) {
        return {
          ok: false,
          refreshed: false,
          mode: 'codex',
          sessionId: codexSessionId,
          error: err?.message || String(err)
        }
      }
    }

    const claudeSid = session.claudeSessionId || telegramBridge?.getSessionId?.(key, 'claude') || null
    if (!session.claudeSessionId && claudeSid) session.claudeSessionId = claudeSid
    return { ok: true, refreshed: !!claudeSid, mode: 'claude', sessionId: claudeSid || null }
  }

  return {
    canRelayTelegramToPty,
    normalizeTelegramChatKey,
    getRelayBindingForChat,
    getRelayBindingForSession,
    describeRelayUnavailable,
    pickRelaySession,
    bindRelaySessionToTelegramChat,
    unbindRelaySessionForTelegramChat,
    unbindRelaySessionsByWcId,
    pickRelaySessionForChat,
    syncSessionContextAfterTelegramDetach
  }
}

module.exports = { createTelegramRelayBindings }
