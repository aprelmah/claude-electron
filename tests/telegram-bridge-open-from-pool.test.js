'use strict'

// Verifica que /abrir en TelegramBridge llama a onOpenTaskSession con chatId,
// y que el main process puede usar ese chatId para resolver del pool.
// Este test es de contrato: no instancia el pool real, simula el wiring
// que hace main.js entre bridge y pool.

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

function makeBridge(onOpenTaskSession) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-pool-test-'))
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

describe('TelegramBridge /abrir con pool oculto', () => {
  test('llama a onOpenTaskSession con chatId para que main lo enrute al pool', async () => {
    let captured = null
    const bridge = makeBridge(async (payload) => { captured = payload; return { ok: true, fromPool: true } })
    bridge.rememberRunForChat('555', {
      sessionId: 'sid-pool-1',
      cli: 'claude',
      cwd: '/tmp/proj',
      taskName: 'Tarea Pool'
    })
    await bridge._handleCommand('555', '/abrir')
    assert.ok(captured, 'onOpenTaskSession debe ejecutarse')
    assert.strictEqual(captured.sessionId, 'sid-pool-1')
    assert.strictEqual(captured.cli, 'claude')
    assert.strictEqual(captured.chatId, '555')
    assert.strictEqual(captured.cwd, '/tmp/proj')
    assert.strictEqual(captured.taskName, 'Tarea Pool')
    const sent = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(sent.text, /Enlazado/i)
    assert.match(sent.text, /Ventana abierta/i)
  })

  test('cuando main reporta fromPool, el bridge muestra mensaje confirmando ventana abierta', async () => {
    const bridge = makeBridge(async () => ({ ok: true, fromPool: true }))
    bridge.rememberRunForChat('555', { sessionId: 'sid-pool-2', cli: 'claude' })
    await bridge._handleCommand('555', '/abrir')
    const sent = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(sent.text, /Ventana abierta/i)
  })

  test('si main no encuentra entry en pool, spawna nueva ventana y devuelve ok', async () => {
    // Simula que main consultó pool (no había entry) y abrió ventana fresca.
    let payloads = []
    const bridge = makeBridge(async (payload) => {
      payloads.push(payload)
      return { ok: true }
    })
    bridge.rememberRunForChat('555', { sessionId: 'sid-fresh', cli: 'claude' })
    await bridge._handleCommand('555', '/abrir')
    assert.strictEqual(payloads.length, 1)
    assert.strictEqual(payloads[0].sessionId, 'sid-fresh')
    const sent = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(sent.text, /Ventana abierta/i)
  })
})

// Verifica el contrato sink Telegram → pool en `scheduler/sinks.js`.
const { createSinks } = require(path.join(REPO_ROOT, 'scheduler', 'sinks.js'))

describe('createSinks: onEnsureHiddenPty', () => {
  function makeFakeBridge() {
    const sent = []
    const remembered = []
    return {
      running: true,
      config: { defaultChatId: 'CHAT-1' },
      sendMessageTo: async (chatId, text) => { sent.push({ chatId, text }); return { message_id: sent.length } },
      sendMessage: async () => {},
      rememberRunForChat: (chatId, info) => { remembered.push({ chatId, info }) },
      _sent: sent,
      _remembered: remembered
    }
  }

  test('al terminar run ok con sessionId, dispara onEnsureHiddenPty con chatId, sessionId, cli, cwd, taskName', async () => {
    const bridge = makeFakeBridge()
    const calls = []
    const sinks = createSinks({
      telegramBridge: bridge,
      broadcastToAllWindows: () => {},
      onEnsureHiddenPty: async (args) => { calls.push(args); return { ok: true } }
    })
    await sinks.telegram({
      task: { name: 'Mi tarea', cli: 'claude', cwd: '/tmp/proj' },
      run: { status: 'ok', sessionId: 'sid-7', durationMs: 1500, output: 'hello', runId: 'r1', cwd: '/tmp/proj' }
    })
    assert.strictEqual(calls.length, 1)
    assert.deepStrictEqual(calls[0], {
      chatId: 'CHAT-1',
      sessionId: 'sid-7',
      cli: 'claude',
      cwd: '/tmp/proj',
      taskName: 'Mi tarea'
    })
    assert.strictEqual(bridge._remembered.length, 1)
    assert.strictEqual(bridge._sent.length, 1)
  })

  test('NO llama onEnsureHiddenPty si el run terminó en error', async () => {
    const bridge = makeFakeBridge()
    const calls = []
    const sinks = createSinks({
      telegramBridge: bridge,
      broadcastToAllWindows: () => {},
      onEnsureHiddenPty: async (args) => { calls.push(args); return { ok: true } }
    })
    await sinks.telegram({
      task: { name: 'T', cli: 'claude' },
      run: { status: 'error', sessionId: 'sid', durationMs: 100, error: 'boom' }
    })
    assert.strictEqual(calls.length, 0)
  })

  test('NO llama onEnsureHiddenPty si no hay sessionId', async () => {
    const bridge = makeFakeBridge()
    const calls = []
    const sinks = createSinks({
      telegramBridge: bridge,
      broadcastToAllWindows: () => {},
      onEnsureHiddenPty: async (args) => { calls.push(args); return { ok: true } }
    })
    await sinks.telegram({
      task: { name: 'T', cli: 'claude' },
      run: { status: 'ok', durationMs: 100, output: 'x' }
    })
    assert.strictEqual(calls.length, 0)
  })

  test('si onEnsureHiddenPty lanza, el sink no rompe el envío del mensaje', async () => {
    const bridge = makeFakeBridge()
    const sinks = createSinks({
      telegramBridge: bridge,
      broadcastToAllWindows: () => {},
      onEnsureHiddenPty: async () => { throw new Error('pool offline') }
    })
    await sinks.telegram({
      task: { name: 'T', cli: 'claude' },
      run: { status: 'ok', sessionId: 'sid', durationMs: 100, output: 'x', runId: 'r' }
    })
    assert.strictEqual(bridge._sent.length, 1, 'el mensaje a Telegram debe haberse enviado igualmente')
  })

  test('funciona sin onEnsureHiddenPty (compat hacia atrás)', async () => {
    const bridge = makeFakeBridge()
    const sinks = createSinks({ telegramBridge: bridge, broadcastToAllWindows: () => {} })
    await sinks.telegram({
      task: { name: 'T', cli: 'claude' },
      run: { status: 'ok', sessionId: 'sid', durationMs: 100, output: 'x', runId: 'r' }
    })
    assert.strictEqual(bridge._sent.length, 1)
  })
})
