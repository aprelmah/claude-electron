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

  test('texto larguísimo con el disparador enterrado al final ya NO es encargo (debe abrir la frase)', () => {
    // Antes de la ronda de correcciones 1 esto contaba como encargo por
    // buscar el disparador en cualquier parte. Ahora el disparador tiene que
    // abrir la frase: uno enterrado 300 repeticiones más allá es charla.
    const textoLargo = 'bueno pues nada, '.repeat(300) + 'aplícalo'
    assert.strictEqual(routeVoiceText(textoLargo).mode, 'charla')
  })

  test('texto larguísimo que SÍ abre con el disparador sigue siendo encargo', () => {
    const textoLargo = 'aplícalo, ' + 'y de paso revisa que todo compile bien por favor '.repeat(300)
    const antes = Date.now()
    const r = routeVoiceText(textoLargo)
    assert.strictEqual(r.mode, 'encargo')
    assert.ok(Date.now() - antes < 500, 'no debería tardar nada con regex simples, sin backtracking catastrófico')
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

  // Proactivo, no pedido por el revisor: mismo patrón de bug que el de
  // forcedMode en routeVoiceText (el default `{ x } = {}` no cubre null
  // explícito). Se arregla gratis con el mismo cambio y evita que reaparezca
  // aquí en la próxima ronda.
  test('opts null explícito no revienta (mismo bug que forcedMode, corregido en los dos sitios)', () => {
    const sesionViva = { activeCli: 'claude', claudeSessionId: 'sid-3', pty: {} }
    assert.doesNotThrow(() => resolveVoiceTarget(sesionViva, null))
    const r = resolveVoiceTarget(sesionViva, null)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.reuseSubchat, false)
  })
})

// Ronda de correcciones 1 (revisor): el disparador contaba por sola
// presencia de la palabra en cualquier parte de la frase, y "que"/"como"/
// "porque" sin tilde en cualquier parte hacían pasar órdenes reales por
// preguntas. Estos tests reproducen cada hallazgo verbatim del informe de
// revisión (deben fallar con el código de antes de esta ronda y pasar con
// el de después).
describe('voice-router: ronda de correcciones 1 — el disparador tiene que abrir la frase', () => {
  test('CRITICAL: "commit" mencionado de fondo no es una orden de commitear', () => {
    assert.strictEqual(routeVoiceText('el último commit rompió el build').mode, 'charla')
  })

  test('CRITICAL: "cambia" usado como vocabulario normal no es una orden de cambiar algo', () => {
    assert.strictEqual(routeVoiceText('el código cambia mucho de una versión a otra').mode, 'charla')
    assert.strictEqual(routeVoiceText('el dólar cambia cada día').mode, 'charla')
  })

  test('CRITICAL: "adelante" dentro de "más adelante" no es una orden de seguir', () => {
    assert.strictEqual(routeVoiceText('más adelante seguimos hablando de esto').mode, 'charla')
  })

  test('CRITICAL: "escribe" hablando de ortografía no es una orden de escribir código', () => {
    assert.strictEqual(routeVoiceText('así se escribe en español correcto').mode, 'charla')
  })

  test('IMPORTANT: una subordinada con "que"/"como"/"porque" ya no convierte la orden en pregunta', () => {
    for (const frase of ['aplica el cambio que te dije', 'hazlo que hace falta ya', 'commitea que ya está listo']) {
      assert.strictEqual(routeVoiceText(frase).mode, 'encargo', `"${frase}" debería seguir siendo encargo`)
    }
  })

  test('IMPORTANT: forcedMode con null explícito (no undefined) no revienta', () => {
    assert.doesNotThrow(() => routeVoiceText('hazlo', null))
    // null no es un forcedMode válido → se ignora, cae a la detección normal.
    assert.strictEqual(routeVoiceText('hazlo', null).mode, 'encargo')
  })

  test('los casos positivos siguen funcionando tras el arreglo', () => {
    for (const frase of ['hazlo', 'commitea esto', 'venga, arréglalo', 'por favor aplica el cambio que te dije']) {
      assert.strictEqual(routeVoiceText(frase).mode, 'encargo', `"${frase}" debería seguir siendo encargo`)
    }
  })
})
