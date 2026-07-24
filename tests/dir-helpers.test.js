'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { looksRemotePath, resolveExistingDir } = require('../main/dir-helpers')

test('looksRemotePath: detecta mount points macOS', () => {
  assert.equal(looksRemotePath('/Volumes/NAS-QNAP'), true)
  assert.equal(looksRemotePath('/Volumes/NAS-QNAP/Projects/foo'), true)
})

test('looksRemotePath: detecta UNC SMB', () => {
  assert.equal(looksRemotePath('//192.168.1.156/share'), true)
  assert.equal(looksRemotePath('\\\\192.168.1.156\\share'), true)
})

test('looksRemotePath: rechaza paths locales', () => {
  assert.equal(looksRemotePath('/Users/isabel/Desktop'), false)
  assert.equal(looksRemotePath('/tmp/x'), false)
  assert.equal(looksRemotePath(os.homedir()), false)
})

test('looksRemotePath: rechaza vacío/no-string', () => {
  assert.equal(looksRemotePath(''), false)
  assert.equal(looksRemotePath(null), false)
  assert.equal(looksRemotePath(undefined), false)
  assert.equal(looksRemotePath(123), false)
})

test('resolveExistingDir: devuelve path remoto sin tocar statSync', () => {
  // /Volumes/NAS-INEXISTENTE NO existe pero el helper lo devuelve igual
  // porque no statSync (evita colgar main process sobre SMB no responsivo).
  const remoteFake = '/Volumes/NAS-AUDITORIA-INEXISTENTE-' + Date.now()
  const t0 = Date.now()
  const result = resolveExistingDir(remoteFake)
  const elapsed = Date.now() - t0
  assert.equal(result, remoteFake)
  assert.ok(elapsed < 50, `debió retornar <50ms, tardó ${elapsed}ms`)
})

test('resolveExistingDir: devuelve "" para path local inexistente', () => {
  const fake = '/tmp/no-existe-este-dir-' + Date.now()
  assert.equal(resolveExistingDir(fake), '')
})

test('resolveExistingDir: devuelve path para dir local existente', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dir-helpers-'))
  try {
    assert.equal(resolveExistingDir(tmp), tmp)
  } finally {
    fs.rmdirSync(tmp)
  }
})

test('resolveExistingDir: devuelve "" para archivo (no dir)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dir-helpers-'))
  const file = path.join(tmp, 'f.txt')
  fs.writeFileSync(file, 'x')
  try {
    assert.equal(resolveExistingDir(file), '')
  } finally {
    fs.unlinkSync(file)
    fs.rmdirSync(tmp)
  }
})

test('resolveExistingDir: trim espacios', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dir-helpers-'))
  try {
    assert.equal(resolveExistingDir(`  ${tmp}  `), tmp)
  } finally {
    fs.rmdirSync(tmp)
  }
})

test('resolveExistingDir: vacío/no-string', () => {
  assert.equal(resolveExistingDir(''), '')
  assert.equal(resolveExistingDir(null), '')
  assert.equal(resolveExistingDir(undefined), '')
  assert.equal(resolveExistingDir(123), '')
})
