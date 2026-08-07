'use strict'

// Al reanudar una sesión de codex nacida en un worktree, el TUI pregunta qué
// directorio usar (el grabado en el rollout ya no existe: se limpia al cerrar la
// sesión). En POWER-AGENT el directorio lo decide el aislamiento git, no el
// rollout, así que la respuesta correcta es siempre "usar el directorio actual".
// Se contesta sola y se avisa — visibilidad antes que magia.

const test = require('node:test')
const assert = require('node:assert/strict')
const { createCodexResumeCwdPrompt } = require('../main/codex-resume-watch')

// Traza REAL capturada de un PTY (sonda 2026-08-07): el TUI pinta palabra a
// palabra con posicionamiento de cursor entre medias, así que al quitar los ANSI
// el texto queda SIN ESPACIOS ("Chooseworkingdirectory..."). Buscar la frase con
// espacios no encontraba nada y el menú se quedaba esperando al usuario.
const MENU_REAL = 'Choose\x1b[2;8Hworking\x1b[2;16Hdirectory\x1b[2;26Hto\x1b[2;29H\x1b[1mresume'
  + '\x1b[2;36H\x1b[22mthis\x1b[2;41Hsession\x1b[4;3H\x1b[2mSession = latest cwd recorded in the resumed session'
  + '\x1b[5;3HCurrent = your current working directory'
  + '\x1b[7;1H\x1b[22m\x1b[38;5;6;49m› 1. Use session directory (/ud/worktrees/proj-abc-msj6v2jt-5b94ec)'
  + '\x1b[9;3H\x1b[39;49m2.\x1b[9;6HUse\x1b[9;10Hcurrent\x1b[9;18Hdirectory\x1b[9;28H(/ud/worktrees/proj-abc-msj85igp-ce0c54)'
  + '\x1b[11;3H3.\x1b[11;6HAlways\x1b[11;13Huse\x1b[11;17Hsession\x1b[11;25Hdirectory'
  + '\x1b[12;3H4.\x1b[12;6HAlways\x1b[12;13Huse\x1b[12;17Hcurrent\x1b[12;25Hdirectory'
  + '\x1b[14;3H\x1b[2mPress enter to continue'

// Mismo PTY, unos ms después: codex se rinde porque la conversación ya está
// abierta en otro sitio (en el caso real, en Terminal.app por "Llevar a
// Terminal"). Sin esto el PTY moría y el renderer abría el picker sin explicar nada.
const ACTIVE_WRITER = 'Error: Failed to resume session from /Users/isabel/.codex/sessions/2026/08/07/'
  + 'rollout-2026-08-07T18-59-06-019fdd2a.jsonl: thread/resume failed during TUI bootstrap: '
  + 'thread/resume failed: thread 019fdd2a already has an active writer (code -32600)\r\n'

const MENU = [
  'Choose working directory to resume this session',
  '',
  '  Session = latest cwd recorded in the resumed session',
  '  Current = your current working directory',
  '',
  '\x1b[36m› 1. Use session directory (/ud/worktrees/proj-abc-vieja)\x1b[0m',
  '  2. Use current directory (/ud/worktrees/proj-abc-nueva)',
  '  3. Always use session directory',
  '  4. Always use current directory',
  '',
  '  Press enter to continue'
].join('\r\n')

function make() {
  const writes = []
  const notices = []
  const fatals = []
  const watcher = createCodexResumeCwdPrompt({
    onAnswer: (data) => writes.push(data),
    onNotice: (msg) => notices.push(msg),
    onFatal: (msg) => fatals.push(msg)
  })
  return { watcher, writes, notices, fatals }
}

test('contesta el menú REAL del TUI, pintado palabra a palabra', () => {
  const { watcher, writes } = make()
  watcher.feed(MENU_REAL)
  assert.deepEqual(writes, ['2\r'])
})

test('el menú real partido en chunks también se contesta', () => {
  const { watcher, writes } = make()
  const corte = MENU_REAL.indexOf('9;10H')
  watcher.feed(MENU_REAL.slice(0, corte))
  assert.deepEqual(writes, [], 'la opción aún no está completa')
  watcher.feed(MENU_REAL.slice(corte))
  assert.deepEqual(writes, ['2\r'])
})

test('aguanta el menú real llegando byte a byte', () => {
  const { watcher, writes } = make()
  for (const ch of MENU_REAL) watcher.feed(ch)
  assert.deepEqual(writes, ['2\r'])
})

test('avisa con un mensaje claro cuando la conversación ya está abierta en otro sitio', () => {
  const { watcher, fatals } = make()
  watcher.feed(ACTIVE_WRITER)
  assert.equal(fatals.length, 1)
  assert.match(fatals[0], /abierta/i)
  assert.match(fatals[0], /Terminal|otra ventana/i)
})

test('el aviso de conversación ocupada sale una sola vez', () => {
  const { watcher, fatals } = make()
  watcher.feed(ACTIVE_WRITER)
  watcher.feed(ACTIVE_WRITER)
  assert.equal(fatals.length, 1)
})

test('contestar el menú no impide detectar el error posterior', () => {
  const { watcher, writes, fatals } = make()
  watcher.feed(MENU_REAL)
  watcher.feed(ACTIVE_WRITER)
  assert.deepEqual(writes, ['2\r'])
  assert.equal(fatals.length, 1)
})

test('responde la opción del directorio actual', () => {
  const { watcher, writes } = make()
  watcher.feed(MENU)
  assert.deepEqual(writes, ['2\r'])
})

test('avisa una vez de que lo ha hecho', () => {
  const { watcher, notices } = make()
  watcher.feed(MENU)
  assert.equal(notices.length, 1)
  assert.match(notices[0], /directorio|worktree/i)
})

test('no contesta dos veces al mismo menú', () => {
  const { watcher, writes } = make()
  watcher.feed(MENU)
  watcher.feed(MENU)
  assert.deepEqual(writes, ['2\r'])
})

test('sigue el número que traiga el menú, no un 2 fijo', () => {
  const { watcher, writes } = make()
  watcher.feed(MENU.replace('2. Use current directory', '7. Use current directory'))
  assert.deepEqual(writes, ['7\r'])
})

test('tolera el menú partido en varios chunks', () => {
  const { watcher, writes } = make()
  const mitad = Math.floor(MENU.length / 2)
  watcher.feed(MENU.slice(0, mitad))
  assert.deepEqual(writes, [], 'aún no está la opción entera')
  watcher.feed(MENU.slice(mitad))
  assert.deepEqual(writes, ['2\r'])
})

test('no responde a la salida normal de codex', () => {
  const { watcher, writes } = make()
  watcher.feed('Use current directory en un mensaje cualquiera\r\n')
  watcher.feed('2. Use current directory sin el título del menú\r\n')
  assert.deepEqual(writes, [])
})

test('el buffer no crece sin límite', () => {
  const { watcher } = make()
  for (let i = 0; i < 50; i++) watcher.feed('x'.repeat(2000))
  assert.ok(watcher.bufferLength() <= 8192, `buffer desbocado: ${watcher.bufferLength()}`)
})

test('reset permite contestar en el siguiente spawn', () => {
  const { watcher, writes } = make()
  watcher.feed(MENU)
  watcher.reset()
  watcher.feed(MENU)
  assert.deepEqual(writes, ['2\r', '2\r'])
})

test('ignora datos que no son texto', () => {
  const { watcher, writes } = make()
  watcher.feed(null)
  watcher.feed(undefined)
  watcher.feed(123)
  assert.deepEqual(writes, [])
})
