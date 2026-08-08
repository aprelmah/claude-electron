'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { createVoiceEndpointer } = require('../main/voice-endpointer')

// Alimenta `count` tramos del mismo nivel y devuelve la primera decisión de
// cierre que aparezca (o null). Los tramos van cada `stepMs` como los que emite
// el helper.
function feed(ep, level, count, clock, stepMs = 100) {
  let decision = null
  for (let i = 0; i < count; i++) {
    clock.t += stepMs
    const d = ep.onLevel(level, clock.t)
    if (d && d.close && !decision) decision = { ...d, at: clock.t }
  }
  return decision
}

function newClock() { return { t: 1000 } }

test('no cierra si el usuario no ha llegado a hablar', () => {
  const ep = createVoiceEndpointer({ silenceMs: 1800 })
  const clock = newClock()
  ep.reset(clock.t)

  // 10 segundos de sala en silencio: nada que cerrar, no hubo turno.
  const decision = feed(ep, 0.004, 100, clock)

  assert.equal(decision, null)
})

test('cierra tras la pausa de silencio cuando la sala calla de verdad', () => {
  const ep = createVoiceEndpointer({ silenceMs: 1800 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.005, 5, clock)          // suelo de ruido
  feed(ep, 0.14, 20, clock)          // dos segundos hablando
  const hablóHasta = clock.t
  const decision = feed(ep, 0.005, 40, clock)

  assert.ok(decision, 'debía cerrar el turno')
  assert.equal(decision.reason, 'silence')
  assert.ok(decision.at - hablóHasta >= 1800, `cerró a los ${decision.at - hablóHasta} ms`)
  assert.ok(decision.at - hablóHasta < 2200, `tardó de más: ${decision.at - hablóHasta} ms`)
})

// El bug que reportó Luismi: con voces de fondo por encima del umbral absoluto
// de 0,012 el turno no cerraba NUNCA, porque cualquier sonido reiniciaba el
// reloj del silencio.
test('cierra aunque queden voces de fondo por encima del umbral absoluto', () => {
  const ep = createVoiceEndpointer({ silenceMs: 1800 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.02, 5, clock)           // televisión de fondo ya sonando
  feed(ep, 0.16, 20, clock)          // Luismi habla encima
  const hablóHasta = clock.t
  const decision = feed(ep, 0.025, 40, clock)   // se calla; la tele sigue

  assert.ok(decision, 'la tele de fondo no puede dejar el micro abierto para siempre')
  assert.equal(decision.reason, 'silence')
  assert.ok(decision.at - hablóHasta < 2200, `tardó de más: ${decision.at - hablóHasta} ms`)
})

test('una pausa para respirar no corta el turno', () => {
  const ep = createVoiceEndpointer({ silenceMs: 1800 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.005, 5, clock)
  feed(ep, 0.15, 15, clock)          // frase
  const enPausa = feed(ep, 0.006, 12, clock)   // 1,2 s pensando
  const siguiendo = feed(ep, 0.15, 15, clock)  // sigue hablando

  assert.equal(enPausa, null, 'cortó al respirar')
  assert.equal(siguiendo, null)
})

test('el ruido constante de la sala no arranca un turno por sí solo', () => {
  const ep = createVoiceEndpointer({ silenceMs: 1800 })
  const clock = newClock()
  ep.reset(clock.t)

  // Ventilador a 0,03: muy por encima del 0,012 absoluto de antes, pero es el
  // suelo de la sala, no una voz.
  const decision = feed(ep, 0.03, 60, clock)

  assert.equal(decision, null)
  assert.equal(ep.snapshot().hasSpeech, false)
})

// El respaldo por texto congelado existe para el ruido alto sostenido, donde el
// reloj del silencio no vence nunca. Si dispara ANTES que la pausa de silencio,
// corta al usuario mientras piensa a mitad de frase — que es justo lo que hacía
// con 1,2 s fijos contra una pausa de 1,8 s (Luismi, probándolo en vivo).
test('el respaldo por texto nunca corta antes que la pausa de silencio', () => {
  const ep = createVoiceEndpointer({ silenceMs: 4000 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.005, 5, clock)
  feed(ep, 0.15, 20, clock)
  ep.onText('estaba diciendo que', clock.t)
  const dejóDeHablar = clock.t

  // Se queda pensando en silencio: ni el nivel ni el texto se mueven.
  const decision = feed(ep, 0.005, 60, clock)

  assert.ok(decision)
  assert.ok(decision.at - dejóDeHablar >= 4000, `cortó a los ${decision.at - dejóDeHablar} ms de callarse`)
})

test('con la pausa por defecto el respaldo por texto tampoco se adelanta', () => {
  const ep = createVoiceEndpointer({})
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.005, 5, clock)
  feed(ep, 0.15, 20, clock)
  ep.onText('lo que quiero es', clock.t)
  const dejóDeHablar = clock.t

  const decision = feed(ep, 0.005, 60, clock)

  assert.ok(decision)
  assert.ok(decision.at - dejóDeHablar >= 1800)
})

test('el texto estancado cierra el turno aunque el ruido no baje', () => {
  const ep = createVoiceEndpointer({ silenceMs: 5000, staleTextMs: 1200 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.01, 5, clock)
  feed(ep, 0.20, 20, clock)
  ep.onText('quiero que revises el modo voz', clock.t)

  // Se calla, pero entra ruido alto sostenido (obra en la calle) que roza el
  // umbral: el reloj del silencio no llega a vencer y el texto no crece.
  const decision = feed(ep, 0.055, 30, clock)

  assert.ok(decision, 'con el texto congelado el turno tiene que cerrar')
  assert.equal(decision.reason, 'stale-text')
})

test('mientras el texto siga creciendo no cierra por texto estancado', () => {
  const ep = createVoiceEndpointer({ silenceMs: 5000, staleTextMs: 1200 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.01, 5, clock)
  feed(ep, 0.20, 10, clock)

  let decision = null
  for (let i = 0; i < 30; i++) {
    ep.onText(`palabra ${i}`, clock.t)
    const d = feed(ep, 0.055, 5, clock)
    if (d && !decision) decision = d
  }

  assert.equal(decision, null)
})

test('respeta la pausa de silencio configurada', () => {
  const ep = createVoiceEndpointer({ silenceMs: 900 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.005, 5, clock)
  feed(ep, 0.15, 10, clock)
  const hablóHasta = clock.t
  const decision = feed(ep, 0.004, 30, clock)

  assert.ok(decision)
  assert.ok(decision.at - hablóHasta >= 900)
  assert.ok(decision.at - hablóHasta < 1300)
})

test('solo decide una vez por turno', () => {
  const ep = createVoiceEndpointer({ silenceMs: 800 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.005, 5, clock)
  feed(ep, 0.15, 10, clock)

  let cierres = 0
  for (let i = 0; i < 40; i++) {
    clock.t += 100
    const d = ep.onLevel(0.004, clock.t)
    if (d && d.close) cierres += 1
  }

  assert.equal(cierres, 1)
})

test('reset devuelve el endpointer a un turno limpio', () => {
  const ep = createVoiceEndpointer({ silenceMs: 800 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.005, 5, clock)
  feed(ep, 0.15, 10, clock)
  assert.ok(feed(ep, 0.004, 20, clock))

  ep.reset(clock.t)
  assert.equal(ep.snapshot().hasSpeech, false)
  assert.equal(feed(ep, 0.004, 40, clock), null)
})

test('una voz lejana tras hablar tú no vale como voz tuya', () => {
  const ep = createVoiceEndpointer({ silenceMs: 1500 })
  const clock = newClock()
  ep.reset(clock.t)

  feed(ep, 0.006, 5, clock)
  feed(ep, 0.30, 20, clock)          // Luismi, boca cerca del micro
  const hablóHasta = clock.t
  // Alguien contesta desde el pasillo: audible, pero a un quinto de su nivel.
  const decision = feed(ep, 0.05, 40, clock)

  assert.ok(decision, 'la voz del pasillo mantuvo el micro abierto')
  assert.ok(decision.at - hablóHasta < 1900)
})

test('niveles imposibles no rompen el estado', () => {
  const ep = createVoiceEndpointer({ silenceMs: 800 })
  const clock = newClock()
  ep.reset(clock.t)

  for (const malo of [NaN, Infinity, -1, null, undefined, 'alto']) {
    clock.t += 100
    assert.equal(ep.onLevel(malo, clock.t), null)
  }
  assert.equal(ep.snapshot().hasSpeech, false)

  feed(ep, 0.005, 5, clock)
  feed(ep, 0.15, 10, clock)
  assert.ok(feed(ep, 0.004, 20, clock), 'sigue funcionando tras la basura')
})
