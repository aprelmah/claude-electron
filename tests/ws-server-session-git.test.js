'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { WebSocket } = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createLanWsServer } = require(path.join(REPO_ROOT, 'main', 'ws-server.js'))
const ptyModule = require('node-pty')

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
}

// PTY falso: captura los argumentos de spawn (incluido el cwd) sin lanzar
// procesos reales. Devuelve el mínimo que usa ws-server (onData/onExit/…).
function installFakePty(capturedSpawns) {
  const original = ptyModule.spawn
  ptyModule.spawn = (file, args, opts) => {
    capturedSpawns.push({ file, args, opts })
    return {
      _alive: true,
      _exited: false,
      onData() { return { dispose() {} } },
      onExit() { return { dispose() {} } },
      write() {},
      resize() {},
      kill() {}
    }
  }
  return () => { ptyModule.spawn = original }
}

// sessionGit falso: registra llamadas y devuelve un workspace con workCwd temporal.
function makeFakeSessionGit(workCwd, { prepareReturnsNull = false } = {}) {
  const calls = { prepare: 0, finalize: 0, copy: 0, finalized: [] }
  return {
    calls,
    async prepareSessionWorkspace({ realCwd }) {
      calls.prepare += 1
      if (prepareReturnsNull) return null
      return {
        key: 'k-test',
        realCwd,
        branch: 'poweragent/session-test',
        worktreePath: workCwd,
        workCwd
      }
    },
    async finalizeSessionWorkspace(ws) {
      calls.finalize += 1
      return { outcome: 'merged', branch: ws.branch }
    },
    copySessionsHome() {
      calls.copy += 1
      return []
    }
  }
}

function makeFakeSessionGitMap(calls) {
  return {
    recordActive() {},
    markFinalized(id) { calls.finalized.push(id) }
  }
}

function buildServer({ clientHtmlPath, cwd, sessionGit, sessionGitMap }) {
  return createLanWsServer({
    clientHtmlPath,
    sessionLockTimeoutMs: 9000,
    sessionLockSweepMs: 1000,
    listReusableSessions: () => ([
      { id: 'git-session-1', preview: 'Sesión Git', mtime: Date.now() - 1000, size: 1200, msgCount: 40 }
    ]),
    getSessionConfig: () => ({
      cli: 'claude',
      cwd,
      bin: process.execPath,
      env: { ...process.env },
      args: [],
      mode: 'enterprise',
      enterpriseEnabled: true,
      allowedRoots: [cwd],
      readOnlyRoots: [],
      allowedMcpServers: [],
      permissions: {
        'pty.execute': true,
        'fs.list': true,
        'fs.read': true,
        'fs.write': true,
        'fs.delete': false,
        'fs.rename': false,
        'viewer.open': true,
        'automations.manage': false
      }
    }),
    logger: () => {},
    ...(sessionGit ? { sessionGit } : {}),
    ...(sessionGitMap ? { sessionGitMap } : {})
  })
}

function attachMessageBuffer(ws) {
  if (ws.__msgBuffer) return ws.__msgBuffer
  const buffer = []
  const waiters = []
  function flushWaiters() {
    if (!waiters.length || !buffer.length) return
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i]
      const idx = buffer.findIndex((msg) => {
        try { return waiter.predicate(msg) } catch { return false }
      })
      if (idx >= 0) {
        const [match] = buffer.splice(idx, 1)
        waiters.splice(i, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(match)
      }
    }
  }
  ws.on('message', (raw) => {
    let msg = null
    try { msg = JSON.parse(String(raw || '')) } catch { return }
    buffer.push(msg)
    flushWaiters()
  })
  ws.__msgBuffer = { buffer, waiters, flushWaiters }
  return ws.__msgBuffer
}

function waitForMessage(ws, predicate, timeoutMs = 12000, label = '') {
  const ctx = attachMessageBuffer(ws)
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject, timer: null }
    waiter.timer = setTimeout(() => {
      const idx = ctx.waiters.indexOf(waiter)
      if (idx >= 0) ctx.waiters.splice(idx, 1)
      reject(new Error(`Timeout esperando mensaje WS${label ? ` (${label})` : ''}`))
    }, timeoutMs)
    ctx.waiters.push(waiter)
    ctx.flushWaiters()
  })
}

async function openWs(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  attachMessageBuffer(ws)
  return ws
}

async function requestSessionStart(ws, requestId, sessionId, extras = {}) {
  ws.send(JSON.stringify({ type: 'session:start', requestId, sessionId, ...extras }))
  return waitForMessage(ws, (msg) => msg.type === 'session:start' && msg.requestId === requestId, 12000, requestId)
}

function makeFixture(prefix) {
  const base = mkTmpDir(prefix)
  const cwd = path.join(base, 'project')
  fs.mkdirSync(cwd, { recursive: true })
  const clientHtmlPath = path.join(base, 'client.html')
  fs.writeFileSync(clientHtmlPath, '<!doctype html><title>test</title>', 'utf8')
  return { base, cwd, clientHtmlPath }
}

async function tryStart(server, port, clientHtmlPath, t) {
  try {
    await server.start({ port, clientHtmlPath })
    return true
  } catch (err) {
    if (err && err.code === 'EPERM') {
      t.skip('Entorno sin permisos para abrir socket local (sandbox).')
      return false
    }
    throw err
  }
}

test('LAN + sessionGit: el PTY se spawnea con el workCwd del workspace', async (t) => {
  const { cwd, clientHtmlPath } = makeFixture('ws-git-spawn')
  const workCwd = mkTmpDir('ws-git-worktree')
  const capturedSpawns = []
  const restorePty = installFakePty(capturedSpawns)
  const sessionGit = makeFakeSessionGit(workCwd)

  const port = 16900 + Math.floor(Math.random() * 200)
  const server = buildServer({ clientHtmlPath, cwd, sessionGit })
  try {
    if (!(await tryStart(server, port, clientHtmlPath, t))) { restorePty(); return }
  } catch (err) {
    restorePty()
    throw err
  }

  try {
    const ws = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cli-git`)
    const start = await requestSessionStart(ws, 'g-start-1', 'git-session-1')
    assert.equal(start.ok, true)
    await waitForMessage(ws, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'connected')

    assert.equal(sessionGit.calls.prepare, 1, 'prepareSessionWorkspace debe llamarse una vez')
    assert.equal(capturedSpawns.length, 1, 'debe spawnearse un PTY')
    assert.equal(capturedSpawns[0].opts.cwd, workCwd, 'el PTY usa el workCwd del workspace')

    ws.close()
  } finally {
    restorePty()
    await server.stop()
  }
})

test('LAN + sessionGit: closeSession finaliza el workspace exactamente una vez', async (t) => {
  const { cwd, clientHtmlPath } = makeFixture('ws-git-finalize')
  const workCwd = mkTmpDir('ws-git-worktree2')
  const capturedSpawns = []
  const restorePty = installFakePty(capturedSpawns)
  const sessionGit = makeFakeSessionGit(workCwd)
  const sessionGitMap = makeFakeSessionGitMap(sessionGit.calls)

  const port = 17200 + Math.floor(Math.random() * 200)
  const server = buildServer({ clientHtmlPath, cwd, sessionGit, sessionGitMap })
  try {
    if (!(await tryStart(server, port, clientHtmlPath, t))) { restorePty(); return }
  } catch (err) {
    restorePty()
    throw err
  }

  try {
    const ws = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cli-git-2`)
    const start = await requestSessionStart(ws, 'g-start-2', 'git-session-1')
    assert.equal(start.ok, true)
    await waitForMessage(ws, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'connected')
    assert.equal(sessionGit.calls.prepare, 1)

    // Cierre del cliente → closeSession en el servidor → finalize (fire-and-forget).
    ws.close()
    // Esperar a que el finalize asíncrono complete.
    const started = Date.now()
    while (sessionGit.calls.finalize < 1 && Date.now() - started < 5000) {
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.equal(sessionGit.calls.finalize, 1, 'finalize se llama una vez tras cerrar la sesión')

    // server.stop() → closeAllSessions: la sesión ya no existe → no re-finaliza.
    await server.stop()
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(sessionGit.calls.finalize, 1, 'finalize NO se repite (doble teardown → una sola vez)')
  } finally {
    restorePty()
    try { await server.stop() } catch {}
  }
})

test('LAN sin sessionGit: comportamiento idéntico, el PTY usa el cwd real', async (t) => {
  const { cwd, clientHtmlPath } = makeFixture('ws-git-none')
  const capturedSpawns = []
  const restorePty = installFakePty(capturedSpawns)

  const port = 17500 + Math.floor(Math.random() * 200)
  const server = buildServer({ clientHtmlPath, cwd }) // sin sessionGit
  try {
    if (!(await tryStart(server, port, clientHtmlPath, t))) { restorePty(); return }
  } catch (err) {
    restorePty()
    throw err
  }

  try {
    const ws = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cli-nogit`)
    const start = await requestSessionStart(ws, 'n-start-1', 'git-session-1')
    assert.equal(start.ok, true)
    await waitForMessage(ws, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'connected')

    assert.equal(capturedSpawns.length, 1)
    assert.equal(capturedSpawns[0].opts.cwd, cwd, 'sin sessionGit el PTY usa el cwd real de la sesión')

    ws.close()
  } finally {
    restorePty()
    await server.stop()
  }
})
