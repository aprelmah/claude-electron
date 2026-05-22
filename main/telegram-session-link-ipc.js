'use strict'

const os = require('os')
const path = require('path')

function registerTelegramSessionLinkIpc({
  ipcMain,
  getSessions,
  getTelegramBridge,
  getTelegramRelayByChat,
  resolveSessionIdForRelay,
  getRelayBindingForSession,
  bindRelaySessionToTelegramChat,
  unbindRelaySessionForTelegramChat,
  unbindRelaySessionsByWcId,
  broadcastTelegramStatus,
  syncSessionContextAfterTelegramDetach
}) {
  ipcMain.handle('app:can-send-to-telegram', (event) => {
    const s = getSessions().get(event.sender.id)
    if (!s) return { ok: false, reason: 'no-session', linked: false, chatId: null, relayActive: false }
    const telegramBridge = getTelegramBridge()
    const preferredChatId = telegramBridge?.getFirstAllowedUserId?.() || null
    const binding = getRelayBindingForSession(s, preferredChatId)
    const linkedChatId = binding.chatId || (preferredChatId == null ? null : String(preferredChatId))
    const withLink = (payload) => ({ ...payload, linked: binding.linked, chatId: linkedChatId, relayActive: !!s.relayActive, cli: s.activeCli })

    if (s.activeCli !== 'claude' && s.activeCli !== 'codex') return withLink({ ok: false, reason: 'not-supported-cli' })
    const sessionId = resolveSessionIdForRelay(s)
    if (s.activeCli === 'claude' && !sessionId) return withLink({ ok: false, reason: 'no-session-id' })
    if (!telegramBridge) return withLink({ ok: false, reason: 'bridge-not-init' })
    const status = telegramBridge.getStatus()
    if (!status.running) return withLink({ ok: false, reason: 'bridge-not-running' })
    if (!preferredChatId) return withLink({ ok: false, reason: 'no-allowed-user' })
    return withLink({ ok: true, sessionId: sessionId || null, cwd: s.cwd })
  })

  ipcMain.handle('app:send-session-to-telegram', async (event) => {
    const s = getSessions().get(event.sender.id)
    if (!s) return { ok: false, error: 'No hay sesión asociada a esta ventana' }
    if (s.activeCli !== 'claude' && s.activeCli !== 'codex') {
      return { ok: false, error: 'CLI no soportado para relay Telegram (usa claude o codex).' }
    }
    const resolvedSessionId = resolveSessionIdForRelay(s)
    if (s.activeCli === 'claude' && !resolvedSessionId) {
      return { ok: false, error: 'No se detectó el sessionId de claude. Habla con él al menos un mensaje y vuelve a intentarlo.' }
    }
    const telegramBridge = getTelegramBridge()
    if (!telegramBridge) return { ok: false, error: 'Telegram bridge no inicializado' }
    const status = telegramBridge.getStatus()
    if (!status.running) return { ok: false, error: 'Telegram bridge no está corriendo (actívalo en Configuración).' }
    const chatId = telegramBridge.getFirstAllowedUserId()
    if (!chatId) return { ok: false, error: 'No hay usuarios autorizados en Telegram (configúralos en Configuración).' }
    const currentSessionId = resolvedSessionId || null

    try {
      if (s.activeCli === 'claude' && s.claudeSessionId) {
        telegramBridge.adoptSession(chatId, 'claude', s.claudeSessionId)
      } else if (s.activeCli === 'codex' && currentSessionId) {
        s.codexSessionId = currentSessionId
        telegramBridge.adoptSession(chatId, 'codex', currentSessionId)
      }
      bindRelaySessionToTelegramChat(chatId, s)
      broadcastTelegramStatus()
      const cwdShort = path.basename(s.cwd || os.homedir())
      const cliLabel = s.activeCli === 'codex' ? 'Codex' : 'Claude'
      const lines = [
        `📱 Sesión de ${cliLabel} conectada a Telegram`,
        `📂 Carpeta: ${cwdShort}`,
      ]
      if (currentSessionId) {
        lines.push(`🆔 ${String(currentSessionId).slice(0, 8)}…`)
      }
      lines.push('', 'Desde ahora, cuando escribas al bot, usará esta sesión viva del PTY.')
      const text = lines.join('\n')
      await telegramBridge.sendMessageTo(chatId, text)
      // Mantener PTY vivo: Telegram usa relay directo sobre esta sesión (sin --resume por turno).
      try { s.win?.webContents.send('pty-transferred-to-telegram', { sessionId: currentSessionId, chatId }) } catch {}
      return { ok: true, sessionId: currentSessionId, chatId: String(chatId), linked: true, cli: s.activeCli }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('app:disconnect-session-from-telegram', async (event) => {
    const s = getSessions().get(event.sender.id)
    if (!s) return { ok: false, error: 'No hay sesión asociada a esta ventana', linked: false }

    const telegramBridge = getTelegramBridge()
    const preferredChatId = telegramBridge?.getFirstAllowedUserId?.() || null
    const binding = getRelayBindingForSession(s, preferredChatId)
    if (!binding.linked) return { ok: false, error: 'Esta ventana no está enlazada a Telegram.', linked: false }

    const chatId = binding.chatId || (preferredChatId == null ? null : String(preferredChatId))
    let detached = false
    if (chatId) detached = unbindRelaySessionForTelegramChat(chatId)
    if (!detached) {
      const telegramRelayByChat = getTelegramRelayByChat()
      const before = telegramRelayByChat.size
      unbindRelaySessionsByWcId(s.wcId)
      detached = telegramRelayByChat.size !== before
    }

    if (detached) {
      broadcastTelegramStatus()
      const sync = await syncSessionContextAfterTelegramDetach(s, chatId, s.activeCli)
      if (chatId && telegramBridge?.getStatus()?.running) {
        const cliLabel = s.activeCli === 'codex' ? 'Codex' : 'Claude'
        try { await telegramBridge.sendMessageTo(chatId, `🔌 Sesión de ${cliLabel} desconectada del relay PTY.`) } catch {}
      }
      return {
        ok: true,
        linked: false,
        detached: true,
        chatId: chatId || null,
        cli: s.activeCli,
        sync
      }
    }

    return {
      ok: true,
      linked: false,
      detached: false,
      chatId: chatId || null,
      cli: s.activeCli,
      sync: { ok: true, refreshed: false, reason: 'already-detached' }
    }
  })
}

module.exports = { registerTelegramSessionLinkIpc }
