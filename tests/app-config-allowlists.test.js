'use strict'

const test = require('node:test')
const assert = require('node:assert')

const fs = require('fs')
const path = require('path')

const { SAFE_CLI, SAFE_TELEGRAM, SAFE_LAN, pick, pickDropped } = require('../main/app-config-allowlists')

test('pick solo copia las claves de la allowlist', () => {
  const out = pick({ enabled: true, port: 9999, authToken: 'secreto' }, SAFE_LAN)
  assert.deepStrictEqual(out, { enabled: true, port: 9999 })
})

test('pick tolera entradas que no son objeto', () => {
  assert.deepStrictEqual(pick(null, SAFE_LAN), {})
  assert.deepStrictEqual(pick(undefined, SAFE_LAN), {})
  assert.deepStrictEqual(pick('texto', SAFE_LAN), {})
  assert.deepStrictEqual(pick(42, SAFE_LAN), {})
})

test('pick distingue ausente de vacío: un campo borrado a propósito debe pasar', () => {
  // Vaciar publicClientUrl en la UI es la forma de dejar de publicar fuera.
  // Si pick ignorase el string vacío, la URL vieja quedaría pegada para siempre.
  const out = pick({ publicClientUrl: '' }, SAFE_LAN)
  assert.deepStrictEqual(out, { publicClientUrl: '' })
})

test('pick no hereda del prototipo', () => {
  const malicioso = Object.create({ port: 1234 })
  assert.deepStrictEqual(pick(malicioso, SAFE_LAN), {})
})

// Regresión del 2026-08-13: SAFE_LAN era ['enabled', 'port'], así que el
// renderer enviaba las dos URLs públicas y save-app-config las descartaba en
// silencio. Los campos volvían vacíos al guardar y la publicación por
// Cloudflare Tunnel era inalcanzable desde la interfaz.
test('SAFE_LAN deja pasar las URLs públicas del túnel', () => {
  const enviado = {
    enabled: true,
    port: 9999,
    publicClientUrl: 'https://ejemplo.trycloudflare.com/lan-client.html',
    publicWsUrl: 'wss://ejemplo-ws.trycloudflare.com'
  }
  assert.deepStrictEqual(pick(enviado, SAFE_LAN), enviado)
})

test('SAFE_LAN nunca acepta authToken desde el renderer', () => {
  assert.ok(!SAFE_LAN.includes('authToken'))
  const out = pick({ port: 9999, authToken: 'robado' }, SAFE_LAN)
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'authToken'))
})

test('SAFE_CLI y SAFE_TELEGRAM no exponen configuración de empresa', () => {
  for (const lista of [SAFE_CLI, SAFE_TELEGRAM, SAFE_LAN]) {
    assert.ok(!lista.includes('roles'))
    assert.ok(!lista.includes('operators'))
    assert.ok(!lista.includes('enterprise'))
  }
})

test('las allowlists no tienen claves repetidas', () => {
  for (const lista of [SAFE_CLI, SAFE_TELEGRAM, SAFE_LAN]) {
    assert.strictEqual(new Set(lista).size, lista.length)
  }
})

// ── pickDropped: el descarte deja de ser mudo ───────────────────────────────
// `pick` tira las claves desconocidas sin decir nada; quien llama necesita
// poder avisar (log/warning) de lo que se quedó fuera.

test('pickDropped lista las claves que pick descartaría', () => {
  const enviado = { enabled: true, port: 9999, authToken: 'secreto', vieja: 1 }
  assert.deepStrictEqual(pickDropped(enviado, SAFE_LAN), ['authToken', 'vieja'])
})

test('pickDropped devuelve [] cuando todas las claves son válidas', () => {
  const enviado = { enabled: true, port: 9999, publicClientUrl: '', publicWsUrl: '' }
  assert.deepStrictEqual(pickDropped(enviado, SAFE_LAN), [])
})

test('pickDropped devuelve [] con objeto vacío', () => {
  assert.deepStrictEqual(pickDropped({}, SAFE_LAN), [])
})

test('pickDropped tolera entradas que no son objeto', () => {
  assert.deepStrictEqual(pickDropped(null, SAFE_LAN), [])
  assert.deepStrictEqual(pickDropped(undefined, SAFE_LAN), [])
  assert.deepStrictEqual(pickDropped('texto', SAFE_LAN), [])
  assert.deepStrictEqual(pickDropped(42, SAFE_LAN), [])
  assert.deepStrictEqual(pickDropped([], SAFE_LAN), [])
})

test('pickDropped no mira el prototipo', () => {
  const heredado = Object.create({ noExiste: 1 })
  heredado.propia = 2
  assert.deepStrictEqual(pickDropped(heredado, SAFE_LAN), ['propia'])
})

test('pickDropped cuenta una clave presente aunque valga undefined', () => {
  // `{ desconocida: undefined }` SÍ se descarta: la clave viajó y se perdió.
  assert.deepStrictEqual(pickDropped({ desconocida: undefined }, SAFE_LAN), ['desconocida'])
  assert.deepStrictEqual(pickDropped({ port: undefined }, SAFE_LAN), [])
})

test('pickDropped respeta el orden de Object.keys', () => {
  assert.deepStrictEqual(pickDropped({ zzz: 1, port: 2, aaa: 3 }, SAFE_LAN), ['zzz', 'aaa'])
})

test('pickDropped no cambia el comportamiento de pick', () => {
  const enviado = { enabled: true, sobra: 'x' }
  assert.deepStrictEqual(pick(enviado, SAFE_LAN), { enabled: true })
  assert.deepStrictEqual(pickDropped(enviado, SAFE_LAN), ['sobra'])
})

// ── Invariante renderer ↔ allowlist ─────────────────────────────────────────
// El bug de 2026-08-13 costó SEIS días: el renderer mandaba publicClientUrl y
// publicWsUrl, SAFE_LAN no las listaba, `pick` las tiraba sin un solo error y
// ningún test ataba las dos puntas. Este test las ata: TODA clave que el
// renderer envía de verdad en `saveAppConfig(payload)` tiene que estar en su
// allowlist.
//
// SI ESTE TEST FALLA:
//   1) Has añadido un campo al payload de renderer.js → añádelo TAMBIÉN a la
//      SAFE_* correspondiente en main/app-config-allowlists.js y a la lista
//      esperada de aquí abajo. Sin el primer paso, el campo se "guarda" sin
//      error y vuelve vacío al recargar.
//   2) Has reestructurado el bloque `const payload = {` del handler de
//      btnSaveSettings → arregla el extractor o pásalo a listas explícitas.
//      Lo que NO puede pasar es que este test se quede en verde sin mirar nada:
//      por eso se compara contra listas explícitas y no solo "es subconjunto".

const RENDERER_SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8')

// Devuelve el interior del literal `{...}` que empieza en `openIndex`.
function sliceBalanced(src, openIndex) {
  let depth = 0
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(openIndex + 1, i)
    }
  }
  return null
}

// Claves de primer nivel de un cuerpo de objeto literal. Salta cadenas y
// cuenta profundidad de {} [] () para no confundir claves anidadas ni el ':'
// de un ternario (ahí el ':' no viene precedido de '{' ni de ',').
function topLevelKeys(body) {
  const keys = []
  let depth = 0
  let prev = '{'
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < body.length && body[i] !== quote) {
        if (body[i] === '\\') i++
        i++
      }
      prev = quote
      continue
    }
    if (c === '{' || c === '[' || c === '(') { depth++; prev = c; continue }
    if (c === '}' || c === ']' || c === ')') { depth--; prev = c; continue }
    if (/\s/.test(c)) continue
    if (depth === 0 && (prev === '{' || prev === ',')) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i))
      if (m) {
        keys.push(m[1])
        i += m[0].length - 1
        prev = ':'
        continue
      }
    }
    prev = c
  }
  return keys
}

function payloadBody() {
  const marker = 'const payload = {'
  const at = RENDERER_SRC.indexOf(marker)
  assert.notStrictEqual(at, -1, 'no se encontró `const payload = {` en renderer.js: el handler de guardar cambió de forma, revisa este test')
  const body = sliceBalanced(RENDERER_SRC, at + marker.length - 1)
  assert.ok(body, 'el literal `const payload = {` de renderer.js no cierra: extractor desincronizado')
  return body
}

function sectionKeys(body, section) {
  const re = new RegExp(`(?:^|[,{\\s])${section}\\s*:\\s*\\{`, 'm')
  const m = re.exec(body)
  assert.ok(m, `no se encontró la sección \`${section}\` en el payload de renderer.js`)
  const open = body.indexOf('{', m.index + m[0].length - 1)
  const inner = sliceBalanced(body, open)
  assert.ok(inner, `la sección \`${section}\` del payload no cierra: extractor desincronizado`)
  return topLevelKeys(inner)
}

// Espejo EXPLÍCITO del payload de renderer.js (~línea 2916). Si cambia el
// payload, esta lista tiene que cambiar con él — y con ella la SAFE_*.
const PAYLOAD_ESPERADO = {
  cli: [
    'defaultCli', 'claudeBin', 'claudeModel', 'gitSessionIsolation',
    'gitIsolationExcludes', 'codexBin', 'whisperBin', 'voiceId', 'voiceRate', 'voiceSilenceMs'
  ],
  telegram: [
    'enabled', 'botToken', 'allowedUsers', 'claudeModel', 'claudeEffort',
    'codexModel', 'codexEffort', 'notifyBotToken', 'notifyChatId', 'healthWatchdog'
  ],
  lanServer: ['enabled', 'port', 'publicClientUrl', 'publicWsUrl']
}

const ALLOWLIST_POR_SECCION = { cli: SAFE_CLI, telegram: SAFE_TELEGRAM, lanServer: SAFE_LAN }

test('el payload de renderer.js solo tiene las tres secciones con allowlist', () => {
  const secciones = topLevelKeys(payloadBody())
  assert.deepStrictEqual(
    secciones,
    ['cli', 'telegram', 'lanServer'],
    'sección nueva en el payload de save-app-config: necesita su propia allowlist SAFE_* en main/app-config-allowlists.js (si no, se descarta entera y en silencio)'
  )
})

for (const [seccion, esperadas] of Object.entries(PAYLOAD_ESPERADO)) {
  test(`el payload de renderer.js para \`${seccion}\` es el que dice este test`, () => {
    const leidas = sectionKeys(payloadBody(), seccion)
    assert.deepStrictEqual(
      leidas,
      esperadas,
      `las claves que renderer.js envía en \`${seccion}\` ya no son las esperadas. Actualiza PAYLOAD_ESPERADO y, si el campo es nuevo, añádelo a la allowlist SAFE_* o se descartará al guardar sin ningún error.`
    )
  })

  test(`toda clave de \`${seccion}\` que envía el renderer pasa la allowlist`, () => {
    const allowlist = ALLOWLIST_POR_SECCION[seccion]
    const leidas = sectionKeys(payloadBody(), seccion)
    assert.ok(leidas.length > 0, `extracción vacía para \`${seccion}\`: el test no está comprobando nada`)
    const descartadas = leidas.filter((k) => !allowlist.includes(k))
    assert.deepStrictEqual(
      descartadas,
      [],
      `renderer.js envía ${JSON.stringify(descartadas)} en \`${seccion}\` y save-app-config las tira EN SILENCIO. Añádelas a la allowlist de main/app-config-allowlists.js.`
    )
  })
}

// Regresión del poll de 5 s (2026-08-15): `snapshot?.publicClientUrl || input.value`
// hacía imposible vaciar el campo desde la UI — el snapshot viejo lo rerellenaba.
// Con `??` un '' del servidor se pinta como ''.
test('renderLanStatus usa ?? (no ||) al pintar las URLs públicas del snapshot', () => {
  assert.ok(
    !/snapshot\?\.publicClientUrl\s*\|\|/.test(RENDERER_SRC),
    'renderer.js vuelve a encadenar publicClientUrl con ||: un vacío legítimo del servidor no se puede pintar'
  )
  assert.ok(
    !/snapshot\?\.publicWsUrl\s*\|\|/.test(RENDERER_SRC),
    'renderer.js vuelve a encadenar publicWsUrl con ||: un vacío legítimo del servidor no se puede pintar'
  )
})
