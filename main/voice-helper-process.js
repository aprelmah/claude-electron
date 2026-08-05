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
//
// Blindaje añadido en la ronda de revisión 2:
// - `stoppingGen` (antes un booleano `stopping` global) escopa el "esto lo
//   paramos nosotros" a la generación que lo pidió. Con un booleano simple,
//   el guard de generación de onClose devolvía ANTES de resetearlo cuando
//   llegaba el close tardío de la generación vieja — así que `stopping`
//   quedaba pegado a `true` para la generación nueva, y un crash real de
//   ESA generación se tragaba en silencio (sin respawn, sin aviso) por
//   confundirse con el stop deliberado de la generación anterior. Guardar
//   la generación exacta que se detuvo, en vez de un booleano compartido,
//   hace que cada generación se juzgue solo por lo que le pasó a ella.

const DEFAULT_MAX_RESTARTS = 3

// Margen que se le da al helper para atender su `quit` y salir por su cuenta
// antes del SIGTERM. Corto a propósito: `stop()` corre también en `before-quit`,
// y ahí la app está esperando para cerrarse.
const DEFAULT_QUIT_GRACE_MS = 250

// `child_process.spawn` NO lanza con un binario que no existe o que no es
// ejecutable: emite 'error' de forma ASÍNCRONA. Así que el try/catch del spawn
// no lo ve nunca, el fallo se cuela por 'close' y hacen falta los tres respawns
// para que alguien se entere — mientras tanto el consumidor ya recibió su
// {ok:true} y el botón dice "escuchando" con el micro cerrado. Comprobar el
// binario ANTES de arrancar convierte ese diagnóstico de 3 caídas en una frase.
//
// Es justo lo que hará falta si el binario no sobrevive al empaquetado: en dev
// vive en `resources/`, en la app empaquetada en `process.resourcesPath`.
function checkHelperBinary(helperPath, accessFn) {
  if (!helperPath) return { ok: false, reason: 'no hay ruta para el helper de voz' }
  const check = typeof accessFn === 'function'
    ? accessFn
    : (p) => { const fs = require('fs'); fs.accessSync(p, fs.constants.X_OK) }
  try {
    check(helperPath)
    return { ok: true }
  } catch (err) {
    const code = err && err.code
    if (code === 'ENOENT') {
      return { ok: false, reason: `falta el helper de voz (${helperPath}): compílalo con npm run build:voice-helper` }
    }
    if (code === 'EACCES') {
      return { ok: false, reason: `el helper de voz no es ejecutable (${helperPath}): chmod +x` }
    }
    return { ok: false, reason: `no se puede usar el helper de voz (${helperPath}): ${err?.message || err}` }
  }
}

function createVoiceHelperProcess({
  helperPath,
  spawnFn,
  onEvent,
  log,
  maxRestarts,
  quitGraceMs,
  setTimeoutFn,
  clearTimeoutFn
} = {}) {
  if (!helperPath) throw new Error('voice-helper-process: helperPath requerido')
  if (typeof spawnFn !== 'function') throw new Error('voice-helper-process: spawnFn requerido')

  const emit = typeof onEvent === 'function' ? onEvent : () => {}
  const trace = typeof log === 'function' ? log : () => {}
  const MAX = Number.isFinite(maxRestarts) && maxRestarts >= 0 ? maxRestarts : DEFAULT_MAX_RESTARTS
  const GRACE = Number.isFinite(quitGraceMs) && quitGraceMs >= 0 ? quitGraceMs : DEFAULT_QUIT_GRACE_MS
  const setTimer = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout
  const clearTimer = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout

  let proc = null
  let buffer = ''
  let restarts = 0
  let broken = false
  let stoppingGen = null
  let generation = 0
  let killTimer = null

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
      if (!obj || typeof obj !== 'object') continue
      // El `hello` es la prueba de que ESTE proceso arrancó de verdad (abrió su
      // stdout y habló). El contador de reintentos existe para frenar un bucle
      // de respawn, no para acumular caídas sueltas: sin reiniciarlo, tres
      // crashes repartidos a lo largo de horas —cada uno con su recuperación
      // buena por medio— acaban marcando el helper como `broken` y dejan el modo
      // voz muerto hasta reiniciar la app.
      if (obj.type === 'hello') restarts = 0
      safeEmit(obj)
    }
  }

  function onClose(myGen, code) {
    // Close tardío de un proceso ya reemplazado por un start() posterior
    // (carrera stop()+start() antes de que llegue el close asíncrono del
    // proceso viejo): no es el proceso vigente, se ignora entero.
    if (myGen !== generation) return
    proc = null
    buffer = ''
    // Salió solo tras el `quit`: el SIGTERM de respaldo ya no hace falta.
    if (stoppingGen === myGen) { stoppingGen = null; clearKillTimer(); return }
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

  function clearKillTimer() {
    if (killTimer === null) return
    try { clearTimer(killTimer) } catch {}
    killTimer = null
  }

  // Mandar `quit` y matar en la misma vuelta del bucle de eventos es mandar solo
  // SIGTERM: el helper no ha llegado ni a leer su stdin. El `quit` existe para
  // que salga por su cuenta cerrando el motor de audio (soltar el micro, parar
  // la síntesis); a lo bruto eso queda al SO. Se le da una vuelta de reloj y el
  // kill se queda de red de seguridad, cancelable si el proceso muere antes.
  function stop() {
    if (!proc) return
    const victima = proc
    stoppingGen = generation
    send({ cmd: 'quit' })
    proc = null
    clearKillTimer()
    killTimer = setTimer(() => {
      killTimer = null
      try { victima.kill() } catch {}
    }, GRACE)
    // Node deja el timer suelto si el proceso ya salió solo; sin unref, un
    // `stop()` en before-quit retrasaría el cierre de la app hasta que venza.
    if (killTimer && typeof killTimer.unref === 'function') killTimer.unref()
  }

  return {
    start,
    send,
    stop,
    checkBinary: (accessFn) => checkHelperBinary(helperPath, accessFn),
    isRunning: () => !!proc,
    isBroken: () => broken,
    reset: () => { broken = false; restarts = 0 }
  }
}

module.exports = { createVoiceHelperProcess, checkHelperBinary, DEFAULT_QUIT_GRACE_MS }
