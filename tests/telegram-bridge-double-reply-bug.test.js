'use strict'

// Reproduce bug: cuando user responde tras tarea programada con sessionId,
// el bot envía DOS mensajes en lugar de uno.
// La causa raíz: race condition entre TelegramStream._flush() (disparado por setTimeout
// desde _maybeFlush via appendText) y TelegramStream.finalize() — ambos pueden invocar
// _sendMessage si _flush está esperando a red cuando finalize entra en su await.

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

function makeBridge({ onRunQuery, capture, sendDelayMs = 0 }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-double-bug-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery,
    onGetActiveCli: () => 'claude',
    onGetCwd: () => tmp,
    onSetCli: async () => ({ ok: true }),
    onUnlinkRelay: async () => ({ ok: true, linked: false }),
    onStatus: () => {},
    onSemanticInput: () => {},
    onSemanticOutput: () => {},
    onOpenTaskSession: async () => ({ ok: true })
  })
  bridge.running = true
  bridge.config = { defaultChatId: '1503529320', allowedUsers: new Set(['1503529320']) }
  bridge._sendMessage = async (chatId, text) => {
    capture.sent.push({ chatId: String(chatId), text, t: Date.now() })
    if (sendDelayMs > 0) await new Promise((r) => setTimeout(r, sendDelayMs))
    return { message_id: capture.sent.length }
  }
  bridge._editMessage = async (chatId, messageId, text) => {
    capture.edits.push({ chatId: String(chatId), messageId, text, t: Date.now() })
    return { message_id: messageId }
  }
  bridge._sendChatAction = async () => ({})
  return bridge
}

describe('telegram-bridge: bug de doble respuesta por race _flush/finalize', () => {
  test('REPRO: onText + setImmediate antes de retornar (yield) reproduce doble envío', async () => {
    const capture = { sent: [], edits: [] }
    const bridge = makeBridge({
      onRunQuery: async (opts) => {
        // Simula relay/headless: invoca onText y cede el control al event loop
        // antes de resolver. Esto deja al setTimeout(0) tiempo para arrancar
        // _flush, que se queda esperando la red mientras finalize entra.
        opts.onText?.('Respuesta del relay')
        await new Promise((r) => setImmediate(r))
        return { sessionId: 'sid-1', text: 'Respuesta del relay' }
      },
      capture,
      sendDelayMs: 80 // red simulada — _flush se queda esperando aquí
    })

    await bridge._runQuery('1503529320', 'A la papelera')

    // Antes del fix: capture.sent.length === 2 (BUG)
    // Tras el fix: capture.sent.length === 1
    assert.strictEqual(
      capture.sent.length,
      1,
      `BUG REPRODUCIDO: ${capture.sent.length} mensajes en vez de 1: ${JSON.stringify(capture.sent.map(s => ({ t: s.t, text: s.text.slice(0, 40) })))}`
    )
  })

  test('streaming chunks múltiples no debe duplicar', async () => {
    const capture = { sent: [], edits: [] }
    const bridge = makeBridge({
      onRunQuery: async (opts) => {
        opts.onText?.('chunk1 ')
        await new Promise((r) => setImmediate(r))
        opts.onText?.('chunk2 ')
        await new Promise((r) => setImmediate(r))
        opts.onText?.('chunk3')
        return { sessionId: 'sid-1', text: 'chunk1 chunk2 chunk3' }
      },
      capture,
      sendDelayMs: 50
    })

    await bridge._runQuery('1503529320', 'hola')
    assert.strictEqual(
      capture.sent.length,
      1,
      `Streaming: ${capture.sent.length} mensajes en vez de 1`
    )
  })

  test('appendStatus (tool_use) seguido de finalize no duplica', async () => {
    const capture = { sent: [], edits: [] }
    const bridge = makeBridge({
      onRunQuery: async (opts) => {
        opts.onToolUse?.('Read')
        await new Promise((r) => setImmediate(r))
        opts.onText?.('texto final')
        return { sessionId: 'sid-1' }
      },
      capture,
      sendDelayMs: 50
    })

    await bridge._runQuery('1503529320', 'hola')
    assert.strictEqual(
      capture.sent.length,
      1,
      `Tool+texto: ${capture.sent.length} mensajes en vez de 1: ${capture.sent.map(s => s.text.slice(0,30))}`
    )
  })

  test('finalize sin onText previo no rompe (caso normal)', async () => {
    const capture = { sent: [], edits: [] }
    const bridge = makeBridge({
      onRunQuery: async () => ({ sessionId: 'sid-1' }),
      capture,
      sendDelayMs: 30
    })

    await bridge._runQuery('1503529320', 'hola')
    assert.strictEqual(capture.sent.length, 1, 'debe enviar placeholder (sin respuesta)')
  })
})
