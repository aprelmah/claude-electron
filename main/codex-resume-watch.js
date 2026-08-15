'use strict'

// Vigía del arranque de un `codex resume` dentro del PTY. Dos cosas, las dos
// medidas con una sonda sobre un PTY real (2026-08-07):
//
// 1. El TUI pregunta qué directorio usar cuando el cwd grabado en el rollout no
//    es el actual. Con el aislamiento git eso pasa SIEMPRE: la conversación nació
//    en el worktree de su sesión, que se limpia al cerrarla. El directorio de una
//    sesión lo decide la app, no el rollout, así que la respuesta correcta es
//    siempre "usar el directorio actual" — se contesta sola y se avisa.
//    No se usan las opciones "Always use…": guardarían la preferencia en la
//    config global de codex y afectarían a las sesiones que Luismi abre a mano.
//
// 2. Codex se niega a reanudar una conversación que ya tiene otro escritor
//    ("already has an active writer"), y muere. Pasó de verdad: el botón "Llevar
//    a Terminal" dejó `codex resume <id>` vivo en Terminal.app y, al elegir esa
//    misma sesión en el picker, el PTY moría y el renderer abría el selector de
//    proyecto sin explicar nada.
//
// REGLA DURA: el TUI pinta palabra a palabra con posicionamiento de cursor entre
// medias (`Choose` `\x1b[2;8H` `working` …). Quitar los ANSI deja el texto SIN
// ESPACIOS, así que todo patrón contra la pantalla de codex se compara sobre el
// texto normalizado sin espacios. Buscar la frase con espacios no encuentra nada.

// stripAnsi completo (OSC, ESC sueltos y controles C0): un residuo ANSI en el
// texto normalizado rompe el match contra el TUI, así que se usa el de
// agent-pty-proposal en vez de una copia débil local.
const { stripAnsi } = require('./agent-pty-proposal')

const MENU_TITLE = 'Chooseworkingdirectorytoresumethissession'
const CURRENT_OPTION = /(\d+)\.Usecurrentdirectory/
const ACTIVE_WRITER = 'alreadyhasanactivewriter'
const MAX_BUFFER = 8192

// Sin ANSI y sin espacios: así el texto es estable pese al pintado por celdas.
function normalize(text) {
  return stripAnsi(String(text)).replace(/\s+/g, '')
}

// Un chunk del PTY puede cortar una secuencia ANSI por la mitad (`\x1b[9;1` +
// `0H`). Normalizar cada mitad por separado deja basura en medio del texto y el
// patrón deja de casar, así que la cola incompleta se guarda para el chunk
// siguiente. Devuelve el índice del ESC pendiente, o -1 si no hay ninguno.
const MAX_PENDING = 64
function pendingEscapeIndex(text) {
  const idx = text.lastIndexOf('\x1b')
  if (idx === -1) return -1
  const tail = text.slice(idx)
  if (/^\x1b\[[0-9;?]*[A-Za-z]/.test(tail)) return -1
  if (/^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.test(tail)) return -1
  // ESC seguido de algo que ya no puede ser el principio de una secuencia:
  // no vale la pena esperar más.
  if (tail.length > MAX_PENDING) return -1
  if (tail.length > 1 && tail[1] !== '[' && tail[1] !== ']') return -1
  return idx
}

function createCodexResumeCwdPrompt({ onAnswer, onNotice, onFatal } = {}) {
  let buffer = ''
  let pendingRaw = ''
  let answered = false
  let reported = false

  function feed(data) {
    if (typeof data !== 'string' || !data) return
    const raw = pendingRaw + data
    const cut = pendingEscapeIndex(raw)
    const safe = cut === -1 ? raw : raw.slice(0, cut)
    pendingRaw = cut === -1 ? '' : raw.slice(cut)
    buffer = (buffer + normalize(safe)).slice(-MAX_BUFFER)

    if (!reported && buffer.includes(ACTIVE_WRITER)) {
      reported = true
      try {
        onFatal?.('Esa conversación de codex ya está abierta en otra ventana o en Terminal. Ciérrala allí para reanudarla aquí.')
      } catch {}
    }

    if (answered || !buffer.includes(MENU_TITLE)) return
    const m = CURRENT_OPTION.exec(buffer)
    if (!m) return // el menú aún llega partido: se contesta cuando esté la opción
    answered = true
    try { onAnswer?.(`${m[1]}\r`) } catch {}
    try {
      onNotice?.('Sesión reanudada en el directorio de esta ventana (el worktree original ya no existe).')
    } catch {}
  }

  function reset() {
    buffer = ''
    pendingRaw = ''
    answered = false
    reported = false
  }

  return {
    feed,
    reset,
    bufferLength: () => buffer.length,
    hasAnswered: () => answered
  }
}

module.exports = { createCodexResumeCwdPrompt, MENU_TITLE }
