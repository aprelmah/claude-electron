'use strict'

// Lectura en voz alta de documentos desde la ventana del visor (botón 🔊).
//
// Reutiliza el helper de voz (misma voz y velocidad que el modo voz) pero SIN
// tocar la máquina de estados de voice-session: el sintetizador no necesita
// micrófono ni permisos, así que el helper puede arrancarse solo para esto
// (mismo patrón que el listado de voces de Configuración).
//
// El helper solo maneja UNA frase a la vez (su `speakingId` es único y cada
// `speak` lo pisa emitiendo el `speech-end` con el id equivocado), así que el
// documento troceado se encola AQUÍ: se manda un trozo, se espera su
// `speech-end`, se manda el siguiente. Los ids llevan el prefijo `viewer:` —
// voice-session filtra por su propio `speakingId`, así que estos eventos le
// resbalan aunque el modo voz estuviera encendido.
//
// Con el modo voz encendido NO se lee: su micrófono abierto oiría la lectura
// por el altavoz y se auto-interrumpiría (rms medido muy por encima del
// umbral, 2026-08-05). Es la misma razón por la que el modo voz cierra el
// micro mientras habla.

const ID_PREFIX = 'viewer:'

function createViewerSpeech({ helper, chunker, isVoiceModeEnabled, applyPrefs, notifyEnded, log = () => {} }) {
  if (!helper || typeof chunker !== 'function') throw new Error('viewer-speech: faltan dependencias')

  // Una lectura activa como mucho (el sintetizador es uno): si otra ventana
  // pide leer, la lectura anterior se para. `reading` es null o
  // { wcId, chunks, next, seq, startedHelper }.
  let reading = null
  let seqCounter = 0

  function currentId() {
    if (!reading) return null
    return `${ID_PREFIX}${reading.seq}:${reading.next - 1}`
  }

  function stopHelperIfOurs(startedHelper) {
    if (!startedHelper) return
    const voiceOn = typeof isVoiceModeEnabled === 'function' && isVoiceModeEnabled()
    if (voiceOn) return
    try { helper.stop() } catch {}
  }

  function finish({ notify }) {
    if (!reading) return
    const { wcId, startedHelper } = reading
    reading = null
    if (notify && typeof notifyEnded === 'function') {
      try { notifyEnded(wcId) } catch {}
    }
    stopHelperIfOurs(startedHelper)
  }

  function sendNextChunk() {
    if (!reading) return
    if (reading.next >= reading.chunks.length) {
      finish({ notify: true })
      return
    }
    const text = reading.chunks[reading.next]
    reading.next += 1
    const id = currentId()
    if (!helper.send({ cmd: 'speak', id, text })) {
      // El helper murió a mitad de documento: no llegará ningún speech-end.
      log('la lectura murió con el helper')
      finish({ notify: true })
    }
  }

  function speak(wcId, markdown) {
    if (typeof isVoiceModeEnabled === 'function' && isVoiceModeEnabled()) {
      return { ok: false, reason: 'apaga el modo voz para leer documentos: su micrófono se oiría a sí mismo' }
    }
    const chunks = chunker(markdown)
    if (!Array.isArray(chunks) || !chunks.length) {
      return { ok: false, reason: 'no hay prosa legible en este documento' }
    }

    // Otra lectura en marcha (esta u otra ventana): se corta y arranca la nueva.
    if (reading) stop(reading.wcId)

    const startedHelper = !helper.isRunning()
    if (startedHelper) {
      try { helper.start() } catch (err) {
        return { ok: false, reason: `no se pudo arrancar el helper de voz: ${err?.message || err}` }
      }
    }
    // Voz y velocidad de Configuración: el helper recién arrancado nace con la
    // voz del sistema.
    if (typeof applyPrefs === 'function') { try { applyPrefs() } catch {} }

    seqCounter += 1
    reading = { wcId, chunks, next: 0, seq: seqCounter, startedHelper, sawHello: false }
    log(`leyendo documento: ${chunks.length} trozo(s)`)
    sendNextChunk()
    return reading ? { ok: true, chunks: chunks.length } : { ok: false, reason: 'el helper de voz no responde' }
  }

  function stop(wcId) {
    if (!reading || (wcId != null && reading.wcId !== wcId)) return { ok: true }
    // `shutup` corta la frase actual; el resto de la cola vive aquí y muere
    // aquí. El `speech-end` (finished:false) que provoque llegará con `reading`
    // ya a null y se ignorará.
    try { helper.send({ cmd: 'shutup' }) } catch {}
    finish({ notify: false })
    return { ok: true }
  }

  // Devuelve true si el evento era de una lectura del visor (consumido).
  function handleHelperEvent(evt) {
    if (!evt || typeof evt !== 'object') return false
    // Un `hello` a mitad de lectura = el proceso murió y el supervisor lo
    // relanzó: la frase en vuelo murió con él y su `speech-end` no llegará.
    // El primer saludo del helper que ESTA lectura arrancó sí se espera. El
    // evento no se consume: voice-session también necesita ver los hello.
    if (evt.type === 'hello') {
      if (!reading) return false
      if (reading.startedHelper && !reading.sawHello) { reading.sawHello = true; return false }
      log('el helper se reinició a mitad de lectura')
      finish({ notify: true })
      return false
    }
    if (typeof evt.id !== 'string' || !evt.id.startsWith(ID_PREFIX)) return false
    if (evt.type === 'speech-start') return true
    if (evt.type !== 'speech-end') return false
    if (!reading || evt.id !== currentId()) return true
    if (evt.finished === false) {
      // Cancelada desde fuera (un `shutup` ajeno, el helper reiniciado): no se
      // sigue leyendo un documento que alguien acaba de callar.
      finish({ notify: true })
      return true
    }
    sendNextChunk()
    return true
  }

  // La ventana que pidió la lectura se cerró: callar sin avisar a nadie.
  function handleWindowClosed(wcId) {
    if (reading && reading.wcId === wcId) stop(wcId)
  }

  function isReading() { return reading != null }

  return { speak, stop, handleHelperEvent, handleWindowClosed, isReading }
}

module.exports = { createViewerSpeech }
