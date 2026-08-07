'use strict'

// Emparejamiento por código de un solo uso (robado de Hermes Agent):
// un chat desconocido pide vincularse, recibe un código de 6 dígitos y el
// dueño lo aprueba en la app. El manager vive en memoria a propósito:
// reiniciar la app caduca todos los códigos pendientes.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createPairingManager } = require(path.join(REPO_ROOT, 'main', 'telegram-pairing.js'))

describe('telegram-pairing: requestPairing', () => {
  test('emite un código de 6 dígitos con caducidad', () => {
    let ts = 1000
    const mgr = createPairingManager({ now: () => ts, ttlMs: 600000 })
    const res = mgr.requestPairing({ userId: '111', chatId: '111', username: 'pepe' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.created, true)
    assert.match(res.code, /^\d{6}$/)
    assert.strictEqual(res.expiresAt, 1000 + 600000)
  })

  test('el mismo usuario pidiendo otra vez recibe el MISMO código (no spamea códigos)', () => {
    const mgr = createPairingManager({ now: () => 1000 })
    const a = mgr.requestPairing({ userId: '111' })
    const b = mgr.requestPairing({ userId: '111' })
    assert.strictEqual(b.ok, true)
    assert.strictEqual(b.created, false)
    assert.strictEqual(a.code, b.code)
  })

  test('caducado el código, una nueva petición emite código nuevo', () => {
    let ts = 1000
    const mgr = createPairingManager({ now: () => ts, ttlMs: 1000 })
    const a = mgr.requestPairing({ userId: '111' })
    ts = 2001
    const b = mgr.requestPairing({ userId: '111' })
    assert.strictEqual(b.created, true)
    assert.notStrictEqual(a.code, b.code)
  })

  test('sin userId no hay código', () => {
    const mgr = createPairingManager()
    assert.strictEqual(mgr.requestPairing({}).ok, false)
    assert.strictEqual(mgr.requestPairing({ userId: '   ' }).ok, false)
  })

  test('tope de pendientes: el sexto usuario distinto recibe rate-limited', () => {
    const mgr = createPairingManager({ now: () => 1000, maxPending: 5 })
    for (let i = 1; i <= 5; i++) {
      assert.strictEqual(mgr.requestPairing({ userId: String(i) }).ok, true)
    }
    const res = mgr.requestPairing({ userId: '6' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.reason, 'rate-limited')
  })

  test('los caducados no cuentan para el tope', () => {
    let ts = 1000
    const mgr = createPairingManager({ now: () => ts, ttlMs: 1000, maxPending: 2 })
    mgr.requestPairing({ userId: '1' })
    mgr.requestPairing({ userId: '2' })
    ts = 5000
    assert.strictEqual(mgr.requestPairing({ userId: '3' }).ok, true)
  })

  test('códigos únicos aunque el RNG colisione', () => {
    let calls = 0
    const rig = [7, 7, 8]
    const mgr = createPairingManager({ now: () => 1000, randomInt: () => rig[Math.min(calls++, 2)] })
    const a = mgr.requestPairing({ userId: '1' })
    const b = mgr.requestPairing({ userId: '2' })
    assert.notStrictEqual(a.code, b.code)
  })
})

describe('telegram-pairing: approve / reject / listPending', () => {
  test('aprobar devuelve el userId y consume el código', () => {
    const mgr = createPairingManager({ now: () => 1000 })
    const { code } = mgr.requestPairing({ userId: '111', chatId: '222', username: 'pepe' })
    const res = mgr.approve(code)
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.userId, '111')
    assert.strictEqual(res.chatId, '222')
    assert.strictEqual(mgr.approve(code).ok, false)
  })

  test('aprobar un código desconocido o caducado falla', () => {
    let ts = 1000
    const mgr = createPairingManager({ now: () => ts, ttlMs: 1000 })
    assert.strictEqual(mgr.approve('000000').ok, false)
    const { code } = mgr.requestPairing({ userId: '111' })
    ts = 2001
    const res = mgr.approve(code)
    assert.strictEqual(res.ok, false)
  })

  test('rechazar elimina el código pendiente', () => {
    const mgr = createPairingManager({ now: () => 1000 })
    const { code } = mgr.requestPairing({ userId: '111' })
    assert.strictEqual(mgr.reject(code).ok, true)
    assert.strictEqual(mgr.approve(code).ok, false)
  })

  test('listPending devuelve metadatos y poda caducados', () => {
    let ts = 1000
    const mgr = createPairingManager({ now: () => ts, ttlMs: 1000 })
    mgr.requestPairing({ userId: '1', username: 'ana', firstName: 'Ana' })
    ts = 1500
    mgr.requestPairing({ userId: '2' })
    ts = 2100 // el primero caducó (1000+1000 < 2100), el segundo vive
    const list = mgr.listPending()
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].userId, '2')
    assert.match(list[0].code, /^\d{6}$/)
  })
})
