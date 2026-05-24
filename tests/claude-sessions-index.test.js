'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createClaudeSessionsIndex } = require('../main/claude-sessions-index')

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-idx-test-'))
}

test('get devuelve null cuando no hay archivo', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  assert.equal(idx.get('/cwd', 'sid'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('set persiste y get recupera', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  idx.set('/proj/a', 'sid-1', {
    preview: 'hola',
    msgCount: 5,
    mtime: 1000,
    size: 200
  })
  const entry = idx.get('/proj/a', 'sid-1')
  assert.equal(entry.preview, 'hola')
  assert.equal(entry.msgCount, 5)
  assert.equal(entry.mtime, 1000)
  assert.equal(entry.size, 200)
  assert.ok(entry.updatedAt > 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('persistencia entre instancias del índice (flush)', () => {
  const dir = tmpUserData()
  const idx1 = createClaudeSessionsIndex({ userDataDir: dir })
  idx1.set('/proj/a', 'sid-1', { preview: 'p1', msgCount: 3, mtime: 11, size: 22 })
  idx1.flush() // PERF-H7: persist es ahora debounced, flush para forzar write inmediato

  const idx2 = createClaudeSessionsIndex({ userDataDir: dir })
  const entry = idx2.get('/proj/a', 'sid-1')
  assert.equal(entry.preview, 'p1')
  assert.equal(entry.msgCount, 3)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('getForCwd devuelve todas las entradas del cwd', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  idx.set('/proj/a', 's1', { preview: 'a', msgCount: 1, mtime: 1, size: 1 })
  idx.set('/proj/a', 's2', { preview: 'b', msgCount: 2, mtime: 2, size: 2 })
  idx.set('/proj/b', 's3', { preview: 'c', msgCount: 3, mtime: 3, size: 3 })
  const map = idx.getForCwd('/proj/a')
  assert.equal(Object.keys(map).length, 2)
  assert.equal(map.s1.preview, 'a')
  assert.equal(map.s2.preview, 'b')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('removeSession quita una entrada concreta', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  idx.set('/proj/a', 's1', { preview: 'a', msgCount: 1, mtime: 1, size: 1 })
  idx.set('/proj/a', 's2', { preview: 'b', msgCount: 2, mtime: 2, size: 2 })
  idx.removeSession('/proj/a', 's1')
  assert.equal(idx.get('/proj/a', 's1'), null)
  assert.ok(idx.get('/proj/a', 's2'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('removeSession limpia el cwd cuando se queda vacío', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  idx.set('/proj/a', 's1', { preview: 'a', msgCount: 1, mtime: 1, size: 1 })
  idx.removeSession('/proj/a', 's1')
  assert.deepEqual(idx.getForCwd('/proj/a'), {})
  fs.rmSync(dir, { recursive: true, force: true })
})

test('removeForCwd borra todas las entradas del cwd', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  idx.set('/proj/a', 's1', { preview: 'a', msgCount: 1, mtime: 1, size: 1 })
  idx.set('/proj/a', 's2', { preview: 'b', msgCount: 2, mtime: 2, size: 2 })
  idx.set('/proj/b', 's3', { preview: 'c', msgCount: 3, mtime: 3, size: 3 })
  idx.removeForCwd('/proj/a')
  assert.deepEqual(idx.getForCwd('/proj/a'), {})
  assert.ok(idx.get('/proj/b', 's3'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('archivo corrupto se trata como vacío', () => {
  const dir = tmpUserData()
  fs.writeFileSync(path.join(dir, 'claude-sessions-index.json'), 'no-json-aqui')
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  assert.equal(idx.get('/x', 'y'), null)
  idx.set('/x', 'y', { preview: 'ok', msgCount: 1, mtime: 1, size: 1 })
  assert.equal(idx.get('/x', 'y').preview, 'ok')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('set con cwd o sessionId vacíos no hace nada', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  idx.set('', 'sid', { preview: 'x', msgCount: 1, mtime: 1, size: 1 })
  idx.set('/cwd', '', { preview: 'x', msgCount: 1, mtime: 1, size: 1 })
  assert.equal(idx.get('', 'sid'), null)
  assert.equal(idx.get('/cwd', ''), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('clear vacía todo el índice', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  idx.set('/p', 's', { preview: 'a', msgCount: 1, mtime: 1, size: 1 })
  idx.clear()
  assert.equal(idx.get('/p', 's'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('escritura es atómica (no deja .tmp huérfanos)', () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  idx.set('/p', 's', { preview: 'a', msgCount: 1, mtime: 1, size: 1 })
  idx.flush() // PERF-H7
  const files = fs.readdirSync(dir)
  const tmps = files.filter((f) => f.includes('.tmp.'))
  assert.equal(tmps.length, 0)
  assert.ok(files.includes('claude-sessions-index.json'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('PERF-H7: muchos set() consecutivos hacen un único write (debounce)', async () => {
  const dir = tmpUserData()
  const idx = createClaudeSessionsIndex({ userDataDir: dir })
  for (let i = 0; i < 100; i++) {
    idx.set('/p', `s${i}`, { preview: `p${i}`, msgCount: i, mtime: i, size: i })
  }
  // Antes del flush, el archivo puede no existir todavía (debounce 250ms).
  // Tras flush, debe estar.
  idx.flush()
  const files = fs.readdirSync(dir)
  assert.ok(files.includes('claude-sessions-index.json'))
  const data = JSON.parse(fs.readFileSync(require('path').join(dir, 'claude-sessions-index.json'), 'utf-8'))
  assert.equal(Object.keys(data['/p']).length, 100)
  fs.rmSync(dir, { recursive: true, force: true })
})
