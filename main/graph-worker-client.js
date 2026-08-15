'use strict'

// Cliente del worker del grafo. Aquí solo se decide DÓNDE corre el build:
// en un worker_thread persistente (el main no se congela) o, si el worker no
// puede arrancar o muere repetidamente (p.ej. asar sin soporte de workers),
// degradado al cálculo síncrono de siempre — el grafo nunca deja de funcionar.

const path = require('path')
const { computeProjectGraph } = require('./graph-builder')

const MAX_WORKER_FAILURES = 3

let worker = null
let workerBroken = false
let failCount = 0
let nextId = 1
const pending = new Map()

function rejectAllPending(err) {
  if (!pending.size) return
  for (const entry of pending.values()) entry.reject(err)
  pending.clear()
}

function ensureWorker() {
  if (worker || workerBroken) return worker
  let w
  try {
    const { Worker } = require('worker_threads')
    w = new Worker(path.join(__dirname, 'graph-worker.js'))
  } catch {
    workerBroken = true
    return null
  }
  // ref solo mientras haya builds en vuelo: sin pending no debe retener el
  // proceso (app.quit), pero con pending sí — si no, un event loop vacío
  // (tests, headless) saldría antes de recibir la respuesta del worker.
  if (typeof w.unref === 'function') w.unref()
  w.on('message', (msg) => {
    const entry = pending.get(msg && msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (!pending.size && typeof w.unref === 'function') w.unref()
    failCount = 0
    entry.resolve(msg.result)
  })
  w.on('error', (err) => {
    if (worker === w) worker = null
    failCount += 1
    if (failCount >= MAX_WORKER_FAILURES) workerBroken = true
    rejectAllPending(err instanceof Error ? err : new Error(String(err || 'graph worker caído')))
    try { w.terminate() } catch {}
  })
  w.on('exit', () => {
    if (worker === w) worker = null
    rejectAllPending(new Error('graph worker terminado'))
  })
  worker = w
  return worker
}

function computeProjectGraphAsync(rootPath) {
  const w = ensureWorker()
  if (!w) return Promise.resolve(computeProjectGraph(rootPath))
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    if (typeof w.ref === 'function') w.ref()
    try {
      w.postMessage({ id, root: rootPath })
    } catch (err) {
      pending.delete(id)
      if (!pending.size && typeof w.unref === 'function') w.unref()
      reject(err)
    }
  }).catch(() => computeProjectGraph(rootPath))
}

// Solo para tests: cerrar el worker y no dejar el runner colgado.
async function shutdownGraphWorker() {
  const w = worker
  worker = null
  rejectAllPending(new Error('graph worker cerrado'))
  if (w) { try { await w.terminate() } catch {} }
}

module.exports = { computeProjectGraphAsync, shutdownGraphWorker }
