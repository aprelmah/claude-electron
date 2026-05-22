'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { WebSocket } = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createLanWsServer } = require(path.join(REPO_ROOT, 'main', 'ws-server.js'))

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
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
  ws.on('close', () => {
    while (waiters.length) {
      const waiter = waiters.pop()
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Socket cerrado antes de recibir mensaje esperado'))
    }
  })
  ws.on('error', (err) => {
    while (waiters.length) {
      const waiter = waiters.pop()
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
  })
  ws.__msgBuffer = { buffer, waiters, flushWaiters }
  return ws.__msgBuffer
}

function waitForMessage(ws, predicate, timeoutMs = 15000, label = '') {
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

async function requestSessionList(ws, requestId) {
  ws.send(JSON.stringify({ type: 'session:list', requestId, forceRefresh: true }))
  return waitForMessage(ws, (msg) => msg.type === 'session:list' && msg.requestId === requestId, 12000, requestId)
}

async function requestSessionStart(ws, requestId, sessionId, extras = {}) {
  ws.send(JSON.stringify({ type: 'session:start', requestId, sessionId, ...extras }))
  return waitForMessage(ws, (msg) => msg.type === 'session:start' && msg.requestId === requestId, 12000, requestId)
}

function buildServer({ port, clientHtmlPath, cwd }) {
  return createLanWsServer({
    clientHtmlPath,
    sessionLockTimeoutMs: 9000,
    sessionLockSweepMs: 1000,
    listReusableSessions: () => ([
      { id: 'hot-session-x', preview: 'Sesión X', mtime: Date.now() - 1000, size: 1200, msgCount: 40 },
      { id: 'hot-session-y', preview: 'Sesión Y', mtime: Date.now() - 500, size: 900, msgCount: 22 },
      { id: 'hot-session-z', preview: 'Sesión Z', mtime: Date.now() - 250, size: 600, msgCount: 12 }
    ]),
    getSessionConfig: ({ requestedContext }) => ({
      cli: 'claude',
      cwd,
      bin: process.execPath,
      env: { ...process.env },
      args: [],
      mode: 'enterprise',
      enterpriseEnabled: true,
      operatorId: requestedContext?.operatorId || '',
      roleId: 'ops-role',
      profileId: 'perfil-lan',
      allowedRoots: [cwd],
      readOnlyRoots: [],
      allowedMcpServers: [],
      permissions: {
        'pty.execute': false,
        'fs.list': true,
        'fs.read': true,
        'fs.write': true,
        'fs.delete': false,
        'fs.rename': false,
        'viewer.open': true,
        'automations.manage': false
      }
    }),
    logger: () => {}
  })
}

test('hot session switch: cambia de sesión X a Y reutilizando el mismo socket', async (t) => {
  const base = mkTmpDir('ws-hot-ok')
  const cwd = path.join(base, 'project')
  fs.mkdirSync(cwd, { recursive: true })
  const clientHtmlPath = path.join(base, 'client.html')
  fs.writeFileSync(clientHtmlPath, '<!doctype html><title>test</title>', 'utf8')

  const port = 16800 + Math.floor(Math.random() * 200)
  const server = buildServer({ port, clientHtmlPath, cwd })

  try {
    await server.start({ port, clientHtmlPath })
  } catch (err) {
    if (err && err.code === 'EPERM') {
      t.skip('Entorno sin permisos para abrir socket local (sandbox).')
      return
    }
    throw err
  }

  try {
    const wsA = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-hot-a`)
    await requestSessionList(wsA, 'a-list-1')
    const startX = await requestSessionStart(wsA, 'a-start-x', 'hot-session-x')
    assert.equal(startX.ok, true)
    assert.equal(startX.mode, 'fresh')
    const connectedX = await waitForMessage(wsA, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'connected-x')
    assert.equal(connectedX.resumeSessionId, 'hot-session-x')

    // Hot switch a sesión Y desde el mismo socket
    const startY = await requestSessionStart(wsA, 'a-hot-y', 'hot-session-y', { mode: 'hot' })
    assert.equal(startY.ok, true)
    assert.equal(startY.mode, 'hot')
    assert.equal(startY.sessionId, 'hot-session-y')
    assert.equal(startY.previousResumeSessionId, 'hot-session-x')

    const connectedY = await waitForMessage(wsA, (msg) => msg.type === 'status' && msg.state === 'connected' && msg.mode === 'hot', 12000, 'connected-y')
    assert.equal(connectedY.resumeSessionId, 'hot-session-y')
    assert.equal(connectedY.previousResumeSessionId, 'hot-session-x')

    // Verificar locks: X libre, Y ocupada por wsA
    const wsB = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-hot-b`)
    const listB = await requestSessionList(wsB, 'b-list-1')
    const rowX = (listB.sessions || []).find((r) => r.id === 'hot-session-x')
    const rowY = (listB.sessions || []).find((r) => r.id === 'hot-session-y')
    assert.equal(rowX?.status, 'free', 'sesión X debe quedar libre tras el hot switch')
    assert.equal(rowY?.status, 'occupied', 'sesión Y debe estar ocupada por wsA tras el hot switch')

    wsA.close()
    wsB.close()
  } finally {
    await server.stop()
  }
})

test('hot session switch: conflicto con lock ajeno deja sesión original intacta', async (t) => {
  const base = mkTmpDir('ws-hot-conflict')
  const cwd = path.join(base, 'project')
  fs.mkdirSync(cwd, { recursive: true })
  const clientHtmlPath = path.join(base, 'client.html')
  fs.writeFileSync(clientHtmlPath, '<!doctype html><title>test</title>', 'utf8')

  const port = 16400 + Math.floor(Math.random() * 200)
  const server = buildServer({ port, clientHtmlPath, cwd })

  try {
    await server.start({ port, clientHtmlPath })
  } catch (err) {
    if (err && err.code === 'EPERM') {
      t.skip('Entorno sin permisos para abrir socket local (sandbox).')
      return
    }
    throw err
  }

  try {
    const wsA = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-hot-a2`)
    const startX = await requestSessionStart(wsA, 'a-start-x', 'hot-session-x')
    assert.equal(startX.ok, true)
    await waitForMessage(wsA, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'a-connected')

    // wsB ocupa hot-session-z
    const wsB = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-hot-b2`)
    const startZ = await requestSessionStart(wsB, 'b-start-z', 'hot-session-z')
    assert.equal(startZ.ok, true)
    await waitForMessage(wsB, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'b-connected')

    // wsA intenta hot switch a Z (ocupada por B) → debe fallar y conservar X
    const hotZ = await requestSessionStart(wsA, 'a-hot-z', 'hot-session-z', { mode: 'hot' })
    assert.equal(hotZ.ok, false)
    assert.equal(hotZ.error?.code, 'SESSION_LOCKED')

    // No debería llegar un connected con mode hot
    let unexpected = null
    try {
      unexpected = await waitForMessage(wsA, (msg) => msg.type === 'status' && msg.state === 'connected' && msg.mode === 'hot', 1500, 'no-hot-connected')
    } catch (err) {
      // expected timeout
    }
    assert.equal(unexpected, null, 'no debería emitirse connected hot tras conflicto de lock')

    // wsA mantiene X bloqueada. Para confirmar pedimos lista desde un tercer cliente
    const wsC = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-hot-c2`)
    const listC = await requestSessionList(wsC, 'c-list-1')
    const rowX = (listC.sessions || []).find((r) => r.id === 'hot-session-x')
    const rowZ = (listC.sessions || []).find((r) => r.id === 'hot-session-z')
    assert.equal(rowX?.status, 'occupied', 'X debe seguir ocupada por wsA tras el hot switch fallido')
    assert.equal(rowZ?.status, 'occupied', 'Z sigue ocupada por wsB')

    wsA.close()
    wsB.close()
    wsC.close()
  } finally {
    await server.stop()
  }
})
