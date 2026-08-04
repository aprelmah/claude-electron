'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { classNameForVoiceState, voiceCliAvailability, voiceStateAppearance, planForVoiceEvent } = require(path.join(REPO_ROOT, 'voice-ui-state.js'))

describe('classNameForVoiceState', () => {
  test('listening/thinking/speaking devuelven su clase CSS', () => {
    assert.strictEqual(classNameForVoiceState('listening'), 'voice-listening')
    assert.strictEqual(classNameForVoiceState('thinking'), 'voice-thinking')
    assert.strictEqual(classNameForVoiceState('speaking'), 'voice-speaking')
  })

  test('idle no añade ninguna clase (botón en reposo)', () => {
    assert.strictEqual(classNameForVoiceState('idle'), null)
  })

  test('un estado desconocido no revienta, no añade clase', () => {
    assert.strictEqual(classNameForVoiceState('lo-que-sea'), null)
    assert.strictEqual(classNameForVoiceState(undefined), null)
  })
})

describe('voiceCliAvailability', () => {
  test('claude: disponible, con título y aria-label de activar', () => {
    const info = voiceCliAvailability('claude')
    assert.strictEqual(info.available, true)
    assert.match(info.title, /hablar con el agente/)
    assert.match(info.ariaLabel, /Activar/)
  })

  test('codex: NO disponible, título explica el motivo y nombra a CODEX', () => {
    const info = voiceCliAvailability('codex')
    assert.strictEqual(info.available, false)
    assert.match(info.title, /solo disponible con Claude/)
    assert.match(info.title, /CODEX/)
    assert.match(info.ariaLabel, /no disponible/)
  })

  test('un cli no soportado que no es codex no le echa la culpa a Codex (ronda 1: no hardcodear un único "otro")', () => {
    const info = voiceCliAvailability('gemini')
    assert.strictEqual(info.available, false)
    assert.match(info.title, /GEMINI/)
    assert.doesNotMatch(info.title, /[Cc]odex/)
    assert.match(info.ariaLabel, /GEMINI/)
    assert.doesNotMatch(info.ariaLabel, /[Cc]odex/)
  })

  test('cualquier otro valor (undefined, string rara) se trata como no disponible', () => {
    assert.strictEqual(voiceCliAvailability(undefined).available, false)
    assert.strictEqual(voiceCliAvailability('').available, false)
    assert.strictEqual(voiceCliAvailability('lo-que-sea').available, false)
  })

  test('cli vacío/undefined: motivo genérico, no "undefined" ni "null"', () => {
    assert.match(voiceCliAvailability(undefined).title, /este asistente/)
    assert.match(voiceCliAvailability('').title, /este asistente/)
    assert.doesNotMatch(voiceCliAvailability(undefined).title, /undefined/)
  })
})

describe('planForVoiceEvent', () => {
  test('evento nulo o sin type: no hace nada', () => {
    assert.deepStrictEqual(planForVoiceEvent(null), { action: 'none' })
    assert.deepStrictEqual(planForVoiceEvent(undefined), { action: 'none' })
    assert.deepStrictEqual(planForVoiceEvent({}), { action: 'none' })
    assert.deepStrictEqual(planForVoiceEvent('texto'), { action: 'none' })
  })

  test('state con un valor válido: set-state', () => {
    assert.deepStrictEqual(planForVoiceEvent({ type: 'state', state: 'thinking' }), { action: 'set-state', state: 'thinking' })
    assert.deepStrictEqual(planForVoiceEvent({ type: 'state', state: 'idle' }), { action: 'set-state', state: 'idle' })
  })

  test('state con un valor inválido: no hace nada (no se pinta un estado que no existe)', () => {
    assert.deepStrictEqual(planForVoiceEvent({ type: 'state', state: 'volando' }), { action: 'none' })
  })

  test('partial: hud sin auto-ocultar (holdMs 0), se pisa en cada evento', () => {
    const plan = planForVoiceEvent({ type: 'partial', text: 'estoy dicien' })
    assert.strictEqual(plan.action, 'hud')
    assert.strictEqual(plan.text, 'estoy dicien')
    assert.strictEqual(plan.holdMs, 0)
  })

  test('heard con mode encargo: icono de rayo', () => {
    const plan = planForVoiceEvent({ type: 'heard', text: 'para el servidor', mode: 'encargo', reason: 'verbo de ejecución' })
    assert.strictEqual(plan.action, 'hud')
    assert.strictEqual(plan.text, '⚡ para el servidor')
    assert.strictEqual(plan.holdMs, 2600)
  })

  test('heard con mode charla: icono de bocadillo', () => {
    const plan = planForVoiceEvent({ type: 'heard', text: 'qué tal el tiempo', mode: 'charla', reason: 'sin verbo de ejecución' })
    assert.strictEqual(plan.text, '💬 qué tal el tiempo')
  })

  test('heard con mode desconocido: cae a bocadillo por defecto, no revienta', () => {
    const plan = planForVoiceEvent({ type: 'heard', text: 'algo', mode: 'raro' })
    assert.strictEqual(plan.text, '💬 algo')
  })

  test('saying: prefijo de altavoz y recorte a 90 caracteres', () => {
    const largo = 'x'.repeat(200)
    const plan = planForVoiceEvent({ type: 'saying', text: largo })
    assert.strictEqual(plan.action, 'hud')
    assert.strictEqual(plan.text, `🔊 ${'x'.repeat(90)}`)
    assert.strictEqual(plan.text.length, 93)
  })

  test('nothing-to-say: hud fijo, sin depender del payload', () => {
    const plan = planForVoiceEvent({ type: 'nothing-to-say' })
    assert.strictEqual(plan.action, 'hud')
    assert.strictEqual(plan.text, '(sin nada que leer en voz)')
  })

  test('warn: status de nivel warn, sin recheckState', () => {
    const plan = planForVoiceEvent({ type: 'warn', message: 'sin cancelación de eco' })
    assert.deepStrictEqual(plan, { action: 'status', level: 'warn', message: 'sin cancelación de eco' })
  })

  test('error: status de nivel error CON recheckState — no se puede saber si fue fatal', () => {
    const plan = planForVoiceEvent({ type: 'error', message: 'el turno tardó demasiado' })
    assert.deepStrictEqual(plan, { action: 'status', level: 'error', message: 'el turno tardó demasiado', recheckState: true })
  })

  test('error sin message: mensaje por defecto, no "undefined"', () => {
    const plan = planForVoiceEvent({ type: 'error' })
    assert.strictEqual(plan.message, 'error del modo voz')
  })

  test('un type desconocido no hace nada', () => {
    assert.deepStrictEqual(planForVoiceEvent({ type: 'voices' }), { action: 'none' })
    assert.deepStrictEqual(planForVoiceEvent({ type: 'ready' }), { action: 'none' })
  })
})

// Ronda 1 de revisión: el contrato de la Tarea 7 pide enseñar `broken`
// distinto de "apagado" (helper rendido tras 3 intentos). voiceStateAppearance
// traduce la respuesta cruda de voice:state() ({enabled,state,broken,mine}).
describe('voiceStateAppearance', () => {
  test('encendida y mía: on=true, clase del estado, sin título/aria-label propios', () => {
    const appearance = voiceStateAppearance({ enabled: true, state: 'listening', broken: false, mine: true })
    assert.deepStrictEqual(appearance, { on: true, cssClass: 'voice-listening', title: null, ariaLabel: null })
  })

  test('encendida en OTRA ventana (mine:false): on=false, sin clase — no se pinta un estado ajeno', () => {
    const appearance = voiceStateAppearance({ enabled: true, state: 'speaking', broken: false, mine: false })
    assert.strictEqual(appearance.on, false)
    assert.strictEqual(appearance.cssClass, null)
  })

  test('apagada sin más: on=false, sin clase (reposo, no "broken")', () => {
    const appearance = voiceStateAppearance({ enabled: false, state: 'idle', broken: false, mine: false })
    assert.deepStrictEqual(appearance, { on: false, cssClass: null, title: null, ariaLabel: null })
  })

  test('broken=true: clase voice-broken, título explica y dice que pulsar reintenta', () => {
    const appearance = voiceStateAppearance({ enabled: false, state: 'idle', broken: true, mine: false })
    assert.strictEqual(appearance.cssClass, 'voice-broken')
    assert.match(appearance.title, /reintenta/)
    assert.match(appearance.ariaLabel, /fallo/)
  })

  test('broken gana a la clase de estado aunque (en teoría) coexistieran on=true y broken=true', () => {
    const appearance = voiceStateAppearance({ enabled: true, state: 'listening', broken: true, mine: true })
    assert.strictEqual(appearance.cssClass, 'voice-broken')
    assert.strictEqual(appearance.on, true)
  })

  test('null/undefined: no revienta, todo apagado y sin marcar como roto', () => {
    assert.deepStrictEqual(voiceStateAppearance(null), { on: false, cssClass: null, title: null, ariaLabel: null })
    assert.deepStrictEqual(voiceStateAppearance(undefined), { on: false, cssClass: null, title: null, ariaLabel: null })
  })
})
