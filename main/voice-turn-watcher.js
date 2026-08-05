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

  function watch({ sessionId, cwds = [], baseOffset = 0, onDone, onTimeout } = {}) {
    const done = typeof onDone === 'function' ? onDone : () => {}
    const timedOut = typeof onTimeout === 'function' ? onTimeout : () => {}

    let cancelled = false
    let elapsed = 0
    let lastSize = baseOffset
    let handle = null

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
      if (!result || !result.turnComplete) return

      stopWatching()
      done({ text: result.text || '', sessionId: transcript.sessionId || sessionId, filePath: transcript.filePath })
    }

    handle = setIv(poll, POLL)
    return { cancel: () => { cancelled = true; stopWatching() } }
  }

  return { watch }
}

module.exports = { createVoiceTurnWatcher, DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MS }
