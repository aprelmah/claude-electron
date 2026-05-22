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

function buildServer({ port, clientHtmlPath, cwd, sessionsByCli }) {
  return createLanWsServer({
    clientHtmlPath,
    sessionLockTimeoutMs: 9000,
    sessionLockSweepMs: 1000,
    listReusableSessions: (meta) => {
      const cli = String(meta?.cli || 'claude').toLowerCase()
      return sessionsByCli[cli] || []
    },
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

test('listado de sesiones por CLI: claude por defecto, codex bajo petición explícita', async (t) => {
  const base = mkTmpDir('ws-codex-list')
  const cwd = path.join(base, 'project')
  fs.mkdirSync(cwd, { recursive: true })
  const clientHtmlPath = path.join(base, 'client.html')
  fs.writeFileSync(clientHtmlPath, '<!doctype html><title>test</title>', 'utf8')

  const sessionsByCli = {
    claude: [
      { id: 'cl-session-a', preview: 'Sesión Claude A', mtime: Date.now() - 1000, size: 1200, msgCount: 40 },
      { id: 'cl-session-b', preview: 'Sesión Claude B', mtime: Date.now() - 500, size: 900, msgCount: 22 }
    ],
    codex: [
      { id: 'cx-session-x', preview: 'Sesión Codex X', mtime: Date.now() - 2000, size: 800, msgCount: 12, cli: 'codex' },
      { id: 'cx-session-y', preview: 'Sesión Codex Y', mtime: Date.now() - 200, size: 410, msgCount: 5, cli: 'codex' }
    ]
  }

  const port = 16200 + Math.floor(Math.random() * 400)
  const server = buildServer({ port, clientHtmlPath, cwd, sessionsByCli })

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
    const ws = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-cli`)

    ws.send(JSON.stringify({ type: 'session:list', requestId: 'lc-1', forceRefresh: true }))
    const claudeList = await waitForMessage(ws, (msg) => msg.type === 'session:list' && msg.requestId === 'lc-1', 12000, 'lc-1')
    assert.equal(claudeList.ok, true)
    assert.equal(claudeList.cli, 'claude')
    const ids = (claudeList.sessions || []).map((row) => row.id).sort()
    assert.deepEqual(ids, ['cl-session-a', 'cl-session-b'])
    for (const row of claudeList.sessions) {
      assert.equal(row.cli, 'claude', `fila ${row.id} debe ser cli=claude`)
    }

    ws.send(JSON.stringify({ type: 'session:list', requestId: 'cx-1', cli: 'codex', forceRefresh: true }))
    const codexList = await waitForMessage(ws, (msg) => msg.type === 'session:list' && msg.requestId === 'cx-1', 12000, 'cx-1')
    assert.equal(codexList.ok, true)
    assert.equal(codexList.cli, 'codex')
    const codexIds = (codexList.sessions || []).map((row) => row.id).sort()
    assert.deepEqual(codexIds, ['cx-session-x', 'cx-session-y'])
    for (const row of codexList.sessions) {
      assert.equal(row.cli, 'codex', `fila ${row.id} debe ser cli=codex`)
    }

    ws.close()
  } finally {
    await server.stop()
  }
})

test('listado codex devuelve lista vacía cuando el backend no expone sesiones', async (t) => {
  const base = mkTmpDir('ws-codex-empty')
  const cwd = path.join(base, 'project')
  fs.mkdirSync(cwd, { recursive: true })
  const clientHtmlPath = path.join(base, 'client.html')
  fs.writeFileSync(clientHtmlPath, '<!doctype html><title>test</title>', 'utf8')

  const sessionsByCli = {
    claude: [{ id: 'cl-only', preview: 'única', mtime: Date.now(), size: 100, msgCount: 1 }],
    codex: []
  }
  const port = 16650 + Math.floor(Math.random() * 200)
  const server = buildServer({ port, clientHtmlPath, cwd, sessionsByCli })

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
    const ws = await openWs(`ws://127.0.0.1:${port}?lanSessionMode=select&username=cliente-empty`)
    ws.send(JSON.stringify({ type: 'session:list', requestId: 'empty-cx', cli: 'codex', forceRefresh: true }))
    const reply = await waitForMessage(ws, (msg) => msg.type === 'session:list' && msg.requestId === 'empty-cx', 12000, 'empty-cx')
    assert.equal(reply.ok, true)
    assert.equal(reply.cli, 'codex')
    assert.deepEqual(reply.sessions, [])
    ws.close()
  } finally {
    await server.stop()
  }
})
