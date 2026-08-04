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

// Ronda de correcciones 2 (re-revisor): "dale" es de las palabras más
// polisémicas del español coloquial (despedida, ánimo, "adelante tú",
// "dale que dale", "dale un vistazo", "dale recuerdos"...) y el anclaje al
// inicio de la ronda 1 no lo arregla — mitiga los "dale" de fondo, pero los
// que abren frase son justo los más frecuentes en habla real. Se saca de
// los disparadores y se mueve a cortesías: sigue sirviendo delante de un
// disparador real, pero deja de ordenar por sí sola.
describe('voice-router: ronda de correcciones 2 — dale es cortesía, no orden', () => {
  test('las cinco frases de la tabla del re-revisor son charla', () => {
    for (const frase of [
      'vale, dale que va, luego seguimos con el commit',
      'venga, dale caña que se hace tarde',
      'oye, dale recuerdos a tu hermano de mi parte',
      'pues dale, tú mismo, yo paso del tema',
      'dale un vistazo cuando puedas, no hay prisa'
    ]) {
      assert.strictEqual(routeVoiceText(frase).mode, 'charla', `"${frase}" debería ser charla`)
    }
  })

  test('"dale" delante de un disparador real sigue siendo encargo (no se pierde el uso útil)', () => {
    assert.strictEqual(routeVoiceText('dale, arregla el login').mode, 'encargo')
    assert.strictEqual(routeVoiceText('dale, commitea esto').mode, 'encargo')
  })

  // Hallazgo propio de esta ronda (pedido explícitamente: revisar si hay
  // otro disparador con el mismo problema): "adelante" es prácticamente
  // sinónimo de "dale" en su uso como interjección de permiso/ánimo — el
  // propio re-revisor lo cita como uno de los significados de "dale" ("dale
  // = adelante tú"). Mismo criterio, mismo arreglo.
  test('"adelante" como interjección de conversación normal también es charla', () => {
    for (const frase of [
      'adelante, te escucho, dime qué tal',
      'adelante con lo que decías, que yo termino esto',
      'adelante, pasa, que la puerta está abierta'
    ]) {
      assert.strictEqual(routeVoiceText(frase).mode, 'charla', `"${frase}" debería ser charla`)
    }
  })

  test('"adelante" delante de un disparador real sigue siendo encargo', () => {
    assert.strictEqual(routeVoiceText('adelante, arregla el login').mode, 'encargo')
  })

  test('"más adelante"/"de aquí en adelante" (no abre la frase) sigue siendo charla, sin cambios', () => {
    assert.strictEqual(routeVoiceText('más adelante seguimos hablando de esto').mode, 'charla')
    assert.strictEqual(routeVoiceText('de aquí en adelante vamos a hacerlo distinto').mode, 'charla')
  })
})

// Ronda de correcciones 3 (re-revisor): un Critical de clase distinta —
// retractación a mitad de frase — y varios Minor de cortesías apiladas y
// vocativos que faltaban. Un test por caso, tal como se pidió, para que el
// informe de fallos sea preciso si algo se rompe.
describe('voice-router: ronda de correcciones 3 — retractación y cortesías encadenadas', () => {
  test('CRITICAL: retractarse justo después del disparador ("no, mejor espera...") es charla', () => {
    assert.strictEqual(routeVoiceText('commitea, no, mejor espera que aun faltan los tests').mode, 'charla')
  })

  test('MINOR: "adelante pues, hazlo cuando puedas" — dos cortesías encadenadas, es encargo', () => {
    assert.strictEqual(routeVoiceText('adelante pues, hazlo cuando puedas').mode, 'encargo')
  })

  test('MINOR: "vale, adelante, aplica el cambio" — tres cortesías encadenadas, es encargo', () => {
    assert.strictEqual(routeVoiceText('vale, adelante, aplica el cambio').mode, 'encargo')
  })

  test('MINOR: "eh, borra ese archivo que ya no sirve" — vocativo nuevo, es encargo', () => {
    assert.strictEqual(routeVoiceText('eh, borra ese archivo que ya no sirve').mode, 'encargo')
  })

  test('MINOR: "tio dale, aplica el cambio de una vez" — vocativo + dale encadenados, es encargo', () => {
    assert.strictEqual(routeVoiceText('tio dale, aplica el cambio de una vez').mode, 'encargo')
  })

  test('MINOR: "oye majo, arregla esto que llevamos media hora con el mismo bug" — vocativo nuevo, es encargo', () => {
    assert.strictEqual(
      routeVoiceText('oye majo, arregla esto que llevamos media hora con el mismo bug').mode,
      'encargo'
    )
  })

  test('MINOR: "hazlo, ¿vale?" — la coletilla de confirmación final no tumba el encargo', () => {
    assert.strictEqual(routeVoiceText('hazlo, ¿vale?').mode, 'encargo')
  })

  test('retractación: "espera" solo, sin "no", también retira la orden', () => {
    assert.strictEqual(routeVoiceText('arréglalo, espera, mejor no').mode, 'charla')
  })

  test('retractación: cubre "aún no"/"todavía no" sin necesidad de listarlas aparte (lo hace "no")', () => {
    assert.strictEqual(routeVoiceText('aplícalo, aún no, espera').mode, 'charla')
    assert.strictEqual(routeVoiceText('cámbialo, todavía no').mode, 'charla')
  })

  test('control negativo: una negación lejos del disparador NO retracta (evita sobre-disparar)', () => {
    // "no" aquí es la 4ª palabra tras el disparador, fuera de la ventana de
    // 2-3 palabras — sigue siendo una orden real con una subordinada.
    assert.strictEqual(routeVoiceText('aplica el cambio que no te gusta').mode, 'encargo')
  })

  // Bug encontrado y arreglado en esta misma ronda, al ampliar la lista de
  // cortesías: pelar un vocativo puede destapar un "¿" que estaba justo
  // detrás ("eh, ¿aplícalo ya?" → tras pelar "eh, " queda "¿aplícalo ya?").
  // Si lo que queda es una pregunta, sigue siendo charla — pelar cortesías
  // nunca debe convertir una pregunta con vocativo delante en una orden.
  test('una cortesía nueva delante de un "¿" oculto no convierte la pregunta en orden', () => {
    for (const frase of [
      'eh, ¿aplícalo ya?',
      'oye, ¿lo aplico ya?',
      'tio, ¿lo hago o no?',
      'va, ¿lo hacemos?',
      'anda, ¿arreglamos esto ya?',
      'vale, ¿aplícalo?',
      'dale, ¿arreglamos esto?'
    ]) {
      assert.strictEqual(routeVoiceText(frase).mode, 'charla', `"${frase}" debería ser charla`)
    }
  })

  test('regresión: las 5 frases de "dale" de la ronda 2 siguen en charla', () => {
    for (const frase of [
      'vale, dale que va, luego seguimos con el commit',
      'venga, dale caña que se hace tarde',
      'oye, dale recuerdos a tu hermano de mi parte',
      'pues dale, tú mismo, yo paso del tema',
      'dale un vistazo cuando puedas, no hay prisa'
    ]) {
      assert.strictEqual(routeVoiceText(frase).mode, 'charla', `"${frase}" debería seguir siendo charla`)
    }
  })

  test('regresión: los 6 falsos positivos de dominio de la ronda 2 siguen en encargo (no son de esta clase)', () => {
    for (const frase of [
      'commit y ya está, no le des más vueltas al tema',
      'aplica tú el descuento que yo ahora no puedo',
      'arregla tú el lío que has montado, que yo paso',
      'escribe cuando llegues a casa, que estoy liado',
      'ejecuta bien tu papel en la obra que hemos preparado',
      'borra ya ese mensaje que me diste vergüenza'
    ]) {
      assert.strictEqual(routeVoiceText(frase).mode, 'encargo', `"${frase}" debería seguir siendo encargo`)
    }
  })
})
