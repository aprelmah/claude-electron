'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceSession } = require(path.join(REPO_ROOT, 'main', 'voice-session.js'))

// Harness mínimo con reloj falso: el endpointer real decide, así que esto prueba
// el camino completo nivel → decisión → orden al helper.
function makeHarness(opts = {}) {
  const helperCmds = []
  const clock = { t: 10000 }
  let onDoneCb = null

  const session = createVoiceSession({
    helper: {
      start: () => {},
      send: (c) => { helperCmds.push(c); return true },
      stop: () => {},
      isRunning: () => true
    },
    speakable: (md) => md,
    watcher: { watch: ({ onDone }) => { onDoneCb = onDone; return { cancel: () => {} } } },
    router: {
      routeVoiceText: () => ({ mode: 'encargo', reason: 'test' }),
      resolveVoiceTarget: () => ({ ok: true, target: 'madre' })
    },
    sendToTarget: async () => ({ ok: true, sessionId: 'sid', cwds: ['/p'], baseOffset: 0 }),
    getSession: () => ({ activeCli: 'claude', claudeSessionId: 'sid', pty: {}, wcId: 1 }),
    getVoiceId: () => '',
    getSilenceMs: () => opts.silenceMs || 1800,
    notifyRenderer: () => {},
    log: () => {},
    nowFn: () => clock.t,
    setTimeoutFn: () => ({}),
    clearTimeoutFn: () => {}
  })

  function levels(level, count, stepMs = 100) {
    for (let i = 0; i < count; i++) {
      clock.t += stepMs
      session.handleHelperEvent({ type: 'audio-level', level })
    }
  }

  return {
    session,
    helperCmds,
    clock,
    levels,
    fireDone: (r) => onDoneCb && onDoneCb(r),
    count: (cmd) => helperCmds.filter((c) => c.cmd === cmd).length
  }
}

test('el nivel de audio cierra el turno cuando el usuario deja de hablar', () => {
  const h = makeHarness()
  h.session.enable()

  h.levels(0.005, 5)
  h.levels(0.15, 20)
  assert.equal(h.count('endturn'), 0, 'no puede cerrar mientras habla')

  h.levels(0.005, 25)
  assert.equal(h.count('endturn'), 1)
})

// El caso de Luismi: voces de fondo por encima del viejo umbral absoluto.
test('el ruido de fondo ya no mantiene el micro abierto', () => {
  const h = makeHarness()
  h.session.enable()

  h.levels(0.02, 5)
  h.levels(0.17, 20)
  h.levels(0.025, 25)

  assert.equal(h.count('endturn'), 1)
})

test('no manda más de un cierre por turno', () => {
  const h = makeHarness()
  h.session.enable()

  h.levels(0.005, 5)
  h.levels(0.15, 20)
  h.levels(0.005, 80)

  assert.equal(h.count('endturn'), 1)
})

test('los niveles que llegan mientras piensa no cierran nada', async () => {
  const h = makeHarness()
  h.session.enable()

  h.levels(0.005, 5)
  h.levels(0.15, 20)
  await h.session.handleHelperEvent({ type: 'final', text: 'haz esto' })

  const antes = h.count('endturn')
  h.levels(0.005, 40)
  assert.equal(h.count('endturn'), antes, 'cerró un turno que ya estaba en marcha')
})

test('cada turno nuevo arranca con el endpointer limpio', async () => {
  const h = makeHarness()
  h.session.enable()

  h.levels(0.005, 5)
  h.levels(0.15, 20)
  h.levels(0.005, 25)
  assert.equal(h.count('endturn'), 1)

  await h.session.handleHelperEvent({ type: 'final', text: 'primero' })
  h.fireDone({ text: '' })            // sin nada que decir → vuelve a escuchar

  h.levels(0.005, 5)
  h.levels(0.15, 20)
  h.levels(0.005, 25)
  assert.equal(h.count('endturn'), 2, 'el segundo turno no llegó a cerrarse')
})

test('el texto del reconocedor entra en la decisión', () => {
  const h = makeHarness({ silenceMs: 6000 })
  h.session.enable()

  h.levels(0.01, 5)
  h.levels(0.20, 20)
  h.session.handleHelperEvent({ type: 'partial', text: 'revisa el modo voz' })

  // Ruido sostenido que se cuela por encima del umbral: el reloj del silencio no
  // vence nunca y solo el texto congelado puede cerrar esto. Tarda más que la
  // pausa de silencio a propósito — es un respaldo, no el criterio principal.
  h.levels(0.055, 95)

  assert.equal(h.count('endturn'), 1)
})

test('un audio-level sin modo voz encendido no hace nada', () => {
  const h = makeHarness()

  h.levels(0.15, 20)
  h.levels(0.005, 30)

  assert.equal(h.count('endturn'), 0)
})
