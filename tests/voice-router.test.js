'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { routeVoiceText, resolveVoiceTarget } = require(path.join(REPO_ROOT, 'main', 'voice-router.js'))

// DECISIÓN DE PRODUCTO 2026-08-05: hablar por voz es hablarle a TU sesión de
// claude. Ya no hay detección de intención por patrones — el sub-chat es un
// destino al que se va queriendo, con el toggle. Los ~50 tests de la heurística
// anterior (verbos de ejecución al inicio, cortesías encadenadas, retractación,
// preguntas) se retiraron con ella; viven en el historial de git por si el modo
// mixto vuelve.
describe('voice-router: intención', () => {
  test('sin toggle, todo va a la sesión de trabajo', () => {
    const frases = [
      'arregla el login',
      '¿qué hace este módulo?',
      'el último commit rompió el build',
      'commitea, no, mejor espera',
      'dale un vistazo a esto'
    ]
    for (const frase of frases) {
      assert.strictEqual(routeVoiceText(frase, {}).mode, 'encargo', frase)
    }
  })

  test('el toggle manual manda sobre el defecto', () => {
    assert.strictEqual(routeVoiceText('arregla el login', { forcedMode: 'charla' }).mode, 'charla')
    assert.strictEqual(routeVoiceText('¿qué opinas?', { forcedMode: 'encargo' }).mode, 'encargo')
  })

  test('un modo forzado inválido se ignora y vuelve al defecto', () => {
    assert.strictEqual(routeVoiceText('lo que sea', { forcedMode: 'otra-cosa' }).mode, 'encargo')
    assert.strictEqual(routeVoiceText('lo que sea', { forcedMode: '' }).mode, 'encargo')
  })

  test('texto vacío o basura no revienta (lo filtra sendToTarget, no el router)', () => {
    for (const entrada of ['', '   ', null, undefined, 42, {}]) {
      const r = routeVoiceText(entrada, {})
      assert.ok(r && (r.mode === 'encargo' || r.mode === 'charla'), String(entrada))
    }
  })

  test('opts null explícito no revienta (el default de parámetro solo cubre undefined)', () => {
    assert.strictEqual(routeVoiceText('hola', null).mode, 'encargo')
    assert.strictEqual(routeVoiceText('hola').mode, 'encargo')
  })

  test('siempre devuelve un motivo legible para la UI', () => {
    assert.ok(routeVoiceText('hola', {}).reason.length > 0)
    assert.strictEqual(routeVoiceText('hola', { forcedMode: 'charla' }).reason, 'forzado')
  })
})

describe('voice-router: destino', () => {
  const sesionViva = { activeCli: 'claude', claudeSessionId: 'sid-1', pty: {}, wcId: 7 }

  test('con sesión viva, la charla va al sub-chat', () => {
    const r = resolveVoiceTarget(sesionViva, { subchatHas: false })
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.target, 'subchat')
    assert.strictEqual(r.reuseSubchat, false)
  })

  test('si ya hay sub-chat abierto, se reutiliza, no se abre otro', () => {
    const r = resolveVoiceTarget(sesionViva, { subchatHas: true })
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.reuseSubchat, true)
  })

  test('sin sesión, no arranca', () => {
    const r = resolveVoiceTarget(null, {})
    assert.strictEqual(r.ok, false)
    assert.ok(/sesión/i.test(r.reason))
  })

  test('sin PTY vivo, no arranca', () => {
    const r = resolveVoiceTarget({ activeCli: 'claude', claudeSessionId: 'x', pty: null }, {})
    assert.strictEqual(r.ok, false)
  })

  test('sesión sin campo pty (undefined) se trata igual que sin PTY vivo', () => {
    const r = resolveVoiceTarget({ activeCli: 'claude', claudeSessionId: 'x' }, {})
    assert.strictEqual(r.ok, false)
  })

  test('codex no está soportado y lo dice', () => {
    const r = resolveVoiceTarget({ activeCli: 'codex', claudeSessionId: 'x', pty: {} }, {})
    assert.strictEqual(r.ok, false)
    assert.ok(/codex/i.test(r.reason))
  })

  test('sin sessionId todavía, no hay fork posible', () => {
    // El claudeSessionId no existe hasta el primer turno.
    const r = resolveVoiceTarget({ activeCli: 'claude', claudeSessionId: null, pty: {} }, {})
    assert.strictEqual(r.ok, false)
    assert.ok(/turno|sesión/i.test(r.reason))
  })

  test('resolveVoiceTarget sin segundo argumento no revienta', () => {
    const r = resolveVoiceTarget(sesionViva)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.reuseSubchat, false)
  })

  test('opts null explícito tampoco revienta', () => {
    const r = resolveVoiceTarget(sesionViva, null)
    assert.strictEqual(r.ok, true)
  })
})
