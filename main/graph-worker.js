'use strict'

// Entry del worker_thread que construye el grafo del proyecto FUERA del hilo
// main: el walk (readdir/stat + readFile de cada fuente ≤2MB) es síncrono por
// diseño y en proyectos grandes congelaba PTYs, IPC y servidor WS a la vez.
const { parentPort } = require('worker_threads')
const { computeProjectGraph } = require('./graph-builder')

// Guard: el módulo también se carga fuera de un worker (smoke test del main
// thread); sin parentPort no hay nada que escuchar.
if (parentPort) {
  parentPort.on('message', (msg) => {
    let result
    try {
      result = computeProjectGraph(msg && msg.root)
    } catch (err) {
      result = { ok: false, error: String(err?.message || err) }
    }
    parentPort.postMessage({ id: msg && msg.id, result })
  })
}
