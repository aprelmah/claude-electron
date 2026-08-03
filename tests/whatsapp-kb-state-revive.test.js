const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const wa = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-client.js'))
const { reviveKbActive, reviveKbClarify, ESCALATION_REASONS } = wa.__private || {}

const TTL = 1800 // KB_ACTIVE_TTL_SECS y KB_CLARIFY_TTL_SECS, ambos 30 min
const NOW = 1_000_000

// persistState serializa el chat entero, así que kbActive/kbClarify SÍ llegaban
// al disco: era el literal de loadState el que los tiraba al arrancar. Un cliente
// a medias de una ficha volvía a clasificarse desde cero tras un reinicio y se le
// repetía una aclaración ya contestada. Estos revivers son lo que loadState usa
// ahora para recuperarlos sin tragarse basura.
describe('reviveKbActive', () => {
  test('estado fresco → se conserva', () => {
    const v = { ids: ['bateria-no-carga'], since: NOW - 60 }
    assert.deepStrictEqual(reviveKbActive(v, NOW), { ids: ['bateria-no-carga'], since: NOW - 60 })
  })

  test('TTL vencido → null (se re-clasifica, que es lo correcto)', () => {
    assert.strictEqual(reviveKbActive({ ids: ['x'], since: NOW - TTL }, NOW), null)
    assert.strictEqual(reviveKbActive({ ids: ['x'], since: NOW - TTL - 1 }, NOW), null)
  })

  test('justo dentro del TTL → se conserva', () => {
    assert.ok(reviveKbActive({ ids: ['x'], since: NOW - TTL + 1 }, NOW))
  })

  test('forma inválida → null', () => {
    assert.strictEqual(reviveKbActive(null, NOW), null)
    assert.strictEqual(reviveKbActive({}, NOW), null)
    assert.strictEqual(reviveKbActive({ ids: [], since: NOW }, NOW), null)
    assert.strictEqual(reviveKbActive({ ids: 'no-es-array', since: NOW }, NOW), null)
    assert.strictEqual(reviveKbActive({ ids: ['x'] }, NOW), null, 'sin since no se puede fechar')
  })

  test('descarta ids que no son cadenas', () => {
    assert.deepStrictEqual(reviveKbActive({ ids: ['ok', 42, null, ''], since: NOW }, NOW), { ids: ['ok'], since: NOW })
    assert.strictEqual(reviveKbActive({ ids: [42, null], since: NOW }, NOW), null)
  })
})

describe('reviveKbClarify', () => {
  test('intento fresco → se conserva, para no volver a preguntar', () => {
    assert.deepStrictEqual(reviveKbClarify({ count: 1, since: NOW - 10 }, NOW), { count: 1, since: NOW - 10 })
  })

  test('TTL vencido → null: es un tema nuevo y se puede volver a preguntar', () => {
    assert.strictEqual(reviveKbClarify({ count: 1, since: NOW - TTL }, NOW), null)
  })

  test('forma inválida o count 0 → null', () => {
    assert.strictEqual(reviveKbClarify(null, NOW), null)
    assert.strictEqual(reviveKbClarify({ count: 0, since: NOW }, NOW), null)
    assert.strictEqual(reviveKbClarify({ count: 1 }, NOW), null)
  })
})

// 'error' es nuevo: escalada por fallo interno, revertible por el sweep. Si
// loadState no lo aceptara, al reiniciar caería al default 'user' y el chat se
// quedaría mudo para siempre — justo el bug que se estaba arreglando.
describe('ESCALATION_REASONS', () => {
  test('incluye media, user y error', () => {
    assert.deepStrictEqual([...ESCALATION_REASONS].sort(), ['error', 'media', 'user'])
  })
})
