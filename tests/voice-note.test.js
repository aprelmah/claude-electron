'use strict'

// Notas de voz de respuesta para Telegram: texto → helper de voz ({cmd:'synth'}
// → .caf con la voz configurada) → ffmpeg → .ogg opus. Helper y ffmpeg
// falseados. El contrato del helper es UNA síntesis a la vez: el módulo
// serializa.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { createVoiceNoteMaker } = require('../main/voice-note')

function fakeHelper({ binaryOk = true, running = false } = {}) {
  const sent = []
  return {
    sent,
    running,
    startCalls: 0,
    stopCalls: 0,
    checkBinary() { return binaryOk ? { ok: true } : { ok: false, reason: 'falta el helper' } },
    isRunning() { return this.running },
    isBroken() { return false },
    start() { this.startCalls += 1; this.running = true },
    stop() { this.stopCalls += 1; this.running = false },
    send(obj) { sent.push(obj); return true }
  }
}

function fakeSpawn({ exit = 0 } = {}) {
  const calls = []
  const spawnFn = (bin, args) => {
    const p = new EventEmitter()
    p.stderr = new EventEmitter()
    calls.push({ bin, args })
    setImmediate(() => {
      const out = args[args.length - 1]
      if (exit === 0) fs.writeFileSync(out, 'ogg-falso')
      p.emit('close', exit)
    })
    return p
  }
  return { spawnFn, calls }
}

// El despacho va por la cola de serialización (microtask): esperar a que el
// cmd salga antes de inspeccionar helper.sent.
async function tick() {
  await new Promise((resolve) => setImmediate(resolve))
}

function crear({ helper, spawnFn, tmpDir, applyPrefs, isVoiceInUse, timeoutMs = 2000 }) {
  return createVoiceNoteMaker({
    helper,
    spawnFn,
    tmpDir: tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'vn-test-')),
    ffmpegBin: 'ffmpeg-falso',
    applyPrefs: applyPrefs || (() => {}),
    isVoiceInUse: isVoiceInUse || (() => false),
    timeoutMs,
    log: () => {}
  })
}

test('sintetiza, convierte a ogg y limpia el caf', async () => {
  const helper = fakeHelper()
  const { spawnFn, calls } = fakeSpawn()
  const maker = crear({ helper, spawnFn })
  const p = maker.makeVoiceNote('hola desde el agente')
  await tick()
  const cmd = helper.sent.find((m) => m.cmd === 'synth')
  assert.ok(cmd, 'manda cmd synth')
  assert.strictEqual(cmd.text, 'hola desde el agente')
  assert.ok(cmd.path.endsWith('.caf'))
  fs.writeFileSync(cmd.path, 'caf-falso')
  maker.handleHelperEvent({ type: 'synth-done', id: cmd.id, path: cmd.path })
  const oggPath = await p
  assert.ok(oggPath.endsWith('.ogg'))
  assert.ok(fs.existsSync(oggPath), 'el ogg existe')
  assert.ok(!fs.existsSync(cmd.path), 'el caf intermedio se limpia')
  const ff = calls[0]
  assert.strictEqual(ff.bin, 'ffmpeg-falso')
  assert.ok(ff.args.includes('libopus'), 'codifica con libopus')
})

test('synth-error rechaza', async () => {
  const helper = fakeHelper()
  const { spawnFn } = fakeSpawn()
  const maker = crear({ helper, spawnFn })
  const p = maker.makeVoiceNote('hola')
  await tick()
  const cmd = helper.sent.find((m) => m.cmd === 'synth')
  maker.handleHelperEvent({ type: 'synth-error', id: cmd.id, message: 'síntesis vacía' })
  await assert.rejects(p, /síntesis vacía/)
})

test('ffmpeg fallando rechaza y limpia el caf', async () => {
  const helper = fakeHelper()
  const { spawnFn } = fakeSpawn({ exit: 1 })
  const maker = crear({ helper, spawnFn })
  const p = maker.makeVoiceNote('hola')
  await tick()
  const cmd = helper.sent.find((m) => m.cmd === 'synth')
  fs.writeFileSync(cmd.path, 'caf-falso')
  maker.handleHelperEvent({ type: 'synth-done', id: cmd.id, path: cmd.path })
  await assert.rejects(p, /ffmpeg/)
  assert.ok(!fs.existsSync(cmd.path))
})

test('timeout si el helper no contesta', async () => {
  const helper = fakeHelper()
  const { spawnFn } = fakeSpawn()
  const maker = crear({ helper, spawnFn, timeoutMs: 30 })
  await assert.rejects(maker.makeVoiceNote('hola'), /no contestó/)
})

test('texto vacío rechaza sin tocar el helper', async () => {
  const helper = fakeHelper()
  const { spawnFn } = fakeSpawn()
  const maker = crear({ helper, spawnFn })
  await assert.rejects(maker.makeVoiceNote('   '), /vacío/)
  assert.strictEqual(helper.sent.length, 0)
})

test('serializa: la segunda síntesis no sale hasta acabar la primera', async () => {
  const helper = fakeHelper()
  const { spawnFn } = fakeSpawn()
  const maker = crear({ helper, spawnFn })
  const p1 = maker.makeVoiceNote('uno')
  const p2 = maker.makeVoiceNote('dos')
  await tick()
  assert.strictEqual(helper.sent.filter((m) => m.cmd === 'synth').length, 1, 'solo la primera en vuelo')
  const c1 = helper.sent[helper.sent.length - 1]
  fs.writeFileSync(c1.path, 'caf')
  maker.handleHelperEvent({ type: 'synth-done', id: c1.id, path: c1.path })
  await p1
  await tick()
  const c2 = helper.sent.filter((m) => m.cmd === 'synth')[1]
  assert.ok(c2, 'la segunda sale tras acabar la primera')
  fs.writeFileSync(c2.path, 'caf')
  maker.handleHelperEvent({ type: 'synth-done', id: c2.id, path: c2.path })
  await p2
})

test('arranca el helper si no corría, aplica prefs de voz y lo para al acabar', async () => {
  const helper = fakeHelper({ running: false })
  const { spawnFn } = fakeSpawn()
  let prefsAplicadas = 0
  const maker = crear({ helper, spawnFn, applyPrefs: () => { prefsAplicadas += 1 } })
  const p = maker.makeVoiceNote('hola')
  await tick()
  assert.strictEqual(helper.startCalls, 1)
  assert.strictEqual(prefsAplicadas, 1, 'la voz configurada se empuja tras arrancar')
  const cmd = helper.sent.find((m) => m.cmd === 'synth')
  fs.writeFileSync(cmd.path, 'caf')
  maker.handleHelperEvent({ type: 'synth-done', id: cmd.id, path: cmd.path })
  await p
  assert.strictEqual(helper.stopCalls, 1)
})

test('NO para el helper si la voz está en uso o ya corría', async () => {
  const helper = fakeHelper({ running: true })
  const { spawnFn } = fakeSpawn()
  const maker = crear({ helper, spawnFn })
  const p = maker.makeVoiceNote('hola')
  await tick()
  const cmd = helper.sent.find((m) => m.cmd === 'synth')
  fs.writeFileSync(cmd.path, 'caf')
  maker.handleHelperEvent({ type: 'synth-done', id: cmd.id, path: cmd.path })
  await p
  assert.strictEqual(helper.stopCalls, 0)
})

test('handleHelperEvent solo consume eventos synth', () => {
  const helper = fakeHelper()
  const { spawnFn } = fakeSpawn()
  const maker = crear({ helper, spawnFn })
  assert.strictEqual(maker.handleHelperEvent({ type: 'final', text: 'x' }), false)
  assert.strictEqual(maker.handleHelperEvent({ type: 'file-transcript', id: 'ftr:1' }), false)
  assert.strictEqual(maker.handleHelperEvent({ type: 'synth-done', id: 'syn:99', path: '/x' }), true)
})
