'use strict'

// Feature 2026-08-02: elegir proyecto y sesión desde Telegram.
// /proyecto lista los proyectos recientes con botones inline; /sesiones lista
// las conversaciones previas del proyecto del chat. La elección se persiste en
// telegram-sessions.json ({ cwd, claude, codex }) y _runQuery pasa chatCwd al
// onRunQuery para que el headless corra en el proyecto elegido.

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

const CHAT = 777
const USER = '777'

function makeBridge(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-picker-test-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery: async () => ({ ok: true, text: 'ok' }),
    onGetActiveCli: () => 'claude',
    onGetCwd: () => '/tmp/app-cwd',
    onSetCli: async () => ({ ok: true }),
    onUnlinkRelay: async () => ({ ok: true, detached: false }),
    onStatus: () => {},
    onSemanticInput: () => {},
    onSemanticOutput: () => {},
    onOpenTaskSession: async () => ({ ok: true }),
    onListProjects: async () => [],
    onListSessions: async () => [],
    ...overrides
  })
  bridge.allowedUsers = new Set([USER])
  bridge._sent = []
  bridge._sendMessage = async (chatId, text, extra) => {
    bridge._sent.push({ chatId, text, extra })
    return { message_id: bridge._sent.length }
  }
  bridge._apiCalls = []
  bridge._api = async (method, payload) => {
    bridge._apiCalls.push({ method, payload })
    return {}
  }
  return bridge
}

function callbackUpdate(data) {
  return {
    callback_query: {
      id: 'cbq-1',
      from: { id: USER },
      data,
      message: { chat: { id: CHAT } }
    }
  }
}

describe('elección de proyecto desde Telegram', () => {
  test('/proyecto lista proyectos recientes con teclado inline', async () => {
    const bridge = makeBridge({
      onListProjects: async () => [
        { cwd: '/Users/x/Desktop/turbo e', lastUsedAt: 2 },
        { cwd: '/Users/x/Desktop/otro', lastUsedAt: 1 }
      ]
    })
    await bridge._handleCommand(CHAT, '/proyecto')
    const msg = bridge._sent[0]
    assert.ok(msg.text.includes('Elige proyecto'))
    const kb = msg.extra.reply_markup.inline_keyboard
    assert.strictEqual(kb.length, 2)
    assert.strictEqual(kb[0][0].callback_data, 'prj:0')
    assert.ok(kb[0][0].text.includes('turbo e'))
  })

  test('tocar un proyecto lo persiste como cwd del chat y limpia sesiones previas', async () => {
    const bridge = makeBridge({
      onListProjects: async () => [{ cwd: '/Users/x/Desktop/turbo e' }]
    })
    bridge._setSessionId(CHAT, 'claude', 'sid-vieja')
    await bridge._handleCommand(CHAT, '/proyecto')
    await bridge._handleUpdate(callbackUpdate('prj:0'))

    assert.strictEqual(bridge._getChatCwd(CHAT), '/Users/x/Desktop/turbo e')
    assert.strictEqual(bridge._getSessionId(CHAT, 'claude'), null)
    // Persistido en disco, no solo en memoria.
    const onDisk = JSON.parse(fs.readFileSync(bridge.sessionsPath, 'utf-8'))
    assert.strictEqual(onDisk[String(CHAT)].cwd, '/Users/x/Desktop/turbo e')
  })

  test('callback con listado caducado avisa en vez de romper', async () => {
    const bridge = makeBridge()
    await bridge._handleUpdate(callbackUpdate('prj:5'))
    assert.ok(bridge._sent[0].text.toLowerCase().includes('caducó'))
  })

  test('callback de usuario no autorizado se ignora', async () => {
    const bridge = makeBridge({ onListProjects: async () => [{ cwd: '/tmp/p' }] })
    await bridge._handleCommand(CHAT, '/proyecto')
    bridge._sent = []
    await bridge._handleUpdate({
      callback_query: { id: 'x', from: { id: '999' }, data: 'prj:0', message: { chat: { id: CHAT } } }
    })
    assert.strictEqual(bridge._sent.length, 0)
    assert.strictEqual(bridge._getChatCwd(CHAT), null)
  })
})

describe('elección de sesión desde Telegram', () => {
  test('/sesiones sin proyecto usa el cwd de la app', async () => {
    let asked = null
    const bridge = makeBridge({
      onListSessions: async (q) => { asked = q; return [] }
    })
    await bridge._handleCommand(CHAT, '/sesiones')
    assert.strictEqual(asked.cwd, '/tmp/app-cwd')
  })

  test('/sesiones lista con preview + botón de nueva sesión', async () => {
    const bridge = makeBridge({
      onListSessions: async () => [
        { id: 'sid-1', preview: 'arregla el login', mtime: Date.now() },
        { id: 'sid-2', preview: 'dame el informe', mtime: Date.now() }
      ]
    })
    bridge._setChatCwd(CHAT, '/tmp/proyecto')
    await bridge._handleCommand(CHAT, '/sesiones')
    const kb = bridge._sent[0].extra.reply_markup.inline_keyboard
    assert.strictEqual(kb.length, 3)
    assert.ok(kb[0][0].text.includes('arregla el login'))
    assert.strictEqual(kb[2][0].callback_data, 'ses:new')
  })

  test('tocar una sesión la enlaza al chat y desengancha el relay PTY', async () => {
    let unlinked = false
    const bridge = makeBridge({
      onListSessions: async () => [{ id: 'sid-elegida', preview: 'hola', mtime: 1 }],
      onUnlinkRelay: async () => { unlinked = true; return { ok: true, detached: true } }
    })
    bridge._setChatCwd(CHAT, '/tmp/proyecto')
    await bridge._handleCommand(CHAT, '/sesiones')
    await bridge._handleUpdate(callbackUpdate('ses:0'))

    assert.strictEqual(bridge._getSessionId(CHAT, 'claude'), 'sid-elegida')
    assert.strictEqual(bridge._getChatCwd(CHAT), '/tmp/proyecto')
    assert.ok(unlinked)
  })

  test('ses:new limpia la sesión pero conserva el proyecto', async () => {
    const bridge = makeBridge()
    bridge._setChatCwd(CHAT, '/tmp/proyecto')
    bridge._setSessionId(CHAT, 'claude', 'sid-vieja')
    await bridge._handleUpdate(callbackUpdate('ses:new'))

    assert.strictEqual(bridge._getSessionId(CHAT, 'claude'), null)
    assert.strictEqual(bridge._getChatCwd(CHAT), '/tmp/proyecto')
  })
})

describe('enrutado con proyecto de chat', () => {
  test('_runQuery pasa chatCwd al onRunQuery', async () => {
    let captured = null
    const bridge = makeBridge({
      onRunQuery: async (opts) => { captured = opts; return { sessionId: 'nueva' } }
    })
    bridge.running = true
    bridge._setChatCwd(CHAT, '/tmp/proyecto-elegido')
    await bridge._runQuery(CHAT, 'hola')
    assert.strictEqual(captured.chatCwd, '/tmp/proyecto-elegido')
  })

  test('/reset conserva el proyecto elegido', async () => {
    const bridge = makeBridge()
    bridge._setChatCwd(CHAT, '/tmp/proyecto')
    bridge._setSessionId(CHAT, 'claude', 'sid-vieja')
    await bridge._handleCommand(CHAT, '/reset')
    assert.strictEqual(bridge._getSessionId(CHAT, 'claude'), null)
    assert.strictEqual(bridge._getChatCwd(CHAT), '/tmp/proyecto')
  })
})
