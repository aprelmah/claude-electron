'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createRecentCwds, RECENT_CWDS_MAX } = require('../main/recent-cwds')

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recent-cwds-test-'))
}

test('lista vacía cuando no hay archivo', () => {
  const dir = tmpUserData()
  const r = createRecentCwds({ userDataDir: dir })
  assert.deepEqual(r.list(), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('push añade carpetas existentes en orden LIFO', () => {
  const dir = tmpUserData()
  const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'projA-'))
  const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'projB-'))
  const r = createRecentCwds({ userDataDir: dir })
  r.push(projA)
  r.push(projB)
  const list = r.list()
  assert.equal(list.length, 2)
  assert.equal(list[0].cwd, path.resolve(projB))
  assert.equal(list[1].cwd, path.resolve(projA))
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(projA, { recursive: true, force: true })
  fs.rmSync(projB, { recursive: true, force: true })
})

test('push deduplica y mueve al frente', () => {
  const dir = tmpUserData()
  const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'projA-'))
  const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'projB-'))
  const r = createRecentCwds({ userDataDir: dir })
  r.push(projA)
  r.push(projB)
  r.push(projA)
  const list = r.list()
  assert.equal(list.length, 2)
  assert.equal(list[0].cwd, path.resolve(projA))
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(projA, { recursive: true, force: true })
  fs.rmSync(projB, { recursive: true, force: true })
})

test('respeta cap de 10', () => {
  const dir = tmpUserData()
  const projects = []
  for (let i = 0; i < RECENT_CWDS_MAX + 3; i++) {
    projects.push(fs.mkdtempSync(path.join(os.tmpdir(), `cap-${i}-`)))
  }
  const r = createRecentCwds({ userDataDir: dir })
  for (const p of projects) r.push(p)
  const list = r.list()
  assert.equal(list.length, RECENT_CWDS_MAX)
  // El último pushed va primero
  assert.equal(list[0].cwd, path.resolve(projects[projects.length - 1]))
  fs.rmSync(dir, { recursive: true, force: true })
  for (const p of projects) fs.rmSync(p, { recursive: true, force: true })
})

test('remove elimina por cwd', () => {
  const dir = tmpUserData()
  const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'projA-'))
  const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'projB-'))
  const r = createRecentCwds({ userDataDir: dir })
  r.push(projA)
  r.push(projB)
  r.remove(projA)
  const list = r.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].cwd, path.resolve(projB))
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(projA, { recursive: true, force: true })
  fs.rmSync(projB, { recursive: true, force: true })
})

test('list({pruneMissing:true}) descarta carpetas borradas', () => {
  const dir = tmpUserData()
  const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'projA-'))
  const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'projB-'))
  const r = createRecentCwds({ userDataDir: dir })
  r.push(projA)
  r.push(projB)
  fs.rmSync(projA, { recursive: true, force: true })
  const list = r.list({ pruneMissing: true })
  assert.equal(list.length, 1)
  assert.equal(list[0].cwd, path.resolve(projB))
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(projB, { recursive: true, force: true })
})

test('push ignora strings vacíos', () => {
  const dir = tmpUserData()
  const r = createRecentCwds({ userDataDir: dir })
  r.push('')
  r.push('   ')
  assert.deepEqual(r.list(), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('archivo corrupto se trata como vacío', () => {
  const dir = tmpUserData()
  fs.writeFileSync(path.join(dir, 'recent-cwds.json'), '{not valid json')
  const r = createRecentCwds({ userDataDir: dir })
  assert.deepEqual(r.list(), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('clear vacía la lista', () => {
  const dir = tmpUserData()
  const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'projA-'))
  const r = createRecentCwds({ userDataDir: dir })
  r.push(projA)
  r.clear()
  assert.deepEqual(r.list(), [])
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(projA, { recursive: true, force: true })
})
