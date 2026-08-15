'use strict'

// El enlace público del túnel y el Bearer permanente del servidor LAN.
// Invariante que se prueba aquí: el token persistente SOLO viaja en la URL LAN.
// La URL pública (alcanzable desde internet) se usa únicamente con invitación.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createLanWsServer } = require('../main/ws-server')

// Banda propia 13400–13600, disjunta de los demás ficheros ws-server
// (12000–14000 acl, 14000–17900 resto, 18300 invite, 18500–19900 auth-token)
// y FUERA del rango efímero del SO (49152–65535).
let __portCursor = 13400 + (Math.floor(Math.random() * 100) & ~1)
function freePort() {
  const p = __portCursor
  __portCursor += 2
  if (__portCursor > 13600) __portCursor = 13400
  return p
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-public-url-'))
  const cwd = path.join(dir, 'project')
  fs.mkdirSync(cwd)
  const html = path.join(dir, 'lan-client.html')
  fs.writeFileSync(html, '<!doctype html><title>LAN</title>', 'utf8')
  return { dir, cwd, html }
}

function makeServer({ token = '', publicClient = '', publicWs = '', html } = {}) {
  return createLanWsServer({
    clientHtmlPath: html || makeFixture().html,
    getAuthToken: () => token,
    getPublicClientUrl: () => publicClient,
    getPublicWsUrl: () => publicWs
  })
}

const PUBLIC_CLIENT = 'https://demo.trycloudflare.com/lan-client.html'
const PUBLIC_WS = 'wss://demo-ws.trycloudflare.com'

describe('buildClientUrl: el Bearer permanente nunca sale en la URL pública', () => {
  test('URLs públicas configuradas y SIN invite → URL LAN con token, jamás la pública', () => {
    const server = makeServer({
      token: 'permanent-bearer-secret',
      publicClient: PUBLIC_CLIENT,
      publicWs: PUBLIC_WS
    })
    const url = new URL(server.getStatus().clientUrl)
    assert.equal(url.protocol, 'http:', 'el enlace sin invite es el LAN, no el público')
    assert.equal(url.hostname, '127.0.0.1')
    assert.equal(url.pathname, '/lan-client.html')
    assert.equal(url.searchParams.get('token'), 'permanent-bearer-secret')
    assert.equal(url.searchParams.has('wsUrl'), false)
    assert.equal(server.getStatus().clientUrl.includes('trycloudflare'), false)
  })

  test('sin URLs públicas y sin invite → URL LAN con token (comportamiento clásico)', () => {
    const server = makeServer({ token: 'TKN-XYZ' })
    const url = new URL(server.getStatus().clientUrl)
    assert.equal(url.hostname, '127.0.0.1')
    assert.equal(url.searchParams.get('token'), 'TKN-XYZ')
    assert.equal(url.searchParams.get('host'), '127.0.0.1')
    assert.ok(url.searchParams.get('port'))
  })

  test('sin token configurado → la URL LAN no lleva ?token=', () => {
    const server = makeServer({ token: '' })
    const url = new URL(server.getStatus().clientUrl)
    assert.equal(url.searchParams.has('token'), false)
  })

  test('URLs públicas configuradas y CON invite → URL pública con wsUrl y sin token', async () => {
    const { cwd, html } = makeFixture()
    const port = freePort()
    const server = createLanWsServer({
      clientHtmlPath: html,
      getAuthToken: () => 'permanent-bearer-secret',
      getPublicClientUrl: () => PUBLIC_CLIENT,
      getPublicWsUrl: () => PUBLIC_WS,
      listReusableSessions: () => [{ id: 'invite-session', preview: 'Sesión compartida' }]
    })
    await server.start({ port, clientHtmlPath: html })
    try {
      const created = server.createSessionInvite({ cwd, sessionId: 'invite-session', cli: 'claude' })
      const url = new URL(created.clientUrl)
      assert.equal(url.origin, new URL(PUBLIC_CLIENT).origin)
      assert.equal(url.searchParams.get('wsUrl'), PUBLIC_WS)
      assert.ok(url.searchParams.get('invite'))
      assert.equal(url.searchParams.has('token'), false, 'el Bearer permanente jamás viaja al exterior')
    } finally {
      await server.stop()
    }
  })

  test('URL pública inválida + invite → cae a la LAN y sigue sin filtrar el token', async () => {
    const { cwd, html } = makeFixture()
    const port = freePort()
    const server = createLanWsServer({
      clientHtmlPath: html,
      getAuthToken: () => 'permanent-bearer-secret',
      getPublicClientUrl: () => 'no-es-una-url',
      getPublicWsUrl: () => PUBLIC_WS,
      listReusableSessions: () => [{ id: 'invite-session', preview: 'Sesión compartida' }]
    })
    await server.start({ port, clientHtmlPath: html })
    try {
      const created = server.createSessionInvite({ cwd, sessionId: 'invite-session', cli: 'claude' })
      const url = new URL(created.clientUrl)
      assert.equal(url.protocol, 'http:')
      assert.equal(url.searchParams.has('token'), false)
      assert.ok(url.searchParams.get('invite'))
    } finally {
      await server.stop()
    }
  })
})

describe('getStatus().publicUrlWarning: media configuración del túnel no degrada en silencio', () => {
  test('solo la URL pública del cliente → avisa de que falta la del WebSocket', () => {
    const server = makeServer({ publicClient: PUBLIC_CLIENT, publicWs: '' })
    const warning = server.getStatus().publicUrlWarning
    assert.equal(typeof warning, 'string')
    assert.match(warning, /WebSocket/)
    assert.match(warning, /red local/)
  })

  test('solo la URL pública del WebSocket → avisa de que falta la del cliente', () => {
    const server = makeServer({ publicClient: '', publicWs: PUBLIC_WS })
    const warning = server.getStatus().publicUrlWarning
    assert.equal(typeof warning, 'string')
    assert.match(warning, /cliente/)
    assert.match(warning, /red local/)
  })

  test('ambas URLs públicas puestas → sin aviso', () => {
    const server = makeServer({ publicClient: PUBLIC_CLIENT, publicWs: PUBLIC_WS })
    assert.equal(server.getStatus().publicUrlWarning, null)
  })

  test('ninguna URL pública → sin aviso', () => {
    const server = makeServer({})
    assert.equal(server.getStatus().publicUrlWarning, null)
  })

  test('URLs públicas en blancos → tratadas como vacías, sin aviso', () => {
    const server = makeServer({ publicClient: '   ', publicWs: '  ' })
    assert.equal(server.getStatus().publicUrlWarning, null)
  })
})
