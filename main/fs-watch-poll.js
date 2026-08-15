'use strict'

// Decisión pura: ¿el fs:watch necesita el poll de respaldo?
// El poll es caro (walk síncrono de hasta 2500 lstat + sha1 en el hilo main),
// así que solo corre cuando NO hay watcher nativo adjunto y fiable.
// Vive fuera de ws-server.js porque la suite corre sin Electron: lo que
// decide inline en el servidor no lo cubre nadie.
//
// nativeAttached: fs.watch nativo adjunto y sin haberse degradado.
// pollRunning: el setInterval de poll ya está activo.
// Devuelve 'start' | 'stop' | 'none'.
function resolveFsWatchPollAction({ nativeAttached = false, pollRunning = false } = {}) {
  if (nativeAttached) return pollRunning ? 'stop' : 'none'
  return pollRunning ? 'none' : 'start'
}

module.exports = { resolveFsWatchPollAction }
