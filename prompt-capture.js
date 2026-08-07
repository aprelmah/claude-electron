'use strict'

// Captura heurística de lo que el usuario está escribiendo en el terminal, para
// que "Programar este prompt" abra con texto. Antes esto vivía inline en
// renderer.js y solo recordaba prompts YA ENVIADOS, así que el botón abría
// vacío mientras tenías el prompt delante sin enviar (bug real 2026-08-07).
//
// Dos fuentes: teclas (`absorb`, desde term.onData) y texto inyectado
// (`noteInjected`, desde injectToPty — dictado, arrastrar archivos, doble clic
// en el explorador), que nunca pasa por onData y por tanto era invisible.
//
// Es heurístico a propósito: no modela la posición del cursor, así que editar
// por el medio con las flechas lo desincroniza. El TUI de Claude Code es la
// verdad; esto solo rellena un campo que el usuario puede corregir.
//
// Doble carga como el resto de scripts sueltos del renderer: `window.PromptCapture`
// en el navegador, `module.exports` en node (tests).

const MIN_PENDING = 2

function createPromptCapture() {
  let lastSent = ''
  let buffer = ''
  let inPaste = false

  function absorb(data) {
    if (typeof data !== 'string') return
    let i = 0
    while (i < data.length) {
      const c = data[i]
      // Bracketed paste start/end: ESC [ 2 0 0 ~ / ESC [ 2 0 1 ~
      if (c === '\x1b' && data.substr(i, 6) === '\x1b[200~') {
        inPaste = true
        i += 6
        continue
      }
      if (c === '\x1b' && data.substr(i, 6) === '\x1b[201~') {
        inPaste = false
        i += 6
        continue
      }
      if (inPaste) {
        // Dentro del paste todo es texto literal (incluido el salto de línea).
        buffer += (c === '\r' || c === '\n') ? '\n' : c
        i += 1
        continue
      }
      // ESC + secuencia (flechas, F-keys…): saltar hasta la letra final.
      if (c === '\x1b') {
        i += 1
        if (data[i] === '[') {
          i += 1
          while (i < data.length && !/[a-zA-Z~]/.test(data[i])) i += 1
          i += 1
        }
        continue
      }
      if (c === '\x7f' || c === '\b') {
        if (buffer.length) buffer = buffer.slice(0, -1)
        i += 1
        continue
      }
      if (c === '\r' || c === '\n') {
        const trimmed = buffer.trim()
        if (trimmed.length >= MIN_PENDING) lastSent = trimmed
        buffer = ''
        i += 1
        continue
      }
      if (c.charCodeAt(0) < 0x20) { i += 1; continue }
      buffer += c
      i += 1
    }
  }

  function noteInjected(text) {
    absorb(text)
  }

  function pending() {
    const trimmed = buffer.trim()
    return trimmed.length >= MIN_PENDING ? trimmed : ''
  }

  function current() {
    return pending() || lastSent
  }

  return { absorb, noteInjected, pending, current }
}

const promptCapture = { createPromptCapture }

if (typeof module !== 'undefined' && module.exports) module.exports = promptCapture
if (typeof window !== 'undefined') window.PromptCapture = promptCapture
