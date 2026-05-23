// Verifica que TaskScheduler.runNow guarda sessionId del executor en el run,
// y que sinks.inbox lo recibe en run.sessionId (cabo 1 — handoff sesión-tarea).

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const TaskScheduler = require(path.join(REPO_ROOT, 'scheduler', 'index.js'))
const { createInboxSink } = require(path.join(REPO_ROOT, 'scheduler', 'sinks.js'))

function makePersistence(tasks = []) {
  const taskMap = new Map(tasks.map(t => [t.id, { ...t }]))
  const runs = []
  return {
    loadTasks: async () => Array.from(taskMap.values()),
    getTask: async (id) => taskMap.get(id) || null,
    updateTask: async (id, patch) => {
      const cur = taskMap.get(id) || {}
      const next = { ...cur, ...patch, id }
      taskMap.set(id, next)
      return next
    },
    upsertTask: async (t) => { taskMap.set(t.id, t); return t },
    deleteTask: async (id) => taskMap.delete(id),
    appendRun: async (r) => { runs.push(r) },
    _taskMap: taskMap,
    _runs: runs
  }
}

function fakeInbox() {
  const items = []
  return {
    appendUnread: (item) => { items.push(item) },
    count: () => items.filter(i => !i.read).length,
    _items: items
  }
}

describe('TaskScheduler.runNow — sessionId en run y sinks', () => {
  test('run guarda result.sessionId aunque task.resume === false', async () => {
    const task = {
      id: 't1', name: 'demo', cli: 'claude', cron: '* * * * *',
      enabled: true, resume: false, sessionId: null, cwd: '/tmp', sinks: {}
    }
    const persistence = makePersistence([task])
    const sessionIdGenerated = '11111111-2222-3333-4444-555555555555'
    const executor = async () => ({ output: 'hola', sessionId: sessionIdGenerated })
    const scheduler = new TaskScheduler({ executor, persistence, sinks: {}, broadcast: () => {} })
    const res = await scheduler.runNow('t1')
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.status, 'ok')
    const runs = persistence._runs
    assert.strictEqual(runs.length, 1)
    assert.strictEqual(runs[0].sessionId, sessionIdGenerated)
    assert.strictEqual(runs[0].cwd, '/tmp')
    // Si resume === false, NO se actualiza task.sessionId
    assert.strictEqual(persistence._taskMap.get('t1').sessionId, null)
  })

  test('run con resume=true SÍ actualiza task.sessionId', async () => {
    const task = {
      id: 't2', name: 'demo2', cli: 'claude', cron: '* * * * *',
      enabled: true, resume: true, sessionId: null, cwd: '/tmp', sinks: {}
    }
    const persistence = makePersistence([task])
    const sid = '99999999-aaaa-bbbb-cccc-dddddddddddd'
    const executor = async () => ({ output: 'ok', sessionId: sid })
    const scheduler = new TaskScheduler({ executor, persistence, sinks: {}, broadcast: () => {} })
    await scheduler.runNow('t2')
    assert.strictEqual(persistence._taskMap.get('t2').sessionId, sid)
    assert.strictEqual(persistence._runs[0].sessionId, sid)
  })

  test('inbox sink recibe run.sessionId cuando task.sessionId está vacío', async () => {
    const task = {
      id: 't3', name: 'demo3', cli: 'claude', cron: '* * * * *',
      enabled: true, resume: false, sessionId: null, cwd: '/tmp', sinks: { inbox: true }
    }
    const persistence = makePersistence([task])
    const inbox = fakeInbox()
    const inboxSink = createInboxSink({ inbox, broadcast: () => {} })
    const sid = 'aaaaaaaa-1111-2222-3333-444444444444'
    const executor = async () => ({ output: 'log', sessionId: sid })
    const scheduler = new TaskScheduler({
      executor, persistence, sinks: { inbox: inboxSink }, broadcast: () => {}
    })
    await scheduler.runNow('t3')
    assert.strictEqual(inbox._items.length, 1)
    assert.strictEqual(inbox._items[0].sessionId, sid)
    assert.strictEqual(inbox._items[0].cli, 'claude')
  })

  test('run sin sessionId del executor → run.sessionId es null', async () => {
    const task = {
      id: 't4', name: 'demo4', cli: 'claude', cron: '* * * * *',
      enabled: true, resume: false, sessionId: null, cwd: '/tmp', sinks: {}
    }
    const persistence = makePersistence([task])
    const executor = async () => ({ output: 'sin sid' })
    const scheduler = new TaskScheduler({ executor, persistence, sinks: {}, broadcast: () => {} })
    await scheduler.runNow('t4')
    assert.strictEqual(persistence._runs[0].sessionId, null)
  })
})
