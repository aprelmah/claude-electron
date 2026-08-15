'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { WebSocket } = require('ws')
const { createLanWsServer } = require('../main/ws-server')

// Por qué existe este fichero: el modo ESPEJO engancha una conexión LAN al PTY
// VIVO del terminal local (mismo hilo, misma pantalla). Sus dos invariantes
// críticos se prueban aquí sin Electron: (1) el cliente ve el snapshot y el
// stream y sus teclas llegan al PTY del host; (2) cerrar el espejo DESENGANCHA
// pero JAMÁS mata el PTY del host (killSessionPty llama kill() del facade).

// Banda de puertos propia de este fichero (regla: jamás el rango efímero).
const PORT_BASE = 18400

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-mirror-'))
  const html = path.join(dir, 'lan-client.html')
  fs.writeFileSync(html, '<!doctype html><title>LAN</title>', 'utf8')
  fs.writeFileSync(path.join(dir, 'lan-mirror.html'), '<!doctype html><title>ESPEJO</title>', 'utf8')
  return { dir, html }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = require('http').get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.once('error', reject)
    req.setTimeout(4000, () => req.destroy(new Error('HTTP timeout')))
  })
}

function waitForMessage(ws, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), 5000)
    const onMessage = (raw) => {
      let message
      try { message = JSON.parse(String(raw)) } catch { return }
      if (!predicate(message)) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(message)
    }
    ws.on('message', onMessage)
  })
}

function makeMirrorHost() {
  const host = {
    writes: [],
    detached: 0,
    hostKilled: 0,
    handlers: null,
    attachCalls: []
  }
  host.attachLocalMirror = (mirrorId, handlers) => {
    host.attachCalls.push(mirrorId)
    if (mirrorId !== 'mirror-id-valido-123') return null
    host.handlers = handlers
    return {
      write: (data) => host.writes.push(String(data)),
      detach: () => { host.detached += 1 },
      // kill NO existe a propósito: si alguien intentara matar el host, peta.
      snapshot: 'PANTALLA-PREVIA>',
      cols: 132,
      rows: 41,
      cli: 'claude',
      cwd: os.tmpdir()
    }
  }
  return host
}

test('el espejo conecta directo, recibe snapshot+stream y sus teclas llegan al PTY del host', async () => {
  const { html } = makeFixture()
  const port = PORT_BASE + Math.floor(Math.random() * 60)
  const host = makeMirrorHost()
  const server = createLanWsServer({
    clientHtmlPath: html,
    getAuthToken: () => 'bearer-secreto-que-no-viaja',
    attachLocalMirror: host.attachLocalMirror
  })
  let ws = null
  try {
    await server.start({ port, clientHtmlPath: html })
    const created = server.createSessionInvite({ mode: 'mirror', mirrorId: 'mirror-id-valido-123', cli: 'claude', label: 'Espejo' })
    assert.equal(created.ok, true)
    const inviteUrl = new URL(created.clientUrl)
    // El espejo abre SU página minimal, con invite y sin el Bearer permanente.
    assert.equal(inviteUrl.pathname, '/lan-mirror.html')
    assert.equal(inviteUrl.searchParams.has('token'), false)
    const inviteToken = inviteUrl.searchParams.get('invite')
    assert.ok(inviteToken)

    // La página espejo se sirve con invite y se niega sin él.
    const page = await httpGet(inviteUrl)
    assert.equal(page.status, 200)
    assert.ok(page.body.includes('ESPEJO'))
    const bare = new URL(inviteUrl)
    bare.searchParams.delete('invite')
    const rejected = await httpGet(bare)
    assert.equal(rejected.status, 401)

    const wsUrl = new URL(`ws://127.0.0.1:${port}/`)
    wsUrl.searchParams.set('invite', inviteToken)
    ws = new WebSocket(wsUrl)
    // OJO: el connected y el snapshot llegan NADA MÁS conectar — los listeners
    // van ANTES del open o la carrera se los come (bug del primer intento).
    const connectedPromise = waitForMessage(ws, (m) => m.type === 'status' && m.state === 'connected', 'connected')
    const snapshotPromise = waitForMessage(ws, (m) => m.type === 'output', 'snapshot')
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })

    // Conecta SOLO (sin picker, sin session:start): el invite espejo basta.
    const connected = await connectedPromise
    assert.equal(connected.mirror.cols, 132)
    assert.equal(connected.mirror.rows, 41)
    assert.equal(connected.cli, 'claude')
    // En espejo el chat semántico va APAGADO: contestaría un headless aparte
    // del PTY que estás viendo, la bifurcación exacta que el espejo evita.
    assert.equal(connected.capabilities.chat.ask, false)

    const snapshot = await snapshotPromise
    assert.equal(snapshot.data, 'PANTALLA-PREVIA>')

    // El host escribe → el espejo lo ve.
    host.handlers.onData('hola desde el host')
    const streamed = await waitForMessage(ws, (m) => m.type === 'output' && m.data.includes('hola desde el host'), 'stream')
    assert.ok(streamed)

    // El espejo teclea → llega al PTY del host tal cual.
    ws.send(JSON.stringify({ type: 'input', data: 'ls\r' }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.deepEqual(host.writes, ['ls\r'])

    // Latido: ping → pong (mantiene vivo el WS a través del túnel).
    ws.send(JSON.stringify({ type: 'ping' }))
    await waitForMessage(ws, (m) => m.type === 'pong', 'pong')
  } finally {
    try { ws?.close() } catch {}
    await server.stop()
  }
})

test('cerrar el espejo DESENGANCHA sin matar el PTY del host', async () => {
  const { html } = makeFixture()
  const port = PORT_BASE + 60 + Math.floor(Math.random() * 40)
  const host = makeMirrorHost()
  const server = createLanWsServer({
    clientHtmlPath: html,
    getAuthToken: () => 'otro-bearer-secreto',
    attachLocalMirror: host.attachLocalMirror
  })
  let ws = null
  try {
    await server.start({ port, clientHtmlPath: html })
    const created = server.createSessionInvite({ mode: 'mirror', mirrorId: 'mirror-id-valido-123', cli: 'claude' })
    const inviteToken = new URL(created.clientUrl).searchParams.get('invite')
    const wsUrl = new URL(`ws://127.0.0.1:${port}/`)
    wsUrl.searchParams.set('invite', inviteToken)
    ws = new WebSocket(wsUrl)
    const connectedPromise = waitForMessage(ws, (m) => m.type === 'status' && m.state === 'connected', 'connected')
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    await connectedPromise
    ws.close()
    await new Promise((resolve) => setTimeout(resolve, 300))
    // killSessionPty corrió al cerrar: el facade desengancha y el fake no tiene
    // kill del host — si el server lo hubiera intentado, habría petado antes.
    assert.equal(host.detached, 1)
    assert.deepEqual(host.writes, [])
  } finally {
    try { ws?.close() } catch {}
    await server.stop()
  }
})

test('espejo con el terminal ya cerrado → error claro, nunca una sesión fantasma', async () => {
  const { html } = makeFixture()
  const port = PORT_BASE + 100 + Math.floor(Math.random() * 40)
  const host = makeMirrorHost()
  const server = createLanWsServer({
    clientHtmlPath: html,
    getAuthToken: () => 'bearer-tres',
    attachLocalMirror: host.attachLocalMirror
  })
  let ws = null
  try {
    await server.start({ port, clientHtmlPath: html })
    // mirrorId que el host ya no reconoce (sesión cerrada): attach → null.
    const created = server.createSessionInvite({ mode: 'mirror', mirrorId: 'mirror-id-caducado-9', cli: 'claude' })
    const inviteToken = new URL(created.clientUrl).searchParams.get('invite')
    const wsUrl = new URL(`ws://127.0.0.1:${port}/`)
    wsUrl.searchParams.set('invite', inviteToken)
    ws = new WebSocket(wsUrl)
    const errorPromise = waitForMessage(ws, (m) => m.type === 'status' && m.state === 'error', 'error')
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const errorMsg = await errorPromise
    assert.equal(errorMsg.code, 'MIRROR_TARGET_GONE')
  } finally {
    try { ws?.close() } catch {}
    await server.stop()
  }
})

test('audio y adjuntos en espejo: transcript con ENTER aparte y ruta del fichero sin enter', async () => {
  const { html } = makeFixture()
  const port = PORT_BASE + 180 + Math.floor(Math.random() * 40)
  const host = makeMirrorHost()
  const server = createLanWsServer({
    clientHtmlPath: html,
    getAuthToken: () => 'bearer-audio',
    attachLocalMirror: host.attachLocalMirror,
    transcribeAudio: async () => 'dictado de prueba'
  })
  let ws = null
  try {
    await server.start({ port, clientHtmlPath: html })
    const created = server.createSessionInvite({ mode: 'mirror', mirrorId: 'mirror-id-valido-123', cli: 'claude' })
    const inviteToken = new URL(created.clientUrl).searchParams.get('invite')
    const wsUrl = new URL(`ws://127.0.0.1:${port}/`)
    wsUrl.searchParams.set('invite', inviteToken)
    ws = new WebSocket(wsUrl)
    const connectedPromise = waitForMessage(ws, (m) => m.type === 'status' && m.state === 'connected', 'connected')
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    await connectedPromise

    // Audio → transcripción al PTY con el ENTER en escritura APARTE (regla
    // pty-prompt-write: pegado al texto, el claude TUI lo deja sin enviar).
    ws.send(JSON.stringify({ type: 'audio', data: Buffer.from('fake-ogg').toString('base64') }))
    await waitForMessage(ws, (m) => m.type === 'transcript', 'transcript')
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.deepEqual(host.writes, ['dictado de prueba', '\r'])

    // Adjunto → fichero guardado y su RUTA al prompt, sin enter.
    host.writes.length = 0
    ws.send(JSON.stringify({ type: 'mirror:attach', name: 'foto rara ñ.jpg', data: Buffer.from('JPEGDATA').toString('base64') }))
    const ok = await waitForMessage(ws, (m) => m.type === 'mirror:attach-ok', 'attach-ok')
    assert.ok(ok.path.includes('poweragent-espejo'))
    assert.ok(fs.existsSync(ok.path))
    assert.equal(fs.readFileSync(ok.path, 'utf8'), 'JPEGDATA')
    assert.equal(host.writes.length, 1)
    assert.equal(host.writes[0], `${ok.path} `)
    assert.ok(!host.writes[0].includes('\r'))
    fs.unlinkSync(ok.path)
  } finally {
    try { ws?.close() } catch {}
    await server.stop()
  }
})

test('la invitación espejo no exige cwd ni sessionId (no hay nada que resumir)', async () => {
  const { html } = makeFixture()
  const port = PORT_BASE + 140 + Math.floor(Math.random() * 40)
  const server = createLanWsServer({
    clientHtmlPath: html,
    getAuthToken: () => 'bearer-cuatro',
    attachLocalMirror: () => null
  })
  try {
    await server.start({ port, clientHtmlPath: html })
    const created = server.createSessionInvite({ mode: 'mirror', mirrorId: 'mirror-sin-cwd-ni-id' })
    assert.equal(created.ok, true)
    assert.throws(() => server.createSessionInvite({ mode: 'mirror', mirrorId: 'x' }), /espejo/i)
  } finally {
    await server.stop()
  }
})
