'use strict'

// Flujo de no autorizado en el bridge: con onPairingRequest configurado, el
// desconocido recibe un código de vinculación en vez del rechazo seco. Sin
// hook (o si peta), se conserva el mensaje de siempre — fail-open al legacy.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

function makeBridge(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-pairing-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery: async () => ({ ok: true, text: 'respuesta' }),
    onGetActiveCli: () => 'claude',
    onGetCwd: () => tmp,
    onSetCli: async () => ({ ok: true }),
    onStatus: () => {},
    onPairingRequest: overrides.onPairingRequest
  })
  bridge.running = true
  bridge.allowedUsers = new Set(['999'])
  bridge._sentMessages = []
  bridge._sendMessage = async (chatId, text) => {
    bridge._sentMessages.push({ chatId, text })
    return { message_id: bridge._sentMessages.length }
  }
  bridge._api = async () => ({})
  return bridge
}

function update(fromId, text) {
  return {
    message: {
      chat: { id: Number(fromId) },
      from: { id: Number(fromId), username: 'intruso', first_name: 'Intruso' },
      text
    }
  }
}

describe('bridge: desconocido con emparejamiento', () => {
  test('recibe el código y no se procesa su mensaje', async () => {
    const seen = []
    const bridge = makeBridge({
      onPairingRequest: (req) => {
        seen.push(req)
        return { ok: true, code: '123456', created: true }
      }
    })
    await bridge._handleUpdate(update('111', 'hola'))
    assert.strictEqual(seen.length, 1)
    assert.strictEqual(seen[0].userId, '111')
    assert.strictEqual(seen[0].username, 'intruso')
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /123456/)
    assert.match(msg, /Configuraci/)
  })

  test('rate-limited: mensaje de "más tarde", sin código', async () => {
    const bridge = makeBridge({
      onPairingRequest: () => ({ ok: false, reason: 'rate-limited' })
    })
    await bridge._handleUpdate(update('111', 'hola'))
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /tarde/i)
    assert.doesNotMatch(msg, /\d{6}/)
  })

  test('sin hook: rechazo legacy', async () => {
    const bridge = makeBridge({})
    await bridge._handleUpdate(update('111', 'hola'))
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /No autorizado/)
  })

  test('hook que peta: rechazo legacy, no se rompe el poll', async () => {
    const bridge = makeBridge({
      onPairingRequest: () => { throw new Error('boom') }
    })
    await bridge._handleUpdate(update('111', 'hola'))
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /No autorizado/)
  })

  test('el usuario autorizado no pasa por el emparejamiento', async () => {
    let called = 0
    const bridge = makeBridge({ onPairingRequest: () => { called++; return { ok: true, code: '000000' } } })
    bridge._enqueueQuery = async () => {}
    await bridge._handleUpdate(update('999', 'hola'))
    assert.strictEqual(called, 0)
  })
})
