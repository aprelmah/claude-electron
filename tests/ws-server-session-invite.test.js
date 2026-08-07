'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { WebSocket } = require('ws')
const { createLanWsServer } = require('../main/ws-server')

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-invite-'))
  const cwd = path.join(dir, 'project')
  fs.mkdirSync(cwd)
  const html = path.join(dir, 'lan-client.html')
  fs.writeFileSync(html, '<!doctype html><title>LAN</title>', 'utf8')
  return { dir, cwd, html }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.once('error', reject)
    req.setTimeout(4000, () => req.destroy(new Error('HTTP timeout')))
  })
}

function waitForSessionList(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('session:list timeout')), 5000)
    const onMessage = (raw) => {
      let message
      try { message = JSON.parse(String(raw)) } catch { return }
      if (message.type !== 'session:list') return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(message)
    }
    ws.on('message', onMessage)
  })
}

function waitForMessageType(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timeout`)), 5000)
    const onMessage = (raw) => {
      let message
      try { message = JSON.parse(String(raw)) } catch { return }
      if (message.type !== type) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(message)
    }
    ws.on('message', onMessage)
  })
}

test('la invitación temporal abre la página y el WS sin filtrar el Bearer', async (t) => {
  const { cwd, html } = makeFixture()
  const port = 18300 + Math.floor(Math.random() * 80)
  let resolverInput = null
  const server = createLanWsServer({
    clientHtmlPath: html,
    getAuthToken: () => 'permanent-bearer-secret',
    listReusableSessions: () => [{ id: 'invite-session', preview: 'Sesión compartida' }],
    getSessionConfig: ({ requestedContext }) => {
      resolverInput = requestedContext
      return {
        cli: 'claude',
        cwd,
        bin: process.execPath,
        env: { ...process.env },
        args: [],
        permissions: { 'pty.execute': false },
        allowedRoots: [cwd]
      }
    }
  })
  let ws = null

  try {
    await server.start({ port, clientHtmlPath: html })
    const created = server.createSessionInvite({ cwd, sessionId: 'invite-session', cli: 'claude', label: 'Demo' })
    const inviteUrl = new URL(created.clientUrl)
    assert.equal(inviteUrl.searchParams.has('token'), false)
    assert.ok(inviteUrl.searchParams.get('invite'))

    const page = await httpGet(inviteUrl)
    assert.equal(page.status, 200)
    const status = new URL(inviteUrl)
    status.pathname = '/status'
    const statusWithoutBearer = await httpGet(status)
    assert.equal(statusWithoutBearer.status, 401)

    const wsUrl = new URL(`ws://127.0.0.1:${port}/`)
    wsUrl.searchParams.set('invite', inviteUrl.searchParams.get('invite'))
    ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    ws.send(JSON.stringify({ type: 'session:list', requestId: 'invite-list' }))
    const listed = await waitForSessionList(ws)
    assert.equal(listed.selectedSessionId, 'invite-session')
    assert.equal(resolverInput.raw.lanInvite.sessionId, 'invite-session')
    assert.equal(resolverInput.raw.lanInvite.token, undefined)

    ws.send(JSON.stringify({ type: 'project:list', requestId: 'invite-projects' }))
    const projects = await waitForMessageType(ws, 'project:list')
    assert.equal(projects.ok, true)
    assert.equal(projects.projects.length, 1)
    assert.equal(projects.projects[0].cwd, undefined)
    assert.ok(projects.projects[0].id)

    const projectSessionList = waitForSessionList(ws)
    ws.send(JSON.stringify({
      type: 'project:select',
      requestId: 'invite-project-select',
      projectId: projects.projects[0].id
    }))
    const selected = await waitForMessageType(ws, 'project:selected')
    assert.equal(selected.ok, true)
    await projectSessionList
    assert.equal(resolverInput.raw.lanProject.cwd, cwd)
  } catch (err) {
    if (err?.code === 'EPERM') t.skip('Entorno sin permisos para abrir sockets locales.')
    else throw err
  } finally {
    try { ws?.close() } catch {}
    await server.stop()
  }
})
