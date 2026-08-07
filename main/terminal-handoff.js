'use strict'

// Llevar la sesión activa a Terminal.app: construcción del comando de resume,
// del AppleScript que lo lanza, y captura de los datos de la sesión ANTES de
// matar el PTY. Diseño: docs/superpowers/specs/2026-08-07-boton-a-terminal-design.md

const { execFile } = require('child_process')

function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function buildHandoffCommand({ cli, cwd, sessionId } = {}) {
  const c = String(cli || '').trim()
  const dir = String(cwd || '').trim()
  const sid = String(sessionId || '').trim()
  if (!dir) throw new Error('cwd vacío')
  if (!sid) throw new Error('sessionId vacío')
  if (c === 'claude') return `cd ${shq(dir)} && claude --resume ${shq(sid)}`
  if (c === 'codex') return `cd ${shq(dir)} && codex resume ${shq(sid)}`
  throw new Error(`cli no soportado: ${c || '(vacío)'}`)
}

function buildAppleScript(shellCmd) {
  const esc = String(shellCmd).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `tell application "Terminal"\n  activate\n  do script "${esc}"\nend tell`
}

function captureHandoffTarget(session) {
  if (!session) return { error: 'Sin sesión activa' }
  // session.claudeSessionId sobrevive a la muerte del PTY: sin esta guarda,
  // el botón abriría en Terminal una conversación que ya no corre en la app.
  if (!session.pty) return { error: 'No hay ninguna sesión corriendo en esta ventana' }
  const cli = session.activeCli === 'codex' ? 'codex' : 'claude'
  const rawId = cli === 'codex' ? session.codexSessionId : session.claudeSessionId
  const sessionId = String(rawId || '').trim()
  if (!sessionId) return { error: 'La sesión aún no tiene conversación que reanudar' }
  const cwd = String(session.gitWorkspace?.realCwd || session.cwd || '').trim()
  if (!cwd) return { error: 'La sesión no tiene directorio de trabajo' }
  return { cli, cwd, sessionId }
}

function openInTerminal({ cli, cwd, sessionId, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    let script
    try {
      script = buildAppleScript(buildHandoffCommand({ cli, cwd, sessionId }))
    } catch (err) {
      reject(err)
      return
    }
    execFileImpl('osascript', ['-e', script], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

module.exports = { buildHandoffCommand, buildAppleScript, captureHandoffTarget, openInTerminal }
