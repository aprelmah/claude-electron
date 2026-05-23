'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createTelegramHiddenPtyPool } = require(path.join(REPO_ROOT, 'main', 'telegram-hidden-pty-pool.js'))

function makeFakeWin(id) {
  let destroyed = false
  return {
    webContents: { id },
    isDestroyed: () => destroyed,
    isMinimized: () => false,
    restore: () => {},
    show: () => {},
    focus: () => {},
    close: () => { destroyed = true },
    _markDestroyed: () => { destroyed = true }
  }
}

function makeHarness(opts = {}) {
  const wins = new Map()      // wcId → fake win
  const states = new Map()    // wcId → fake state
  const ptyStarts = []
  const closes = []
  const binds = []
  const unbinds = []
  const logs = []
  const timers = []
  const events = []

  let nextWcId = opts.startWcId || 100
  const fakeNow = { value: opts.startNow || 1_000_000 }
  const fakeSetInterval = (fn, ms) => {
    const handle = { fn, ms, cleared: false, unref: () => {} }
    timers.push(handle)
    return handle
  }
  const fakeClearInterval = (handle) => {
    if (handle) handle.cleared = true
  }

  const pool = createTelegramHiddenPtyPool({
    openWindow: opts.openWindow || (async ({ sessionId, cli, cwd, taskName, hidden }) => {
      events.push({ type: 'openWindow', sessionId, cli, cwd, taskName, hidden })
      const wcId = nextWcId++
      const win = makeFakeWin(wcId)
      wins.set(wcId, win)
      states.set(wcId, {
        wcId,
        win,
        sessionId,
        cli,
        activeCli: cli,
        claudeSessionId: cli === 'claude' ? sessionId : null,
        codexSessionId: cli === 'codex' ? sessionId : null,
        cwd,
        taskName,
        hidden,
        pty: null,
        relayActive: false
      })
      return win
    }),
    startPty: opts.startPty || ((state) => {
      ptyStarts.push({ wcId: state.wcId, sessionId: state.sessionId })
      state.pty = { _alive: true, kill: () => {} }
      return state.pty
    }),
    getTaskState: (wcId) => states.get(wcId) || null,
    closeWindow: (wcId, reason) => {
      closes.push({ wcId, reason })
      const win = wins.get(wcId)
      if (win) win._markDestroyed()
      states.delete(wcId)
      wins.delete(wcId)
    },
    bindRelay: (chatId, wcId) => { binds.push({ chatId: String(chatId), wcId }) },
    unbindRelay: (chatId, wcId) => { unbinds.push({ chatId: String(chatId), wcId }) },
    log: (event, data) => { logs.push({ event, data }) },
    getNow: () => fakeNow.value,
    setIntervalFn: fakeSetInterval,
    clearIntervalFn: fakeClearInterval,
    ttlMs: opts.ttlMs,
    maxSize: opts.maxSize,
    sweepMs: opts.sweepMs
  })

  return { pool, wins, states, ptyStarts, closes, binds, unbinds, logs, timers, events, fakeNow }
}

describe('telegram-hidden-pty-pool: ensureHiddenPtyForChat', () => {
  test('spawnea ventana oculta y registra binding para el chatId', async () => {
    const h = makeHarness()
    const res = await h.pool.ensureHiddenPtyForChat({
      chatId: '999',
      sessionId: 'sid-abc',
      cli: 'claude',
      cwd: '/tmp/proj',
      taskName: 'Test'
    })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.reused, false)
    assert.ok(res.wcId)
    assert.strictEqual(h.events[0].hidden, true)
    assert.strictEqual(h.ptyStarts.length, 1)
    assert.deepStrictEqual(h.binds, [{ chatId: '999', wcId: res.wcId }])
  })

  test('reusa la entry si chatId+sessionId+cli coinciden', async () => {
    const h = makeHarness()
    const first = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-1', cli: 'claude' })
    h.fakeNow.value += 5000
    const second = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-1', cli: 'claude' })
    assert.strictEqual(second.wcId, first.wcId)
    assert.strictEqual(second.reused, true)
    assert.strictEqual(h.events.length, 1)
    assert.strictEqual(h.ptyStarts.length, 1)
    const entry = h.pool.getHiddenPtyForChat('1')
    assert.strictEqual(entry.ts, h.fakeNow.value)
  })

  test('reusa la entry y re-enlaza chat->wcId (idempotente)', async () => {
    const h = makeHarness()
    const first = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-1', cli: 'claude' })
    const second = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-1', cli: 'claude' })
    assert.strictEqual(second.reused, true)
    assert.deepStrictEqual(h.binds, [
      { chatId: '1', wcId: first.wcId },
      { chatId: '1', wcId: first.wcId }
    ])
  })

  test('recrea si sessionId cambia para el mismo chatId', async () => {
    const h = makeHarness()
    const first = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-old', cli: 'claude' })
    const second = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-new', cli: 'claude' })
    assert.notStrictEqual(second.wcId, first.wcId)
    assert.strictEqual(h.closes.length, 1)
    assert.strictEqual(h.closes[0].wcId, first.wcId)
    assert.strictEqual(h.closes[0].reason, 'replace')
    assert.deepStrictEqual(h.unbinds, [{ chatId: '1', wcId: first.wcId }])
    assert.strictEqual(h.binds.length, 2)
  })

  test('valida chatId y sessionId', async () => {
    const h = makeHarness()
    const a = await h.pool.ensureHiddenPtyForChat({ chatId: '', sessionId: 'sid' })
    assert.strictEqual(a.ok, false)
    const b = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: '' })
    assert.strictEqual(b.ok, false)
  })

  test('falla limpio si openWindow falla', async () => {
    const h = makeHarness({
      openWindow: async () => { throw new Error('boom') }
    })
    const res = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid', cli: 'claude' })
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /openWindow falló/)
    assert.strictEqual(h.binds.length, 0)
  })

  test('falla limpio y cierra ventana si startPty falla', async () => {
    const h = makeHarness({
      startPty: () => { throw new Error('no pty') }
    })
    const res = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid', cli: 'claude' })
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /startPty falló/)
    assert.strictEqual(h.closes.length, 1)
    assert.strictEqual(h.closes[0].reason, 'pty-failed')
  })
})

describe('telegram-hidden-pty-pool: LRU + capacidad', () => {
  test('cuando se excede max, cierra la entry más antigua (LRU)', async () => {
    const h = makeHarness({ maxSize: 2 })
    await h.pool.ensureHiddenPtyForChat({ chatId: 'A', sessionId: 'sid-A', cli: 'claude' })
    h.fakeNow.value += 1000
    await h.pool.ensureHiddenPtyForChat({ chatId: 'B', sessionId: 'sid-B', cli: 'claude' })
    h.fakeNow.value += 1000
    // Tocar A → B queda como más viejo
    h.pool.touchHiddenPty('A')
    h.fakeNow.value += 1000
    await h.pool.ensureHiddenPtyForChat({ chatId: 'C', sessionId: 'sid-C', cli: 'claude' })
    const lruCloses = h.closes.filter(c => c.reason === 'lru')
    assert.strictEqual(lruCloses.length, 1, 'debe haber exactamente un close por lru')
    assert.strictEqual(h.pool.getHiddenPtyForChat('B'), null, 'B (LRU) debe estar fuera')
    assert.ok(h.pool.getHiddenPtyForChat('A'), 'A debe seguir (fue tocado)')
    assert.ok(h.pool.getHiddenPtyForChat('C'), 'C debe estar (recién creado)')
  })
})

describe('telegram-hidden-pty-pool: TTL + sweep', () => {
  test('sweep cierra entries expiradas y no las vivas', async () => {
    const h = makeHarness({ ttlMs: 10_000 })
    await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-1', cli: 'claude' })
    h.fakeNow.value += 5000
    await h.pool.ensureHiddenPtyForChat({ chatId: '2', sessionId: 'sid-2', cli: 'claude' })
    h.fakeNow.value += 11_000
    // Chat 2 lleva 11s, chat 1 lleva 16s. Toca 2 para que solo 1 expire.
    h.pool.touchHiddenPty('2')
    const closed = h.pool.sweep()
    assert.strictEqual(closed, 1)
    assert.strictEqual(h.pool.getHiddenPtyForChat('1'), null)
    assert.ok(h.pool.getHiddenPtyForChat('2'))
  })
})

describe('telegram-hidden-pty-pool: show/close/stats', () => {
  test('showHiddenPty marca touch y devuelve true', async () => {
    const h = makeHarness()
    const r = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid', cli: 'claude' })
    let showCalls = 0
    h.states.get(r.wcId).win.show = () => { showCalls++ }
    h.fakeNow.value += 3000
    const ok = h.pool.showHiddenPty('1')
    assert.strictEqual(ok, true)
    assert.strictEqual(showCalls, 1)
    const e = h.pool.getHiddenPtyForChat('1')
    assert.strictEqual(e.ts, h.fakeNow.value)
  })

  test('showHiddenPty devuelve false si ventana destruida', async () => {
    const h = makeHarness()
    const r = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid', cli: 'claude' })
    h.states.get(r.wcId).win._markDestroyed()
    const ok = h.pool.showHiddenPty('1')
    assert.strictEqual(ok, false)
    assert.strictEqual(h.pool.getHiddenPtyForChat('1'), null)
    assert.deepStrictEqual(h.unbinds, [{ chatId: '1', wcId: r.wcId }])
  })

  test('closeHiddenPty elimina entry y dispara unbind', async () => {
    const h = makeHarness()
    const r = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid', cli: 'claude' })
    const ok = h.pool.closeHiddenPty('1', 'manual')
    assert.strictEqual(ok, true)
    assert.strictEqual(h.pool.getHiddenPtyForChat('1'), null)
    assert.deepStrictEqual(h.unbinds, [{ chatId: '1', wcId: r.wcId }])
  })

  test('notifyWindowClosed limpia entry cuyo wcId coincide', async () => {
    const h = makeHarness()
    const r = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid', cli: 'claude' })
    const cleaned = h.pool.notifyWindowClosed(r.wcId)
    assert.strictEqual(cleaned, true)
    assert.strictEqual(h.pool.getHiddenPtyForChat('1'), null)
    assert.deepStrictEqual(h.unbinds, [{ chatId: '1', wcId: r.wcId }])
  })

  test('notifyWindowClosed limpia todas las entries si comparten wcId', async () => {
    const sharedWin = makeFakeWin(555)
    const h = makeHarness({
      openWindow: async ({ sessionId, cli, cwd, taskName, hidden }) => {
        h.events.push({ type: 'openWindow', sessionId, cli, cwd, taskName, hidden })
        h.wins.set(555, sharedWin)
        h.states.set(555, {
          wcId: 555,
          win: sharedWin,
          sessionId,
          cli,
          activeCli: cli,
          claudeSessionId: cli === 'claude' ? sessionId : null,
          codexSessionId: cli === 'codex' ? sessionId : null,
          cwd,
          taskName,
          hidden,
          pty: null,
          relayActive: false
        })
        return sharedWin
      }
    })
    await h.pool.ensureHiddenPtyForChat({ chatId: 'A', sessionId: 'sid', cli: 'claude' })
    await h.pool.ensureHiddenPtyForChat({ chatId: 'B', sessionId: 'sid', cli: 'claude' })
    const cleaned = h.pool.notifyWindowClosed(555)
    assert.strictEqual(cleaned, true)
    assert.strictEqual(h.pool.getHiddenPtyForChat('A'), null)
    assert.strictEqual(h.pool.getHiddenPtyForChat('B'), null)
    assert.deepStrictEqual(h.unbinds, [
      { chatId: 'A', wcId: 555 },
      { chatId: 'B', wcId: 555 }
    ])
  })

  test('notifySessionRotated actualiza sessionId en entries vivas del wcId', async () => {
    const h = makeHarness()
    const r = await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-old', cli: 'claude' })
    const updated = h.pool.notifySessionRotated(r.wcId, 'sid-new', 'claude')
    assert.strictEqual(updated, 1)
    const entry = h.pool.getHiddenPtyForChat('1')
    assert.strictEqual(entry.sessionId, 'sid-new')
    assert.strictEqual(entry.cli, 'claude')
  })

  test('notifySessionRotated no toca entries de otros wcId', async () => {
    const h = makeHarness()
    await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-1', cli: 'claude' })
    const updated = h.pool.notifySessionRotated(9999, 'sid-new', 'claude')
    assert.strictEqual(updated, 0)
    const entry = h.pool.getHiddenPtyForChat('1')
    assert.strictEqual(entry.sessionId, 'sid-1')
  })

  test('getStats devuelve count y métricas básicas', async () => {
    const h = makeHarness({ ttlMs: 60_000, maxSize: 5 })
    await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-1', cli: 'claude' })
    h.fakeNow.value += 7000
    await h.pool.ensureHiddenPtyForChat({ chatId: '2', sessionId: 'sid-2', cli: 'claude' })
    h.fakeNow.value += 2000
    const stats = h.pool.getStats()
    assert.strictEqual(stats.count, 2)
    assert.strictEqual(stats.ttlMs, 60_000)
    assert.strictEqual(stats.maxSize, 5)
    assert.ok(stats.oldestIdleMs >= 8000)
    assert.strictEqual(stats.byChat.length, 2)
  })

  test('destroy cierra todo y para sweep', async () => {
    const h = makeHarness({ sweepMs: 30_000 })
    await h.pool.ensureHiddenPtyForChat({ chatId: '1', sessionId: 'sid-1', cli: 'claude' })
    await h.pool.ensureHiddenPtyForChat({ chatId: '2', sessionId: 'sid-2', cli: 'claude' })
    h.pool.destroy('test')
    assert.strictEqual(h.pool.getStats().count, 0)
    assert.strictEqual(h.closes.length, 2)
    const cleared = h.timers.find(t => t.cleared)
    assert.ok(cleared, 'sweep timer debe estar cleared')
    // tras destroy, ensure devuelve error
    const res = await h.pool.ensureHiddenPtyForChat({ chatId: '3', sessionId: 'sid', cli: 'claude' })
    assert.strictEqual(res.ok, false)
    assert.match(res.error, /pool-destroyed/)
  })
})
