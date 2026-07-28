'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { createCliUpdateWatcher } = require('../main/cli-update-watch')

function fakeClock(start = 1000) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

test('detecta el marcador de update completado de codex', () => {
  const w = createCliUpdateWatcher()
  assert.strictEqual(w.observe(1, 'pensando…'), false)
  assert.strictEqual(w.observe(1, '\n🎉 Update ran successfully! Please restart Codex.\r\n'), true)
  assert.strictEqual(w.takeRestart(1), true)
})

test('detecta el marcador aunque llegue partido entre dos chunks', () => {
  const w = createCliUpdateWatcher()
  assert.strictEqual(w.observe(1, 'changed 2 packages in 6s\n🎉 Update ran suc'), false)
  assert.strictEqual(w.observe(1, 'cessfully! Please restart Codex.'), true)
  assert.strictEqual(w.takeRestart(1), true)
})

test('sin marcador no hay reinicio: salir del CLI sigue cerrando la sesión', () => {
  const w = createCliUpdateWatcher()
  w.observe(1, 'Update available! 0.133.0 -> 0.145.0')
  w.observe(1, 'npm error code EACCES')
  assert.strictEqual(w.takeRestart(1), false)
})

test('takeRestart consume el aviso: no reinicia dos veces por un update', () => {
  const w = createCliUpdateWatcher()
  w.observe(1, 'Update ran successfully')
  assert.strictEqual(w.takeRestart(1), true)
  assert.strictEqual(w.takeRestart(1), false)
})

test('tope de reinicios por ventana: evita el bucle si el CLI vuelve a morir', () => {
  const clock = fakeClock()
  const w = createCliUpdateWatcher({ now: clock.now, maxRestarts: 1 })
  w.observe(1, 'Update ran successfully')
  assert.strictEqual(w.takeRestart(1), true)
  clock.advance(1000)
  w.observe(1, 'Update ran successfully')
  assert.strictEqual(w.takeRestart(1), false, 'el segundo reinicio seguido debe bloquearse')
})

test('pasada la ventana de reinicios vuelve a permitirse', () => {
  const clock = fakeClock()
  const w = createCliUpdateWatcher({ now: clock.now, maxRestarts: 1, restartWindowMs: 60_000 })
  w.observe(1, 'Update ran successfully')
  assert.strictEqual(w.takeRestart(1), true)
  clock.advance(120_000)
  w.observe(1, 'Update ran successfully')
  assert.strictEqual(w.takeRestart(1), true)
})

test('un marcador viejo caduca y no reinicia', () => {
  const clock = fakeClock()
  const w = createCliUpdateWatcher({ now: clock.now, pendingWindowMs: 1000 })
  w.observe(1, 'Update ran successfully')
  clock.advance(5000)
  assert.strictEqual(w.takeRestart(1), false)
})

test('el estado es por sesión', () => {
  const w = createCliUpdateWatcher()
  w.observe('wc-1', 'Update ran successfully')
  assert.strictEqual(w.takeRestart('wc-2'), false)
  assert.strictEqual(w.takeRestart('wc-1'), true)
})

test('forget limpia el estado de la sesión', () => {
  const w = createCliUpdateWatcher()
  w.observe(1, 'Update ran successfully')
  w.forget(1)
  assert.strictEqual(w.takeRestart(1), false)
})

test('observe tolera data vacía o nula', () => {
  const w = createCliUpdateWatcher()
  assert.strictEqual(w.observe(1, ''), false)
  assert.strictEqual(w.observe(1, null), false)
  assert.strictEqual(w.observe(undefined, 'Update ran successfully'), false)
})
