const test = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')

const {
  createLanTunnelManager,
  extractTryCloudflareUrl,
  toWssUrl
} = require('../main/lan-tunnel')

// Por qué existe este fichero: el botón "Compartir por internet" lanza dos
// Quick Tunnels de cloudflared y TODO lo que decide (parsear la URL del banner,
// distinguirla de las llamadas a api.trycloudflare.com, sobrevivir a chunks
// partidos, matar a los dos hijos, negarse sin servidor LAN) vive en
// main/lan-tunnel.js precisamente para que la suite lo cubra sin Electron y
// sin tocar la red.

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = (signal) => {
    child.killed = true
    child.lastSignal = signal || 'SIGTERM'
    return true
  }
  return child
}

function makeManager(overrides = {}) {
  const spawned = []
  const spawnFn = overrides.spawnFn || ((cmd, args) => {
    const child = fakeChild()
    spawned.push({ cmd, args, child })
    return child
  })
  const manager = createLanTunnelManager({
    spawnFn,
    getPorts: () => ({ wsPort: 9999, httpPort: 10000 }),
    urlTimeoutMs: overrides.urlTimeoutMs ?? 2000
  })
  return { manager, spawned }
}

const BANNER = (host) => [
  '2026-08-15T19:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...',
  '2026-08-15T19:00:01Z INF +--------------------------------------------------------------------------------------------+',
  `2026-08-15T19:00:01Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |`,
  `2026-08-15T19:00:01Z INF |  https://${host}.trycloudflare.com                                                         |`,
  '2026-08-15T19:00:01Z INF +--------------------------------------------------------------------------------------------+'
].join('\n')

// ── extractTryCloudflareUrl ──

test('extrae la URL del banner de cloudflared', () => {
  assert.strictEqual(
    extractTryCloudflareUrl(BANNER('lila-mesa-actor-brisa')),
    'https://lila-mesa-actor-brisa.trycloudflare.com'
  )
})

test('ignora las llamadas del propio cloudflared a api.trycloudflare.com', () => {
  const text = 'INF POST https://api.trycloudflare.com/tunnel HTTP/1.1\n' + BANNER('otro-host-real-aqui')
  assert.strictEqual(extractTryCloudflareUrl(text), 'https://otro-host-real-aqui.trycloudflare.com')
})

test('sin URL en el texto devuelve null', () => {
  assert.strictEqual(extractTryCloudflareUrl('INF arrancando...\nINF nada que ver'), null)
})

// ── toWssUrl ──

test('convierte https en wss conservando el host', () => {
  assert.strictEqual(toWssUrl('https://abc-def.trycloudflare.com'), 'wss://abc-def.trycloudflare.com')
})

// ── start ──

test('start sin servidor LAN corriendo → error claro y sin spawns', async () => {
  const { manager, spawned } = makeManager()
  await assert.rejects(() => manager.start({ serverRunning: false }), /servidor LAN/i)
  assert.strictEqual(spawned.length, 0)
  assert.strictEqual(manager.getStatus().state, 'stopped')
})

test('start lanza dos cloudflared (cliente 10000 y ws 9999) y resuelve con las URLs', async () => {
  const { manager, spawned } = makeManager()
  const pending = manager.start({ serverRunning: true })
  assert.strictEqual(spawned.length, 2)
  for (const s of spawned) {
    assert.strictEqual(s.cmd, 'cloudflared')
    assert.ok(s.args.includes('tunnel'))
  }
  const targets = spawned.map((s) => s.args[s.args.indexOf('--url') + 1]).sort()
  assert.deepStrictEqual(targets, ['http://127.0.0.1:10000', 'http://127.0.0.1:9999'])

  const byTarget = (port) => spawned.find((s) => s.args.includes(`http://127.0.0.1:${port}`)).child
  byTarget(10000).stderr.emit('data', Buffer.from(BANNER('cliente-uno-dos-tres')))
  byTarget(9999).stderr.emit('data', Buffer.from(BANNER('ws-cuatro-cinco-seis')))

  const result = await pending
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.clientUrl, 'https://cliente-uno-dos-tres.trycloudflare.com')
  assert.strictEqual(result.wsUrl, 'wss://ws-cuatro-cinco-seis.trycloudflare.com')
  assert.strictEqual(manager.getStatus().state, 'running')
  assert.strictEqual(manager.getPublicClientUrl(), 'https://cliente-uno-dos-tres.trycloudflare.com')
  assert.strictEqual(manager.getPublicWsUrl(), 'wss://ws-cuatro-cinco-seis.trycloudflare.com')
})

test('la URL sobrevive a llegar partida en dos chunks', async () => {
  const { manager, spawned } = makeManager()
  const pending = manager.start({ serverRunning: true })
  const banner = BANNER('host-partido-en-dos')
  const mitad = Math.floor(banner.indexOf('host-partido') + 6)
  spawned[0].child.stderr.emit('data', Buffer.from(banner.slice(0, mitad)))
  spawned[0].child.stderr.emit('data', Buffer.from(banner.slice(mitad)))
  spawned[1].child.stderr.emit('data', Buffer.from(BANNER('el-otro-host-normal')))
  const result = await pending
  assert.strictEqual(result.ok, true)
  assert.ok([result.clientUrl, result.wsUrl].some((u) => u.includes('host-partido-en-dos')))
})

test('start con el túnel ya corriendo devuelve las URLs vivas sin lanzar más procesos', async () => {
  const { manager, spawned } = makeManager()
  const pending = manager.start({ serverRunning: true })
  spawned[0].child.stderr.emit('data', Buffer.from(BANNER('primero-a')))
  spawned[1].child.stderr.emit('data', Buffer.from(BANNER('primero-b')))
  await pending
  const again = await manager.start({ serverRunning: true })
  assert.strictEqual(again.ok, true)
  assert.strictEqual(spawned.length, 2)
})

test('cloudflared no instalado (error de spawn) → error que lo dice y limpieza', async () => {
  const { manager, spawned } = makeManager()
  const pending = manager.start({ serverRunning: true })
  const err = Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' })
  spawned[0].child.emit('error', err)
  await assert.rejects(() => pending, /cloudflared/i)
  assert.strictEqual(manager.getStatus().state, 'error')
  assert.strictEqual(manager.getPublicClientUrl(), '')
  assert.strictEqual(spawned[1].child.killed, true)
})

test('si la URL no llega a tiempo → timeout, hijos muertos y estado error', async () => {
  const { manager, spawned } = makeManager({ urlTimeoutMs: 40 })
  await assert.rejects(() => manager.start({ serverRunning: true }), /tiempo|timeout/i)
  assert.strictEqual(manager.getStatus().state, 'error')
  for (const s of spawned) assert.strictEqual(s.child.killed, true)
})

// ── stop y muertes ──

test('stop mata a los dos hijos y vacía las URLs', async () => {
  const { manager, spawned } = makeManager()
  const pending = manager.start({ serverRunning: true })
  spawned[0].child.stderr.emit('data', Buffer.from(BANNER('para-parar-a')))
  spawned[1].child.stderr.emit('data', Buffer.from(BANNER('para-parar-b')))
  await pending
  manager.stop()
  assert.strictEqual(manager.getStatus().state, 'stopped')
  assert.strictEqual(manager.getPublicClientUrl(), '')
  assert.strictEqual(manager.getPublicWsUrl(), '')
  for (const s of spawned) assert.strictEqual(s.child.killed, true)
})

test('un hijo muere con el túnel en marcha → estado error y URLs vacías (nunca un enlace muerto)', async () => {
  const { manager, spawned } = makeManager()
  const pending = manager.start({ serverRunning: true })
  spawned[0].child.stderr.emit('data', Buffer.from(BANNER('muere-luego-a')))
  spawned[1].child.stderr.emit('data', Buffer.from(BANNER('muere-luego-b')))
  await pending
  spawned[0].child.emit('exit', 1, null)
  assert.strictEqual(manager.getStatus().state, 'error')
  assert.strictEqual(manager.getPublicClientUrl(), '')
  assert.strictEqual(spawned[1].child.killed, true)
})

test('usa la ruta absoluta de cloudflared si se inyecta (la app empaquetada no tiene /usr/local/bin en PATH)', () => {
  const spawned = []
  const manager = createLanTunnelManager({
    spawnFn: (cmd, args) => { spawned.push({ cmd, args }); return fakeChild() },
    getPorts: () => ({ wsPort: 9999, httpPort: 10000 }),
    cloudflaredBin: '/usr/local/bin/cloudflared',
    urlTimeoutMs: 50
  })
  manager.start({ serverRunning: true }).catch(() => {})
  assert.strictEqual(spawned.length, 2)
  for (const s of spawned) assert.strictEqual(s.cmd, '/usr/local/bin/cloudflared')
  manager.stop()
})

test('stop con el túnel parado es inocuo', () => {
  const { manager } = makeManager()
  assert.doesNotThrow(() => manager.stop())
  assert.strictEqual(manager.getStatus().state, 'stopped')
})
