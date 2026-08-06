'use strict'

// Transcripción de FICHEROS de audio vía el helper de voz (Apple Speech en
// modo servidor) — la vía rápida para los audios de Telegram/WhatsApp y el
// dictado: whisper.cpp en este Mac tiene RTF ~1,4 (tarda más que el audio),
// Apple servidor contesta en ~1-2 s.
//
// Habla el protocolo NDJSON del helper: manda {cmd:'transcribe', id, path} y
// espera {type:'file-transcript'|'file-transcript-error', id}. Los eventos
// llegan por el stream general del helper, así que handleHelperEvent() debe
// engancharse en el onEvent de main.js ANTES de viewer-speech y voice-session
// (mismo patrón de multiplexado por consumo que viewer-speech).
//
// Ciclo de vida del helper: si no corría, se arranca solo para esto y se para
// al quedar cero transcripciones pendientes — salvo que el modo voz o el
// lector del visor lo estén usando (isVoiceInUse). Los permisos son perezosos:
// transcribir un fichero pide reconocimiento, no micrófono. En dev el permiso
// puede no llegar nunca (requestAuthorization solo responde dentro de una app
// con bundle): de eso protege el timeout, y el que llama cae a whisper.

const DEFAULT_TIMEOUT_MS = 15000

function createAppleFileTranscriber({ helper, isVoiceInUse, timeoutMs, log } = {}) {
  if (!helper) throw new Error('apple-transcribe: helper requerido')
  const vozEnUso = typeof isVoiceInUse === 'function' ? isVoiceInUse : () => false
  const TIMEOUT = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  const trace = typeof log === 'function' ? log : () => {}

  let seq = 0
  const pendientes = new Map()
  let arrancadoPorNosotros = false

  function cerrar(id) {
    const w = pendientes.get(id)
    if (!w) return null
    pendientes.delete(id)
    clearTimeout(w.timer)
    if (pendientes.size === 0 && arrancadoPorNosotros && !vozEnUso()) {
      arrancadoPorNosotros = false
      try { helper.stop() } catch {}
    }
    return w
  }

  function handleHelperEvent(evt) {
    if (!evt || typeof evt !== 'object') return false
    if (evt.type === 'file-transcript' || evt.type === 'file-transcript-error') {
      const w = cerrar(evt.id)
      if (w) {
        if (evt.type === 'file-transcript') w.resolve(String(evt.text || '').trim())
        else w.reject(new Error(evt.message || 'la transcripción falló'))
      }
      // Aunque el id ya no tenga dueño (timeout previo), el evento es nuestro.
      return true
    }
    // Un fatal del helper mata todas las pendientes, pero NO se consume:
    // voice-session también necesita verlo para apagar el modo voz.
    if (evt.type === 'error' && evt.fatal) {
      const ids = [...pendientes.keys()]
      for (const id of ids) {
        const w = cerrar(id)
        if (w) w.reject(new Error(evt.message || 'el helper de voz murió'))
      }
      return false
    }
    return false
  }

  function transcribeWav(wavPath) {
    return new Promise((resolve, reject) => {
      const bin = helper.checkBinary()
      if (!bin.ok) return reject(new Error(bin.reason || 'no hay helper de voz'))
      if (helper.isBroken()) return reject(new Error('el helper de voz está roto (no arranca)'))
      if (!helper.isRunning()) {
        try { helper.start() } catch (err) {
          return reject(new Error(`no se pudo arrancar el helper: ${err?.message || err}`))
        }
        arrancadoPorNosotros = true
      }
      seq += 1
      const id = `ftr:${seq}`
      const timer = setTimeout(() => {
        cerrar(id)
        reject(new Error(`el helper no contestó en ${TIMEOUT} ms`))
      }, TIMEOUT)
      if (timer && typeof timer.unref === 'function') timer.unref()
      pendientes.set(id, { resolve, reject, timer })
      if (!helper.send({ cmd: 'transcribe', id, path: wavPath })) {
        cerrar(id)
        reject(new Error('no se pudo escribir al helper de voz'))
        return
      }
      trace(`transcripción Apple en marcha (${id})`)
    })
  }

  return { transcribeWav, handleHelperEvent, pendingCount: () => pendientes.size }
}

module.exports = { createAppleFileTranscriber, DEFAULT_TIMEOUT_MS }
