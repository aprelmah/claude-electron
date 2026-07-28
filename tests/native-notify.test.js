'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { createNotifier } = require('../main/native-notify')

function makeFakeNotification({ supported = true, throwOnCtor = false, failAfterShow = false } = {}) {
  const instances = []
  class FakeNotification {
    constructor(opts) {
      if (throwOnCtor) throw new Error('boom')
      this.opts = opts
      this.handlers = {}
      this.shown = false
      instances.push(this)
    }
    on(evt, fn) { (this.handlers[evt] ||= []).push(fn); return this }
    emit(evt, ...args) { for (const fn of this.handlers[evt] || []) fn(...args) }
    show() {
      this.shown = true
      if (failAfterShow) this.emit('failed', {}, new Error('not code-signed'))
    }
  }
  FakeNotification.isSupported = () => supported
  return { FakeNotification, instances }
}

describe('native-notify: fallback cuando UNNotification no está disponible (Electron 42+ sin firma)', () => {
  test('camino feliz: muestra la notificación nativa y no llama al fallback', () => {
    const { FakeNotification, instances } = makeFakeNotification()
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })
    let fallbacks = 0

    const r = notify({ title: 'T', body: 'B', fallback: () => { fallbacks++ } })

    assert.equal(r.shown, true)
    assert.equal(fallbacks, 0)
    assert.equal(instances.length, 1)
    assert.equal(instances[0].shown, true)
    assert.deepEqual({ t: instances[0].opts.title, b: instances[0].opts.body }, { t: 'T', b: 'B' })
    assert.equal(notify.isBroken(), false)
  })

  test('isSupported() false → fallback inmediato, sin construir notificación', () => {
    const { FakeNotification, instances } = makeFakeNotification({ supported: false })
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })
    const reasons = []

    const r = notify({ title: 'T', body: 'B', fallback: (reason) => reasons.push(reason) })

    assert.equal(r.shown, false)
    assert.equal(instances.length, 0)
    assert.deepEqual(reasons, ['unsupported'])
    assert.equal(notify.isBroken(), true)
  })

  test("evento 'failed' (app sin firmar) → dispara el fallback", () => {
    const { FakeNotification } = makeFakeNotification({ failAfterShow: true })
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })
    const reasons = []

    notify({ title: 'T', body: 'B', fallback: (reason) => reasons.push(reason) })

    assert.deepEqual(reasons, ['failed'])
    assert.equal(notify.isBroken(), true)
  })

  test('una vez roto, no reintenta la vía nativa: va directo al fallback', () => {
    const { FakeNotification, instances } = makeFakeNotification({ failAfterShow: true })
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })
    const reasons = []
    const fallback = (reason) => reasons.push(reason)

    notify({ title: '1', body: 'B', fallback })
    notify({ title: '2', body: 'B', fallback })
    notify({ title: '3', body: 'B', fallback })

    assert.equal(instances.length, 1, 'solo el primer intento construye una Notification')
    assert.deepEqual(reasons, ['failed', 'previo', 'previo'])
  })

  test('el aviso de degradación se loguea una sola vez', () => {
    const { FakeNotification } = makeFakeNotification({ failAfterShow: true })
    const logs = []
    const notify = createNotifier({ Notification: FakeNotification, log: (m) => logs.push(m) })

    notify({ title: '1', body: 'B' })
    notify({ title: '2', body: 'B' })

    assert.equal(logs.length, 1)
    assert.match(logs[0], /no disponibles/)
  })

  test('constructor que lanza → fallback con motivo "threw", sin propagar', () => {
    const { FakeNotification } = makeFakeNotification({ throwOnCtor: true })
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })
    const reasons = []

    assert.doesNotThrow(() => notify({ title: 'T', body: 'B', fallback: (r) => reasons.push(r) }))
    assert.deepEqual(reasons, ['threw'])
  })

  test('un fallback que lanza no rompe al llamante', () => {
    const { FakeNotification } = makeFakeNotification({ supported: false })
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })

    assert.doesNotThrow(() => notify({ title: 'T', body: 'B', fallback: () => { throw new Error('fallback roto') } }))
  })

  test('sin fallback definido, degradar no lanza', () => {
    const { FakeNotification } = makeFakeNotification({ supported: false })
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })

    assert.doesNotThrow(() => notify({ title: 'T', body: 'B' }))
  })

  test('onClick se engancha y los errores del handler quedan contenidos', () => {
    const { FakeNotification, instances } = makeFakeNotification()
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })
    let clicks = 0

    notify({ title: 'T', body: 'B', onClick: () => { clicks++; throw new Error('handler roto') } })
    assert.doesNotThrow(() => instances[0].emit('click'))
    assert.equal(clicks, 1)
  })

  test('reset() vuelve a permitir la vía nativa', () => {
    const { FakeNotification, instances } = makeFakeNotification({ supported: false })
    const notify = createNotifier({ Notification: FakeNotification, log: () => {} })

    notify({ title: 'T', body: 'B' })
    assert.equal(notify.isBroken(), true)
    notify.reset()
    assert.equal(notify.isBroken(), false)
    assert.equal(instances.length, 0)
  })
})
