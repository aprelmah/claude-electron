'use strict'

// Cola de frases para el helper de voz.
//
// El helper solo maneja UNA frase a la vez: su `speakingId` es único y cada
// `speak` pisa el anterior, así que encolar en él devuelve `speech-end` con el
// id equivocado. La cola se lleva desde aquí — es lo mismo que hace
// main/viewer-speech.js para los documentos largos, pero aquí hace falta porque
// la respuesta se lee A TROZOS según Claude la va escribiendo, y el trozo
// siguiente suele llegar antes de que termine de leerse el anterior.
//
// Módulo puro: no conoce el helper ni el estado del modo voz. Recibe `speak` y
// avisa por `onIdle` cuando se queda sin nada que decir.

function createSpeechQueue({ speak, onIdle, log, idPrefix } = {}) {
  if (typeof speak !== 'function') throw new Error('voice-speech-queue: speak requerido')

  const decir = speak
  const idle = typeof onIdle === 'function' ? onIdle : () => {}
  const trace = typeof log === 'function' ? log : () => {}
  const prefix = typeof idPrefix === 'string' && idPrefix ? idPrefix : 'v'

  const cola = []
  let seq = 0
  let currentId = null
  let currentText = ''

  // Arranca la siguiente frase. Si el helper la rechaza (proceso muerto, stdin
  // roto) no se puede esperar un `speech-end` que no va a llegar: se descarta y
  // se sigue, o la cola se quedaría colgada para siempre.
  function advance() {
    while (cola.length) {
      const text = cola.shift()
      seq += 1
      const id = `${prefix}${seq}`
      currentId = id
      currentText = text
      let ok = false
      try { ok = decir(id, text) !== false } catch (err) {
        trace(`el helper rechazó una frase: ${err?.message || err}`)
        ok = false
      }
      if (ok) return
      trace('frase perdida: el helper no la aceptó')
    }
    currentId = null
    currentText = ''
    idle()
  }

  function push(text) {
    const clean = String(text == null ? '' : text).trim()
    if (!clean) return
    cola.push(clean)
    if (currentId === null) advance()
  }

  // `finished: false` = síntesis cancelada (el usuario cortó, o mandamos
  // `shutup`). Lo que quedaba por leer pierde el sentido: se tira entero.
  function handleSpeechEnd(id, finished) {
    if (currentId === null || id !== currentId) return
    if (finished === false) {
      cola.length = 0
      currentId = null
      currentText = ''
      idle()
      return
    }
    currentId = null
    currentText = ''
    advance()
  }

  // Vaciado silencioso: quien llama ya sabe que esto se acabó (apagado, turno
  // descartado) y no necesita el aviso de vuelta.
  function clear() {
    cola.length = 0
    currentId = null
    currentText = ''
  }

  return {
    push,
    handleSpeechEnd,
    clear,
    isBusy: () => currentId !== null,
    pending: () => cola.length,
    currentId: () => currentId,
    currentText: () => currentText
  }
}

module.exports = { createSpeechQueue }
