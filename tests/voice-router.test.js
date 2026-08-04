'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { routeVoiceText, resolveVoiceTarget } = require(path.join(REPO_ROOT, 'main', 'voice-router.js'))

describe('voice-router: intención', () => {
  test('por defecto, charla', () => {
    assert.strictEqual(routeVoiceText('¿por qué falla el relay de Telegram?').mode, 'charla')
    assert.strictEqual(routeVoiceText('explícame cómo va el aislamiento por worktree').mode, 'charla')
  })

  test('los imperativos de ejecución son encargo', () => {
    for (const frase of [
      'hazlo',
      'aplícalo',
      'arréglalo',
      'cámbialo',
      'ejecuta los tests',
      'commitea eso',
      'hazlo ya por favor',
      'venga, aplica el cambio'
    ]) {
      assert.strictEqual(routeVoiceText(frase).mode, 'encargo', `"${frase}" debería ser encargo`)
    }
  })

  test('no confunde una pregunta sobre hacer algo con la orden de hacerlo', () => {
    assert.strictEqual(routeVoiceText('¿cómo lo harías?').mode, 'charla')
    assert.strictEqual(routeVoiceText('¿qué pasa si lo aplico?').mode, 'charla')
    assert.strictEqual(routeVoiceText('¿deberíamos arreglarlo?').mode, 'charla')
  })

  test('funciona sin acentos: el dictado no siempre los pone', () => {
    assert.strictEqual(routeVoiceText('arreglalo').mode, 'encargo')
    assert.strictEqual(routeVoiceText('aplicalo').mode, 'encargo')
  })

  test('el modo forzado manda sobre la detección', () => {
    assert.strictEqual(routeVoiceText('hazlo', { forcedMode: 'charla' }).mode, 'charla')
    assert.strictEqual(routeVoiceText('¿qué opinas?', { forcedMode: 'encargo' }).mode, 'encargo')
    assert.strictEqual(routeVoiceText('hazlo', { forcedMode: 'charla' }).reason, 'forzado')
  })

  test('un modo forzado inválido se ignora', () => {
    assert.strictEqual(routeVoiceText('hazlo', { forcedMode: 'inventado' }).mode, 'encargo')
  })

  test('texto vacío o basura cae en charla sin reventar', () => {
    assert.strictEqual(routeVoiceText('').mode, 'charla')
    assert.strictEqual(routeVoiceText(null).mode, 'charla')
    assert.strictEqual(routeVoiceText(undefined).mode, 'charla')
    assert.strictEqual(routeVoiceText(42).mode, 'charla')
  })

  test('siempre devuelve un motivo legible', () => {
    assert.ok(routeVoiceText('hazlo').reason.length > 0)
    assert.ok(routeVoiceText('¿qué tal?').reason.length > 0)
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
})

// Casos límite adicionales pedidos en la revisión de calidad: mayúsculas,
// texto larguísimo, y puntuación pegada a la palabra disparadora. El criterio
// que más importa: ante ambigüedad, el lado seguro es SIEMPRE charla, porque
// mandar a la sesión de trabajo algo que era charla tiene efectos reales en
// el código.
describe('voice-router: casos límite adicionales', () => {
  test('detecta el imperativo en mayúsculas (dictado con caps lock o énfasis)', () => {
    assert.strictEqual(routeVoiceText('HAZLO').mode, 'encargo')
    assert.strictEqual(routeVoiceText('ARRÉGLALO YA').mode, 'encargo')
  })

  test('puntuación pegada a la palabra disparadora no rompe la detección', () => {
    assert.strictEqual(routeVoiceText('hazlo.').mode, 'encargo')
    assert.strictEqual(routeVoiceText('hazlo,').mode, 'encargo')
    assert.strictEqual(routeVoiceText('¡hazlo!').mode, 'encargo')
    assert.strictEqual(routeVoiceText('¿aplícalo?').mode, 'charla')
  })

  test('cadena de solo espacios cae en charla sin reventar', () => {
    assert.strictEqual(routeVoiceText('   ').mode, 'charla')
    assert.strictEqual(routeVoiceText('\n\t  \n').mode, 'charla')
  })

  test('texto larguísimo sin disparador es charla y no cuelga', () => {
    const textoLargo = 'me gustaría entender mejor cómo funciona el aislamiento por worktree y por qué se eligió así '.repeat(500)
    const antes = Date.now()
    const r = routeVoiceText(textoLargo)
    assert.strictEqual(r.mode, 'charla')
    assert.ok(Date.now() - antes < 500, 'no debería tardar nada con regex simples, sin backtracking catastrófico')
  })

  test('texto larguísimo con el disparador al final sí es encargo', () => {
    const textoLargo = 'bueno pues nada, '.repeat(300) + 'aplícalo'
    assert.strictEqual(routeVoiceText(textoLargo).mode, 'encargo')
  })

  test('ante ambigüedad real (pregunta + verbo de ejecución), gana la charla', () => {
    assert.strictEqual(routeVoiceText('¿lo aplico ya o esperamos?').mode, 'charla')
  })

  test('resolveVoiceTarget sin segundo argumento no revienta (subchatHas por defecto)', () => {
    const sesionViva = { activeCli: 'claude', claudeSessionId: 'sid-2', pty: {} }
    const r = resolveVoiceTarget(sesionViva)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.reuseSubchat, false)
  })

  test('sesión sin campo pty (undefined) se trata igual que sin PTY vivo', () => {
    const r = resolveVoiceTarget({ activeCli: 'claude', claudeSessionId: 'x' }, {})
    assert.strictEqual(r.ok, false)
  })
})
