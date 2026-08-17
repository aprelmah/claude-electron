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

// El warning nunca se materializa como clave undefined: los tests comparan el
// resultado con deepStrictEqual y una clave presente-pero-undefined no es igual
// a la clave ausente.
function withWarning(result, warning) {
  return warning ? { ...result, warning } : result
}

// El plist del bridge trae RunAtLoad + KeepAlive, así que launchd lo levanta en
// cada login. Para que "parado" sea parado de verdad hay que tocar el override
// store (enable/disable), no solo cargar/descargar el servicio.
function stopBridgeService({ exec, domain, serviceTarget, plistPath, stopClient, persistDisable = false }) {
  try { stopClient?.() } catch {}
  let warning
  // Primero el disable: si el bootout falla y salimos con error, el estado que
  // el usuario pidió (apagado) ya quedó grabado y no revive en el próximo login.
  if (persistDisable) {
    const disabled = exec(['disable', serviceTarget])
    if (!disabled.ok) {
      const msg = runMessage(disabled)
      warning = `No se pudo deshabilitar el servicio${msg ? `: ${msg}` : ''}. Volverá a arrancar al iniciar sesión.`
    }
  }
  const byLabel = exec(['bootout', serviceTarget])
  if (byLabel.ok) return withWarning({ ok: true, step: 'bootout-label', run: byLabel }, warning)
  const msg1 = runMessage(byLabel)
  if (isBenignBootoutFailure(msg1)) {
    return withWarning({ ok: true, step: 'bootout-label-benign', run: byLabel }, warning)
  }
  const byPlist = exec(['bootout', domain, plistPath])
  if (byPlist.ok) return withWarning({ ok: true, step: 'bootout-plist', run: byPlist }, warning)
  const msg2 = runMessage(byPlist)
  if (isBenignBootoutFailure(msg2)) {
    return withWarning({ ok: true, step: 'bootout-plist-benign', run: byPlist }, warning)
  }
  return withWarning(
    { ok: false, step: 'bootout-failed', run: byPlist, error: msg2 || msg1 || 'bootout failed' },
    warning
  )
}

// Habilitar SIEMPRE antes del bootstrap: un stop previo dejó el servicio
// deshabilitado y launchd no lo arrancaría. Medido en macOS 12: con el servicio
// disabled el bootstrap devuelve "Input/output error" (que esta escalera trata
// como benigno) y el que revienta es el kickstart con "Could not find service".
// Se habilita en vez de parsear ese mensaje: los textos de launchd son frágiles.
function startBridgeService({ exec, domain, serviceTarget, plistPath, startClient }) {
  let warning
  const enabled = exec(['enable', serviceTarget])
  if (!enabled.ok) {
    const msg = runMessage(enabled)
    warning = `El servicio puede seguir deshabilitado: no se pudo habilitar${msg ? ` (${msg})` : ''}.`
  }
  const bootstrap = exec(['bootstrap', domain, plistPath])
  const bootstrapMsg = runMessage(bootstrap)
  if (!bootstrap.ok && !isBenignBootstrapFailure(bootstrapMsg)) {
    return withWarning(
      { ok: false, step: 'bootstrap-failed', run: bootstrap, error: bootstrapMsg || 'bootstrap failed' },
      warning
    )
  }
  // kickstart -k SIEMPRE, incluso con bootstrap benigno ("already loaded"):
  // es lo que fuerza el (re)arranque del proceso.
  const kickstart = exec(['kickstart', '-k', serviceTarget])
  if (!kickstart.ok) {
    const msg = runMessage(kickstart)
    return withWarning(
      { ok: false, step: 'kickstart-failed', run: kickstart, error: msg || 'kickstart failed' },
      warning
    )
  }
  try { startClient?.() } catch {}
  return withWarning({ ok: true, step: 'kickstart', run: kickstart }, warning)
}

function runBridgeControl({ action, exec, domain, serviceTarget, plistPath, stopClient, startClient }) {
  if (action === 'stop') {
    // Solo el stop explícito persiste el apagado. El del restart es un paso
    // intermedio: deshabilitar ahí dejaría un estado incoherente a mitad.
    return stopBridgeService({ exec, domain, serviceTarget, plistPath, stopClient, persistDisable: true })
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
