'use strict'

// /menu (botonera inline que dispara los comandos) y /modelo (cambiar el
// modelo de Telegram desde el bot, con botones para claude). 2026-08-06.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

function makeBridge(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-menu-'))
  const bridge = new TelegramBridge({
    tmpDir: tmp,
    stateDir: tmp,
    onTranscribeFile: async () => '',
    onRunQuery: async () => ({ ok: true }),
    onGetActiveCli: overrides.onGetActiveCli || (() => 'claude'),
    onGetCwd: () => tmp,
    onSetCli: async () => ({ ok: true }),
    onUnlinkRelay: async () => ({ ok: true, linked: false, detached: false }),
    onGetLinkStatus: overrides.onGetLinkStatus || (async () => ({ bound: false })),
    onGetTelegramModel: overrides.onGetTelegramModel || (() => 'sonnet'),
    onSetTelegramModel: overrides.onSetTelegramModel,
    onStatus: () => {},
    onSemanticInput: () => {},
    onSemanticOutput: () => {}
  })
  bridge.running = true
  bridge.allowedUsers = new Set(['111'])
  bridge._sentMessages = []
  bridge._sendMessage = async (chatId, text, extra) => {
    bridge._sentMessages.push({ chatId, text, extra })
    return { message_id: bridge._sentMessages.length }
  }
  bridge._api = async (method, payload) => {
    bridge._apiCalls = bridge._apiCalls || []
    bridge._apiCalls.push({ method, payload })
    return {}
  }
  return bridge
}

const cb = (data) => ({ id: 'cb-1', from: { id: 111 }, data, message: { chat: { id: 111 } } })

describe('/menu', () => {
  test('manda botonera inline con las acciones frecuentes', async () => {
    const bridge = makeBridge()
    await bridge._handleCommand('111', '/menu')
    const last = bridge._sentMessages[bridge._sentMessages.length - 1]
    const kb = last.extra?.reply_markup?.inline_keyboard
    assert.ok(Array.isArray(kb) && kb.flat().length >= 6, 'al menos 6 botones')
    assert.ok(kb.flat().every((b) => b.callback_data.startsWith('mnu:')))
    const labels = kb.flat().map((b) => b.text).join(' ')
    assert.match(labels, /Proyecto/i)
    assert.match(labels, /Modelo/i)
  })

  test('pulsar un botón del menú ejecuta el comando (mnu:vinculo → /vinculo)', async () => {
    const bridge = makeBridge()
    await bridge._handleCallback(cb('mnu:vinculo'))
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /enlace|Enlazado/i)
  })
})

describe('/modelo', () => {
  test('sin argumento (claude): enseña el actual y botones mod:', async () => {
    const bridge = makeBridge({ onGetTelegramModel: () => 'sonnet' })
    await bridge._handleCommand('111', '/modelo')
    const last = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(last.text, /sonnet/i)
    const kb = last.extra?.reply_markup?.inline_keyboard
    const datas = kb.flat().map((b) => b.callback_data)
    assert.ok(datas.includes('mod:opus'))
    assert.ok(datas.includes('mod:default'))
  })

  test('botón mod:opus → onSetTelegramModel(claude, opus) + confirmación', async () => {
    const sets = []
    const bridge = makeBridge({ onSetTelegramModel: async (args) => { sets.push(args); return { ok: true } } })
    await bridge._handleCallback(cb('mod:opus'))
    assert.deepStrictEqual(sets, [{ cli: 'claude', model: 'opus' }])
    const msg = bridge._sentMessages.map((m) => m.text).join('\n')
    assert.match(msg, /opus/i)
  })

  test('mod:default persiste cadena vacía (= modelo por defecto)', async () => {
    const sets = []
    const bridge = makeBridge({ onSetTelegramModel: async (args) => { sets.push(args); return { ok: true } } })
    await bridge._handleCallback(cb('mod:default'))
    assert.deepStrictEqual(sets, [{ cli: 'claude', model: '' }])
  })

  test('/modelo opus con argumento: set directo sin botones', async () => {
    const sets = []
    const bridge = makeBridge({ onSetTelegramModel: async (args) => { sets.push(args); return { ok: true } } })
    await bridge._handleCommand('111', '/modelo opus')
    assert.deepStrictEqual(sets, [{ cli: 'claude', model: 'opus' }])
  })

  test('con codex no hay botones: pide el nombre por argumento', async () => {
    const bridge = makeBridge({ onGetActiveCli: () => 'codex' })
    await bridge._handleCommand('111', '/modelo')
    const last = bridge._sentMessages[bridge._sentMessages.length - 1]
    assert.match(last.text, /\/modelo/)
    assert.strictEqual(last.extra?.reply_markup, undefined)
  })
})

describe('menú nativo de Telegram', () => {
  test('_registerCommandMenu registra los comandos vía setMyCommands', async () => {
    const bridge = makeBridge()
    await bridge._registerCommandMenu()
    const call = (bridge._apiCalls || []).find((c) => c.method === 'setMyCommands')
    assert.ok(call, 'debe llamar a setMyCommands')
    const cmds = call.payload.commands.map((c) => c.command)
    assert.ok(cmds.includes('menu'))
    assert.ok(cmds.includes('modelo'))
    assert.ok(cmds.includes('proyecto'))
  })
})
