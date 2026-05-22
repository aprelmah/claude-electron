'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const { createInbox, buildSummary } = require('../main/tasks-inbox')

function mkTmpDir() {
  const dir = path.join(os.tmpdir(), 'tasks-inbox-test-' + crypto.randomUUID())
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

function makeItem(overrides = {}) {
  return {
    runId: overrides.runId || crypto.randomUUID(),
    taskId: overrides.taskId || 'task-1',
    taskName: overrides.taskName || 'Tarea de prueba',
    cli: overrides.cli || 'claude',
    sessionId: overrides.sessionId || null,
    cwd: overrides.cwd || '/tmp/proj',
    finishedAt: overrides.finishedAt || new Date().toISOString(),
    output: overrides.output != null ? overrides.output : 'salida estándar'
  }
}

test('buildSummary trunca a 240 con elipsis', () => {
  const longText = 'x'.repeat(500)
  const s = buildSummary(longText)
  assert.strictEqual(s.length, 240)
  assert.ok(s.endsWith('…'))
})

test('buildSummary devuelve cadena vacía con input vacío', () => {
  assert.strictEqual(buildSummary(''), '')
  assert.strictEqual(buildSummary(null), '')
})

test('appendUnread + list ordena por finishedAt descendente', () => {
  const dir = mkTmpDir()
  try {
    const inbox = createInbox({ userDataDir: dir })
    inbox.appendUnread(makeItem({ runId: 'a', finishedAt: '2026-01-01T10:00:00Z' }))
    inbox.appendUnread(makeItem({ runId: 'b', finishedAt: '2026-01-03T10:00:00Z' }))
    inbox.appendUnread(makeItem({ runId: 'c', finishedAt: '2026-01-02T10:00:00Z' }))
    const items = inbox.list()
    assert.strictEqual(items.length, 3)
    assert.deepStrictEqual(items.map(it => it.runId), ['b', 'c', 'a'])
  } finally {
    cleanup(dir)
  }
})

test('markRead y count({unreadOnly:true})', () => {
  const dir = mkTmpDir()
  try {
    const inbox = createInbox({ userDataDir: dir })
    inbox.appendUnread(makeItem({ runId: 'r1' }))
    inbox.appendUnread(makeItem({ runId: 'r2' }))
    inbox.appendUnread(makeItem({ runId: 'r3' }))
    assert.strictEqual(inbox.count({ unreadOnly: true }), 3)
    assert.strictEqual(inbox.markRead('r2'), true)
    assert.strictEqual(inbox.count({ unreadOnly: true }), 2)
    const it = inbox.getById('r2')
    assert.strictEqual(it.read, true)
    assert.ok(it.readAt)
  } finally {
    cleanup(dir)
  }
})

test('markAllRead pone read=true a todos', () => {
  const dir = mkTmpDir()
  try {
    const inbox = createInbox({ userDataDir: dir })
    inbox.appendUnread(makeItem({ runId: 'a' }))
    inbox.appendUnread(makeItem({ runId: 'b' }))
    inbox.markAllRead()
    assert.strictEqual(inbox.count({ unreadOnly: true }), 0)
    assert.strictEqual(inbox.count({ unreadOnly: false }), 2)
  } finally {
    cleanup(dir)
  }
})

test('list({unreadOnly:true}) filtra los leídos', () => {
  const dir = mkTmpDir()
  try {
    const inbox = createInbox({ userDataDir: dir })
    inbox.appendUnread(makeItem({ runId: 'a', finishedAt: '2026-01-01T00:00:00Z' }))
    inbox.appendUnread(makeItem({ runId: 'b', finishedAt: '2026-01-02T00:00:00Z' }))
    inbox.markRead('a')
    const items = inbox.list({ unreadOnly: true })
    assert.strictEqual(items.length, 1)
    assert.strictEqual(items[0].runId, 'b')
  } finally {
    cleanup(dir)
  }
})

test('cap descarta los leídos antiguos primero', () => {
  const dir = mkTmpDir()
  try {
    const inbox = createInbox({ userDataDir: dir, __maxItems: 3 })
    inbox.appendUnread(makeItem({ runId: 'r1', finishedAt: '2026-01-01T00:00:00Z' }))
    inbox.appendUnread(makeItem({ runId: 'r2', finishedAt: '2026-01-02T00:00:00Z' }))
    inbox.appendUnread(makeItem({ runId: 'r3', finishedAt: '2026-01-03T00:00:00Z' }))
    inbox.markRead('r1')
    inbox.markRead('r2')
    inbox.appendUnread(makeItem({ runId: 'r4', finishedAt: '2026-01-04T00:00:00Z' }))
    const ids = inbox.list({ limit: 10 }).map(it => it.runId).sort()
    // El más antiguo leído (r1) debe haberse eliminado
    assert.deepStrictEqual(ids, ['r2', 'r3', 'r4'])
  } finally {
    cleanup(dir)
  }
})

test('cap descarta no leídos cuando no quedan leídos antiguos', () => {
  const dir = mkTmpDir()
  try {
    const inbox = createInbox({ userDataDir: dir, __maxItems: 2 })
    inbox.appendUnread(makeItem({ runId: 'a', finishedAt: '2026-01-01T00:00:00Z' }))
    inbox.appendUnread(makeItem({ runId: 'b', finishedAt: '2026-01-02T00:00:00Z' }))
    inbox.appendUnread(makeItem({ runId: 'c', finishedAt: '2026-01-03T00:00:00Z' }))
    const ids = inbox.list({ limit: 10 }).map(it => it.runId).sort()
    assert.deepStrictEqual(ids, ['b', 'c'])
  } finally {
    cleanup(dir)
  }
})

test('escritura atómica: recargar inbox tras append da los mismos datos', () => {
  const dir = mkTmpDir()
  try {
    const inbox1 = createInbox({ userDataDir: dir })
    inbox1.appendUnread(makeItem({ runId: 'x1', taskName: 'Diario', output: 'hola mundo' }))
    inbox1.appendUnread(makeItem({ runId: 'x2', taskName: 'Noche', output: 'foo bar' }))
    const inbox2 = createInbox({ userDataDir: dir })
    const items = inbox2.list().sort((a, b) => a.runId.localeCompare(b.runId))
    assert.strictEqual(items.length, 2)
    assert.strictEqual(items[0].runId, 'x1')
    assert.strictEqual(items[0].taskName, 'Diario')
    assert.strictEqual(items[0].summary, 'hola mundo')
    assert.strictEqual(items[1].output, 'foo bar')
  } finally {
    cleanup(dir)
  }
})

test('appendUnread normaliza campos y rellena cwd con homedir si vacío', () => {
  const dir = mkTmpDir()
  try {
    const inbox = createInbox({ userDataDir: dir })
    const item = inbox.appendUnread({
      runId: 'r1',
      taskId: 't1',
      taskName: 'X',
      cli: 'unknown',
      output: 'salida'
    })
    assert.strictEqual(item.cli, 'claude')
    assert.strictEqual(item.cwd, os.homedir())
    assert.strictEqual(item.status, 'ok')
    assert.strictEqual(item.read, false)
    assert.strictEqual(item.readAt, null)
  } finally {
    cleanup(dir)
  }
})

test('appendUnread sin runId lanza', () => {
  const dir = mkTmpDir()
  try {
    const inbox = createInbox({ userDataDir: dir })
    assert.throws(() => inbox.appendUnread({ taskId: 't', output: 'x' }), /runId/)
  } finally {
    cleanup(dir)
  }
})
