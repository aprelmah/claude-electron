'use strict'

// Panel "¿qué está pasando?": junta en un snapshot legible lo que la app
// tiene repartido por dentro — sesiones vivas (CLI, proyecto, id, PTY),
// aislamiento git, enlace a Telegram, pool oculto y últimos eventos de la
// bitácora. Módulo puro: recibe los datos, no conoce Electron.

function shortId(id) {
  return id ? String(id).slice(0, 8) : ''
}

function buildStatusPanelSnapshot({ sessions = [], poolStats = null, recentEvents = [], voiceOwnerWcId = null } = {}) {
  const sesiones = (sessions || []).map((s) => ({
    wcId: s.wcId ?? null,
    cli: s.activeCli === 'codex' ? 'codex' : 'claude',
    cwd: s.cwd || '',
    sessionId: shortId(s.activeCli === 'codex' ? s.codexSessionId : s.claudeSessionId),
    ptyVivo: !!s.pty,
    aislada: s.gitWorkspace
      ? { branch: s.gitWorkspace.branch || '', realCwd: s.gitWorkspace.realCwd || '' }
      : null,
    telegram: !!s.relayActive,
    voz: voiceOwnerWcId != null && s.wcId === voiceOwnerWcId
  }))

  const poolTelegram = (poolStats && Array.isArray(poolStats.items))
    ? poolStats.items.map((i) => ({
        chatId: String(i.chatId || ''),
        cli: i.cli === 'codex' ? 'codex' : 'claude',
        sessionId: shortId(i.sessionId),
        idleMin: Math.max(0, Math.round((i.idleMs || 0) / 60000))
      }))
    : []

  const eventos = (recentEvents || []).slice(-12).map((e) => ({
    ts: e.ts || '',
    action: String(e.action || ''),
    detail: String(e.detail || '').slice(0, 140),
    ok: e.ok !== false
  }))

  return { ts: Date.now(), sesiones, poolTelegram, eventos }
}

module.exports = { buildStatusPanelSnapshot }
