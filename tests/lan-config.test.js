'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createConfigNormalizers } = require('../main/config-store')

function normalizers() {
  return createConfigNormalizers({
    clampLanPort: (value) => Number(value) || 9999,
    normalizeEnterpriseConfig: (value) => value || { enabled: false },
    defaultEnterpriseRoleId: 'role-default'
  })
}

test('las URLs públicas LAN solo aceptan HTTPS/WSS y no guardan query', () => {
  const cfg = normalizers().normalizeLanServerConfig({
    publicClientUrl: 'http://agent.example.test/client?token=leak',
    publicWsUrl: 'ws://agent-ws.example.test?token=leak'
  })
  assert.equal(cfg.publicClientUrl, '')
  assert.equal(cfg.publicWsUrl, '')

  const safe = normalizers().normalizeLanServerConfig({
    publicClientUrl: 'https://agent.example.test/lan-client.html?token=leak#hash',
    publicWsUrl: 'wss://agent-ws.example.test?invite=leak'
  })
  assert.equal(safe.publicClientUrl, 'https://agent.example.test/lan-client.html')
  assert.equal(safe.publicWsUrl, 'wss://agent-ws.example.test')
})

// El mismo host sirve el cliente y el WebSocket: `cloudflared` imprime una sola
// direccion `https://...trycloudflare.com` y el operador la pega en los dos
// campos. Descartarla en silencio en el campo WS es el bug de 4ff868b una capa
// mas abajo: ahora se coerciona el esquema equivalente y, si de verdad hay que
// descartar, se explica.
test('el campo WS acepta la URL https del tunel y la coerciona a wss', () => {
  const { explainLanPublicUrl, normalizeLanPublicUrl, normalizeLanServerConfig } = normalizers()
  const res = explainLanPublicUrl('https://x.trycloudflare.com', 'ws')
  assert.equal(res.value, 'wss://x.trycloudflare.com')
  assert.equal(res.error, null)
  assert.equal(normalizeLanPublicUrl('https://x.trycloudflare.com', 'ws'), 'wss://x.trycloudflare.com')
  assert.equal(
    normalizeLanServerConfig({ publicWsUrl: 'https://x.trycloudflare.com' }).publicWsUrl,
    'wss://x.trycloudflare.com'
  )
})

test('el campo cliente acepta wss y lo coerciona a https', () => {
  const { explainLanPublicUrl, normalizeLanServerConfig } = normalizers()
  const res = explainLanPublicUrl('wss://y.trycloudflare.com', 'client')
  assert.equal(res.value, 'https://y.trycloudflare.com')
  assert.equal(res.error, null)
  assert.equal(
    normalizeLanServerConfig({ publicClientUrl: 'wss://y.trycloudflare.com' }).publicClientUrl,
    'https://y.trycloudflare.com'
  )
})

test('wss y https en su propio campo se quedan igual', () => {
  const { explainLanPublicUrl } = normalizers()
  assert.deepEqual(
    explainLanPublicUrl('wss://a.example.test/ws', 'ws'),
    { value: 'wss://a.example.test/ws', error: null }
  )
  assert.deepEqual(
    explainLanPublicUrl('https://a.example.test/lan-client.html', 'client'),
    { value: 'https://a.example.test/lan-client.html', error: null }
  )
})

test('http y ws se descartan CON error en ambos campos', () => {
  const { explainLanPublicUrl } = normalizers()
  for (const kind of ['client', 'ws']) {
    for (const raw of ['http://algo', 'ws://algo']) {
      const res = explainLanPublicUrl(raw, kind)
      assert.equal(res.value, '', `${kind} / ${raw}`)
      assert.ok(res.error, `${kind} / ${raw} deberia explicar el descarte`)
      assert.match(res.error, /https:\/\//)
      assert.match(res.error, /wss:\/\//)
    }
  }
  const ftp = explainLanPublicUrl('ftp://algo', 'ws')
  assert.equal(ftp.value, '')
  assert.match(ftp.error, /ftp:\/\//)
})

test('vacio o ausente no es error: borrar el campo es legitimo', () => {
  const { explainLanPublicUrl } = normalizers()
  assert.deepEqual(explainLanPublicUrl('', 'ws'), { value: '', error: null })
  assert.deepEqual(explainLanPublicUrl('   ', 'client'), { value: '', error: null })
  assert.deepEqual(explainLanPublicUrl(undefined, 'ws'), { value: '', error: null })
  assert.deepEqual(explainLanPublicUrl(null, 'client'), { value: '', error: null })
  assert.deepEqual(explainLanPublicUrl(42, 'ws'), { value: '', error: null })
})

test('explainLanPublicUrl mantiene las garantias previas', () => {
  const { explainLanPublicUrl } = normalizers()

  // Query y hash se siguen borrando (sin error: la URL es valida).
  const clean = explainLanPublicUrl('https://a.example.test/c.html?token=leak#h', 'client')
  assert.deepEqual(clean, { value: 'https://a.example.test/c.html', error: null })

  // Credenciales: descartado, con error, y el error NO las repite.
  const creds = explainLanPublicUrl('https://user:pass@a.example.test/?token=leak', 'ws')
  assert.equal(creds.value, '')
  assert.ok(creds.error)
  assert.ok(!creds.error.includes('pass'), 'el mensaje no puede filtrar la contrasena')
  assert.ok(!creds.error.includes('user'), 'el mensaje no puede filtrar el usuario')
  assert.ok(!creds.error.includes('leak'), 'el mensaje no puede filtrar la query')

  // Longitud > 500.
  const long = explainLanPublicUrl(`https://a.example.test/${'x'.repeat(500)}`, 'ws')
  assert.equal(long.value, '')
  assert.ok(long.error)
  assert.ok(!long.error.includes('xxxx'), 'el mensaje no puede volcar la URL entera')

  // Caracteres de control.
  const ctrl = explainLanPublicUrl('https://a.example.test/\r\nX', 'client')
  assert.equal(ctrl.value, '')
  assert.ok(ctrl.error)

  // Texto que no es URL.
  const junk = explainLanPublicUrl('no soy una url', 'ws')
  assert.equal(junk.value, '')
  assert.ok(junk.error)
})

test('normalizeLanPublicUrl y explainLanPublicUrl nunca divergen', () => {
  const { explainLanPublicUrl, normalizeLanPublicUrl } = normalizers()
  const casos = [
    'https://x.trycloudflare.com',
    'wss://x.trycloudflare.com',
    'http://algo',
    'ws://algo',
    'ftp://algo',
    'https://user:pass@a.example.test',
    'https://a.example.test/c.html?token=leak#h',
    '',
    'no soy una url'
  ]
  for (const kind of ['client', 'ws']) {
    for (const raw of casos) {
      assert.equal(
        normalizeLanPublicUrl(raw, kind),
        explainLanPublicUrl(raw, kind).value,
        `${kind} / ${raw}`
      )
    }
  }
})

test('explainLanPublicUrl tambien se exporta a nivel de modulo', () => {
  const mod = require('../main/config-store')
  assert.equal(typeof mod.explainLanPublicUrl, 'function')
  assert.equal(typeof mod.normalizeLanPublicUrl, 'function')
  assert.deepEqual(
    mod.explainLanPublicUrl('https://x.trycloudflare.com', 'ws'),
    { value: 'wss://x.trycloudflare.com', error: null }
  )
})
