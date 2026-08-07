'use strict'

// Integración del saneado de canal (main/untrusted-input.js):
// - Telegram: _enqueueQuery limpia el texto antes de que llegue a onRunQuery
//   (y por tanto antes del PTY relay o del headless).
// - WhatsApp: buildPrompt limpia body e historial del cliente.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))
const { buildPrompt } = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-auto-reply.js'))

describe('telegram: el texto del chat llega saneado a onRunQuery', () => {
  test('zero-width y escapes ANSI fuera; \\r normalizado', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sanitize-'))
    const prompts = []
    const bridge = new TelegramBridge({
      tmpDir: tmp,
      stateDir: tmp,
      onTranscribeFile: async () => '',
      onRunQuery: async (opts) => {
        prompts.push(opts.userPrompt ?? opts.prompt)
        return { ok: true, text: 'vale' }
      },
      onGetActiveCli: () => 'claude',
      onGetCwd: () => tmp,
      onSetCli: async () => ({ ok: true }),
      onStatus: () => {}
    })
    bridge.running = true
    bridge.allowedUsers = new Set(['999'])
    bridge._sendMessage = async () => ({ message_id: 1 })
    bridge._editMessage = async () => ({})
    bridge._api = async () => ({})

    await bridge._enqueueQuery('999', 'ho​la \x1b[31mmundo\x1b[0m\rfin')
    assert.strictEqual(prompts.length, 1)
    assert.ok(prompts[0].includes('hola mundo'), `prompt saneado, fue: ${JSON.stringify(prompts[0])}`)
    assert.ok(!prompts[0].includes('​'))
    assert.ok(!prompts[0].includes('\x1b'))
    assert.ok(!prompts[0].includes('\r'))
  })
})

describe('whatsapp: buildPrompt limpia body e historial del cliente', () => {
  test('invisibles y controles fuera del prompt final', () => {
    const prompt = buildPrompt({
      displayNumber: '+34 600 000 000',
      history: [
        { fromMe: false, body: 'antes​ con \x1b[2Jtruco', type: 'text' },
        { fromMe: true, body: 'respuesta normal', type: 'text' }
      ],
      body: 'hola​‮ soy el cliente\x07',
      maxHistory: 10
    })
    assert.ok(!prompt.includes('​'))
    assert.ok(!prompt.includes('‮'))
    assert.ok(!prompt.includes('\x1b'))
    assert.ok(!prompt.includes('\x07'))
    assert.ok(prompt.includes('hola soy el cliente'))
    assert.ok(prompt.includes('antes con truco'))
  })
})
