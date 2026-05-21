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

function waitForMessage(ws, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timeout esperando mensaje WS'))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('error', onError)
      ws.off('close', onClose)
    }

    function onError(err) {
      cleanup()
      reject(err)
    }

    function onClose() {
      cleanup()
      reject(new Error('Socket cerrado antes de recibir mensaje esperado'))
    }

    function onMessage(raw) {
      let msg = null
      try { msg = JSON.parse(String(raw || '')) } catch { return }
      if (!predicate(msg)) return
      cleanup()
      resolve(msg)
    }

    ws.on('message', onMessage)
    ws.on('error', onError)
    ws.on('close', onClose)
  })
}

test('ws-server aplica ACL por sesión en fs:list/read/write', async (t) => {
  const base = mkTmpDir('ws-acl')
  const allowedRoot = path.join(base, 'allowed')
  fs.mkdirSync(allowedRoot, { recursive: true })
  fs.writeFileSync(path.join(allowedRoot, 'hola.txt'), 'hola ACL', 'utf8')

  const outsideRoot = path.join(base, 'outside')
  fs.mkdirSync(outsideRoot, { recursive: true })
  fs.writeFileSync(path.join(outsideRoot, 'secreto.txt'), 'fuera', 'utf8')

  const clientHtmlPath = path.join(base, 'client.html')
  fs.writeFileSync(clientHtmlPath, '<!doctype html><title>test</title>', 'utf8')

  const port = 12000 + Math.floor(Math.random() * 2000)
  const server = createLanWsServer({
    clientHtmlPath,
    getSessionConfig: ({ requestedContext }) => ({
      cli: 'claude',
      cwd: allowedRoot,
      bin: process.execPath,
      env: { ...process.env },
      args: [],
      mode: 'enterprise',
      enterpriseEnabled: true,
      operatorId: requestedContext?.operatorId || 'secretaria',
      roleId: 'secretaria-role',
      profileId: 'perfil-a',
      allowedRoots: [allowedRoot],
      readOnlyRoots: [],
      allowedMcpServers: ['gmail', 'calendar'],
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

  try {
    await server.start({ port, clientHtmlPath })
  } catch (err) {
    if (err && err.code === 'EPERM') {
      t.skip('Entorno sin permisos para abrir socket local (sandbox).')
      return
    }
    throw err
  }

  const ws = new WebSocket(`ws://127.0.0.1:${port}?operatorId=secretaria&profileId=perfil-a`)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  const connected = await waitForMessage(ws, (msg) => msg.type === 'status' && msg.state === 'connected')
  assert.equal(connected.context?.operatorId, 'secretaria')
  assert.equal(connected.context?.roleId, 'secretaria-role')
  assert.equal(connected.context?.profileId, 'perfil-a')
  assert.deepEqual(connected.context?.allowedMcpServers || [], ['gmail', 'calendar'])

  ws.send(JSON.stringify({ type: 'fs:list', requestId: 'r1', path: allowedRoot, depth: 2 }))
  const listOk = await waitForMessage(ws, (msg) => msg.type === 'fs:result' && msg.requestId === 'r1')
  assert.equal(listOk.ok, true)
  assert.equal(Array.isArray(listOk.entries), true)

  ws.send(JSON.stringify({ type: 'fs:read', requestId: 'r2', path: path.join(allowedRoot, 'hola.txt') }))
  const readOk = await waitForMessage(ws, (msg) => msg.type === 'fs:result' && msg.requestId === 'r2')
  assert.equal(readOk.ok, true)
  assert.equal(readOk.content, 'hola ACL')

  ws.send(JSON.stringify({ type: 'fs:read', requestId: 'r3', path: path.join(outsideRoot, 'secreto.txt') }))
  const readDenied = await waitForMessage(ws, (msg) => msg.type === 'fs:result' && msg.requestId === 'r3')
  assert.equal(readDenied.ok, false)
  assert.equal(readDenied.error?.code, 'PATH_OUTSIDE_ALLOWED_ROOTS')

  ws.send(JSON.stringify({ type: 'fs:write', requestId: 'r4', path: path.join(outsideRoot, 'nuevo.txt'), content: 'x' }))
  const writeDenied = await waitForMessage(ws, (msg) => msg.type === 'fs:result' && msg.requestId === 'r4')
  assert.equal(writeDenied.ok, false)
  assert.equal(writeDenied.error?.code, 'PATH_OUTSIDE_ALLOWED_ROOTS')

  ws.close()
  await server.stop()
})
