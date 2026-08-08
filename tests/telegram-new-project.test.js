'use strict'

// /nuevoproyecto: crear un proyecto desde el móvil y dejarlo elegido para el
// chat. El nombre llega por canal → allowlist estricta (sanitizeNewProjectName),
// nunca sanear-y-seguir. Botón ➕ en el picker de /proyecto.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))
const { sanitizeNewProjectName } = require(path.join(REPO_ROOT, 'main/session-helpers.js'))

function makeBridge(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-newprj-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery: async () => ({ ok: true, text: 'x' }),
    onGetActiveCli: () => 'claude',
    onGetCwd: () => tmp,
    onSetCli: async () => ({ ok: true }),
    onStatus: () => {},
    ...overrides
  })
  bridge.running = true
  bridge.allowedUsers = new Set(['999'])
  bridge._sentMessages = []
  bridge._sendMessage = async (chatId, text, extra) => {
    bridge._sentMessages.push({ chatId, text, extra })
    return { message_id: bridge._sentMessages.length }
  }
  bridge._api = async () => ({})
  return bridge
}

describe('sanitizeNewProjectName', () => {
  test('nombres razonables pasan (espacios colapsados)', () => {
    assert.deepStrictEqual(sanitizeNewProjectName('mi-web'), { ok: true, name: 'mi-web' })
    assert.deepStrictEqual(sanitizeNewProjectName('  Mi   App 2 '), { ok: true, name: 'Mi App 2' })
    assert.deepStrictEqual(sanitizeNewProjectName('café_ñu.v2'), { ok: true, name: 'café_ñu.v2' })
  })

  test('separadores de ruta, ocultas y traversal NO pasan', () => {
    for (const bad of ['a/b', 'a\\b', '../fuera', '.oculta', '..', '', '   ', 'fin.', 'x'.repeat(61)]) {
      assert.strictEqual(sanitizeNewProjectName(bad).ok, false, `debería rechazar: ${JSON.stringify(bad)}`)
    }
  })
})

describe('/nuevoproyecto', () => {
  test('sin nombre → uso, sin llamar al hook', async () => {
    let called = 0
    const bridge = makeBridge({ onCreateProject: async () => { called++; return { ok: true, cwd: '/x' } } })
    await bridge._handleCommand('999', '/nuevoproyecto')
    assert.strictEqual(called, 0)
    assert.match(bridge._sentMessages[0].text, /Uso: \/nuevoproyecto/)
  })

  test('crea, fija cwd del chat y limpia sesiones', async () => {
    const bridge = makeBridge({
      onCreateProject: async (name) => ({ ok: true, cwd: `/Users/isabel/Desktop/LUISMI/${name}`, existed: false })
    })
    bridge._setSessionId('999', 'claude', 'sid-viejo')
    await bridge._handleCommand('999', '/nuevoproyecto mi-web')
    assert.match(bridge._sentMessages.at(-1).text, /Proyecto creado: .*mi-web/)
    assert.strictEqual(bridge._getChatCwd('999'), '/Users/isabel/Desktop/LUISMI/mi-web')
    assert.ok(!bridge._getSessionId('999', 'claude'))
  })

  test('ya existía → lo dice y lo deja elegido', async () => {
    const bridge = makeBridge({
      onCreateProject: async () => ({ ok: true, cwd: '/Users/isabel/Desktop/LUISMI/mi-web', existed: true })
    })
    await bridge._handleCommand('999', '/nuevoproyecto mi-web')
    assert.match(bridge._sentMessages.at(-1).text, /Ya existía/)
    assert.strictEqual(bridge._getChatCwd('999'), '/Users/isabel/Desktop/LUISMI/mi-web')
  })

  test('hook con error → mensaje claro y cwd intacto', async () => {
    const bridge = makeBridge({
      onCreateProject: async () => ({ ok: false, error: 'nombre inválido' })
    })
    await bridge._handleCommand('999', '/nuevoproyecto ../fuera')
    assert.match(bridge._sentMessages.at(-1).text, /No pude crear el proyecto: nombre inválido/)
    assert.ok(!bridge._getChatCwd('999'))
  })

  test('sin hook → no disponible', async () => {
    const bridge = makeBridge()
    await bridge._handleCommand('999', '/nuevoproyecto mi-web')
    assert.match(bridge._sentMessages[0].text, /no está disponible/)
  })

  test('el picker de /proyecto lleva el botón ➕ y prj:new ARMA el siguiente mensaje', async () => {
    const bridge = makeBridge({
      onListProjects: async () => ['/Users/isabel/Desktop/LUISMI/uno'],
      onCreateProject: async (name) => ({ ok: true, cwd: `/Users/isabel/Desktop/LUISMI/${name}`, existed: false })
    })
    await bridge._handleCommand('999', '/proyecto')
    const flat = bridge._sentMessages[0].extra.reply_markup.inline_keyboard.flat()
    assert.ok(flat.some((b) => b.callback_data === 'prj:new'))
    await bridge._handleCallback({ id: 'cb1', data: 'prj:new', from: { id: 999 }, message: { chat: { id: 999 } } })
    assert.match(bridge._sentMessages.at(-1).text, /siguiente mensaje/)
    assert.strictEqual(bridge.pendingPickers.get('999')?.type, 'project-name')
  })

  test('armado: el siguiente mensaje a secas CREA el proyecto, no va al CLI (bug de UX 2026-08-08)', async () => {
    const queries = []
    const bridge = makeBridge({
      onCreateProject: async (name) => ({ ok: true, cwd: `/Users/isabel/Desktop/LUISMI/${name}`, existed: false })
    })
    bridge._enqueueQuery = async (chatId, text) => { queries.push(text) }
    await bridge._handleCallback({ id: 'cb1', data: 'prj:new', from: { id: 999 }, message: { chat: { id: 999 } } })
    await bridge._handleUpdate({ message: { chat: { id: 999 }, from: { id: 999 }, text: 'Prueba PROYECTO' } })
    assert.deepStrictEqual(queries, [])
    assert.match(bridge._sentMessages.at(-1).text, /Proyecto creado: .*Prueba PROYECTO/)
    assert.strictEqual(bridge._getChatCwd('999'), '/Users/isabel/Desktop/LUISMI/Prueba PROYECTO')
    assert.strictEqual(bridge.pendingPickers.get('999'), undefined)
  })

  test('armado + comando → se desarma y el mensaje siguiente viaja como prompt normal', async () => {
    const queries = []
    const bridge = makeBridge({
      onCreateProject: async () => ({ ok: true, cwd: '/x', existed: false })
    })
    bridge._enqueueQuery = async (chatId, text) => { queries.push(text) }
    await bridge._handleCallback({ id: 'cb1', data: 'prj:new', from: { id: 999 }, message: { chat: { id: 999 } } })
    await bridge._handleUpdate({ message: { chat: { id: 999 }, from: { id: 999 }, text: '/cancel' } })
    assert.strictEqual(bridge.pendingPickers.get('999'), undefined)
    await bridge._handleUpdate({ message: { chat: { id: 999 }, from: { id: 999 }, text: 'hola de nuevo' } })
    assert.deepStrictEqual(queries, ['hola de nuevo'])
  })

  test('armado caducado (TTL) → el mensaje sigue su camino normal, no crea carpeta', async () => {
    const queries = []
    let created = 0
    const bridge = makeBridge({
      onCreateProject: async () => { created++; return { ok: true, cwd: '/x', existed: false } }
    })
    bridge._enqueueQuery = async (chatId, text) => { queries.push(text) }
    bridge.pendingPickers.set('999', { type: 'project-name', ts: Date.now() - 6 * 60 * 1000 })
    await bridge._handleUpdate({ message: { chat: { id: 999 }, from: { id: 999 }, text: 'esto era un prompt' } })
    assert.strictEqual(created, 0)
    assert.deepStrictEqual(queries, ['esto era un prompt'])
    assert.strictEqual(bridge.pendingPickers.get('999'), undefined)
  })

  test('sin proyectos recientes el picker sale igual, solo con ➕', async () => {
    const bridge = makeBridge({ onListProjects: async () => [] })
    await bridge._handleCommand('999', '/proyecto')
    const rows = bridge._sentMessages[0].extra.reply_markup.inline_keyboard
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0][0].callback_data, 'prj:new')
  })
})
