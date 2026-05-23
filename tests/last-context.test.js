'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createLastContext } = require('../main/last-context')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'last-context-test-'))
}

test('get devuelve null si no hay archivo', () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  assert.equal(lc.get('1'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('set persiste y get devuelve mismo objeto', () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  lc.set('1', { cwd: '/tmp/foo', cli: 'claude', sessionId: 'abc-123' })
  const got = lc.get('1')
  assert.equal(got.cwd, '/tmp/foo')
  assert.equal(got.cli, 'claude')
  assert.equal(got.sessionId, 'abc-123')
  assert.ok(got.updatedAt > 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('set acepta sessionId null', () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  lc.set('1', { cwd: '/tmp/foo', cli: 'codex', sessionId: null })
  assert.equal(lc.get('1').sessionId, null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('set rechaza sessionId con caracteres inválidos', () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  lc.set('1', { cwd: '/tmp/foo', cli: 'claude', sessionId: '../etc/passwd' })
  assert.equal(lc.get('1').sessionId, null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('set por defecto cli=claude si llega valor inválido', () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  lc.set('1', { cwd: '/tmp/foo', cli: 'bash' })
  assert.equal(lc.get('1').cli, 'claude')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('múltiples wcId independientes', () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  lc.set('1', { cwd: '/tmp/a', cli: 'claude' })
  lc.set('2', { cwd: '/tmp/b', cli: 'codex' })
  assert.equal(lc.get('1').cwd, '/tmp/a')
  assert.equal(lc.get('2').cwd, '/tmp/b')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('set fusiona con valor previo', () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  lc.set('1', { cwd: '/tmp/a', cli: 'claude', sessionId: 'sess1' })
  lc.set('1', { cli: 'codex' })
  const got = lc.get('1')
  assert.equal(got.cwd, '/tmp/a')
  assert.equal(got.cli, 'codex')
  assert.equal(got.sessionId, 'sess1')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('remove borra entrada', () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  lc.set('1', { cwd: '/tmp/a', cli: 'claude' })
  lc.remove('1')
  assert.equal(lc.get('1'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('mostRecent devuelve el más reciente', async () => {
  const dir = tmpDir()
  const lc = createLastContext({ userDataDir: dir })
  lc.set('1', { cwd: '/tmp/a', cli: 'claude' })
  await new Promise((r) => setTimeout(r, 5))
  lc.set('2', { cwd: '/tmp/b', cli: 'codex' })
  const top = lc.mostRecent()
  assert.equal(top.cwd, '/tmp/b')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('archivo corrupto se trata como vacío', () => {
  const dir = tmpDir()
  fs.writeFileSync(path.join(dir, 'last-context.json'), 'no es json')
  const lc = createLastContext({ userDataDir: dir })
  assert.equal(lc.get('1'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})
