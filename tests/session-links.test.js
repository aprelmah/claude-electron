'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const { createSessionLinks } = require('../main/session-links')

function mkTmpDir() {
  const dir = path.join(os.tmpdir(), 'session-links-test-' + crypto.randomUUID())
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

function writeTasks(dir, tasks) {
  fs.writeFileSync(path.join(dir, 'scheduled-tasks.json'), JSON.stringify(tasks, null, 2), 'utf8')
}

function readTasks(dir) {
  const raw = fs.readFileSync(path.join(dir, 'scheduled-tasks.json'), 'utf8')
  return JSON.parse(raw)
}

test('getLinks devuelve task cuando la sessionId existe en una tarea', () => {
  const dir = mkTmpDir()
  try {
    writeTasks(dir, [
      { id: 't1', name: 'Diario', sessionId: 'abc', prompt: 'p', cron: '0 9 * * *', cli: 'claude' },
      { id: 't2', name: 'Otra', sessionId: 'xyz', prompt: 'p', cron: '0 9 * * *', cli: 'claude' }
    ])
    const sl = createSessionLinks({ userDataDir: dir })
    const links = sl.getLinks('abc')
    assert.deepStrictEqual(links.task, { id: 't1', name: 'Diario' })
    assert.strictEqual(links.telegram, null)
    assert.strictEqual(links.whatsapp, null)
    assert.strictEqual(sl.isLinked('abc'), true)
  } finally {
    cleanup(dir)
  }
})

test('getLinks devuelve nulls cuando la sessionId no existe', () => {
  const dir = mkTmpDir()
  try {
    writeTasks(dir, [
      { id: 't1', name: 'Diario', sessionId: 'abc', prompt: 'p', cron: '0 9 * * *', cli: 'claude' }
    ])
    const sl = createSessionLinks({ userDataDir: dir })
    const links = sl.getLinks('zzz')
    assert.strictEqual(links.task, null)
    assert.strictEqual(links.telegram, null)
    assert.strictEqual(links.whatsapp, null)
    assert.strictEqual(sl.isLinked('zzz'), false)
  } finally {
    cleanup(dir)
  }
})

test('clearTaskLink pone sessionId=null en la tarea', async () => {
  const dir = mkTmpDir()
  try {
    writeTasks(dir, [
      { id: 't1', name: 'Diario', sessionId: 'abc', prompt: 'p', cron: '0 9 * * *', cli: 'claude' },
      { id: 't2', name: 'Otra', sessionId: 'xyz', prompt: 'p', cron: '0 9 * * *', cli: 'claude' }
    ])
    const sl = createSessionLinks({ userDataDir: dir })
    const changed = await sl.clearTaskLink('abc')
    assert.strictEqual(changed, true)
    const tasks = readTasks(dir)
    const t1 = tasks.find(t => t.id === 't1')
    const t2 = tasks.find(t => t.id === 't2')
    assert.strictEqual(t1.sessionId, null)
    assert.strictEqual(t2.sessionId, 'xyz')
  } finally {
    cleanup(dir)
  }
})

test('clearTaskLink devuelve false si no había nada que limpiar', async () => {
  const dir = mkTmpDir()
  try {
    writeTasks(dir, [
      { id: 't1', name: 'Diario', sessionId: 'abc', prompt: 'p', cron: '0 9 * * *', cli: 'claude' }
    ])
    const sl = createSessionLinks({ userDataDir: dir })
    const changed = await sl.clearTaskLink('no-existe')
    assert.strictEqual(changed, false)
  } finally {
    cleanup(dir)
  }
})

test('getLinks devuelve telegram cuando el provider lo expone', () => {
  const dir = mkTmpDir()
  try {
    writeTasks(dir, [])
    const tgMap = new Map([['12345', 'sess-a'], ['67890', 'sess-b']])
    const sl = createSessionLinks({
      userDataDir: dir,
      getTelegramSessionsByChat: () => tgMap
    })
    const links = sl.getLinks('sess-b')
    assert.deepStrictEqual(links.telegram, { chatId: '67890' })
    assert.strictEqual(links.task, null)
  } finally {
    cleanup(dir)
  }
})

test('getLinks devuelve whatsapp cuando el provider lo expone (objeto plano)', () => {
  const dir = mkTmpDir()
  try {
    writeTasks(dir, [])
    const waObj = { 'jid-1@s.whatsapp.net': 'sess-w', 'jid-2@s.whatsapp.net': 'otra' }
    const sl = createSessionLinks({
      userDataDir: dir,
      getWhatsAppLinks: () => waObj
    })
    const links = sl.getLinks('sess-w')
    assert.deepStrictEqual(links.whatsapp, { jid: 'jid-1@s.whatsapp.net' })
  } finally {
    cleanup(dir)
  }
})

test('no falla si scheduled-tasks.json no existe', () => {
  const dir = mkTmpDir()
  try {
    const sl = createSessionLinks({ userDataDir: dir })
    const links = sl.getLinks('abc')
    assert.strictEqual(links.task, null)
  } finally {
    cleanup(dir)
  }
})
