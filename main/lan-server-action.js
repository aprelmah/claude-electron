'use strict'

// Decide qué hacer con el servidor LAN cuando se guarda la configuración.
//
// Vivía dentro del ipcMain.handle('save-app-config') y por eso no había forma
// de cubrirlo sin arrancar Electron. Se extrae aquí, puro y sin dependencias,
// para que la suite lo vigile: el modo de fallo que protege es que un guardado
// cualquiera reinicie el servidor, porque start() para antes de rebindear y
// stop() cierra las sesiones remotas vivas y vacía los invites repartidos.
//
// Las URLs públicas del túnel se leen por getter en caliente, así que cambiarlas
// no necesita reinicio ninguno.

function toPort(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {{enabled?: boolean, running?: boolean, previousPort?: number|string, nextPort?: number|string}} input
 * @returns {{action: 'none'|'start'|'stop', reason: string}}
 */
function decideLanServerAction(input) {
  const cfg = input && typeof input === 'object' ? input : {}
  const enabled = !!cfg.enabled
  const running = !!cfg.running

  if (!enabled) {
    return running
      ? { action: 'stop', reason: 'el servidor está activo y se ha desactivado en la configuración' }
      : { action: 'none', reason: 'el servidor ya estaba parado y sigue desactivado' }
  }

  if (!running) {
    return { action: 'start', reason: 'el servidor está activado pero no corre (primer arranque o arranque previo fallido)' }
  }

  const previousPort = toPort(cfg.previousPort)
  const nextPort = toPort(cfg.nextPort)
  if (nextPort !== null && previousPort !== null && nextPort !== previousPort) {
    return { action: 'start', reason: `cambió el puerto (${previousPort} → ${nextPort}), hay que rebindear` }
  }

  return {
    action: 'none',
    reason: 'nada que exija reiniciar: las URLs públicas se leen en caliente y reiniciar cortaría las sesiones remotas'
  }
}

module.exports = { decideLanServerAction }
