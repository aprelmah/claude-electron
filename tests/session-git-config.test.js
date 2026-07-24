const { test } = require('node:test')
const assert = require('node:assert')

const { sanitizeGitSessionIsolation } = require('../main/config-store')

test('sanitizeGitSessionIsolation: default true (campo ausente/undefined)', () => {
  assert.strictEqual(sanitizeGitSessionIsolation(undefined), true)
})

test('sanitizeGitSessionIsolation: config guardado sin el campo se normaliza a true', () => {
  const stored = {} // simula config.cli sin gitSessionIsolation
  assert.strictEqual(sanitizeGitSessionIsolation(stored.gitSessionIsolation), true)
})

test('sanitizeGitSessionIsolation: false explícito se respeta', () => {
  assert.strictEqual(sanitizeGitSessionIsolation(false), false)
})

test('sanitizeGitSessionIsolation: true explícito se respeta', () => {
  assert.strictEqual(sanitizeGitSessionIsolation(true), true)
})

test('sanitizeGitSessionIsolation: valores basura caen al default true', () => {
  assert.strictEqual(sanitizeGitSessionIsolation('false'), true)
  assert.strictEqual(sanitizeGitSessionIsolation(0), true)
  assert.strictEqual(sanitizeGitSessionIsolation(null), true)
})
