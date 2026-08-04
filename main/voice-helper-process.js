'use strict'

// Proceso hijo del helper de voz (Swift) y su protocolo NDJSON.
// Es el primer proceso persistente no-PTY del repo: todo lo demás usa
// spawnSync o spawn de un solo tiro. De ahí el cuidado con el reensamblado
// de líneas partidas y con el freno de reintentos.
//
// El freno copia el patrón de main/native-notify.js: si el helper no se
// puede mantener vivo (sin Command Line Tools, permiso denegado), marcamos
// `broken`, avisamos UNA vez y paramos. Sin eso queda un bucle de respawn.
//
// Tres blindajes añadidos en la ronda de revisión 1:
// - Listener de 'error' en stdin: un write() sobre un pipe ya roto (helper
//   muerto pero sin 'close' emitido todavía) dispara un evento 'error'
//   ASÍNCRONO en el stream. Sin listener, Node lo trata como excepción no
//   capturada y tumba TODO el proceso main de Electron, no solo el helper.
//   El try/catch de send() no lo cubre porque el error llega después del
//   write(), no durante.
// - Identidad de proceso (generación) en onClose: si un consumidor encadena
//   stop() y start() antes de que llegue el 'close' (asíncrono en un proceso
//   real) del proceso viejo, ese close tardío no debe pisar el proceso nuevo
//   ya en marcha. Cada start() sube un contador de generación y el manejador
//   de 'close' solo actúa si su generación sigue siendo la vigente; si no,
//   es el eco de un proceso ya reemplazado y se ignora entero (no toca
//   proc/buffer/stopping ni dispara un respawn espurio).
// - safeEmit: `onEvent` procesa JSON no confiable de un binario externo. Si
//   el callback del consumidor lanza, no puede tumbar el parser de stdout ni
//   el flujo de arranque/caída. Mismo patrón que main/native-notify.js con
//   su `fallback` (try/catch alrededor de la llamada al consumidor).

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
  let generation = 0

  function safeEmit(obj) {
    // onEvent es código del consumidor sobre JSON no confiable de un binario
    // externo: si lanza, no puede tumbar el parser de stdout ni el flujo de
    // arranque/caída (mismo patrón que el `fallback` de native-notify.js).
    try { emit(obj) } catch (err) {
      trace(`el consumidor de eventos del helper de voz lanzó: ${err?.message || err}`)
    }
  }

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
      if (obj && typeof obj === 'object') safeEmit(obj)
    }
  }

  function onClose(myGen, code) {
    // Close tardío de un proceso ya reemplazado por un start() posterior
    // (carrera stop()+start() antes de que llegue el close asíncrono del
    // proceso viejo): no es el proceso vigente, se ignora entero.
    if (myGen !== generation) return
    proc = null
    buffer = ''
    if (stopping) { stopping = false; return }
    if (restarts >= MAX) {
      if (!broken) {
        broken = true
        trace(`el helper de voz no se pudo mantener vivo tras ${MAX} intentos: se rinde`)
        safeEmit({ type: 'error', message: 'el helper de voz no arranca', fatal: true })
      }
      return
    }
    restarts += 1
    trace(`helper de voz cayó (code ${code}), reintento ${restarts}/${MAX}`)
    start()
  }

  function start() {
    if (broken || proc) return
    generation += 1
    const myGen = generation
    try {
      proc = spawnFn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      proc = null
      broken = true
      trace(`no se pudo lanzar el helper de voz: ${err?.message || err}`)
      safeEmit({ type: 'error', message: `no se pudo lanzar el helper de voz: ${err?.message || err}`, fatal: true })
      return
    }
    buffer = ''
    proc.stdout?.on('data', handleChunk)
    proc.stderr?.on('data', (d) => trace(`[helper] ${String(d).trim()}`))
    proc.on('error', (err) => trace(`error del helper: ${err?.message || err}`))
    // Sin este listener, un write() sobre el pipe tras la muerte del helper
    // (pero antes de que llegue 'close') tumba el proceso main entero: Node
    // trata un 'error' de stream sin listener como excepción no capturada.
    proc.stdin?.on('error', (err) => trace(`error de stdin del helper de voz: ${err?.message || err}`))
    proc.on('close', (code) => onClose(myGen, code))
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
