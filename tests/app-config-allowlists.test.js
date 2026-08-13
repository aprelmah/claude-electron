'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { SAFE_CLI, SAFE_TELEGRAM, SAFE_LAN, pick } = require('../main/app-config-allowlists')

test('pick solo copia las claves de la allowlist', () => {
  const out = pick({ enabled: true, port: 9999, authToken: 'secreto' }, SAFE_LAN)
  assert.deepStrictEqual(out, { enabled: true, port: 9999 })
})

test('pick tolera entradas que no son objeto', () => {
  assert.deepStrictEqual(pick(null, SAFE_LAN), {})
  assert.deepStrictEqual(pick(undefined, SAFE_LAN), {})
  assert.deepStrictEqual(pick('texto', SAFE_LAN), {})
  assert.deepStrictEqual(pick(42, SAFE_LAN), {})
})

test('pick distingue ausente de vacío: un campo borrado a propósito debe pasar', () => {
  // Vaciar publicClientUrl en la UI es la forma de dejar de publicar fuera.
  // Si pick ignorase el string vacío, la URL vieja quedaría pegada para siempre.
  const out = pick({ publicClientUrl: '' }, SAFE_LAN)
  assert.deepStrictEqual(out, { publicClientUrl: '' })
})

test('pick no hereda del prototipo', () => {
  const malicioso = Object.create({ port: 1234 })
  assert.deepStrictEqual(pick(malicioso, SAFE_LAN), {})
})

// Regresión del 2026-08-13: SAFE_LAN era ['enabled', 'port'], así que el
// renderer enviaba las dos URLs públicas y save-app-config las descartaba en
// silencio. Los campos volvían vacíos al guardar y la publicación por
// Cloudflare Tunnel era inalcanzable desde la interfaz.
test('SAFE_LAN deja pasar las URLs públicas del túnel', () => {
  const enviado = {
    enabled: true,
    port: 9999,
    publicClientUrl: 'https://ejemplo.trycloudflare.com/lan-client.html',
    publicWsUrl: 'wss://ejemplo-ws.trycloudflare.com'
  }
  assert.deepStrictEqual(pick(enviado, SAFE_LAN), enviado)
})

test('SAFE_LAN nunca acepta authToken desde el renderer', () => {
  assert.ok(!SAFE_LAN.includes('authToken'))
  const out = pick({ port: 9999, authToken: 'robado' }, SAFE_LAN)
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'authToken'))
})

test('SAFE_CLI y SAFE_TELEGRAM no exponen configuración de empresa', () => {
  for (const lista of [SAFE_CLI, SAFE_TELEGRAM, SAFE_LAN]) {
    assert.ok(!lista.includes('roles'))
    assert.ok(!lista.includes('operators'))
    assert.ok(!lista.includes('enterprise'))
  }
})

test('las allowlists no tienen claves repetidas', () => {
  for (const lista of [SAFE_CLI, SAFE_TELEGRAM, SAFE_LAN]) {
    assert.strictEqual(new Set(lista).size, lista.length)
  }
})
