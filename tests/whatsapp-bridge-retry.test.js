const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const wa = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-client.js'))
const priv = wa.__private || {}

// Bug real 2026-08-02: un mensaje entrante coincidió con una reconexión del
// bridge Baileys; el /send/text de la escalada cayó en la ventana "no listo"
// (503), no había reintento, y el cliente se quedó sin respuesta con el
// "escribiendo…" colgado en el panel.
//
// El reintento solo vale para ESE caso. /send/text no es idempotente, así que
// isSafeToResend solo dice que sí cuando consta que el mensaje NO salió: ante
// la duda se abandona, porque un duplicado le llega al cliente.
describe('isSafeToResend', () => {
  test('503 "No listo": el bridge corta antes de sendMessage → seguro reenviar', () => {
    const err = new Error('bridge POST /send/text → 503')
    err.status = 503
    assert.strictEqual(priv.isSafeToResend(err), true)
  })

  test('ECONNREFUSED: no se llegó a abrir la conexión → seguro reenviar', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:3031')
    err.code = 'ECONNREFUSED'
    assert.strictEqual(priv.isSafeToResend(err), true)
  })

  test('500: el catch del bridge envuelve al propio sendMessage (Baileys lanza "Timed Out" con el mensaje ya enviado) → ambiguo, NO reenviar', () => {
    const err = new Error('bridge POST /send/text → 500: Timed Out')
    err.status = 500
    assert.strictEqual(priv.isSafeToResend(err), false)
  })

  test('timeout del cliente sin status: con humanize el envío puede haberse entregado → ambiguo, NO reenviar', () => {
    assert.strictEqual(priv.isSafeToResend(new Error('bridge timeout')), false)
    assert.strictEqual(priv.isSafeToResend({}), false)
    assert.strictEqual(priv.isSafeToResend(null), false)
  })

  test('ECONNRESET: el socket ya estaba abierto, pudo haber salido → NO reenviar', () => {
    const err = new Error('socket hang up')
    err.code = 'ECONNRESET'
    assert.strictEqual(priv.isSafeToResend(err), false)
  })

  test('401 (auth) → NO reenviar, reintentar no lo arregla', () => {
    const err = new Error('x')
    err.status = 401
    assert.strictEqual(priv.isSafeToResend(err), false)
  })

  test('400 (payload inválido) → NO reenviar', () => {
    const err = new Error('x')
    err.status = 400
    assert.strictEqual(priv.isSafeToResend(err), false)
  })

  test('429 (rate limit) → NO reenviar', () => {
    const err = new Error('x')
    err.status = 429
    assert.strictEqual(priv.isSafeToResend(err), false)
  })
})
