'use strict'

// /doctor en el bridge: el chequeo de las 8:00 disparado a mano desde el
// móvil. Responde SIEMPRE — también el "todo en orden".
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

function makeBridge(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-doctor-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery: async () => ({ ok: true, text: 'x' }),
    onGetActiveCli: () => 'claude',
    onGetCwd: () => tmp,
    onSetCli: async () => ({ ok: true }),
    onStatus: () => {},
    onRunDoctor: overrides.onRunDoctor
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

describe('/doctor', () => {
  test('todo en orden → lo dice claramente', async () => {
    const bridge = makeBridge({ onRunDoctor: async () => ({ ran: true, problems: [], ts: 1 }) })
    await bridge._handleCommand('999', '/doctor')
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /Todo en orden/)
  })

  test('con problemas → el informe con cada uno', async () => {
    const bridge = makeBridge({
      onRunDoctor: async () => ({
        ran: true,
        ts: 1,
        problems: [{ key: 'whatsapp', label: 'Bridge de WhatsApp', detail: 'caído' }]
      })
    })
    await bridge._handleCommand('999', '/doctor')
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /Bridge de WhatsApp: caído/)
  })

  test('watchdog no disponible → error claro, no silencio', async () => {
    const bridge = makeBridge({ onRunDoctor: async () => ({ ok: false, error: 'no arrancado' }) })
    await bridge._handleCommand('999', '/doctor')
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /No pude pasar el doctor/)
  })

  test('sin hook → mensaje de no disponible', async () => {
    const bridge = makeBridge({})
    await bridge._handleCommand('999', '/doctor')
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /no está disponible/)
  })

  test('hook que peta → mensaje de error, el poll sigue', async () => {
    const bridge = makeBridge({ onRunDoctor: async () => { throw new Error('boom') } })
    await bridge._handleCommand('999', '/doctor')
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /boom/)
  })
})
