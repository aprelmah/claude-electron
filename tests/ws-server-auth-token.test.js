'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')
const WebSocket = require('ws')

const { createLanWsServer } = require('../main/ws-server')

function makeStubHtml() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-auth-'))
  const html = path.join(tmp, 'lan-client.html')
  fs.writeFileSync(html, '<!doctype html><html><body>stub</body></html>')
  return html
}

// Asignación de puertos sin race: incrementa de 2 en 2 (reservamos port y port+1
// que es el httpPort). Cursor random inicial para evitar choque entre procesos.
let __portCursor = 49000 + (Math.floor(Math.random() * 5000) & ~1)
function freePort() {
  const p = __portCursor
  __portCursor += 2
  if (__portCursor > 64000) __portCursor = 49000
  return Promise.resolve(p)
}

function getStatus(host, port, token) {
  return new Promise((resolve, reject) => {
    const q = token ? `?token=${encodeURIComponent(token)}` : ''
    const req = http.get({ host, port, path: `/status${q}` }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')) })
  })
}

function tryWsConnect(host, port, token) {
  return new Promise((resolve) => {
    const q = token ? `?token=${encodeURIComponent(token)}` : ''
    const url = `ws://${host}:${port}/${q}`
    const ws = new WebSocket(url)
    let resolved = false
    const finish = (result) => { if (!resolved) { resolved = true; try { ws.close() } catch {}; resolve(result) } }
    ws.on('open', () => finish({ ok: true }))
    ws.on('close', (code, reason) => finish({ ok: false, code, reason: reason?.toString?.() || '' }))
    ws.on('error', (err) => finish({ ok: false, error: err?.message }))
    setTimeout(() => finish({ ok: false, timeout: true }), 1500)
  })
}

describe('SEC-C1: auth Bearer LAN ws-server', () => {
  test('sin token configurado → permite todo (compat hacia atrás)', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => ''
    })
    await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      const s = await getStatus('127.0.0.1', wsPort + 1, null)
      assert.equal(s.status, 200)
      const j = JSON.parse(s.body)
      assert.equal(j.ok, true)
      const wsRes = await tryWsConnect('127.0.0.1', wsPort, null)
      assert.equal(wsRes.ok, true)
    } finally {
      await server.stop()
    }
  })

  test('token configurado: HTTP /status sin token → 401', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => 'SECRET-TOKEN-1234'
    })
    await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      const s = await getStatus('127.0.0.1', wsPort + 1, null)
      assert.equal(s.status, 401)
      assert.match(s.headers['www-authenticate'] || '', /Bearer/)
    } finally {
      await server.stop()
    }
  })

  test('token configurado: HTTP /status con token correcto → 200', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => 'SECRET-TOKEN-1234'
    })
    await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      const s = await getStatus('127.0.0.1', wsPort + 1, 'SECRET-TOKEN-1234')
      assert.equal(s.status, 200)
    } finally {
      await server.stop()
    }
  })

  test('token configurado: HTTP /status con token incorrecto → 401', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => 'SECRET-TOKEN-1234'
    })
    await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      const s = await getStatus('127.0.0.1', wsPort + 1, 'WRONG')
      assert.equal(s.status, 401)
    } finally {
      await server.stop()
    }
  })

  test('token configurado: WebSocket sin token → rechazado en handshake', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => 'SECRET-TOKEN-1234'
    })
    await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      const res = await tryWsConnect('127.0.0.1', wsPort, null)
      assert.equal(res.ok, false, `WS sin token debería ser rechazado, got: ${JSON.stringify(res)}`)
    } finally {
      await server.stop()
    }
  })

  test('token configurado: WebSocket con token incorrecto → rechazado', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => 'SECRET-TOKEN-1234'
    })
    await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      const res = await tryWsConnect('127.0.0.1', wsPort, 'WRONG')
      assert.equal(res.ok, false)
    } finally {
      await server.stop()
    }
  })

  test('token configurado: WebSocket con token correcto → conecta', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => 'SECRET-TOKEN-1234'
    })
    await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      const res = await tryWsConnect('127.0.0.1', wsPort, 'SECRET-TOKEN-1234')
      assert.equal(res.ok, true)
    } finally {
      await server.stop()
    }
  })

  test('token configurado: clientUrl incluye ?token=', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => 'TKN-XYZ'
    })
    const startRes = await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      assert.match(startRes.clientUrl, /token=TKN-XYZ/)
      const status = server.getStatus()
      assert.match(status.clientUrl, /token=TKN-XYZ/)
    } finally {
      await server.stop()
    }
  })

  test('comparación timing-safe: tokens de distinta longitud rechazados', async () => {
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: makeStubHtml(),
      getAuthToken: () => 'AAAAAAAAAAAAAAAA'
    })
    await server.start({ port: wsPort, clientHtmlPath: makeStubHtml() })
    try {
      const s = await getStatus('127.0.0.1', wsPort + 1, 'A')
      assert.equal(s.status, 401)
    } finally {
      await server.stop()
    }
  })
})
