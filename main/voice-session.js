'use strict'

// Máquina de estados del modo voz: idle → listening → thinking → speaking.
//
// Dueña del proceso helper y del estado. NO decide a dónde va el texto (eso
// es del router) ni cómo se envía (eso lo inyecta main.js en sendToTarget).
//
// Dos reglas del micro, y son distintas a propósito:
//
// - Mientras PIENSA, el micro se cierra. El turno de Claude dura de segundos
//   a minutos; con el micro abierto, cualquier ruido de la sala cierra un
//   turno falso que se enviaría encima del que ya está en vuelo.
// - Mientras HABLA, el micro se reabre. El barge-in del helper vive en el tap
//   de audio (`onAudio`: si el sintetizador está sonando y el RMS pasa el
//   umbral, corta y emite `user-interrupt`), así que con el micro cerrado ese
//   código no se ejecuta NUNCA y hablarle encima no haría nada. La
//   cancelación de eco (VoiceProcessingIO) está medida y funciona: el
//   reconocedor no se oye a sí mismo.
//
// Los eventos del helper llegan de un proceso externo y asíncrono, así que
// pueden llegar tarde: el `speech-end` de una frase que ya cortó un barge-in,
// un `done` de un turno de antes de apagar. Ninguno puede reabrir un turno ya
// cerrado. De ahí los dos cerrojos: `speakingId` (solo el fin de la frase que
// se está diciendo AHORA cuenta) y `runId` (cada encendido es una carrera; lo
// asíncrono que vuelve de una carrera vieja se tira).

const VALID_STATES = ['idle', 'listening', 'thinking', 'speaking']

function createVoiceSession({
  helper,
  speakable,
  watcher,
  router,
  sendToTarget,
  getSession,
  notifyRenderer,
  log
} = {}) {
  if (!helper || typeof helper.send !== 'function') throw new Error('voice-session: helper requerido')
  if (typeof speakable !== 'function') throw new Error('voice-session: speakable requerido')
  if (!watcher || typeof watcher.watch !== 'function') throw new Error('voice-session: watcher requerido')
  if (!router || typeof router.routeVoiceText !== 'function' || typeof router.resolveVoiceTarget !== 'function') throw new Error('voice-session: router requerido')
  if (typeof sendToTarget !== 'function') throw new Error('voice-session: sendToTarget requerido')

  const notify = typeof notifyRenderer === 'function' ? notifyRenderer : () => {}
  const trace = typeof log === 'function' ? log : () => {}
  const getSess = typeof getSession === 'function' ? getSession : () => null

  let enabled = false
  let state = 'idle'
  let forcedMode = null
  let watchHandle = null
  let speakSeq = 0
  let speakingId = null
  let helperUp = false
  let runId = 0

  function setState(next) {
    if (!VALID_STATES.includes(next)) return
    if (state === next) return
    state = next
    notify({ type: 'state', state })
  }

  function listen() {
    if (!enabled) return
    setState('listening')
    helper.send({ cmd: 'start' })
  }

  function cancelWatch() {
    if (!watchHandle) return
    try { watchHandle.cancel() } catch (err) { trace(`no se pudo cancelar el vigía del turno: ${err?.message || err}`) }
    watchHandle = null
  }

  // Único camino de apagado (toggle del usuario y error fatal del helper).
  // Con dos caminos, uno de los dos acabaría dejándose algo vivo: el vigía
  // del transcript sigue poleando el fichero cada 300 ms hasta que se cancela.
  function shutdown() {
    const estabaHablando = state === 'speaking'
    enabled = false
    runId += 1
    speakingId = null
    helperUp = false
    cancelWatch()
    // Apagar el modo voz calla la frase en curso; no se espera a que acabe.
    if (estabaHablando) helper.send({ cmd: 'shutup' })
    helper.send({ cmd: 'stop' })
    if (typeof helper.stop === 'function') helper.stop()
    setState('idle')
  }

  function enable() {
    if (enabled) return { ok: true }

    // Sin sesión madre viva no hay fork posible: el modo voz no arranca y el
    // motivo sube al renderer para que el botón lo explique.
    const target = router.resolveVoiceTarget(getSess(), {})
    if (!target || !target.ok) {
      const reason = (target && target.reason) || 'no se puede arrancar el modo voz'
      notify({ type: 'error', message: reason })
      return { ok: false, reason }
    }

    enabled = true
    runId += 1
    speakingId = null
    helperUp = false
    // Tras un error fatal el proceso queda marcado como roto y no vuelve a
    // arrancar jamás. Si el usuario reactiva el modo a mano, se le da otra
    // oportunidad: el caso típico es haber concedido el permiso de micrófono
    // justo después del fallo.
    if (typeof helper.isBroken === 'function' && helper.isBroken() && typeof helper.reset === 'function') helper.reset()
    if (typeof helper.start === 'function') helper.start()
    listen()
    return { ok: true }
  }

  function disable() {
    shutdown()
  }

  async function onFinal(text) {
    // Un turno cada vez: lo que llegue mientras piensa o habla se descarta.
    if (!enabled || state !== 'listening') return

    const clean = String(text || '').trim()
    // El helper cierra su micro al cerrar el turno, también si salió en
    // blanco: si nadie lo rearma, se queda en escucha eterna sin escuchar.
    if (!clean) { listen(); return }

    const myRun = runId
    const decision = router.routeVoiceText(clean, { forcedMode })
    notify({ type: 'heard', text: clean, mode: decision.mode, reason: decision.reason })

    setState('thinking')
    helper.send({ cmd: 'stop' })

    let res = null
    try {
      res = await sendToTarget({ text: clean, mode: decision.mode })
    } catch (err) {
      if (!enabled || myRun !== runId) return
      trace(`no se pudo enviar el turno de voz: ${err?.message || err}`)
      notify({ type: 'error', message: `no se pudo enviar: ${err?.message || err}` })
      listen()
      return
    }

    // El envío es asíncrono: entre medias el usuario ha podido apagar el modo
    // voz, o apagarlo y volver a encenderlo. Sin este corte, un turno de la
    // carrera anterior engancharía un vigía a una sesión de voz que ya no
    // existe y acabaría hablando sola.
    if (!enabled || myRun !== runId) return

    if (!res || !res.ok) {
      notify({ type: 'error', message: (res && res.reason) || 'no se pudo enviar el turno' })
      listen()
      return
    }

    cancelWatch()
    watchHandle = watcher.watch({
      sessionId: res.sessionId,
      cwds: res.cwds || [],
      baseOffset: res.baseOffset || 0,
      // Se cancela también aquí, aunque el vigía ya se pare solo al terminar:
      // así el handle se suelta por el MISMO camino en los cuatro finales
      // (done, timeout, apagado, error fatal) y no queda ninguno dependiendo
      // de que el vigía se porte bien por dentro. cancel() es idempotente.
      onDone: (r) => {
        if (myRun !== runId) return
        cancelWatch()
        onTurnDone(r)
      },
      onTimeout: () => {
        if (myRun !== runId) return
        cancelWatch()
        notify({ type: 'error', message: 'el turno tardó demasiado' })
        listen()
      }
    })
  }

  function onTurnDone(result) {
    // Solo se lee el turno que se estaba pensando. Un `done` que llega después
    // de apagar, o cuando ya se está hablando otra cosa, no reabre nada.
    if (!enabled || state !== 'thinking') return

    const texto = speakable((result && result.text) || '')
    if (!texto) {
      // Solo había código, diffs o tablas: no se lee nada y se vuelve a escuchar.
      notify({ type: 'nothing-to-say' })
      listen()
      return
    }

    speakSeq += 1
    speakingId = `s${speakSeq}`
    setState('speaking')
    notify({ type: 'saying', text: texto })
    helper.send({ cmd: 'speak', id: speakingId, text: texto })
    // Micro abierto mientras habla, a propósito: sin él no hay barge-in
    // (ver cabecera). El helper ignora un `start` si ya está escuchando.
    helper.send({ cmd: 'start' })
  }

  function handleHelperEvent(evt) {
    if (!evt || typeof evt !== 'object') return

    switch (evt.type) {
      case 'hello':
        // El helper saluda en cada arranque. El primero es el del proceso que
        // acaba de lanzar enable(), y sus comandos ya van en camino: rearmar
        // aquí mandaría un `start` de más. Un segundo saludo significa que el
        // proceso se murió y el supervisor lo relanzó, y el proceso nuevo nace
        // mudo y sin micro: hay que recolocarlo.
        if (!enabled) return
        if (!helperUp) { helperUp = true; return }
        if (state === 'speaking') {
          // La frase murió con el proceso: no llegará ningún speech-end.
          speakingId = null
          listen()
          return
        }
        // Pensando no se toca: el vigía sigue leyendo el transcript y el turno
        // se leerá por el proceso nuevo cuando cierre.
        if (state === 'listening') helper.send({ cmd: 'start' })
        return

      case 'listening':
        if (enabled && state !== 'thinking' && state !== 'speaking') setState('listening')
        return

      case 'partial':
        notify({ type: 'partial', text: evt.text })
        return

      case 'final':
        return onFinal(evt.text)

      case 'empty':
        if (enabled && state === 'listening') listen()
        return

      case 'speech-end':
        // Solo el fin de la frase que se está diciendo AHORA reabre el micro.
        // El `speech-end` de una frase cortada por un barge-in llega cuando ya
        // se está escuchando otra vez: rearmar allí resetearía el turno del
        // helper y se perdería lo que el usuario acaba de decir.
        if (!enabled || !speakingId || evt.id !== speakingId) return
        speakingId = null
        listen()
        return

      case 'user-interrupt':
        // Le hablas encima. El helper ya ha cortado la síntesis por su cuenta
        // y su micro sigue abierto con el turno nuevo en marcha: aquí no se
        // manda ni `stop` ni `start`, solo se recoloca el estado.
        if (!enabled || state !== 'speaking') return
        speakingId = null
        setState('listening')
        return

      case 'error':
        notify({ type: 'error', message: evt.message })
        if (evt.fatal) shutdown()
        return

      case 'warn':
        notify({ type: 'warn', message: evt.message })
        return

      default:
        // `ready`, `stopped`, `speech-start`, `speech-detected`, `voices`: el
        // estado no depende de ellos (a `speaking` se entra al mandar la frase,
        // no al confirmarla) y nadie los consume todavía.
        return
    }
  }

  return {
    enable,
    disable,
    handleHelperEvent,
    setForcedMode: (m) => { forcedMode = (m === 'charla' || m === 'encargo') ? m : null },
    getState: () => state,
    isEnabled: () => enabled
  }
}

module.exports = { createVoiceSession }
