'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceHelperProcess } = require(path.join(REPO_ROOT, 'main', 'voice-helper-process.js'))

function makeFakeProc() {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.killed = false
  proc.written = []
  proc.stdin = { write: (d) => { proc.written.push(d); return true }, end: () => {} }
  proc.kill = () => { proc.killed = true; proc.emit('close', 0) }
  return proc
}

function makeHarness(opts = {}) {
  const spawned = []
  const events = []
  const logs = []
  let current = null
  const helper = createVoiceHelperProcess({
    helperPath: '/fake/voice-helper',
    spawnFn: (bin, args, o) => { spawned.push({ bin, args, o }); current = makeFakeProc(); return current },
    onEvent: (e) => events.push(e),
    log: (m) => logs.push(m),
    maxRestarts: opts.maxRestarts
  })
  return { helper, spawned, events, logs, proc: () => current }
}

describe('voice-helper-process: arranque y parseo', () => {
  test('exige helperPath y spawnFn', () => {
    assert.throws(() => createVoiceHelperProcess({}), /helperPath requerido/)
    assert.throws(() => createVoiceHelperProcess({ helperPath: '/x' }), /spawnFn requerido/)
  })

  test('arranca el binario y queda vivo', () => {
    const h = makeHarness()
    h.helper.start()
    assert.strictEqual(h.spawned.length, 1)
    assert.strictEqual(h.spawned[0].bin, '/fake/voice-helper')
    assert.strictEqual(h.helper.isRunning(), true)
  })

  test('parsea una línea JSON completa', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"hello","pid":1}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'hello', pid: 1 }])
  })

  test('reensambla un evento partido entre dos chunks', () => {
    // El bug clásico de leer stdout: un JSON puede llegar cortado por la mitad.
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"par'))
    h.proc().stdout.emit('data', Buffer.from('tial","text":"hola"}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'partial', text: 'hola' }])
  })

  test('varios eventos en un solo chunk salen en orden', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"a"}\n{"type":"b"}\n'))
    assert.deepStrictEqual(h.events.map((e) => e.type), ['a', 'b'])
  })

  test('una línea no-JSON se ignora sin tumbar el parser', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('basura no json\n{"type":"ok"}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'ok' }])
  })

  test('send escribe una línea JSON', () => {
    const h = makeHarness()
    h.helper.start()
    assert.strictEqual(h.helper.send({ cmd: 'start' }), true)
    assert.deepStrictEqual(h.proc().written, ['{"cmd":"start"}\n'])
  })

  test('send devuelve false si no está vivo', () => {
    const h = makeHarness()
    assert.strictEqual(h.helper.send({ cmd: 'start' }), false)
  })
})

describe('voice-helper-process: caídas', () => {
  test('reinicia si el helper muere solo', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().emit('close', 1)
    assert.strictEqual(h.spawned.length, 2, 'debe respawnear')
  })

  test('no reinicia tras un stop pedido', () => {
    const h = makeHarness()
    h.helper.start()
    h.helper.stop()
    assert.strictEqual(h.spawned.length, 1)
    assert.strictEqual(h.helper.isRunning(), false)
  })

  test('deja de reintentar tras maxRestarts y avisa una sola vez', () => {
    const h = makeHarness({ maxRestarts: 2 })
    h.helper.start()
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    assert.strictEqual(h.spawned.length, 3, 'arranque + 2 reintentos')
    assert.strictEqual(h.helper.isBroken(), true)
    const avisos = h.logs.filter((m) => /no se pudo mantener|se rinde/i.test(m))
    assert.strictEqual(avisos.length, 1, 'el aviso se emite una vez, no en cada caída')
  })

  test('reset vuelve a permitir arrancar', () => {
    const h = makeHarness({ maxRestarts: 1 })
    h.helper.start()
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    assert.strictEqual(h.helper.isBroken(), true)
    h.helper.reset()
    assert.strictEqual(h.helper.isBroken(), false)
    h.helper.start()
    assert.ok(h.spawned.length >= 3)
  })

  test('un spawn que lanza se degrada sin propagar', () => {
    const events = []
    const helper = createVoiceHelperProcess({
      helperPath: '/fake/voice-helper',
      spawnFn: () => { throw new Error('ENOENT') },
      onEvent: (e) => events.push(e)
    })
    assert.doesNotThrow(() => helper.start())
    assert.strictEqual(helper.isRunning(), false)
    assert.ok(events.some((e) => e.type === 'error' && e.fatal === true))
  })
})
