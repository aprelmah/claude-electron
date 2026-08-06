'use strict'

// Transcripción de ficheros de audio vía el helper de voz (Apple Speech en
// servidor). El módulo habla el protocolo NDJSON del helper: manda
// {cmd:'transcribe', id, path} y espera {type:'file-transcript'|
// 'file-transcript-error', id}. Aquí se prueba todo con un helper falso.

const test = require('node:test')
const assert = require('node:assert')
const { createAppleFileTranscriber } = require('../main/apple-transcribe')

function fakeHelper({ binaryOk = true, running = false, broken = false } = {}) {
  const sent = []
  return {
    sent,
    running,
    startCalls: 0,
    stopCalls: 0,
    checkBinary() { return binaryOk ? { ok: true } : { ok: false, reason: 'falta el helper' } },
    isRunning() { return this.running },
    isBroken() { return broken },
    start() { this.startCalls += 1; this.running = true },
    stop() { this.stopCalls += 1; this.running = false },
    send(obj) { sent.push(obj); return true }
  }
}

function crear(helper, opts = {}) {
  return createAppleFileTranscriber({
    helper,
    isVoiceInUse: opts.isVoiceInUse || (() => false),
    timeoutMs: opts.timeoutMs || 2000,
    log: () => {}
  })
}

test('resuelve con el texto del evento file-transcript con id coincidente', async () => {
  const helper = fakeHelper()
  const t = crear(helper)
  const p = t.transcribeWav('/tmp/audio.wav')
  const cmd = helper.sent.find((m) => m.cmd === 'transcribe')
  assert.ok(cmd, 'manda cmd transcribe')
  assert.strictEqual(cmd.path, '/tmp/audio.wav')
  assert.ok(cmd.id, 'lleva id')
  t.handleHelperEvent({ type: 'file-transcript', id: cmd.id, text: ' hola mundo ' })
  assert.strictEqual(await p, 'hola mundo')
})

test('rechaza con file-transcript-error', async () => {
  const helper = fakeHelper()
  const t = crear(helper)
  const p = t.transcribeWav('/tmp/audio.wav')
  const cmd = helper.sent.find((m) => m.cmd === 'transcribe')
  t.handleHelperEvent({ type: 'file-transcript-error', id: cmd.id, message: 'permiso denegado' })
  await assert.rejects(p, /permiso denegado/)
})

test('rechaza por timeout si el helper nunca contesta', async () => {
  const helper = fakeHelper()
  const t = crear(helper, { timeoutMs: 30 })
  await assert.rejects(t.transcribeWav('/tmp/audio.wav'), /no contestó/)
})

test('rechaza si falta el binario del helper', async () => {
  const helper = fakeHelper({ binaryOk: false })
  const t = crear(helper)
  await assert.rejects(t.transcribeWav('/tmp/audio.wav'), /falta el helper/)
  assert.strictEqual(helper.sent.length, 0)
})

test('rechaza si el helper está roto (broken)', async () => {
  const helper = fakeHelper({ broken: true })
  const t = crear(helper)
  await assert.rejects(t.transcribeWav('/tmp/audio.wav'), /roto|no arranca/)
})

test('rechaza si el send falla', async () => {
  const helper = fakeHelper()
  helper.send = () => false
  const t = crear(helper)
  await assert.rejects(t.transcribeWav('/tmp/audio.wav'), /escribir/)
})

test('arranca el helper si no corría y lo para al terminar (voz apagada)', async () => {
  const helper = fakeHelper({ running: false })
  const t = crear(helper)
  const p = t.transcribeWav('/tmp/a.wav')
  assert.strictEqual(helper.startCalls, 1)
  const cmd = helper.sent.find((m) => m.cmd === 'transcribe')
  t.handleHelperEvent({ type: 'file-transcript', id: cmd.id, text: 'ok' })
  await p
  assert.strictEqual(helper.stopCalls, 1)
})

test('NO para el helper si ya corría antes (modo voz lo tenía abierto)', async () => {
  const helper = fakeHelper({ running: true })
  const t = crear(helper)
  const p = t.transcribeWav('/tmp/a.wav')
  assert.strictEqual(helper.startCalls, 0)
  const cmd = helper.sent.find((m) => m.cmd === 'transcribe')
  t.handleHelperEvent({ type: 'file-transcript', id: cmd.id, text: 'ok' })
  await p
  assert.strictEqual(helper.stopCalls, 0)
})

test('NO para el helper si la voz está en uso al terminar', async () => {
  const helper = fakeHelper({ running: false })
  let vozEnUso = false
  const t = crear(helper, { isVoiceInUse: () => vozEnUso })
  const p = t.transcribeWav('/tmp/a.wav')
  vozEnUso = true
  const cmd = helper.sent.find((m) => m.cmd === 'transcribe')
  t.handleHelperEvent({ type: 'file-transcript', id: cmd.id, text: 'ok' })
  await p
  assert.strictEqual(helper.stopCalls, 0)
})

test('dos transcripciones concurrentes: no se para el helper hasta acabar la última', async () => {
  const helper = fakeHelper({ running: false })
  const t = crear(helper)
  const p1 = t.transcribeWav('/tmp/a.wav')
  const p2 = t.transcribeWav('/tmp/b.wav')
  const cmds = helper.sent.filter((m) => m.cmd === 'transcribe')
  assert.strictEqual(cmds.length, 2)
  assert.notStrictEqual(cmds[0].id, cmds[1].id, 'ids distintos')
  t.handleHelperEvent({ type: 'file-transcript', id: cmds[0].id, text: 'uno' })
  assert.strictEqual(await p1, 'uno')
  assert.strictEqual(helper.stopCalls, 0, 'con una pendiente no se para')
  t.handleHelperEvent({ type: 'file-transcript', id: cmds[1].id, text: 'dos' })
  assert.strictEqual(await p2, 'dos')
  assert.strictEqual(helper.stopCalls, 1)
})

test('handleHelperEvent consume solo sus eventos', () => {
  const helper = fakeHelper()
  const t = crear(helper)
  assert.strictEqual(t.handleHelperEvent({ type: 'partial', text: 'x' }), false)
  assert.strictEqual(t.handleHelperEvent({ type: 'hello', pid: 1 }), false)
  assert.strictEqual(t.handleHelperEvent(null), false)
  // Un file-transcript huérfano (id ya resuelto) se consume igual: no es de nadie más.
  assert.strictEqual(t.handleHelperEvent({ type: 'file-transcript', id: 'ftr:999', text: 'x' }), true)
})

test('un error fatal del helper rechaza todas las pendientes sin consumir el evento', async () => {
  const helper = fakeHelper()
  const t = crear(helper)
  const p1 = t.transcribeWav('/tmp/a.wav')
  const p2 = t.transcribeWav('/tmp/b.wav')
  const consumido = t.handleHelperEvent({ type: 'error', message: 'el helper de voz no arranca', fatal: true })
  assert.strictEqual(consumido, false, 'el fatal lo tienen que ver también los demás consumidores')
  await assert.rejects(p1, /no arranca/)
  await assert.rejects(p2, /no arranca/)
})

test('texto vacío en file-transcript resuelve a cadena vacía (el que llama decide el fallback)', async () => {
  const helper = fakeHelper()
  const t = crear(helper)
  const p = t.transcribeWav('/tmp/a.wav')
  const cmd = helper.sent.find((m) => m.cmd === 'transcribe')
  t.handleHelperEvent({ type: 'file-transcript', id: cmd.id, text: '' })
  assert.strictEqual(await p, '')
})
