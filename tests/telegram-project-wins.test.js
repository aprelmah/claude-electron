'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')

const { shouldAllowMacSessionFallback } = require('../main/telegram-relay-bindings')

// Bug real 2026-08-03 (Luismi): elegía TURBO-ENERGY con /proyecto, escribía, y le
// contestaba la sesión de eatBook que tenía abierta en el Mac — con el cwd de
// eatBook y bypassPermissions.
//
// El fallback a "cualquier sesión claude viva en la app" es de mayo (f4d2d61) y
// nunca miró el cwd. El picker de agosto (12aae16) solo tocó telegram-bridge.js;
// el chatCwd llegó a main.js en 870e658 y solo al camino headless. Por eso
// /proyecto + /sesiones SÍ funcionaba (había sessionId → headless) y /proyecto a
// secas no: sin sessionId caía al relay del Mac.
//
// Regla que pidió Luismi, literal: "si abro un proyecto o sesión desde Telegram
// se respeta independientemente de lo que tenga abierto en el Mac". Nada de
// engancharse "si el cwd casualmente coincide" — eso deja el comportamiento
// atado a lo que haya abierto, que es justo lo que no quiere.
describe('Telegram manda sobre lo que haya abierto en el Mac', () => {
  test('con proyecto elegido: NO se cae a las sesiones del Mac', () => {
    assert.strictEqual(
      shouldAllowMacSessionFallback({ bindingBound: false, chatCwd: '/Users/isabel/Desktop/LUISMI/TURBO-ENERGY RMA' }),
      false
    )
  })

  test('sin proyecto elegido: el fallback de siempre sigue vivo', () => {
    assert.strictEqual(shouldAllowMacSessionFallback({ bindingBound: false, chatCwd: null }), true)
    assert.strictEqual(shouldAllowMacSessionFallback({ bindingBound: false, chatCwd: '' }), true)
  })

  test('con binding explícito de relay (/abrir) nunca hay fallback', () => {
    assert.strictEqual(shouldAllowMacSessionFallback({ bindingBound: true, chatCwd: null }), false)
    assert.strictEqual(shouldAllowMacSessionFallback({ bindingBound: true, chatCwd: '/x' }), false)
  })

  test('sin argumentos no revienta y permite el fallback', () => {
    assert.strictEqual(shouldAllowMacSessionFallback(), true)
    assert.strictEqual(shouldAllowMacSessionFallback({}), true)
  })
})
