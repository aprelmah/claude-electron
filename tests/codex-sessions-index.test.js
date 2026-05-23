'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createCodexSessionsIndex } = require('../main/codex-sessions-index')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeRollout(sessionsRoot, { year, month, day, id, cwd, firstUserText = 'hola' }) {
  const dir = path.join(sessionsRoot, year, month, day)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `rollout-${id}.jsonl`)
  const meta = { type: 'session_meta', payload: { id, cwd } }
  const turn = { type: 'user_input', payload: { text: firstUserText } }
  fs.writeFileSync(filePath, JSON.stringify(meta) + '\n' + JSON.stringify(turn) + '\n')
  return filePath
}

function setupFixture() {
  const userDataDir = tmpDir('codex-idx-ud-')
  const sessionsRoot = tmpDir('codex-idx-sr-')
  return { userDataDir, sessionsRoot, cleanup: () => {
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(sessionsRoot, { recursive: true, force: true })
  } }
}

test('isEmpty true cuando no hay JSON ni datos', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  assert.equal(idx.isEmpty(), true)
  cleanup()
})

test('bootstrap escanea árbol y agrupa por cwd', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwdA = '/tmp/proyA-fake'
  const cwdB = '/tmp/proyB-fake'
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'aaa-1', cwd: cwdA, firstUserText: 'primero A' })
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'aaa-2', cwd: cwdA, firstUserText: 'segundo A' })
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '22', id: 'bbb-1', cwd: cwdB })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  const result = await idx.bootstrap()
  assert.equal(result.filesScanned, 3)
  assert.equal(result.byCwdCount, 2)
  const listA = idx.getForCwd(cwdA)
  assert.equal(listA.length, 2)
  assert.ok(listA[0].mtime >= listA[1].mtime, 'orden mtime desc')
  assert.equal(listA[0].path.endsWith('.jsonl'), true)
  assert.ok(['primero A', 'segundo A'].includes(listA[0].preview))
  assert.deepEqual(idx.getForCwd('/no-existe'), [])
  cleanup()
})

test('bootstrap es idempotente', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-idem'
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'idem-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  await idx.bootstrap()
  await idx.bootstrap()
  assert.equal(idx.getForCwd(cwd).length, 1)
  cleanup()
})

test('addOrUpdate inserta entry nueva', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-add'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'add-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  assert.equal(idx.getForCwd(cwd).length, 0)
  const ok = idx.addOrUpdate(file)
  assert.equal(ok, true)
  const list = idx.getForCwd(cwd)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'add-1')
  cleanup()
})

test('addOrUpdate refresca mtime si el archivo cambió', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-up'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'up-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  const mtime1 = idx.getForCwd(cwd)[0].mtime
  // Forzar nuevo mtime
  const future = new Date(Date.now() + 10_000)
  fs.utimesSync(file, future, future)
  idx.addOrUpdate(file)
  const mtime2 = idx.getForCwd(cwd)[0].mtime
  assert.ok(mtime2 > mtime1, `mtime debe actualizarse (${mtime2} > ${mtime1})`)
  cleanup()
})

test('removeByPath borra entry y limpia cwd vacío', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-rm'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'rm-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  assert.equal(idx.getForCwd(cwd).length, 1)
  assert.equal(idx.removeByPath(file), true)
  assert.equal(idx.getForCwd(cwd).length, 0)
  assert.equal(idx.removeByPath(file), false)
  cleanup()
})

test('persistencia entre instancias', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-persist'
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'p-1', cwd })

  const idx1 = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  await idx1.bootstrap()
  assert.equal(idx1.getForCwd(cwd).length, 1)

  const idx2 = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  // Sin volver a hacer bootstrap, debe leer del JSON.
  assert.equal(idx2.isEmpty(), false)
  const list = idx2.getForCwd(cwd)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'p-1')
  cleanup()
})

test('archivo de índice corrupto se trata como vacío', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  fs.writeFileSync(path.join(userDataDir, 'codex-sessions-index.json'), '{not valid json')
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  assert.equal(idx.isEmpty(), true)
  assert.deepEqual(idx.getForCwd('/cualquier'), [])
  cleanup()
})

test('rollout sin session_meta válido se ignora', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const dir = path.join(sessionsRoot, '2026', '05', '23')
  fs.mkdirSync(dir, { recursive: true })
  const bad = path.join(dir, 'rollout-bad.jsonl')
  fs.writeFileSync(bad, 'no es json valido\n')

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  const ok = idx.addOrUpdate(bad)
  assert.equal(ok, false)
  cleanup()
})

test('addOrUpdate mueve entry si cambia el cwd', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwdA = '/tmp/move-A'
  const cwdB = '/tmp/move-B'
  const dir = path.join(sessionsRoot, '2026', '05', '23')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'rollout-mv-1.jsonl')

  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'mv-1', cwd: cwdA } }) + '\n')
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  assert.equal(idx.getForCwd(cwdA).length, 1)

  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'mv-1', cwd: cwdB } }) + '\n')
  idx.addOrUpdate(file)
  assert.equal(idx.getForCwd(cwdA).length, 0)
  assert.equal(idx.getForCwd(cwdB).length, 1)
  cleanup()
})

test('stopWatcher no lanza si no hay watcher activo', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.stopWatcher()
  assert.ok(true)
  cleanup()
})
