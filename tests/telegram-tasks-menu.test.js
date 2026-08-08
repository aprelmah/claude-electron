'use strict'

// /tareas y /autos en el bridge: disparar desde el móvil una tarea programada
// o una automatización launchd. Mismo patrón de picker que /proyecto (botones
// con índice, mapeo real en pendingPickers). La confirmación solo se da si el
// pre-chequeo pasa; el resultado del run viaja por los sinks de siempre.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { TelegramBridge } = require(path.join(REPO_ROOT, 'telegram-bridge.js'))

function makeBridge(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tasks-'))
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

function cbFor(data) {
  return { id: 'cb1', data, from: { id: 999 }, message: { chat: { id: 999 } } }
}

describe('/tareas', () => {
  test('lista las tareas como botones con índice', async () => {
    const bridge = makeBridge({
      onListTasks: async () => [
        { id: 'uuid-1', name: 'Backup NAS', enabled: true },
        { id: 'uuid-2', name: 'Informe semanal', enabled: false }
      ]
    })
    await bridge._handleCommand('999', '/tareas')
    const sent = bridge._sentMessages[0]
    const rows = sent.extra.reply_markup.inline_keyboard
    assert.strictEqual(rows.length, 2)
    assert.match(rows[0][0].text, /Backup NAS/)
    assert.strictEqual(rows[0][0].callback_data, 'tsk:0')
    assert.match(rows[1][0].text, /\(off\)/)
    const picker = bridge.pendingPickers.get('999')
    assert.strictEqual(picker.type, 'task')
    assert.strictEqual(picker.items[1].id, 'uuid-2')
  })

  test('sin tareas → mensaje claro, sin botones', async () => {
    const bridge = makeBridge({ onListTasks: async () => [] })
    await bridge._handleCommand('999', '/tareas')
    assert.match(bridge._sentMessages[0].text, /No hay tareas/)
    assert.strictEqual(bridge._sentMessages[0].extra, undefined)
  })

  test('sin hook → no disponible, no crash', async () => {
    const bridge = makeBridge()
    await bridge._handleCommand('999', '/tareas')
    assert.match(bridge._sentMessages[0].text, /no están disponibles/)
  })

  test('botón tsk: dispara onRunTaskNow con el id real y confirma', async () => {
    const fired = []
    const bridge = makeBridge({
      onListTasks: async () => [{ id: 'uuid-1', name: 'Backup NAS', enabled: true }],
      onRunTaskNow: async (id) => { fired.push(id); return { ok: true } }
    })
    await bridge._handleCommand('999', '/tareas')
    await bridge._handleCallback(cbFor('tsk:0'))
    assert.deepStrictEqual(fired, ['uuid-1'])
    assert.match(bridge._sentMessages.at(-1).text, /Lanzada «Backup NAS»/)
    assert.strictEqual(bridge.pendingPickers.get('999'), undefined)
  })

  test('botón tsk: con pre-chequeo fallido NO confirma', async () => {
    const bridge = makeBridge({
      onListTasks: async () => [{ id: 'uuid-1', name: 'Backup NAS', enabled: true }],
      onRunTaskNow: async () => ({ ok: false, error: 'ya hay una ejecución en curso' })
    })
    await bridge._handleCommand('999', '/tareas')
    await bridge._handleCallback(cbFor('tsk:0'))
    const last = bridge._sentMessages.at(-1).text
    assert.match(last, /No pude lanzar/)
    assert.match(last, /ejecución en curso/)
  })

  test('listado caducado (sin picker) → pide /tareas otra vez', async () => {
    const bridge = makeBridge({ onRunTaskNow: async () => ({ ok: true }) })
    await bridge._handleCallback(cbFor('tsk:0'))
    assert.match(bridge._sentMessages.at(-1).text, /caducó/)
  })
})

describe('/autos', () => {
  test('solo lista las instaladas', async () => {
    const bridge = makeBridge({
      onListAutomations: async () => [
        { id: 'a1', name: 'Copia NAS', slug: 'copia-nas', status: 'installed' },
        { id: 'a2', name: 'Borrador', slug: 'borrador', status: 'draft' }
      ]
    })
    await bridge._handleCommand('999', '/autos')
    const rows = bridge._sentMessages[0].extra.reply_markup.inline_keyboard
    assert.strictEqual(rows.length, 1)
    assert.match(rows[0][0].text, /Copia NAS/)
  })

  test('botón aut: dispara onRunAutomationNow y confirma', async () => {
    const fired = []
    const bridge = makeBridge({
      onListAutomations: async () => [{ id: 'a1', name: 'Copia NAS', slug: 'copia-nas', status: 'installed' }],
      onRunAutomationNow: async (id) => { fired.push(id); return { ok: true } }
    })
    await bridge._handleCommand('999', '/autos')
    await bridge._handleCallback(cbFor('aut:0'))
    assert.deepStrictEqual(fired, ['a1'])
    assert.match(bridge._sentMessages.at(-1).text, /Ejecutada «Copia NAS»/)
  })

  test('hook que peta → error al chat, no crash', async () => {
    const bridge = makeBridge({
      onListAutomations: async () => { throw new Error('boom') }
    })
    await bridge._handleCommand('999', '/autos')
    assert.match(bridge._sentMessages[0].text, /No pude listar/)
  })
})

describe('/menu', () => {
  test('lleva los botones de Tareas y Automatizaciones', async () => {
    const bridge = makeBridge()
    await bridge._handleCommand('999', '/menu')
    const flat = bridge._sentMessages[0].extra.reply_markup.inline_keyboard.flat()
    assert.ok(flat.some((b) => b.callback_data === 'mnu:tareas'))
    assert.ok(flat.some((b) => b.callback_data === 'mnu:autos'))
  })

  test('mnu:tareas despacha /tareas', async () => {
    const bridge = makeBridge({ onListTasks: async () => [] })
    await bridge._handleCallback(cbFor('mnu:tareas'))
    assert.match(bridge._sentMessages.at(-1).text, /No hay tareas/)
  })
})
