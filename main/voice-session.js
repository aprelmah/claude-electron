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
// un `done` de un turno de antes de apagar. Ninguno puede conducir el estado.
// De ahí los dos cerrojos: `speakingId` (solo el fin de la frase que se está
// diciendo AHORA cuenta) y `runId` (cada encendido es una carrera; lo
// asíncrono que vuelve de una carrera vieja se tira).
//
// Y tres redes de seguridad, porque los tres finales de un turno dependen de
// que un proceso externo avise:
// - `notify` blindado: el renderer puede haber desaparecido y lanzar. Avisar
//   a la UI es un efecto secundario, nunca puede tumbar el proceso main.
// - guardia de tiempo en `speaking`: si el `speech-end` no llega, se rearma.
// - retorno de `helper.send` comprobado donde una orden perdida cuelga el
//   ciclo (la frase y el micro).

const VALID_STATES = ['idle', 'listening', 'thinking', 'speaking']

// Guardia de tiempo del estado `speaking`. Solo entra en juego si el helper
// no avisa del fin de la frase: no es un tope de UX, es un antibloqueo. Por
// eso va holgado. AVSpeechUtterance a rate 0,52 va a ~16 caracteres/segundo
// (~62 ms/carácter), así que 120 ms/carácter es el doble de margen y jamás
// corta una frase legítima. Con el tope de 700 caracteres de
// voice-speakable.js el techo queda en ~94 s.
const SPEAK_GUARD_BASE_MS = 10000
const SPEAK_GUARD_PER_CHAR_MS = 120

function createVoiceSession({
  helper,
  speakable,
  watcher,
  router,
  sendToTarget,
  getSession,
  getVoiceId,
  notifyRenderer,
  onShutdown,
  log,
  setTimeoutFn,
  clearTimeoutFn
} = {}) {
  if (!helper || typeof helper.send !== 'function') throw new Error('voice-session: helper requerido')
  if (typeof speakable !== 'function') throw new Error('voice-session: speakable requerido')
  if (!watcher || typeof watcher.watch !== 'function') throw new Error('voice-session: watcher requerido')
  if (!router || typeof router.routeVoiceText !== 'function' || typeof router.resolveVoiceTarget !== 'function') {
    throw new Error('voice-session: router requerido')
  }
  if (typeof sendToTarget !== 'function') throw new Error('voice-session: sendToTarget requerido')

  const emitToRenderer = typeof notifyRenderer === 'function' ? notifyRenderer : () => {}
  const trace = typeof log === 'function' ? log : () => {}
  const getSess = typeof getSession === 'function' ? getSession : () => null
  const getVoz = typeof getVoiceId === 'function' ? getVoiceId : () => ''
  const announceShutdown = typeof onShutdown === 'function' ? onShutdown : () => {}
  const setTimer = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout
  const clearTimer = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout

  let enabled = false
  let state = 'idle'
  let forcedMode = null
  let watchHandle = null
  let speakSeq = 0
  let speakingId = null
  let speakGuard = null
  let helperUp = false
  let runId = 0

  // Mismo blindaje que el `safeEmit` de main/voice-helper-process.js, y por el
  // mismo motivo: `notifyRenderer` es código del consumidor y puede lanzar sin
  // avisar —un webContents destruido con el modo voz encendido lo hace—. Si el
  // fallo subiera, desde `onFinal` (async) sería un rechazo sin dueño y desde
  // `onTurnDone` una excepción dentro del setInterval del vigía: las dos se
  // llevan el proceso main de Electron entero, y con él todos los PTY.
  function notify(evt) {
    try { emitToRenderer(evt) } catch (err) {
      trace(`el renderer rechazó un evento de voz (${evt && evt.type}): ${err?.message || err}`)
    }
  }

  // El helper puede estar muerto (send devuelve false) o su stdin roto. Quien
  // llama decide: hay órdenes cuya pérdida cuelga el ciclo (`speak`, `start`)
  // y otras que no (`stop`, `shutup`).
  function sendCmd(cmd) {
    let ok = false
    try { ok = helper.send(cmd) !== false } catch (err) {
      trace(`el helper de voz rechazó el comando ${cmd.cmd}: ${err?.message || err}`)
      ok = false
    }
    if (!ok) trace(`el comando ${cmd.cmd} no llegó al helper de voz`)
    return ok
  }

  function setState(next) {
    if (!VALID_STATES.includes(next)) return
    if (state === next) return
    state = next
    notify({ type: 'state', state })
  }

  function listen() {
    if (!enabled) return
    setState('listening')
    if (!sendCmd({ cmd: 'start' })) {
      // El micro no se ha abierto. El supervisor del helper relanza el proceso
      // y su `hello` vuelve a armarlo; hasta entonces la app está sorda y el
      // usuario tiene que saberlo, o hablará a una pared.
      notify({ type: 'warn', message: 'el micrófono no respondió; reintentando' })
    }
  }

  function cancelWatch() {
    if (!watchHandle) return
    try { watchHandle.cancel() } catch (err) { trace(`no se pudo cancelar el vigía del turno: ${err?.message || err}`) }
    watchHandle = null
  }

  function clearSpeakGuard() {
    if (speakGuard === null) return
    try { clearTimer(speakGuard) } catch (err) { trace(`no se pudo parar el guardia de la frase: ${err?.message || err}`) }
    speakGuard = null
  }

  // Único sitio por el que se sale de `speaking`. `silence` distingue quién
  // calló la síntesis: en el barge-in la calla el propio helper antes de
  // avisar, y mandarle un `shutup` de más sería ruido; cuando salimos por
  // nuestra cuenta (guardia de tiempo, un `final` sin `user-interrupt`, apagar)
  // hay que callarla nosotros o seguiría sonando encima del turno siguiente.
  function leaveSpeaking({ silence }) {
    clearSpeakGuard()
    speakingId = null
    if (silence) sendCmd({ cmd: 'shutup' })
    setState('listening')
  }

  // Los tres finales del turno (fin de frase, corte del usuario, fin de la
  // lectura) los avisa un proceso externo. Si el aviso se pierde, sin esto la
  // máquina se queda en `speaking` para siempre: micro cerrado, UI diciendo
  // "hablando" y ni un `final` ni un `empty` la sacan de ahí. `thinking` tiene
  // el tope de 180 s del vigía; `speaking` necesita el suyo.
  function armSpeakGuard(chars) {
    clearSpeakGuard()
    const myRun = runId
    const ms = SPEAK_GUARD_BASE_MS + (chars * SPEAK_GUARD_PER_CHAR_MS)
    speakGuard = setTimer(() => {
      speakGuard = null
      if (!enabled || myRun !== runId || state !== 'speaking') return
      trace('el helper no avisó del fin de la frase: se rearma el micro')
      notify({ type: 'warn', message: 'la lectura no avisó de que terminaba; vuelvo a escuchar' })
      leaveSpeaking({ silence: true })
      listen()
    }, ms)
  }

  // Único camino de apagado (toggle del usuario, error fatal del helper, sesión
  // que deja de servir). Con dos caminos, uno acabaría dejándose algo vivo: el
  // vigía polea el transcript cada 300 ms hasta que se cancela.
  //
  // De los tres motivos, DOS se disparan solos desde dentro (el error fatal y la
  // sesión que deja de servir) y quien nos construyó no se entera por ninguna
  // otra vía. main.js apunta al dueño del micro en `voiceOwnerWcId` y solo lo
  // suelta en los caminos que pasan por él (toggle, muerte del PTY, before-quit):
  // sin este aviso, un apagado interno deja el micro marcado como ocupado por una
  // ventana que ya no lo tiene y TODAS las demás ven "el modo voz ya está activo
  // en otra ventana" hasta reiniciar la app. Es lo más probable en la primera
  // prueba real: el helper que no arranca emite `error` con `fatal: true`.
  function shutdown() {
    const estabaEncendida = enabled
    const estabaHablando = state === 'speaking'
    enabled = false
    runId += 1
    speakingId = null
    helperUp = false
    clearSpeakGuard()
    cancelWatch()
    // Apagar el modo voz calla la frase en curso; no se espera a que acabe.
    if (estabaHablando) sendCmd({ cmd: 'shutup' })
    sendCmd({ cmd: 'stop' })
    if (typeof helper.stop === 'function') helper.stop()
    // El `idle` va ANTES del aviso: notify() resuelve la ventana a través del
    // dueño que main.js está a punto de soltar, así que al revés el renderer se
    // quedaría pintando el último estado que le llegó.
    setState('idle')
    // Solo si de verdad estaba encendida: así un disable() sobre una sesión ya
    // apagada no reavisa, y un onShutdown que llamara a disable() no entra en
    // bucle. Blindado como notify() — es código del consumidor.
    if (!estabaEncendida) return
    try { announceShutdown() } catch (err) {
      trace(`el aviso de apagado del modo voz lanzó: ${err?.message || err}`)
    }
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
    if (!enabled) return

    // Un final mientras habla es un barge-in cuyo `user-interrupt` no ha
    // llegado: el usuario ya ha dicho su frase entera encima de la lectura. Se
    // corta y se atiende, que es exactamente lo que espera.
    if (state === 'speaking') leaveSpeaking({ silence: true })
    // Un turno cada vez: lo que llegue mientras piensa se descarta.
    if (state !== 'listening') return

    const clean = String(text || '').trim()
    // El helper cierra su micro al cerrar el turno, también si salió en
    // blanco. Rearmarlo es defensivo: el helper ya emite `empty` en ese caso
    // (VoiceHelper.swift:206-210), pero un `final` en blanco por cualquier
    // otra vía dejaría la máquina en escucha eterna sin escuchar.
    if (!clean) { listen(); return }

    // La sesión puede haber cambiado bajo los pies desde `enable()`: el hot
    // session switch de la app deja pasar a codex con la voz encendida, y
    // codex no delimita el fin de turno — el vigía polearía un `.jsonl` que no
    // crece hasta morir a los 180 s. Se revalida en cada turno, no solo al
    // encender, y si la sesión ya no sirve se apaga el modo voz con motivo.
    const destino = router.resolveVoiceTarget(getSess(), {})
    if (!destino || !destino.ok) {
      notify({ type: 'error', message: (destino && destino.reason) || 'la sesión ya no sirve para el modo voz' })
      shutdown()
      return
    }

    const myRun = runId
    const decision = router.routeVoiceText(clean, { forcedMode })
    notify({ type: 'heard', text: clean, mode: decision.mode, reason: decision.reason })

    setState('thinking')
    sendCmd({ cmd: 'stop' })

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
      // así el handle se suelta por el MISMO camino en los cinco finales
      // (done, timeout, apagado, error fatal, sesión inválida) y no queda
      // ninguno dependiendo de que el vigía se porte bien por dentro.
      // cancel() es idempotente.
      //
      // El try/catch no es adorno: el vigía llama desde su setInterval y NO
      // envuelve la llamada (voice-turn-watcher.js:76), así que lo que escape
      // de aquí es una excepción no capturada en el proceso main de Electron.
      onDone: (r) => {
        if (myRun !== runId) return
        cancelWatch()
        // Turno completado = claude terminó de escribir en el PTY: se suelta
        // el cerrojo voz↔Telegram YA, en vez de esperar a que caduque (180s).
        // Sin esto, tras cada turno de voz el relay de Telegram del mismo PTY
        // daba "sesión enlazada no disponible" hasta 3 minutos (bug real
        // 2026-08-06). El timeout del vigía NO lo suelta: el turno puede
        // seguir corriendo y ahí manda la caducidad.
        try {
          const s = getSession()
          if (s && s.voiceTurnUntil) s.voiceTurnUntil = 0
        } catch {}
        try { onTurnDone(r) } catch (err) {
          trace(`fallo al cerrar el turno de voz: ${err?.message || err}`)
          listen()
        }
      },
      onTimeout: () => {
        if (myRun !== runId) return
        cancelWatch()
        try {
          notify({ type: 'error', message: 'el turno tardó demasiado' })
          listen()
        } catch (err) {
          trace(`fallo al vencer el turno de voz: ${err?.message || err}`)
        }
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
    const id = `s${speakSeq}`
    // Si la orden no llega al helper no habrá `speech-end` que esperar: entrar
    // en `speaking` aquí dejaría la máquina colgada hasta el guardia de tiempo.
    if (!sendCmd({ cmd: 'speak', id, text: texto })) {
      notify({ type: 'error', message: 'no se pudo leer la respuesta en voz alta' })
      listen()
      return
    }

    speakingId = id
    setState('speaking')
    notify({ type: 'saying', text: texto })
    armSpeakGuard(texto.length)
    // MICRO CERRADO MIENTRAS HABLA (cambiado el 2026-08-05 tras la primera
    // prueba real; antes se reabría aquí para tener barge-in por voz).
    //
    // Medido en la app, no supuesto: con el micro abierto el helper captaba su
    // propia voz por encima del umbral y se cortaba a sí mismo al segundo, dos
    // veces de dos —
    //   SPEAK id=s1 chars=43  → BARGE-IN (level=0,031; umbral 0,012)
    //   SPEAK id=s2 chars=693 → BARGE-IN (level=0,029)
    // La cancelación de eco no basta con el altavoz del propio Mac, y encima
    // VoiceProcessingIO aplica ducking mientras el micro está abierto: lo poco
    // que sonaba, sonaba bajísimo.
    //
    // Precio asumido: se pierde el barge-in por voz (hablarle encima para
    // cortarle). Para cortar, el botón del modo voz. El micro se reabre solo
    // en `speech-end` vía `listen()`, y el guardia de tiempo cubre el caso de
    // que ese aviso no llegue nunca.
  }

  function handleHelperEvent(evt) {
    if (!evt || typeof evt !== 'object') return

    switch (evt.type) {
      case 'hello':
        // El helper saluda en cada arranque. El primero es el del proceso que
        // acaba de lanzar enable(), y sus comandos ya van en camino: rearmar
        // aquí mandaría un `start` de más y una segunda petición de permisos.
        // Un segundo saludo significa que el proceso se murió y el supervisor
        // lo relanzó, y el proceso nuevo nace mudo y sin micro.
        if (!enabled) return
        if (!helperUp) { helperUp = true; return }
        // El proceso nuevo nace con la voz del SISTEMA: la que eligió el usuario
        // se la mandó main.js una sola vez, justo tras enable(), y esa orden se
        // fue con el proceso muerto. Sin reenviarla, una caída del helper cambia
        // de voz a media conversación y en silencio.
        const voz = String(getVoz() || '')
        if (voz) sendCmd({ cmd: 'voice', id: voz })
        if (state === 'speaking') {
          // La frase murió con el proceso: no llegará ningún speech-end.
          leaveSpeaking({ silence: false })
          listen()
          return
        }
        // Pensando no se toca: el vigía sigue leyendo el transcript y el turno
        // se leerá por el proceso nuevo cuando cierre.
        if (state === 'listening') sendCmd({ cmd: 'start' })
        return

      case 'listening':
        if (enabled && state !== 'thinking' && state !== 'speaking') setState('listening')
        return

      case 'partial':
        notify({ type: 'partial', text: evt.text })
        return

      case 'final':
        // `onFinal` es async: cualquier fallo suyo se convertiría en un rechazo
        // sin dueño, y el `safeEmit` del helper que nos llama solo envuelve la
        // parte síncrona. Aquí se cierra ese agujero.
        return onFinal(evt.text).catch((err) => {
          trace(`el turno de voz falló de forma inesperada: ${err?.message || err}`)
          listen()
        })

      case 'empty':
        if (enabled && state === 'listening') listen()
        return

      case 'speech-end':
        // Solo el fin de la frase que se está diciendo AHORA mueve el estado.
        // Un `speech-end` tardío (el de una frase ya cortada, el de una carrera
        // anterior) llega cuando la máquina ya ha seguido: si se obedeciera,
        // un turno que a esas alturas estuviera en `thinking` volvería a
        // `listening` a mitad de camino. Es una transición ilegal, y el cerrojo
        // está para eso — no para evitar un `start` de más, que el helper ya
        // ignora por su cuenta (`guard !listening`, VoiceHelper.swift:115).
        if (!enabled || !speakingId || evt.id !== speakingId) return
        // `finished: false` = síntesis cancelada (barge-in o `shutup` nuestro).
        // Su `user-interrupt` lo emite el hilo de CoreAudio y este evento la
        // cola principal, así que el orden entre ambos depende solo del
        // encolado. Ignorarlo cierra la carrera sin depender de ella: si el
        // `user-interrupt` aún no ha llegado, llegará; y si no llegara nunca,
        // el guardia de tiempo rearma el micro igual.
        if (evt.finished === false) return
        leaveSpeaking({ silence: false })
        listen()
        return

      case 'user-interrupt':
        // Le hablas encima. El helper ya ha cortado la síntesis por su cuenta y
        // su micro sigue abierto con el turno nuevo en marcha: aquí no se manda
        // ni `stop` ni `start`, solo se recoloca el estado.
        if (!enabled || state !== 'speaking') return
        leaveSpeaking({ silence: false })
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

module.exports = { createVoiceSession, SPEAK_GUARD_BASE_MS, SPEAK_GUARD_PER_CHAR_MS }
