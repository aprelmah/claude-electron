'use strict'

// Proceso hijo del helper de voz (Swift) y su protocolo NDJSON.
// Es el primer proceso persistente no-PTY del repo: todo lo demás usa
// spawnSync o spawn de un solo tiro. De ahí el cuidado con el reensamblado
// de líneas partidas y con el freno de reintentos.
//
// El freno copia el patrón de main/native-notify.js: si el helper no se
// puede mantener vivo (sin Command Line Tools, permiso denegado), marcamos
// `broken`, avisamos UNA vez y paramos. Sin eso queda un bucle de respawn.

const DEFAULT_MAX_RESTARTS = 3

function createVoiceHelperProcess({
  helperPath,
  spawnFn,
  onEvent,
  log,
  maxRestarts
} = {}) {
  if (!helperPath) throw new Error('voice-helper-process: helperPath requerido')
  if (typeof spawnFn !== 'function') throw new Error('voice-helper-process: spawnFn requerido')

  const emit = typeof onEvent === 'function' ? onEvent : () => {}
  const trace = typeof log === 'function' ? log : () => {}
  const MAX = Number.isFinite(maxRestarts) && maxRestarts >= 0 ? maxRestarts : DEFAULT_MAX_RESTARTS

  let proc = null
  let buffer = ''
  let restarts = 0
  let broken = false
  let stopping = false

  function handleChunk(chunk) {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    // La última puede venir a medias: se queda para el siguiente chunk.
    buffer = lines.pop()
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj = null
      try { obj = JSON.parse(trimmed) } catch { continue }
      if (obj && typeof obj === 'object') emit(obj)
    }
  }

  function onClose(code) {
    proc = null
    buffer = ''
    if (stopping) { stopping = false; return }
    if (restarts >= MAX) {
      if (!broken) {
        broken = true
        trace(`el helper de voz no se pudo mantener vivo tras ${MAX} intentos: se rinde`)
        emit({ type: 'error', message: 'el helper de voz no arranca', fatal: true })
      }
      return
    }
    restarts += 1
    trace(`helper de voz cayó (code ${code}), reintento ${restarts}/${MAX}`)
    start()
  }

  function start() {
    if (broken || proc) return
    try {
      proc = spawnFn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      proc = null
      broken = true
      trace(`no se pudo lanzar el helper de voz: ${err?.message || err}`)
      emit({ type: 'error', message: `no se pudo lanzar el helper de voz: ${err?.message || err}`, fatal: true })
      return
    }
    buffer = ''
    proc.stdout?.on('data', handleChunk)
    proc.stderr?.on('data', (d) => trace(`[helper] ${String(d).trim()}`))
    proc.on('error', (err) => trace(`error del helper: ${err?.message || err}`))
    proc.on('close', onClose)
  }

  function send(obj) {
    if (!proc || !proc.stdin) return false
    try { proc.stdin.write(JSON.stringify(obj) + '\n'); return true }
    catch (err) { trace(`no se pudo escribir al helper: ${err?.message || err}`); return false }
  }

  function stop() {
    if (!proc) return
    stopping = true
    send({ cmd: 'quit' })
    try { proc.kill() } catch {}
    proc = null
  }

  return {
    start,
    send,
    stop,
    isRunning: () => !!proc,
    isBroken: () => broken,
    reset: () => { broken = false; restarts = 0 }
  }
}

module.exports = { createVoiceHelperProcess }
