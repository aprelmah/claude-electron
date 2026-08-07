'use strict'

// Doctor in-app: evalúa el snapshot de salud y avisa solo si hay problemas.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const {
  createHealthWatchdog,
  evaluateHealthProblems,
  formatHealthReport
} = require(path.join(REPO_ROOT, 'main', 'health-watchdog.js'))

const OK_SNAPSHOT = {
  pty: { state: 'stopped', detail: 'Sin sesión activa' },
  telegram: { state: 'ok' },
  whatsapp: { state: 'ok' },
  launchd: { state: 'ok' },
  scheduler: { state: 'ok' }
}

describe('evaluateHealthProblems', () => {
  test('todo ok (o stopped) → sin problemas', () => {
    assert.deepStrictEqual(evaluateHealthProblems(OK_SNAPSHOT), [])
  })

  test('solo los state=error cuentan, con su etiqueta y detalle', () => {
    const problems = evaluateHealthProblems({
      ...OK_SNAPSHOT,
      whatsapp: { state: 'error', detail: 'bridge caído' },
      launchd: { state: 'error', detail: 'plist no cargado' }
    })
    assert.strictEqual(problems.length, 2)
    assert.strictEqual(problems[0].label, 'Bridge de WhatsApp')
    assert.strictEqual(problems[0].detail, 'bridge caído')
  })

  test('snapshot nulo → problema de chequeo', () => {
    const problems = evaluateHealthProblems(null)
    assert.strictEqual(problems.length, 1)
    assert.strictEqual(problems[0].key, 'collect')
  })
})

describe('runOnce: gating por hora, día y toggle', () => {
  function makeWd(overrides = {}) {
    const sent = []
    const wd = createHealthWatchdog({
      collect: overrides.collect || (async () => OK_SNAPSHOT),
      notify: async (text) => { sent.push(text) },
      isEnabled: overrides.isEnabled || (() => true),
      hourLocal: 8,
      now: overrides.now || (() => new Date(2026, 7, 7, 9, 0, 0)),
      log: () => {}
    })
    return { wd, sent }
  }

  test('sin problemas: corre y NO avisa', async () => {
    const { wd, sent } = makeWd()
    const res = await wd.runOnce()
    assert.strictEqual(res.ran, true)
    assert.deepStrictEqual(res.problems, [])
    assert.strictEqual(sent.length, 0)
  })

  test('con problemas: avisa con el informe', async () => {
    const { wd, sent } = makeWd({
      collect: async () => ({ ...OK_SNAPSHOT, telegram: { state: 'error', detail: 'sin token' } })
    })
    await wd.runOnce()
    assert.strictEqual(sent.length, 1)
    assert.match(sent[0], /Doctor de POWER-AGENT/)
    assert.match(sent[0], /Bridge de Telegram: sin token/)
  })

  test('antes de la hora no corre; después sí; el mismo día no repite', async () => {
    let d = new Date(2026, 7, 7, 6, 0, 0)
    const { wd } = makeWd({ now: () => d })
    assert.strictEqual((await wd.runOnce()).ran, false)
    d = new Date(2026, 7, 7, 8, 30, 0)
    assert.strictEqual((await wd.runOnce()).ran, true)
    d = new Date(2026, 7, 7, 22, 0, 0)
    assert.strictEqual((await wd.runOnce()).reason, 'done')
    d = new Date(2026, 7, 8, 8, 30, 0)
    assert.strictEqual((await wd.runOnce()).ran, true, 'al día siguiente vuelve a correr')
  })

  test('deshabilitado no corre; force salta todos los gates', async () => {
    const { wd, sent } = makeWd({
      isEnabled: () => false,
      collect: async () => ({ ...OK_SNAPSHOT, pty: { state: 'error', detail: 'CLI no encontrado' } })
    })
    assert.strictEqual((await wd.runOnce()).ran, false)
    assert.strictEqual((await wd.runOnce({ force: true })).ran, true)
    assert.strictEqual(sent.length, 1)
  })

  test('collect que peta → avisa de que el chequeo falló', async () => {
    const { wd, sent } = makeWd({ collect: async () => { throw new Error('boom') } })
    await wd.runOnce()
    assert.strictEqual(sent.length, 1)
    assert.match(sent[0], /Chequeo de salud/)
  })

  test('start/stop no petan y start es idempotente', () => {
    const { wd } = makeWd()
    wd.start()
    wd.start()
    wd.stop()
    wd.stop()
  })
})

describe('formatHealthReport', () => {
  test('una línea por problema y tope de longitud', () => {
    const out = formatHealthReport([
      { label: 'A', detail: 'x'.repeat(5000) },
      { label: 'B', detail: 'y' }
    ])
    assert.ok(out.length <= 3900)
    assert.match(out, /^🩺/)
  })
})
