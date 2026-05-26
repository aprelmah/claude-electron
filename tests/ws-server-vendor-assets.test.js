'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')

const { createLanWsServer } = require('../main/ws-server')

function setupClientDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-vendor-'))
  fs.writeFileSync(path.join(tmp, 'lan-client.html'), '<!doctype html><html><body>stub</body></html>')
  fs.mkdirSync(path.join(tmp, 'vendor', 'xterm', 'lib'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'vendor', 'xterm', 'css'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'vendor', 'xterm', 'lib', 'xterm.js'), 'console.log("xterm-stub")')
  fs.writeFileSync(path.join(tmp, 'vendor', 'xterm', 'css', 'xterm.css'), '.x{color:red}')
  // Archivo sensible fuera de vendor para test de traversal
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'SECRET')
  return tmp
}

let __portCursor = 54000 + (Math.floor(Math.random() * 3000) & ~1)
function freePort() {
  const p = __portCursor
  __portCursor += 2
  if (__portCursor > 64000) __portCursor = 54000
  return Promise.resolve(p)
}

function get(host, port, path_) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: path_ }, (res) => {
      let body = ''; res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.setTimeout(3000, () => req.destroy(new Error('timeout')))
  })
}

describe('SEC-C4: vendor assets servidos locales (no jsdelivr)', () => {
  test('/vendor/xterm/lib/xterm.js sirve el JS local con content-type correcto', async () => {
    const dir = setupClientDir()
    const wsPort = await freePort()
    const server = createLanWsServer({ clientHtmlPath: path.join(dir, 'lan-client.html') })
    await server.start({ port: wsPort, clientHtmlPath: path.join(dir, 'lan-client.html') })
    try {
      const r = await get('127.0.0.1', wsPort + 1, '/vendor/xterm/lib/xterm.js')
      assert.equal(r.status, 200)
      assert.match(r.headers['content-type'], /application\/javascript/)
      assert.match(r.body, /xterm-stub/)
    } finally { await server.stop() }
  })

  test('/vendor/xterm/css/xterm.css sirve CSS local', async () => {
    const dir = setupClientDir()
    const wsPort = await freePort()
    const server = createLanWsServer({ clientHtmlPath: path.join(dir, 'lan-client.html') })
    await server.start({ port: wsPort, clientHtmlPath: path.join(dir, 'lan-client.html') })
    try {
      const r = await get('127.0.0.1', wsPort + 1, '/vendor/xterm/css/xterm.css')
      assert.equal(r.status, 200)
      assert.match(r.headers['content-type'], /text\/css/)
    } finally { await server.stop() }
  })

  test('traversal con .. rechazado', async () => {
    const dir = setupClientDir()
    const wsPort = await freePort()
    const server = createLanWsServer({ clientHtmlPath: path.join(dir, 'lan-client.html') })
    await server.start({ port: wsPort, clientHtmlPath: path.join(dir, 'lan-client.html') })
    try {
      const r = await get('127.0.0.1', wsPort + 1, '/vendor/../secret.txt')
      assert.notEqual(r.status, 200)
      assert.equal(/SECRET/.test(r.body), false)
    } finally { await server.stop() }
  })

  test('archivo fuera de vendor: 404', async () => {
    const dir = setupClientDir()
    const wsPort = await freePort()
    const server = createLanWsServer({ clientHtmlPath: path.join(dir, 'lan-client.html') })
    await server.start({ port: wsPort, clientHtmlPath: path.join(dir, 'lan-client.html') })
    try {
      const r = await get('127.0.0.1', wsPort + 1, '/vendor/xterm/lib/no-existe.js')
      assert.equal(r.status, 404)
    } finally { await server.stop() }
  })
})

describe('SEC-C4: lan-client.html NO referencia cdn.jsdelivr', () => {
  test('lan-client.html del repo NO contiene cdn.jsdelivr', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'lan-client.html'), 'utf8')
    assert.equal(html.includes('cdn.jsdelivr.net'), false, 'lan-client.html no debe cargar de jsdelivr')
    assert.ok(html.includes('vendor/xterm/lib/xterm.js'), 'debe referenciar vendor local')
  })
})

describe('SEC-C4 regresión: vendor público pese a token (bug conexión LAN 2026-05-26)', () => {
  test('con token configurado, /vendor/* se sirve SIN token; página y /status siguen gated', async () => {
    const dir = setupClientDir()
    const wsPort = await freePort()
    const server = createLanWsServer({
      clientHtmlPath: path.join(dir, 'lan-client.html'),
      getAuthToken: () => 'SECRET-TOKEN-1234'
    })
    await server.start({ port: wsPort, clientHtmlPath: path.join(dir, 'lan-client.html') })
    try {
      // sub-recurso pedido por el navegador (sin ?token=) → DEBE servirse
      const js = await get('127.0.0.1', wsPort + 1, '/vendor/xterm/lib/xterm.js')
      assert.equal(js.status, 200, 'vendor debe servirse sin token')
      assert.match(js.body, /xterm-stub/)
      // la página y /status SIGUEN exigiendo token
      const page = await get('127.0.0.1', wsPort + 1, '/lan-client.html')
      assert.equal(page.status, 401, 'la página sigue protegida')
      const status = await get('127.0.0.1', wsPort + 1, '/status')
      assert.equal(status.status, 401, '/status sigue protegido')
    } finally { await server.stop() }
  })
})
