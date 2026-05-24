'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const { atomicWriteFileAsync, atomicWriteJsonAsync } = require('../main/atomic-writes')

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-async-')) }

describe('PERF-H8: atomicWriteFileAsync / atomicWriteJsonAsync', () => {
  test('escribe contenido correctamente con encoding', async () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'f.txt')
    await atomicWriteFileAsync(target, 'hola mundo', 'utf-8')
    assert.equal(fs.readFileSync(target, 'utf-8'), 'hola mundo')
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })

  test('mode 0o600 aplica', async () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 's.txt')
    await atomicWriteFileAsync(target, 'secret', 'utf-8', { mode: 0o600 })
    assert.equal(fs.statSync(target).mode & 0o777, 0o600)
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })

  test('atomicWriteJsonAsync escribe JSON formateado', async () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'd.json')
    await atomicWriteJsonAsync(target, { a: 1, b: [2, 3] })
    const data = JSON.parse(fs.readFileSync(target, 'utf-8'))
    assert.deepEqual(data, { a: 1, b: [2, 3] })
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })

  test('no deja .tmp huérfanos en éxito', async () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'x.txt')
    await atomicWriteFileAsync(target, 'data', 'utf-8')
    const files = fs.readdirSync(tmp)
    const tmps = files.filter((f) => f.includes('.tmp.'))
    assert.equal(tmps.length, 0)
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })

  test('overwrite preserva atomicidad', async () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'y.txt')
    await atomicWriteFileAsync(target, 'v1', 'utf-8')
    await atomicWriteFileAsync(target, 'v2', 'utf-8')
    assert.equal(fs.readFileSync(target, 'utf-8'), 'v2')
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })

  test('crea directorio padre si no existe', async () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'sub', 'deep', 'z.txt')
    await atomicWriteFileAsync(target, 'd', 'utf-8')
    assert.equal(fs.readFileSync(target, 'utf-8'), 'd')
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  test('main process no se bloquea durante write grande (yield al event loop)', async () => {
    const tmp = mkTmp()
    const target = path.join(tmp, 'big.txt')
    const data = 'a'.repeat(2 * 1024 * 1024) // 2MB

    let ticks = 0
    const iv = setInterval(() => { ticks++ }, 1)
    const writePromise = atomicWriteFileAsync(target, data, 'utf-8')
    await writePromise
    clearInterval(iv)
    // En sync, ticks sería 0 (loop bloqueado). En async, al menos 1 tick.
    assert.ok(ticks >= 1, `event loop debió procesar al menos 1 tick durante write, fue ${ticks}`)
    assert.equal(fs.statSync(target).size, data.length)
    fs.unlinkSync(target); fs.rmdirSync(tmp)
  })
})
