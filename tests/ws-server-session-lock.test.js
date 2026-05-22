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

async function requestSessionStart(ws, requestId, sessionId) {
  ws.send(JSON.stringify({ type: 'session:start', requestId, sessionId }))
  return waitForMessage(ws, (msg) => msg.type === 'session:start' && msg.requestId === requestId, 12000, requestId)
}

async function waitUntil(fn, timeoutMs = 10000, intervalMs = 250) {
  const started = Date.now()
  while ((Date.now() - started) < timeoutMs) {
    const value = await fn()
    if (value) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

function buildServer({ port, clientHtmlPath, cwd, sessionLockTimeoutMs = 9000, sessionLockSweepMs = 1000 }) {
  return createLanWsServer({
    clientHtmlPath,
    sessionLockTimeoutMs,
    sessionLockSweepMs,
    listReusableSessions: () => ([
      { id: 'session-s', preview: 'Sesión de soporte', mtime: Date.now() - 1000, size: 1200, msgCount: 40 },
      { id: 'session-t', preview: 'Sesión técnica', mtime: Date.now() - 500, size: 900, msgCount: 22 }
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

test('lock por sesión reusable: colisión entre clientes y liberación por desconexión', async (t) => {
  const base = mkTmpDir('ws-lock')
  const cwd = path.join(base, 'project')
  fs.mkdirSync(cwd, { recursive: true })
  const clientHtmlPath = path.join(base, 'client.html')
  fs.writeFileSync(clientHtmlPath, '<!doctype html><title>test</title>', 'utf8')

  const port = 15000 + Math.floor(Math.random() * 900)
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

  const wsA = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-a`)
  const listA = await requestSessionList(wsA, 'a-list-1')
  const rowA = (listA.sessions || []).find((row) => row.id === 'session-s')
  assert.equal(rowA?.status, 'free')

  const startA = await requestSessionStart(wsA, 'a-start-1', 'session-s')
  assert.equal(startA.ok, true)
  const connectedA = await waitForMessage(wsA, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'a-connected')
  assert.equal(connectedA.resumeSessionId, 'session-s')

  const wsB = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-b`)
  const listB1 = await requestSessionList(wsB, 'b-list-1')
  const rowB1 = (listB1.sessions || []).find((row) => row.id === 'session-s')
  assert.equal(rowB1?.status, 'occupied')
  assert.equal(typeof rowB1?.lock?.owner, 'string')
  assert.ok(rowB1.lock.owner.length > 0)

  const blocked = await requestSessionStart(wsB, 'b-start-lock', 'session-s')
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error?.code, 'SESSION_LOCKED')

  wsA.close()

  const released = await waitUntil(async () => {
    const list = await requestSessionList(wsB, `b-list-release-${Date.now()}`)
    const row = (list.sessions || []).find((entry) => entry.id === 'session-s')
    return row?.status === 'free'
  }, 10000, 300)
  assert.equal(released, true)

  const wsA2 = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-a2`)
  const startA2 = await requestSessionStart(wsA2, 'a2-start-1', 'session-t')
  assert.equal(startA2.ok, true)
  await waitForMessage(wsA2, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'a2-connected')

  const listB2 = await requestSessionList(wsB, 'b-list-2')
  const rowS = (listB2.sessions || []).find((row) => row.id === 'session-s')
  const rowT = (listB2.sessions || []).find((row) => row.id === 'session-t')
  assert.equal(rowS?.status, 'free')
  assert.equal(rowT?.status, 'occupied')

  wsA2.close()
  wsB.close()
  await server.stop()
})

test('lock stale se libera por timeout si no hay heartbeat', async (t) => {
  const base = mkTmpDir('ws-lock-stale')
  const cwd = path.join(base, 'project')
  fs.mkdirSync(cwd, { recursive: true })
  const clientHtmlPath = path.join(base, 'client.html')
  fs.writeFileSync(clientHtmlPath, '<!doctype html><title>test</title>', 'utf8')

  const port = 15950 + Math.floor(Math.random() * 300)
  const server = buildServer({
    port,
    clientHtmlPath,
    cwd,
    sessionLockTimeoutMs: 1500,
    sessionLockSweepMs: 500
  })

  try {
    await server.start({ port, clientHtmlPath })
  } catch (err) {
    if (err && err.code === 'EPERM') {
      t.skip('Entorno sin permisos para abrir socket local (sandbox).')
      return
    }
    throw err
  }

  const wsA = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-timeout-a`)
  const startA = await requestSessionStart(wsA, 'stale-a-start', 'session-s')
  assert.equal(startA.ok, true)
  await waitForMessage(wsA, (msg) => msg.type === 'status' && msg.state === 'connected', 12000, 'stale-a-connected')

  const wsB = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-timeout-b`)
  const listBefore = await requestSessionList(wsB, 'stale-b-before')
  const rowBefore = (listBefore.sessions || []).find((row) => row.id === 'session-s')
  assert.equal(rowBefore?.status, 'occupied')

  const freed = await waitUntil(async () => {
    const list = await requestSessionList(wsB, `stale-b-after-${Date.now()}`)
    const row = (list.sessions || []).find((entry) => entry.id === 'session-s')
    return row?.status === 'free'
  }, 6000, 350)
  assert.equal(freed, true)

  wsA.close()
  wsB.close()
  await server.stop()
})
