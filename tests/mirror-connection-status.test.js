'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  describeMirrorFailure,
  computeQrRefreshDelay,
  formatQrCountdown,
  QR_REFRESH_SAFETY_MS
} = require('../main/mirror-connection-status')

test('el invite quemado o caducado se explica con su causa real, sin reintentar', () => {
  const invalid = describeMirrorFailure({ closeCode: 4403, serverCode: 'SESSION_INVITE_INVALID' })
  assert.equal(invalid.kind, 'invite-invalid')
  assert.equal(invalid.retry, false)
  assert.match(invalid.detail, /90 s/)
  assert.match(invalid.detail, /4 h/)
})

test('el terminal cerrado en el Mac no se confunde con una invitación caducada', () => {
  const gone = describeMirrorFailure({ everOpened: true, closeCode: 1011, serverCode: 'MIRROR_TARGET_GONE' })
  assert.equal(gone.kind, 'target-gone')
  assert.equal(gone.retry, false)
  assert.doesNotMatch(gone.title, /caducad/i)
})

test('si el WS nunca abrió y el host no responde, señala host y puerto exactos', () => {
  const unreachable = describeMirrorFailure({
    everOpened: false,
    reachable: false,
    host: '192.168.1.17',
    port: 9999
  })
  assert.equal(unreachable.kind, 'host-unreachable')
  assert.match(unreachable.detail, /192\.168\.1\.17:9999/)
  assert.equal(unreachable.retry, true)
})

// El caso que deja la pantalla en blanco: la página se sirvió por HTTP, así que
// el host existe, pero el WebSocket no llega. Sin este mensaje es indistinguible
// de un token caducado.
test('host alcanzable pero WS caído se distingue del token inválido', () => {
  const wsDown = describeMirrorFailure({
    everOpened: false,
    reachable: true,
    host: 'tunel.example.com',
    port: 9999
  })
  assert.equal(wsDown.kind, 'ws-blocked')
  assert.match(wsDown.detail, /tunel\.example\.com:9999/)
  assert.notEqual(wsDown.kind, 'invite-invalid')
})

test('un corte con el WS ya abierto es reintentable y no culpa al token', () => {
  const dropped = describeMirrorFailure({ everOpened: true, closeCode: 1006 })
  assert.equal(dropped.kind, 'dropped')
  assert.equal(dropped.retry, true)
})

test('agotados los reintentos el mensaje deja de prometer reconexión', () => {
  const exhausted = describeMirrorFailure({ everOpened: true, closeCode: 1006, attemptsExhausted: true })
  assert.equal(exhausted.retry, false)
  assert.match(exhausted.detail, /🪞/)
})

test('el mensaje del servidor gana al genérico cuando existe', () => {
  const withMessage = describeMirrorFailure({
    closeCode: 4403,
    serverCode: 'SESSION_INVITE_INVALID',
    serverMessage: 'La invitación ha caducado o ya no admite más usos.'
  })
  assert.match(withMessage.title, /caducado o ya no admite/)
})

test('el refresco del QR se adelanta a la caducidad', () => {
  const delay = computeQrRefreshDelay({ expiresAt: 100000, now: 10000 })
  assert.equal(delay, 90000 - QR_REFRESH_SAFETY_MS)
})

test('un QR ya caducado o casi pide refresco inmediato acotado, nunca negativo', () => {
  assert.equal(computeQrRefreshDelay({ expiresAt: 1000, now: 50000 }), 0)
  assert.equal(computeQrRefreshDelay({ expiresAt: 51000, now: 50000 }), 0)
})

test('sin expiresAt válido no se programa refresco', () => {
  assert.equal(computeQrRefreshDelay({ expiresAt: null, now: 1000 }), null)
  assert.equal(computeQrRefreshDelay({ expiresAt: 'mañana', now: 1000 }), null)
})

test('la cuenta atrás dice segundos restantes y avisa cuando ya no vale', () => {
  assert.equal(formatQrCountdown(65000, 5000), 'caduca en 60 s')
  assert.equal(formatQrCountdown(5500, 5000), 'caduca en 1 s')
  assert.equal(formatQrCountdown(4000, 5000), 'caducado')
  assert.equal(formatQrCountdown(null, 5000), '')
})

// Regresión del incidente: el QR seguía viéndose idéntico después de caducar,
// así que "vuelve a escanear" nunca podía funcionar. El refresco tiene que
// dispararse ANTES del vencimiento y encadenarse mientras el popover siga abierto.
test('el refresco encadena antes de cada vencimiento', () => {
  let clock = 0
  const delays = []
  for (let i = 0; i < 3; i += 1) {
    const expiresAt = clock + 90000
    const delay = computeQrRefreshDelay({ expiresAt, now: clock })
    delays.push(delay)
    clock += delay
    assert.ok(clock < expiresAt, 'el refresco debe caer antes de que el QR muera')
  }
  assert.deepEqual(delays, [75000, 75000, 75000])
})

// El diagnóstico llega a la página por INYECCIÓN del marcador al servirla. Si
// alguien renombra el marcador, mueve el módulo o suelta el <script>, el móvil
// vuelve a la pantalla en blanco sin que falle ningún otro test.
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

test('la página espejo conserva el marcador de inyección', () => {
  const html = fs.readFileSync(path.join(ROOT, 'lan-mirror.html'), 'utf8')
  assert.match(html, /\/\*__MIRROR_STATUS_MODULE__\*\//)
  assert.match(html, /MirrorConnectionStatus/)
})

test('el ws-server sustituye el marcador por el módulo real', () => {
  const server = fs.readFileSync(path.join(ROOT, 'main', 'ws-server.js'), 'utf8')
  assert.match(server, /injectMirrorStatusModule/)
  assert.match(server, /mirror-connection-status\.js/)
})

test('el módulo se expone en el navegador sin require ni module', () => {
  const vm = require('node:vm')
  const src = fs.readFileSync(path.join(ROOT, 'main', 'mirror-connection-status.js'), 'utf8')
  const win = {}
  vm.runInContext(src, vm.createContext({ window: win }))
  assert.equal(typeof win.MirrorConnectionStatus?.describeMirrorFailure, 'function')
  assert.equal(typeof win.MirrorConnectionStatus?.computeQrRefreshDelay, 'function')
})

// nodeIntegration está desactivado: el renderer solo puede tomarlo del global,
// y para eso index.html tiene que cargarlo como <script src>.
test('index.html carga el módulo y el renderer lo toma del global', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  assert.match(html, /<script src="main\/mirror-connection-status\.js"><\/script>/)
  const renderer = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8')
  assert.match(renderer, /window\.MirrorConnectionStatus/)
  assert.doesNotMatch(renderer, /require\(['"]\.\/main\/mirror-connection-status/)
})
