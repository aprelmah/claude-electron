'use strict'

// Vigila el transcript de una sesión claude hasta que el turno cierra de
// verdad, y devuelve el texto para leerlo en voz.
//
// Reutiliza main/relay-transcript-helpers.js, que ya resuelve lo difícil:
// localizar el .jsonl por sessionId (NO por cwd: una sesión resumida escribe
// en su proyecto original aunque corra en el worktree) y calcular
// `turnComplete` = el ÚLTIMO evento assistant no-sidechain cierra con
// stop_reason 'end_turn'. `sawEndTurn` a secas no vale: con tool_use por
// medio puede ser cierto mientras el turno sigue vivo.
//
// No se usa relayThroughPty porque vive inline en main.js, no se exporta y
// arrastra el streaming a Telegram y las rutas de codex.

const fs = require('fs')

const DEFAULT_POLL_MS = 300
const DEFAULT_TIMEOUT_MS = 180000

// Por debajo de esto no se entrega un trozo suelto: leer "Vale." y callarse un
// segundo suena peor que esperar a la frase siguiente.
const MIN_CHUNK_CHARS = 25

const SENTENCE_END = new Set(['.', '!', '?', '…', ':'])

// Parte el texto pendiente en (lo que ya se puede leer en voz alta, el resto).
// Solo se entregan frases CERRADAS: leer media frase y continuar en el trozo
// siguiente deja una pausa en mitad de la idea.
//
// Con `flush` se entrega lo que haya: es el final del turno y ya no va a llegar
// más texto que cierre la frase.
function splitSpeakableChunk(pending, { flush = false } = {}) {
  const texto = String(pending == null ? '' : pending)
  if (!texto.trim()) return { chunk: '', rest: texto, consumed: 0 }
  if (flush) return { chunk: texto.trim(), rest: '', consumed: texto.length }

  // Un bloque de código a medio escribir no se puede limpiar: `speakableFromMarkdown`
  // reconoce ``` … ``` y, con la valla sin cerrar, leería el código en voz alta.
  const vallas = texto.split('```').length - 1
  if (vallas % 2 !== 0) return { chunk: '', rest: texto, consumed: 0 }

  let corte = -1
  for (let i = texto.length - 1; i >= 0; i--) {
    const c = texto[i]
    if (c === '\n') { corte = i + 1; break }
    if (SENTENCE_END.has(c)) {
      const sig = texto[i + 1]
      if (sig === undefined || sig === ' ' || sig === '\n') { corte = i + 1; break }
    }
  }
  if (corte <= 0) return { chunk: '', rest: texto, consumed: 0 }

  const chunk = texto.slice(0, corte).trim()
  if (chunk.length < MIN_CHUNK_CHARS) return { chunk: '', rest: texto, consumed: 0 }
  return { chunk, rest: texto.slice(corte).trim(), consumed: corte }
}

function createVoiceTurnWatcher({
  findRelayTranscript,
  extractAssistantTextFromTranscript,
  statFn,
  setIntervalFn,
  clearIntervalFn,
  pollMs,
  timeoutMs
} = {}) {
  if (typeof findRelayTranscript !== 'function') throw new Error('voice-turn-watcher: findRelayTranscript requerido')
  if (typeof extractAssistantTextFromTranscript !== 'function') throw new Error('voice-turn-watcher: extractAssistantTextFromTranscript requerido')

  const stat = typeof statFn === 'function' ? statFn : (p) => fs.statSync(p)
  const setIv = typeof setIntervalFn === 'function' ? setIntervalFn : setInterval
  const clearIv = typeof clearIntervalFn === 'function' ? clearIntervalFn : clearInterval
  const POLL = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : DEFAULT_POLL_MS
  const TIMEOUT = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS

  function watch({ sessionId, cwds = [], baseOffset = 0, onChunk, onDone, onTimeout } = {}) {
    const done = typeof onDone === 'function' ? onDone : () => {}
    const timedOut = typeof onTimeout === 'function' ? onTimeout : () => {}
    const chunked = typeof onChunk === 'function' ? onChunk : null

    let cancelled = false
    let elapsed = 0
    let lastSize = baseOffset
    let handle = null
    // Cuánto del texto del turno se ha entregado ya para leer en voz alta. El
    // texto acumulado solo crece por el final, así que basta un índice.
    let entregado = 0

    function stopWatching() {
      if (handle === null) return
      try { clearIv(handle) } catch {}
      handle = null
    }

    function poll() {
      if (cancelled) { stopWatching(); return }

      elapsed += POLL
      if (elapsed >= TIMEOUT) { stopWatching(); timedOut(); return }

      let transcript = null
      try { transcript = findRelayTranscript({ sessionId, cwds }) } catch { transcript = null }
      if (!transcript || !transcript.filePath) return

      let size = 0
      try { size = stat(transcript.filePath)?.size || 0 } catch { return }
      // stat antes de parsear: sin esto, un transcript grande se relee entero
      // varias veces por segundo aunque no haya crecido.
      if (size <= lastSize) return
      lastSize = size

      let result = null
      try { result = extractAssistantTextFromTranscript(transcript.filePath, baseOffset, 0, {}) } catch { return }
      if (!result) return

      const full = String(result.text || '')

      if (!result.turnComplete) {
        // Lectura a trozos mientras claude sigue escribiendo: en turnos con
        // herramientas por medio hay minutos entre el prompt y el `end_turn`, y
        // esperar a que termine es lo que se hacía pesado.
        if (!chunked || full.length <= entregado) return
        const { chunk, consumed } = splitSpeakableChunk(full.slice(entregado))
        if (!chunk) return
        entregado += consumed
        try { chunked(chunk) } catch { /* el consumidor se blinda por su cuenta */ }
        return
      }

      stopWatching()
      // `remainder` = lo que quedó sin leer. Quien lo consuma lee eso y no el
      // turno entero, o repetiría en voz alta todo lo ya dicho.
      const { chunk: resto } = splitSpeakableChunk(full.slice(entregado), { flush: true })
      done({
        text: full,
        remainder: resto,
        sessionId: transcript.sessionId || sessionId,
        filePath: transcript.filePath
      })
    }

    handle = setIv(poll, POLL)
    return { cancel: () => { cancelled = true; stopWatching() } }
  }

  return { watch }
}

module.exports = {
  createVoiceTurnWatcher,
  splitSpeakableChunk,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  MIN_CHUNK_CHARS
}
