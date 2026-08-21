'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  planMirrorWrites,
  detectBracketedPaste,
  applyMirrorWrites,
  ENTER_DELAY_MS
} = require('../main/mirror-input-send')

// Por qué existe este fichero: el móvil dejó de teclear contra xterm (GBoard
// componía y duplicaba) y ahora manda el texto entero. Ese troceado es la única
// decisión con consecuencias del cambio, y el HTML remoto no lo cubre nadie.

test('el texto va en un write y el ENTER en otro — jamás pegados', () => {
  const steps = planMirrorWrites('hola mundo')
  assert.deepEqual(steps, [
    { data: 'hola mundo', delayMs: 0 },
    { data: '\r', delayMs: ENTER_DELAY_MS }
  ])
})

test('sin ENTER: para menús que responden a la tecla suelta', () => {
  assert.deepEqual(planMirrorWrites('2', { enter: false }), [{ data: '2', delayMs: 0 }])
})

test('texto vacío con enter → solo el ENTER, y sin espera que retrasarle', () => {
  assert.deepEqual(planMirrorWrites('', { enter: true }), [{ data: '\r', delayMs: 0 }])
  assert.deepEqual(planMirrorWrites('   ', { enter: false }), [{ data: '   ', delayMs: 0 }])
})

test('los saltos FINALES se recortan: dos enters seguidos envían dos veces', () => {
  assert.deepEqual(planMirrorWrites('hola\n\n'), [
    { data: 'hola', delayMs: 0 },
    { data: '\r', delayMs: ENTER_DELAY_MS }
  ])
  assert.deepEqual(planMirrorWrites('hola\r\n', { enter: false }), [{ data: 'hola', delayMs: 0 }])
})

test('multilínea con bracketed paste activo → va delimitado, no como enters', () => {
  const [first] = planMirrorWrites('linea 1\nlinea 2', { bracketedPaste: true })
  assert.equal(first.data, '\x1b[200~linea 1\nlinea 2\x1b[201~')
})

test('multilínea SIN constancia del modo → crudo, no se inventa la secuencia', () => {
  const [first] = planMirrorWrites('linea 1\nlinea 2', { bracketedPaste: false })
  assert.equal(first.data, 'linea 1\nlinea 2')
})

test('una sola línea nunca se envuelve, aunque el modo esté activo', () => {
  const [first] = planMirrorWrites('ls -la', { bracketedPaste: true })
  assert.equal(first.data, 'ls -la')
})

test('el modo bracketed paste se aprende del stream y el último manda', () => {
  let state = detectBracketedPaste(null, 'sin nada')
  assert.equal(state.enabled, false)
  state = detectBracketedPaste(state, 'arranca el TUI \x1b[?2004h listo')
  assert.equal(state.enabled, true)
  state = detectBracketedPaste(state, 'sigue pintando')
  assert.equal(state.enabled, true)
  state = detectBracketedPaste(state, 'sale del TUI \x1b[?2004l')
  assert.equal(state.enabled, false)
})

test('una secuencia partida entre dos chunks se detecta igual (y no se cuenta dos veces)', () => {
  let state = detectBracketedPaste(null, 'pinta\x1b[?20')
  assert.equal(state.enabled, false)
  state = detectBracketedPaste(state, '04h y sigue')
  assert.equal(state.enabled, true)
  // La cola no puede reactivar sola lo que ya se contó.
  state = detectBracketedPaste({ enabled: false, tail: state.tail }, 'nada')
  assert.equal(state.enabled, false)
})

test('applyMirrorWrites separa en el tiempo y respeta un PTY que ya murió', () => {
  const writes = []
  const timers = []
  const target = { write: (d) => writes.push(d) }
  let alive = true
  const elapsed = applyMirrorWrites(target, planMirrorWrites('hola'), {
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return null },
    isAlive: () => alive
  })
  assert.deepEqual(writes, ['hola'])
  assert.equal(elapsed, ENTER_DELAY_MS)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, ENTER_DELAY_MS)
  alive = false
  timers[0].fn()
  assert.deepEqual(writes, ['hola'], 'el ENTER diferido no se escribe si el PTY murió')
})
