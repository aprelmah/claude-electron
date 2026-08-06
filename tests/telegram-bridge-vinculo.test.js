'use strict'

// /vinculo (ver desde el móvil a qué está enganchado el chat), alias
// /desvincular de /salir, y pie de contexto en las respuestas del bot
// (tarea 4 de la sesión 2026-08-06).
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

function makeBridge(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-vinculo-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery: overrides.onRunQuery || (async () => ({ ok: true, text: 'respuesta' })),
    onGetActiveCli: () => 'claude',
    onGetCwd: () => tmp,
    onSetCli: async () => ({ ok: true }),
    onUnlinkRelay: overrides.onUnlinkRelay || (async () => ({ ok: true, linked: false, detached: true })),
    onStatus: () => {},
    onSemanticInput: () => {},
    onSemanticOutput: () => {},
    onGetLinkStatus: overrides.onGetLinkStatus
  })
  bridge.running = true
  bridge._sentMessages = []
  bridge._sendMessage = async (chatId, text) => {
    bridge._sentMessages.push({ chatId, text })
    return { message_id: bridge._sentMessages.length }
  }
  bridge._editMessage = async () => ({})
  bridge._api = async () => ({})
  return bridge
}

describe('/vinculo', () => {
  test('con binding PTY: enseña proyecto, sesión corta y tipo de enlace', async () => {
    const bridge = makeBridge({
      onGetLinkStatus: async () => ({
        bound: true,
        via: 'pty',
        cli: 'claude',
        sessionId: 'abcd1234-5678-90ab-cdef-111122223333',
        cwd: '/Users/luismi/proyectos/dmweb'
      })
    })
    await bridge._handleCommand('111', '/vinculo')
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /dmweb/)
    assert.match(msg, /abcd1234/)
    assert.match(msg, /PTY/i)
  })

  test('sin binding: enseña la sesión persistida y el proyecto del chat', async () => {
    const bridge = makeBridge({ onGetLinkStatus: async () => ({ bound: false }) })
    bridge._setChatCwd('111', '/tmp/mi-proyecto')
    bridge._setSessionId('111', 'claude', 'ffff0000-1111-2222-3333-444455556666')
    await bridge._handleCommand('111', '/vinculo')
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /mi-proyecto/)
    assert.match(msg, /ffff0000/)
  })

  test('/desvincular es alias de /salir: dispara onUnlinkRelay', async () => {
    let called = 0
    const bridge = makeBridge({ onUnlinkRelay: async () => { called++; return { ok: true, linked: false, detached: true } } })
    await bridge._handleCommand('111', '/desvincular')
    assert.strictEqual(called, 1)
  })
})

describe('pie de contexto en respuestas', () => {
  test('_contextFooter: proyecto + sesión corta', () => {
    const bridge = makeBridge()
    bridge._setChatCwd('111', '/Users/luismi/proyectos/dmweb')
    bridge._setSessionId('111', 'claude', 'abcd1234-5678-90ab-cdef-111122223333')
    const footer = bridge._contextFooter('111', 'claude')
    assert.match(footer, /dmweb/)
    assert.match(footer, /abcd1234/)
    assert.ok(!footer.includes('abcd1234-5678'), 'sesión en formato corto')
  })

  test('_contextFooter sin nada que enseñar: cadena vacía', () => {
    const bridge = makeBridge()
    assert.strictEqual(bridge._contextFooter('111', 'claude'), '')
  })

  test('la respuesta de un turno termina con el pie', async () => {
    const bridge = makeBridge({
      onRunQuery: async ({ onText }) => {
        onText('hecho, jefe')
        return { ok: true, sessionId: 'abcd1234-5678-90ab-cdef-111122223333' }
      }
    })
    bridge._setChatCwd('111', '/Users/luismi/proyectos/dmweb')
    await bridge._runQuery('111', 'haz algo')
    const last = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.ok(last, 'debe haberse enviado algo')
    assert.match(last.text, /hecho, jefe/)
    assert.match(last.text, /📁 .*dmweb · abcd1234/)
  })
})
