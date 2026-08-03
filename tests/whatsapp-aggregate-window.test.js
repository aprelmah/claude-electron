const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const wa = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-client.js'))
const {
  nextAggregateSilenceMs,
  AGGREGATE_SILENCE_MIN_MS,
  AGGREGATE_SILENCE_MAX_MS
} = wa.__private || {}

// Dos requisitos que tiran en direcciones opuestas y hay que cumplir a la vez:
//   1. Agrupar de verdad: con un suelo de 4s, una ráfaga con la pausa normal de
//      5-6s que tarda alguien en escribir se partía en dos turnos y el cliente
//      recibía dos mensajes por una sola idea.
//   2. No cantar: un valor FIJO es el patrón más delator del pipeline. Cada
//      ráfaga tiene que sacar su propio número.
describe('ventana de agrupación', () => {
  test('el suelo cubre la pausa típica al redactar (>= 7s)', () => {
    assert.ok(AGGREGATE_SILENCE_MIN_MS >= 7_000, `suelo demasiado bajo: ${AGGREGATE_SILENCE_MIN_MS}`)
  })

  test('el techo no dispara la latencia percibida (<= 15s)', () => {
    assert.ok(AGGREGATE_SILENCE_MAX_MS <= 15_000, `techo demasiado alto: ${AGGREGATE_SILENCE_MAX_MS}`)
  })

  test('siempre dentro del rango', () => {
    for (let i = 0; i < 500; i++) {
      const v = nextAggregateSilenceMs()
      assert.ok(v >= AGGREGATE_SILENCE_MIN_MS && v < AGGREGATE_SILENCE_MAX_MS, `fuera de rango: ${v}`)
    }
  })

  test('no es un valor fijo: 200 tiradas dan muchos valores distintos', () => {
    const vistos = new Set()
    for (let i = 0; i < 200; i++) vistos.add(nextAggregateSilenceMs())
    assert.ok(vistos.size > 150, `demasiado repetitivo, solo ${vistos.size} valores distintos`)
  })
})
