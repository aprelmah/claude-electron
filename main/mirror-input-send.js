'use strict'

// Envío de TEXTO desde la página espejo (móvil) al PTY del host.
//
// Por qué existe: xterm.js entrega al PTY cada evento del teclado según llega
// — correcto con un teclado físico, desastroso con un IME. GBoard no teclea:
// COMPONE. Reescribe la palabra entera al meter un espacio, emite composición
// e input por el mismo carácter, y en Android `autocorrect`/`autocapitalize`
// no son estándar, así que xterm los pone y el teclado los ignora. Medido por
// Luismi el 2026-08-21 desde Android: letras dobles, palabras repetidas y
// ENTER por duplicado.
//
// La cura no es un atributo: es no darle el teclado del móvil a xterm. El móvil
// escribe en un textarea normal y manda el texto ENTERO de una vez. Aquí vive
// la única decisión con consecuencias —cómo se trocea ese envío— fuera del HTML
// remoto, al que no llega ningún test.

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

// El ENTER va SIEMPRE en escritura APARTE: pegado al texto, el TUI de claude se
// queda con el prompt escrito sin enviar (regla dura de pty-prompt-write.js).
const ENTER_DELAY_MS = 150

// `\x1b[?2004h` / `\x1b[?2004l`: el programa del PTY anunciando si quiere que
// los pegados lleguen delimitados. Ocho caracteres exactos.
const PASTE_MODE_RE = /\x1b\[\?2004([hl])/g
const PASTE_MODE_SEQ_LEN = 8

function planMirrorWrites(text, options = {}) {
  const enter = options.enter !== false
  const bracketedPaste = options.bracketedPaste === true
  // Los saltos FINALES sobran: el ENTER lo pone el paso siguiente, y dos
  // enters seguidos en un TUI envían dos veces.
  const body = String(text == null ? '' : text).replace(/[\r\n]+$/, '')
  const steps = []
  if (body) {
    // Un texto multilínea escrito tal cual enviaría el prompt a mitad, porque
    // cada \n es un ENTER. Si el programa PIDIÓ bracketed paste, se lo damos
    // como pegado y sus saltos son texto. Si no consta que lo pidiera, no se
    // inventa: se manda crudo, que es el comportamiento de siempre.
    const data = body.includes('\n') && bracketedPaste
      ? `${PASTE_START}${body}${PASTE_END}`
      : body
    steps.push({ data, delayMs: 0 })
  }
  if (enter) steps.push({ data: '\r', delayMs: steps.length ? ENTER_DELAY_MS : 0 })
  return steps
}

// Estado acumulado del modo bracketed paste, alimentado con lo que el PTY
// escupe. Un chunk puede cortar la secuencia por la mitad, así que se guarda
// cola; con 7 caracteres nunca cabe una secuencia entera (8) y por eso jamás
// se cuenta dos veces la misma.
function detectBracketedPaste(state, chunk) {
  const prev = state && typeof state === 'object' ? state : null
  const text = `${prev && prev.tail ? prev.tail : ''}${chunk == null ? '' : String(chunk)}`
  let enabled = prev ? prev.enabled === true : false
  PASTE_MODE_RE.lastIndex = 0
  let match = null
  while ((match = PASTE_MODE_RE.exec(text))) enabled = match[1] === 'h'
  return { enabled, tail: text.slice(-(PASTE_MODE_SEQ_LEN - 1)) }
}

// Aplica el plan sobre cualquier cosa con .write(). El reloj se inyecta para
// que la suite no espere de verdad los 150 ms del ENTER.
function applyMirrorWrites(target, steps, options = {}) {
  const schedule = typeof options.setTimeoutFn === 'function' ? options.setTimeoutFn : setTimeout
  const isAlive = typeof options.isAlive === 'function' ? options.isAlive : () => true
  let elapsed = 0
  for (const step of Array.isArray(steps) ? steps : []) {
    elapsed += Number(step && step.delayMs) || 0
    const data = String(step && step.data != null ? step.data : '')
    if (!data) continue
    const write = () => {
      if (!isAlive()) return
      try { target.write(data) } catch {}
    }
    if (elapsed <= 0) write()
    else schedule(write, elapsed)
  }
  return elapsed
}

module.exports = {
  planMirrorWrites,
  detectBracketedPaste,
  applyMirrorWrites,
  ENTER_DELAY_MS,
  PASTE_START,
  PASTE_END
}
