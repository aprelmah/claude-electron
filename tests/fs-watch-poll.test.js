'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { resolveFsWatchPollAction } = require('../main/fs-watch-poll')

test('con watcher nativo adjunto y sin poll, no arranca nada', () => {
  assert.strictEqual(resolveFsWatchPollAction({ nativeAttached: true, pollRunning: false }), 'none')
})

test('con watcher nativo adjunto y poll corriendo, para el poll', () => {
  assert.strictEqual(resolveFsWatchPollAction({ nativeAttached: true, pollRunning: true }), 'stop')
})

test('sin watcher nativo y sin poll, arranca el poll de respaldo', () => {
  assert.strictEqual(resolveFsWatchPollAction({ nativeAttached: false, pollRunning: false }), 'start')
})

test('sin watcher nativo pero con poll ya corriendo, no lo duplica', () => {
  assert.strictEqual(resolveFsWatchPollAction({ nativeAttached: false, pollRunning: true }), 'none')
})

test('sin argumentos: el default es arrancar el poll (no hay nativo)', () => {
  assert.strictEqual(resolveFsWatchPollAction(), 'start')
  assert.strictEqual(resolveFsWatchPollAction({}), 'start')
})

test('el degradado del nativo a mitad de vida arranca el poll una sola vez', () => {
  // Secuencia real: arranca con nativo (none) → el watcher emite 'error'
  // (start) → un segundo 'error' no debe duplicar el interval (none).
  let pollRunning = false
  let nativeAttached = true
  assert.strictEqual(resolveFsWatchPollAction({ nativeAttached, pollRunning }), 'none')
  nativeAttached = false
  assert.strictEqual(resolveFsWatchPollAction({ nativeAttached, pollRunning }), 'start')
  pollRunning = true
  assert.strictEqual(resolveFsWatchPollAction({ nativeAttached, pollRunning }), 'none')
})
