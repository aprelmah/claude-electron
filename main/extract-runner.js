'use strict'

// Matriz de fallback del extractor headless (automation-pty:extract): se usa
// el runner pedido y, si su CLI no está disponible, se cae al otro; sin
// ninguno, el error compone primero el del runner pedido. Extraída del
// ipcMain.handle para que CI la cubra (la suite corre sin Electron).

function decideExtractRunner(requested, checkCli) {
  const primary = requested === 'codex' ? 'codex' : 'claude'
  const secondary = primary === 'codex' ? 'claude' : 'codex'
  const first = checkCli(primary)
  if (first.ok) return { ok: true, runner: primary }
  const second = checkCli(secondary)
  if (second.ok) return { ok: true, runner: secondary }
  return { ok: false, error: first.error + ' / ' + second.error }
}

module.exports = { decideExtractRunner }
