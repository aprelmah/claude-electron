'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceTurnWatcher } = require(path.join(REPO_ROOT, 'main', 'voice-turn-watcher.js'))

// Reloj de mentira: nada de temporizadores reales en los tests.
function makeClock() {
  let handlers = []
  return {
    setIntervalFn: (fn) => { const h = { fn }; handlers.push(h); return h },
    clearIntervalFn: (h) => { handlers = handlers.filter((x) => x !== h) },
    tick: (n = 1) => { for (let i = 0; i < n; i++) handlers.slice().forEach((h) => h.fn()) },
    count: () => handlers.length
  }
}

function makeHarness(opts = {}) {
  const clock = makeClock()
  let size = opts.initialSize ?? 0
  const extractResults = opts.extractResults ? [...opts.extractResults] : []
  const extractCalls = []
  const watcher = createVoiceTurnWatcher({
    findRelayTranscript: opts.findRelayTranscript || (() => ({ filePath: '/fake/t.jsonl', sessionId: 'sid', size, mtimeMs: 1 })),
    extractAssistantTextFromTranscript: (p, offset) => {
      extractCalls.push({ p, offset })
      return extractResults.shift() || { text: '', sawAssistant: false, sawEndTurn: false, lastStopReason: null, turnComplete: false }
    },
    statFn: () => ({ size }),
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    pollMs: 300,
    timeoutMs: opts.timeoutMs ?? 180000
  })
  return { watcher, clock, extractCalls, setSize: (n) => { size = n } }
}

describe('voice-turn-watcher', () => {
  test('exige sus dos dependencias', () => {
    assert.throws(() => createVoiceTurnWatcher({}), /findRelayTranscript requerido/)
    assert.throws(() => createVoiceTurnWatcher({ findRelayTranscript: () => null }), /extractAssistantTextFromTranscript requerido/)
  })

  test('avisa con el texto cuando el turno cierra', () => {
    const h = makeHarness({
      extractResults: [{ text: 'Ya está arreglado.', sawAssistant: true, sawEndTurn: true, lastStopReason: 'end_turn', turnComplete: true }]
    })
    let done = null
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: (r) => { done = r } })
    h.setSize(100)
    h.clock.tick()
    assert.ok(done)
    assert.strictEqual(done.text, 'Ya está arreglado.')
  })

  test('no avisa mientras el turno sigue vivo', () => {
    // Con tool_use por medio puede haber un end_turn suelto sin que el turno acabe.
    const h = makeHarness({
      extractResults: [{ text: 'voy a mirar', sawAssistant: true, sawEndTurn: true, lastStopReason: 'tool_use', turnComplete: false }]
    })
    let done = null
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: (r) => { done = r } })
    h.setSize(100)
    h.clock.tick()
    assert.strictEqual(done, null, 'turnComplete false no debe cerrar el turno')
  })

  test('no lee el fichero si no ha crecido', () => {
    const h = makeHarness({ initialSize: 50 })
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 50, onDone: () => {} })
    h.clock.tick(3)
    assert.strictEqual(h.extractCalls.length, 0, 'sin crecimiento no se parsea: un transcript de 14MB no se relee 3 veces por segundo')
  })

  test('lee desde el offset dado', () => {
    const h = makeHarness({
      extractResults: [{ text: 'hola', sawAssistant: true, sawEndTurn: true, lastStopReason: 'end_turn', turnComplete: true }]
    })
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 4096, onDone: () => {} })
    h.setSize(9000)
    h.clock.tick()
    assert.strictEqual(h.extractCalls[0].offset, 4096)
  })

  test('para el temporizador al cerrar el turno', () => {
    const h = makeHarness({
      extractResults: [{ text: 'listo', sawAssistant: true, sawEndTurn: true, lastStopReason: 'end_turn', turnComplete: true }]
    })
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: () => {} })
    h.setSize(10)
    h.clock.tick()
    assert.strictEqual(h.clock.count(), 0, 'no debe quedar ningún interval vivo')
  })

  test('cancel para el vigía y no llama a onDone', () => {
    const h = makeHarness({
      extractResults: [{ text: 'x', sawAssistant: true, sawEndTurn: true, lastStopReason: 'end_turn', turnComplete: true }]
    })
    let done = null
    const handle = h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: (r) => { done = r } })
    handle.cancel()
    h.setSize(100)
    h.clock.tick()
    assert.strictEqual(done, null)
    assert.strictEqual(h.clock.count(), 0)
  })

  test('avisa por timeout y deja de vigilar', () => {
    const h = makeHarness({ timeoutMs: 900 })
    let timedOut = false
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: () => {}, onTimeout: () => { timedOut = true } })
    h.clock.tick(4)   // 4 × 300 ms > 900 ms
    assert.strictEqual(timedOut, true)
    assert.strictEqual(h.clock.count(), 0)
  })

  test('sin transcript localizable avisa por timeout, no revienta', () => {
    const h = makeHarness({ findRelayTranscript: () => null, timeoutMs: 600 })
    let timedOut = false
    assert.doesNotThrow(() => {
      h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: () => {}, onTimeout: () => { timedOut = true } })
      h.clock.tick(3)
    })
    assert.strictEqual(timedOut, true)
  })

  test('un stat que lanza no tumba el vigía', () => {
    const watcher = createVoiceTurnWatcher({
      findRelayTranscript: () => ({ filePath: '/x', sessionId: 's', size: 0, mtimeMs: 0 }),
      extractAssistantTextFromTranscript: () => ({ turnComplete: false }),
      statFn: () => { throw new Error('ENOENT') },
      setIntervalFn: (fn) => ({ fn }),
      clearIntervalFn: () => {},
      pollMs: 300
    })
    const handle = watcher.watch({ sessionId: 's', cwds: [], baseOffset: 0, onDone: () => {} })
    assert.ok(handle && typeof handle.cancel === 'function')
  })
})
