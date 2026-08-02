const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const wa = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-client.js'))
const priv = wa.__private || {}

// Bug real 2026-08-02: un mensaje entrante coincidió con una reconexión del
// bridge Baileys; el /send/text de la escalada cayó en la ventana "no listo"
// (503), no había reintento, y el cliente se quedó sin respuesta con el
// "escribiendo…" colgado en el panel. isTransientBridgeError decide qué
// errores merece la pena reintentar (bridgeFetchWithRetry, usado solo en
// envíos automáticos del bot, no en los manuales de Luismi).
describe('isTransientBridgeError', () => {
  test('sin status (fallo de red/timeout, bridge caído del todo) → transitorio', () => {
    assert.strictEqual(priv.isTransientBridgeError(new Error('bridge timeout')), true)
    assert.strictEqual(priv.isTransientBridgeError({}), true)
    assert.strictEqual(priv.isTransientBridgeError(null), true)
  })

  test('503 "No listo" (el caso real de la reconexión) → transitorio', () => {
    const err = new Error('bridge POST /send/text → 503')
    err.status = 503
    assert.strictEqual(priv.isTransientBridgeError(err), true)
  })

  test('5xx en general → transitorio', () => {
    const err = new Error('x')
    err.status = 500
    assert.strictEqual(priv.isTransientBridgeError(err), true)
  })

  test('401 (auth) → NO transitorio, reintentar no lo arregla', () => {
    const err = new Error('x')
    err.status = 401
    assert.strictEqual(priv.isTransientBridgeError(err), false)
  })

  test('400 (payload inválido) → NO transitorio', () => {
    const err = new Error('x')
    err.status = 400
    assert.strictEqual(priv.isTransientBridgeError(err), false)
  })

  test('429 (rate limit) → NO transitorio: reintentar de inmediato empeora, no ayuda', () => {
    const err = new Error('x')
    err.status = 429
    assert.strictEqual(priv.isTransientBridgeError(err), false)
  })
})
