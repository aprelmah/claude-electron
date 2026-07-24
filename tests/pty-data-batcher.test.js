'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { createPtyDataBatcher } = require('../main/pty-data-batcher')

function makeSession() {
  const sends = []
  return {
    sends,
    session: {
      win: { isDestroyed: () => false, webContents: { send: (ch, p) => sends.push({ ch, p }) } }
    }
  }
}

describe('PERF-H6: pty-data batcher', () => {
  test('chunk pequeño no se envía hasta flush por timer', () => {
    const { session, sends } = makeSession()
    let armedDelay = null
    const fakeTimer = (fn, delay) => { armedDelay = delay; return { _fn: fn, unref: () => {} } }
    const b = createPtyDataBatcher({ flushMs: 16, flushBytes: 1024, setTimeoutFn: fakeTimer, clearTimeoutFn: () => {} })
    b.enqueue(session, 'hola')
    assert.equal(sends.length, 0, 'no debe enviar todavía')
    assert.equal(armedDelay, 16)
    b.flush(session)
    assert.equal(sends.length, 1)
    assert.equal(sends[0].p, 'hola')
  })

  test('múltiples chunks coalescen en un único send', () => {
    const { session, sends } = makeSession()
    const b = createPtyDataBatcher({ flushMs: 16, flushBytes: 1024 })
    b.enqueue(session, 'a')
    b.enqueue(session, 'b')
    b.enqueue(session, 'c')
    b.flush(session)
    assert.equal(sends.length, 1)
    assert.equal(sends[0].p, 'abc')
  })

  test('flush inmediato cuando supera flushBytes', () => {
    const { session, sends } = makeSession()
    const b = createPtyDataBatcher({ flushBytes: 10, flushMs: 1000 })
    b.enqueue(session, 'x'.repeat(15))
    assert.equal(sends.length, 1, 'debe enviar inmediato sin esperar timer')
    assert.equal(sends[0].p.length, 15)
  })

  test('Buffer (no string): se convierte con toString utf8', () => {
    const { session, sends } = makeSession()
    const b = createPtyDataBatcher({ flushMs: 5, flushBytes: 1024 })
    b.enqueue(session, Buffer.from('héllo', 'utf8'))
    b.flush(session)
    assert.equal(sends.length, 1)
    assert.equal(sends[0].p, 'héllo')
  })

  test('chunk vacío: no encola', () => {
    const { session, sends } = makeSession()
    const b = createPtyDataBatcher()
    b.enqueue(session, '')
    b.flush(session)
    assert.equal(sends.length, 0)
  })

  test('window destruida: no envía aunque hayan chunks', () => {
    const sends = []
    const session = {
      win: { isDestroyed: () => true, webContents: { send: (ch, p) => sends.push({ ch, p }) } }
    }
    const b = createPtyDataBatcher({ flushBytes: 1 })
    b.enqueue(session, 'a')
    // window destruida en enqueue → no acumula
    assert.equal(sends.length, 0)
  })

  test('flush sin chunks pendientes es no-op', () => {
    const { session, sends } = makeSession()
    const b = createPtyDataBatcher()
    b.flush(session)
    assert.equal(sends.length, 0)
  })

  test('100 chunks de 1B en burst: solo flush() final emite', () => {
    const { session, sends } = makeSession()
    const b = createPtyDataBatcher({ flushBytes: 10_000, flushMs: 10_000 })
    for (let i = 0; i < 100; i++) b.enqueue(session, '.')
    assert.equal(sends.length, 0, 'sin alcanzar bytes ni timer, no envía')
    b.flush(session)
    assert.equal(sends.length, 1)
    assert.equal(sends[0].p.length, 100)
  })

  test('sendFn custom override', () => {
    const calls = []
    const b = createPtyDataBatcher({ flushBytes: 1, sendFn: (s, p) => calls.push(p) })
    b.enqueue({ win: { isDestroyed: () => false } }, 'X')
    assert.deepEqual(calls, ['X'])
  })
})
