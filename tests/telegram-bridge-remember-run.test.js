// Verifica rememberRunForChat y comando /abrir en TelegramBridge (cabo 3).
// Test puro: no requiere red, no arranca polling.

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

function makeBridge({ onOpenTaskSession } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-bridge-test-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery: async () => ({ ok: true, text: 'ignored' }),
    onGetActiveCli: () => 'claude',
    onGetCwd: () => tmp,
    onSetCli: async () => ({ ok: true }),
    onUnlinkRelay: async () => ({ ok: true, linked: false }),
    onStatus: () => {},
    onSemanticInput: () => {},
    onSemanticOutput: () => {},
    onOpenTaskSession
  })
  bridge._sentMessages = []
  bridge._sendMessage = async (chatId, text) => {
    bridge._sentMessages.push({ chatId, text })
    return { message_id: bridge._sentMessages.length }
  }
  return bridge
}

describe('TelegramBridge.rememberRunForChat', () => {
  test('guarda run y permite leerlo por chatId', () => {
    const bridge = makeBridge()
    bridge.rememberRunForChat('123', {
      sessionId: 'abc-12345',
      cli: 'claude',
      cwd: '/tmp',
      taskName: 'Mi tarea',
      runId: 'r1'
    })
    const stored = bridge.lastRunByChat.get('123')
    assert.strictEqual(stored.sessionId, 'abc-12345')
    assert.strictEqual(stored.cli, 'claude')
    assert.strictEqual(stored.taskName, 'Mi tarea')
    assert.strictEqual(stored.runId, 'r1')
  })

  test('ignora payload sin sessionId', () => {
    const bridge = makeBridge()
    bridge.rememberRunForChat('123', { cli: 'codex' })
    assert.strictEqual(bridge.lastRunByChat.size, 0)
  })

  test('normaliza cli inválido a claude', () => {
    const bridge = makeBridge()
    bridge.rememberRunForChat('77', { sessionId: 'sid', cli: 'whatever' })
    assert.strictEqual(bridge.lastRunByChat.get('77').cli, 'claude')
  })

  test('cap 64 entradas evita memory leak', () => {
    const bridge = makeBridge()
    for (let i = 0; i < 70; i++) {
      bridge.rememberRunForChat(String(i), { sessionId: 'sid' + i })
    }
    assert.strictEqual(bridge.lastRunByChat.size, 64)
  })
})

describe('TelegramBridge /abrir command', () => {
  test('sin run previo responde con mensaje claro', async () => {
    const bridge = makeBridge()
    await bridge._handleCommand('123', '/abrir')
    const sent = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(sent.text, /No hay sesión reciente/i)
  })

  test('con run previo enlaza sessionId al chat, abre ventana y notifica', async () => {
    let opened = null
    const bridge = makeBridge({
      onOpenTaskSession: async (payload) => { opened = payload; return { ok: true } }
    })
    bridge.rememberRunForChat('123', {
      sessionId: 'abc-12345',
      cli: 'codex',
      cwd: '/tmp/proj',
      taskName: 'Diaria 21:00'
    })
    await bridge._handleCommand('123', '/abrir')
    assert.strictEqual(opened.sessionId, 'abc-12345')
    assert.strictEqual(opened.cli, 'codex')
    assert.strictEqual(opened.chatId, '123')
    // _setSessionId debe haber registrado el sid para el cli del run
    assert.strictEqual(bridge._getSessionId('123', 'codex'), 'abc-12345')
    const sent = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(sent.text, /Enlazado a la sesión/i)
    assert.match(sent.text, /próximos mensajes/i)
    assert.match(sent.text, /Ventana abierta/i)
  })

  test('si onOpenTaskSession falla, el enlace de sessionId persiste y se reporta', async () => {
    const bridge = makeBridge({
      onOpenTaskSession: async () => ({ ok: false, error: 'ventana cerrada' })
    })
    bridge.rememberRunForChat('123', { sessionId: 'sid-7890', cli: 'claude' })
    await bridge._handleCommand('123', '/abrir')
    // sessionId del chat queda anclado aunque la ventana local falle
    assert.strictEqual(bridge._getSessionId('123', 'claude'), 'sid-7890')
    const sent = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(sent.text, /Enlazado/i)
    assert.match(sent.text, /No abrí ventana local/i)
    assert.match(sent.text, /ventana cerrada/)
  })

  test('si el CLI activo difiere del cli del run, intenta cambiarlo', async () => {
    let cliChangedTo = null
    const bridge = makeBridge({
      onOpenTaskSession: async () => ({ ok: true })
    })
    bridge.onGetActiveCli = () => 'claude'
    bridge.onSetCli = async (target) => { cliChangedTo = target; return { ok: true } }
    bridge.rememberRunForChat('123', { sessionId: 'sid-1', cli: 'codex' })
    await bridge._handleCommand('123', '/abrir')
    assert.strictEqual(cliChangedTo, 'codex')
    const sent = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(sent.text, /CLI cambiado a codex/i)
  })

  test('desliga relay PTY previo del chat', async () => {
    let unlinkedChat = null
    const bridge = makeBridge({
      onOpenTaskSession: async () => ({ ok: true })
    })
    bridge.onUnlinkRelay = async (chatId) => { unlinkedChat = chatId; return { ok: true, detached: true } }
    bridge.rememberRunForChat('123', { sessionId: 'sid', cli: 'claude' })
    await bridge._handleCommand('123', '/abrir')
    assert.strictEqual(unlinkedChat, '123')
    const sent = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(sent.text, /relay PTY anterior desenlazado/i)
  })

  test('aliases /sesion /sesión /continuar funcionan igual que /abrir', async () => {
    let calls = 0
    const bridge = makeBridge({
      onOpenTaskSession: async () => { calls++; return { ok: true } }
    })
    bridge.rememberRunForChat('123', { sessionId: 'sid', cli: 'claude' })
    await bridge._handleCommand('123', '/sesion')
    await bridge._handleCommand('123', '/sesión')
    await bridge._handleCommand('123', '/continuar')
    assert.strictEqual(calls, 3)
  })
})
