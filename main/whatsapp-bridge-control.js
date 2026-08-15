'use strict'

// Escalera bootout→bootstrap→kickstart del bridge de WhatsApp, extraída del
// ipcMain.handle('whatsapp:bridge-control'): la suite corre SIN Electron, así
// que lo que decide dentro de un handler no lo cubre CI. Aquí vive la decisión
// (qué comandos ejecutar y cómo clasificar cada resultado); el handler solo
// aporta launchctl y el cliente. No es un "plan" estático porque cada paso
// depende del resultado del anterior: se inyecta `exec` y la escalera decide
// sobre la marcha.

const BRIDGE_CONTROL_ACTIONS = ['start', 'stop', 'restart']

// Devuelve la acción normalizada o null si no es válida.
function normalizeBridgeAction(actionRaw) {
  const action = String(actionRaw || '').trim().toLowerCase()
  return BRIDGE_CONTROL_ACTIONS.includes(action) ? action : null
}

// "Benigno" = el servicio ya estaba en el estado que se pedía: parar algo no
// cargado o arrancar algo ya cargado no es un error real.
function isBenignBootoutFailure(message) {
  const s = String(message || '').toLowerCase()
  return s.includes('could not find') || s.includes('no such process') || s.includes('not loaded')
}

function isBenignBootstrapFailure(message) {
  const s = String(message || '').toLowerCase()
  return s.includes('already') || s.includes('in progress') || s.includes('input/output error')
}

function runMessage(run) {
  return `${run.error || ''} ${run.stderr || ''}`.trim()
}

function stopBridgeService({ exec, domain, serviceTarget, plistPath, stopClient }) {
  try { stopClient?.() } catch {}
  const byLabel = exec(['bootout', serviceTarget])
  if (byLabel.ok) return { ok: true, step: 'bootout-label', run: byLabel }
  const msg1 = runMessage(byLabel)
  if (isBenignBootoutFailure(msg1)) return { ok: true, step: 'bootout-label-benign', run: byLabel }
  const byPlist = exec(['bootout', domain, plistPath])
  if (byPlist.ok) return { ok: true, step: 'bootout-plist', run: byPlist }
  const msg2 = runMessage(byPlist)
  if (isBenignBootoutFailure(msg2)) return { ok: true, step: 'bootout-plist-benign', run: byPlist }
  return { ok: false, step: 'bootout-failed', run: byPlist, error: msg2 || msg1 || 'bootout failed' }
}

function startBridgeService({ exec, domain, serviceTarget, plistPath, startClient }) {
  const bootstrap = exec(['bootstrap', domain, plistPath])
  const bootstrapMsg = runMessage(bootstrap)
  if (!bootstrap.ok && !isBenignBootstrapFailure(bootstrapMsg)) {
    return { ok: false, step: 'bootstrap-failed', run: bootstrap, error: bootstrapMsg || 'bootstrap failed' }
  }
  // kickstart -k SIEMPRE, incluso con bootstrap benigno ("already loaded"):
  // es lo que fuerza el (re)arranque del proceso.
  const kickstart = exec(['kickstart', '-k', serviceTarget])
  if (!kickstart.ok) {
    const msg = runMessage(kickstart)
    return { ok: false, step: 'kickstart-failed', run: kickstart, error: msg || 'kickstart failed' }
  }
  try { startClient?.() } catch {}
  return { ok: true, step: 'kickstart', run: kickstart }
}

function runBridgeControl({ action, exec, domain, serviceTarget, plistPath, stopClient, startClient }) {
  if (action === 'stop') {
    return stopBridgeService({ exec, domain, serviceTarget, plistPath, stopClient })
  }
  if (action === 'start') {
    return startBridgeService({ exec, domain, serviceTarget, plistPath, startClient })
  }
  const stopped = stopBridgeService({ exec, domain, serviceTarget, plistPath, stopClient })
  if (!stopped.ok) return stopped
  return startBridgeService({ exec, domain, serviceTarget, plistPath, startClient })
}

module.exports = {
  BRIDGE_CONTROL_ACTIONS,
  normalizeBridgeAction,
  isBenignBootoutFailure,
  isBenignBootstrapFailure,
  runBridgeControl
}
