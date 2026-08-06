'use strict'

// El ENTER va SIEMPRE en su propia escritura al PTY, nunca pegado al texto.
// El TUI de Claude Code trata lo que llega en un solo write como un pegado:
// un '\r' al final del mismo chunk se lee como salto de línea DENTRO del
// prompt y el turno se queda escrito sin enviar. Regla dura descubierta en la
// primera prueba real del modo voz (2026-08-05, main/voice-send-target.js);
// el relay de Telegram la violaba con `message + '\r'` — con textos cortos
// colaba, una transcripción de voz larga lo destapó (2026-08-06).

const DEFAULT_ENTER_DELAY_MS = 150

async function writePromptThenEnter(writeFn, prompt, { delayMs, waitFn } = {}) {
  const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : DEFAULT_ENTER_DELAY_MS
  const wait = typeof waitFn === 'function'
    ? waitFn
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  writeFn(prompt)
  await wait(delay)
  writeFn('\r')
}

module.exports = { writePromptThenEnter, DEFAULT_ENTER_DELAY_MS }
