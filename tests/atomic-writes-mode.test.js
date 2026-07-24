'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const { atomicWriteFileSync, atomicWriteJsonSync } = require('../main/atomic-writes')

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-mode-'))
}

describe('SEC-H1: atomic-writes permite mode 0o600 para secrets', () => {
  test('atomicWriteFileSync sin opts: comportamiento default (≥0o644 típico)', () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'a.txt')
    atomicWriteFileSync(target, 'hello', 'utf-8')
    assert.ok(fs.existsSync(target))
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })

  test('atomicWriteFileSync con mode 0o600: archivo queda 0o600', () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'secret.txt')
    atomicWriteFileSync(target, 'token-xyz', 'utf-8', { mode: 0o600 })
    const st = fs.statSync(target)
    const perms = st.mode & 0o777
    assert.strictEqual(perms, 0o600, `permisos deben ser 0o600, son ${perms.toString(8)}`)
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })

  test('atomicWriteJsonSync con mode 0o600: archivo queda 0o600', () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'config.json')
    atomicWriteJsonSync(target, { botToken: 'SECRET-TG' }, { mode: 0o600 })
    const st = fs.statSync(target)
    assert.strictEqual(st.mode & 0o777, 0o600)
    const data = JSON.parse(fs.readFileSync(target, 'utf-8'))
    assert.strictEqual(data.botToken, 'SECRET-TG')
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })

  test('sobreescritura con mode mantiene 0o600 tras rename', () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'c.json')
    atomicWriteJsonSync(target, { v: 1 }, { mode: 0o600 })
    atomicWriteJsonSync(target, { v: 2 }, { mode: 0o600 })
    assert.strictEqual(fs.statSync(target).mode & 0o777, 0o600)
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })
})
