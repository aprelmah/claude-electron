'use strict'

function registerProposalIpc({
  ipcMain,
  agentProposalWatcher,
  resolveProposalExecutionSession,
  getSessionByEvent,
  getPrimaryWindowSession,
  finalizePendingProposal,
  serializePendingProposalForRenderer,
  logProposalApprovedStub,
  logProposalRejectedStub,
  semanticSessionId,
  getActiveCliSync
}) {
  ipcMain.handle('proposal:get-pending', () => {
    return { pending: serializePendingProposalForRenderer(agentProposalWatcher.getPending()) }
  })

  ipcMain.handle('proposal:approve', (event, payload = {}) => {
    const pending = agentProposalWatcher.getPending()
    if (!pending) return { ok: false, error: 'No hay propuesta pendiente' }
    const requestedId = String(payload?.id || '').trim()
    if (requestedId && requestedId !== pending.id) {
      return { ok: false, error: 'La propuesta pendiente cambió. Vuelve a abrir el modal.' }
    }
    const command = String(pending.command || '').trim()
    if (!command) return { ok: false, error: 'La propuesta no tiene command ejecutable' }

    const target = resolveProposalExecutionSession(event)
    if (!target || !target.pty) return { ok: false, error: 'No hay PTY activo para ejecutar la propuesta' }
    if (target.relayActive) return { ok: false, error: 'La sesión PTY está en uso por relay Telegram' }

    try {
      target.pty.write(command.endsWith('\n') || command.endsWith('\r') ? command : `${command}\r`)
    } catch (err) {
      return { ok: false, error: `No se pudo enviar el comando al PTY: ${err?.message || err}` }
    }

    const done = finalizePendingProposal('approved')
    logProposalApprovedStub({
      session: semanticSessionId(target, target.activeCli),
      cli: target.activeCli || getActiveCliSync(),
      detail: `id=${pending.id} command=${command}`,
      ok: true
    })
    return {
      ok: true,
      id: pending.id,
      command,
      markerPath: done.markerPath || '',
      cli: target.activeCli || 'claude',
      cwd: target.cwd || ''
    }
  })

  ipcMain.handle('proposal:reject', (event, payload = {}) => {
    const pending = agentProposalWatcher.getPending()
    if (!pending) return { ok: false, error: 'No hay propuesta pendiente' }
    const requestedId = String(payload?.id || '').trim()
    if (requestedId && requestedId !== pending.id) {
      return { ok: false, error: 'La propuesta pendiente cambió. Vuelve a abrir el modal.' }
    }
    const sourceSession = getSessionByEvent(event) || getPrimaryWindowSession()
    const done = finalizePendingProposal('rejected')
    logProposalRejectedStub({
      session: semanticSessionId(sourceSession, sourceSession?.activeCli),
      cli: sourceSession?.activeCli || getActiveCliSync(),
      detail: `id=${pending.id}`,
      ok: true
    })
    return {
      ok: true,
      id: pending.id,
      markerPath: done.markerPath || ''
    }
  })
}

module.exports = { registerProposalIpc }
