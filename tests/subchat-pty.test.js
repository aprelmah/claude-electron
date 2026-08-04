'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { createSubchatManager } = require('../main/subchat-pty')

function makeFakePty() {
  const state = { written: [], resized: null, killed: false, onDataCb: null, onExitCb: null }
  const proc = {
    write: (d) => state.written.push(d),
    resize: (c, r) => { state.resized = { cols: c, rows: r } },
    kill: () => { state.killed = true },
    onData: (cb) => { state.onDataCb = cb },
    onExit: (cb) => { state.onExitCb = cb }
  }
  return { proc, state }
}

function makeSession({ cli = 'claude', sid = 'abc-123', workCwd = '/wt', wcId = 7 } = {}) {
  const sends = []
  return {
    sends,
    session: {
      wcId,
      activeCli: cli,
      claudeSessionId: sid,
      cwd: '/real',
      gitWorkspace: workCwd ? { workCwd, realCwd: '/real', branch: 'b', worktreePath: workCwd } : null,
      win: { isDestroyed: () => false, webContents: { send: (ch, p) => sends.push({ ch, p }) } }
    }
  }
}

function makeManager(overrides = {}) {
  const spawns = []
  const fake = makeFakePty()
  const mgr = createSubchatManager({
    ptySpawn: (file, argv, opts) => { spawns.push({ file, argv, opts }); return fake.proc },
    ensureCliAvailable: () => ({ ok: true, bin: '/usr/local/bin/claude', env: { PATH: '/x' }, name: 'Claude' }),
    buildFdLimitCommand: (bin, args) => `${bin} ${args.join(' ')}`,
    getClaudeModel: () => 'opus',
    ...overrides
  })
  return { mgr, spawns, fake }
}

describe('subchat-pty: validaciones canStart', () => {
  test('rechaza codex', () => {
    const { mgr } = makeManager()
    const { session } = makeSession({ cli: 'codex' })
    const r = mgr.canStart(session)
    assert.equal(r.ok, false)
    assert.match(r.reason, /claude/i)
  })

  test('rechaza sin claudeSessionId', () => {
    const { mgr } = makeManager()
    const { session } = makeSession({ sid: null })
    const r = mgr.canStart(session)
    assert.equal(r.ok, false)
    assert.match(r.reason, /contexto/i)
  })

  test('rechaza si ya hay sub-chat vivo en la ventana', () => {
    const { mgr } = makeManager()
    const { session } = makeSession()
    assert.equal(mgr.start(session, { cols: 80, rows: 24 }).ok, true)
    const r = mgr.canStart(session)
    assert.equal(r.ok, false)
    assert.match(r.reason, /abierto/i)
  })

  test('acepta claude con sessionId y sin sub-chat previo', () => {
    const { mgr } = makeManager()
    const { session } = makeSession()
    assert.deepEqual(mgr.canStart(session), { ok: true })
  })
})

describe('subchat-pty: spawn del fork', () => {
  test('args exactos: --model, --resume <sid>, --fork-session; cwd = workCwd', () => {
    const { mgr, spawns } = makeManager()
    const { session } = makeSession()
    const r = mgr.start(session, { cols: 100, rows: 30 })
    assert.equal(r.ok, true)
    assert.equal(spawns.length, 1)
    const { file, argv, opts } = spawns[0]
    assert.equal(file, '/bin/bash')
    assert.equal(argv[0], '-c')
    assert.equal(argv[1], '/usr/local/bin/claude --model opus --resume abc-123 --fork-session')
    assert.equal(opts.cwd, '/wt')
    assert.equal(opts.cols, 100)
    assert.equal(opts.rows, 30)
  })

  test('sin gitWorkspace usa session.cwd', () => {
    const { mgr, spawns } = makeManager()
    const { session } = makeSession({ workCwd: null })
    mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(spawns[0].opts.cwd, '/real')
  })

  test('CLI no disponible → { ok:false, error }, sin spawn', () => {
    const { mgr, spawns } = makeManager({
      ensureCliAvailable: () => ({ ok: false, error: 'claude no encontrado' })
    })
    const { session } = makeSession()
    const r = mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(r.ok, false)
    assert.match(r.error, /no encontrado/)
    assert.equal(spawns.length, 0)
  })

  test('ptySpawn lanza → { ok:false, error } y no queda registrado', () => {
    const { mgr } = makeManager({ ptySpawn: () => { throw new Error('boom') } })
    const { session } = makeSession()
    const r = mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(r.ok, false)
    assert.equal(mgr.has(7), false)
  })
})

describe('subchat-pty: write / resize / data / exit / close', () => {
  test('write y resize llegan al pty del sub-chat', () => {
    const { mgr, fake } = makeManager()
    const { session } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    mgr.write(7, 'hola')
    mgr.resize(7, 90, 40)
    assert.deepEqual(fake.state.written, ['hola'])
    assert.deepEqual(fake.state.resized, { cols: 90, rows: 40 })
  })

  test('write devuelve si el texto llegó de verdad al PTY', () => {
    const { mgr, fake } = makeManager()
    const { session } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    assert.strictEqual(mgr.write(7, 'hola'), true)
    // Sin sub-chat en esa ventana no hay a dónde escribir.
    assert.strictEqual(mgr.write(99, 'hola'), false)
    // EPIPE: el proceso ha muerto pero la entrada sigue marcada viva. Antes se
    // tragaba el error sin devolver nada y quien esperaba respuesta (el modo
    // voz) daba el turno por enviado y se quedaba 180 s en silencio.
    fake.proc.write = () => { throw new Error('EPIPE') }
    assert.strictEqual(mgr.write(7, 'hola'), false)
  })

  test('onData del pty → subchat:data al webContents (flush por bytes)', () => {
    const { mgr, fake } = makeManager()
    const { session, sends } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    fake.state.onDataCb('x'.repeat(9000)) // > 8KB → flush inmediato del batcher
    const dataMsgs = sends.filter((m) => m.ch === 'subchat:data')
    assert.equal(dataMsgs.length, 1)
    assert.equal(dataMsgs[0].p, 'x'.repeat(9000))
  })

  test('exit del pty → subchat:exit y limpieza del registro', () => {
    const { mgr, fake } = makeManager()
    const { session, sends } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    fake.state.onExitCb({ exitCode: 0 })
    const exits = sends.filter((m) => m.ch === 'subchat:exit')
    assert.equal(exits.length, 1)
    assert.equal(exits[0].p.code, 0)
    assert.equal(mgr.has(7), false)
  })

  test('close mata el pty, limpia y devuelve true; segundo close devuelve false', () => {
    const { mgr, fake } = makeManager()
    const { session } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(mgr.close(7, 'test'), true)
    assert.equal(fake.state.killed, true)
    assert.equal(mgr.has(7), false)
    assert.equal(mgr.close(7), false)
  })

  test('data después de close no se envía', () => {
    const { mgr, fake } = makeManager()
    const { session, sends } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    mgr.close(7)
    const before = sends.length
    fake.state.onDataCb('tarde')
    assert.equal(sends.length, before)
  })

  test("close(wcId, 'parent-pty-closed') avisa al renderer con subchat:exit", () => {
    const { mgr } = makeManager()
    const { session, sends } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(mgr.close(7, 'parent-pty-closed'), true)
    const exits = sends.filter((m) => m.ch === 'subchat:exit')
    assert.equal(exits.length, 1)
    assert.deepEqual(exits[0].p, { code: null, reason: 'parent-pty-closed' })
  })

  test("close(wcId, 'renderer') NO emite subchat:exit (el renderer ya lo sabe)", () => {
    const { mgr } = makeManager()
    const { session, sends } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(mgr.close(7, 'renderer'), true)
    const exits = sends.filter((m) => m.ch === 'subchat:exit')
    assert.equal(exits.length, 0)
  })

  test('closeAll cierra todos los sub-chats vivos', () => {
    const { mgr } = makeManager()
    const a = makeSession({ wcId: 1 })
    const b = makeSession({ wcId: 2 })
    mgr.start(a.session, { cols: 80, rows: 24 })
    mgr.start(b.session, { cols: 80, rows: 24 })
    mgr.closeAll()
    assert.equal(mgr.has(1), false)
    assert.equal(mgr.has(2), false)
  })
})

describe('subchat-pty: deps obligatorias', () => {
  test('lanza si falta ptySpawn o ensureCliAvailable', () => {
    assert.throws(() => createSubchatManager({}))
  })
})
