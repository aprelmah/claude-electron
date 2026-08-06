// Bot de avisos separado para automatizaciones (tarea A+3).
// Manda notificaciones de tareas por su propio token y ofrece binding
// EXPLÍCITO vía botón inline «Continuar esta sesión» — nunca toca el
// estado del bridge principal como efecto colateral.
const { describe, test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createTelegramNotifyBot } = require('../main/telegram-notify-bot')

function makeBot(overrides = {}) {
  const calls = []
  const postJson = overrides.postJson || (async (url, payload) => {
    calls.push({ url, payload })
    return { ok: true, result: {} }
  })
  const bot = createTelegramNotifyBot({
    token: 'NOTIFY-TOKEN',
    stateDir: overrides.stateDir || fs.mkdtempSync(path.join(os.tmpdir(), 'tg-notify-')),
    getAllowedUsers: overrides.getAllowedUsers || (() => ['111']),
    onContinueSession: overrides.onContinueSession || (async () => ({ ok: true })),
    onUserReply: overrides.onUserReply,
    nowFn: overrides.nowFn,
    postJson,
    ...overrides.opts
  })
  return { bot, calls }
}

describe('telegram-notify-bot: sendTaskNotification', () => {
  test('con sesión: sendMessage con botón inline «Continuar esta sesión»', async () => {
    const { bot, calls } = makeBot()
    await bot.sendTaskNotification({
      chatId: '111',
      text: '⏰ backup — OK\n\nresultado',
      session: { sessionId: 'sid-1', cli: 'claude', cwd: '/tmp/proj', taskName: 'backup', runId: 'run-9' }
    })
    assert.strictEqual(calls.length, 1)
    assert.ok(calls[0].url.includes('/botNOTIFY-TOKEN/sendMessage'))
    assert.strictEqual(calls[0].payload.chat_id, '111')
    const kb = calls[0].payload.reply_markup?.inline_keyboard
    assert.ok(Array.isArray(kb) && kb[0][0].callback_data.startsWith('cont:'))
    assert.match(kb[0][0].text, /Continuar/)
  })

  test('sin sesión: sendMessage plano, sin teclado', async () => {
    const { bot, calls } = makeBot()
    await bot.sendTaskNotification({ chatId: '111', text: '⏰ backup — ERROR\n\nboom' })
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].payload.reply_markup, undefined)
  })
})

describe('telegram-notify-bot: callback «Continuar»', () => {
  function callbackUpdate({ data, fromId = 111, chatId = 111 }) {
    return {
      update_id: 5,
      callback_query: {
        id: 'cb-1',
        from: { id: fromId },
        data,
        message: { message_id: 42, chat: { id: chatId } }
      }
    }
  }

  test('usuario autorizado + clave viva → onContinueSession con los datos del run', async () => {
    const continued = []
    const { bot, calls } = makeBot({ onContinueSession: async (info) => { continued.push(info); return { ok: true } } })
    await bot.sendTaskNotification({
      chatId: '111',
      text: 'aviso',
      session: { sessionId: 'sid-7', cli: 'claude', cwd: '/tmp/p', taskName: 'riego', runId: 'r1' }
    })
    const data = calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data
    await bot.handleUpdate(callbackUpdate({ data }))
    assert.strictEqual(continued.length, 1)
    assert.strictEqual(continued[0].sessionId, 'sid-7')
    assert.strictEqual(continued[0].cli, 'claude')
    assert.strictEqual(continued[0].cwd, '/tmp/p')
    assert.strictEqual(String(continued[0].chatId), '111')
    const answered = calls.find((c) => c.url.includes('answerCallbackQuery'))
    assert.ok(answered, 'debe responder el callback SIEMPRE')
  })

  test('usuario NO autorizado → no se enlaza nada', async () => {
    const continued = []
    const { bot, calls } = makeBot({ onContinueSession: async (info) => { continued.push(info) } })
    await bot.sendTaskNotification({
      chatId: '111',
      text: 'aviso',
      session: { sessionId: 'sid-7', cli: 'claude', cwd: '/tmp/p' }
    })
    const data = calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data
    await bot.handleUpdate(callbackUpdate({ data, fromId: 999 }))
    assert.strictEqual(continued.length, 0)
    const answered = calls.find((c) => c.url.includes('answerCallbackQuery'))
    assert.ok(answered)
  })

  test('clave desconocida (app reiniciada) → aviso de caducado, sin enlazar', async () => {
    const continued = []
    const { bot, calls } = makeBot({ onContinueSession: async (info) => { continued.push(info) } })
    await bot.handleUpdate(callbackUpdate({ data: 'cont:no-existe' }))
    assert.strictEqual(continued.length, 0)
    const answered = calls.find((c) => c.url.includes('answerCallbackQuery'))
    assert.ok(answered)
    assert.match(String(answered.payload.text || ''), /antiguo|caducad|no disponible/i)
  })

  test('si onContinueSession revienta, el callback se responde igual (sin unhandled)', async () => {
    const { bot, calls } = makeBot({ onContinueSession: async () => { throw new Error('pool muerto') } })
    await bot.sendTaskNotification({
      chatId: '111',
      text: 'aviso',
      session: { sessionId: 'sid-7', cli: 'claude', cwd: '/tmp/p' }
    })
    const data = calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data
    await bot.handleUpdate(callbackUpdate({ data }))
    const answered = calls.find((c) => c.url.includes('answerCallbackQuery'))
    assert.ok(answered)
  })
})

describe('telegram-notify-bot: poll loop y offset', () => {
  test('procesa updates del getUpdates y persiste el offset', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-notify-'))
    const seen = []
    let polls = 0
    const postJson = async (url, payload) => {
      seen.push({ url, payload })
      if (url.includes('getUpdates')) {
        polls++
        if (polls === 1) {
          return { ok: true, result: [{ update_id: 77, message: { chat: { id: 111 }, from: { id: 111 }, text: 'hola' } }] }
        }
        await new Promise((r) => setTimeout(r, 5))
        return { ok: true, result: [] }
      }
      return { ok: true, result: {} }
    }
    const { bot } = makeBot({ stateDir, postJson })
    bot.start()
    await new Promise((r) => setTimeout(r, 50))
    await bot.stop()
    const statePath = path.join(stateDir, 'telegram-notify-state.json')
    assert.ok(fs.existsSync(statePath), 'debe persistir el offset')
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    assert.strictEqual(state.offset, 78)
    const later = seen.filter((c) => c.url.includes('getUpdates')).slice(1)
    assert.ok(later.length >= 1)
    assert.strictEqual(later[0].payload.offset, 78)
  })

  test('un texto al bot de avisos recibe UNA cortesía, no un diálogo', async () => {
    const { bot, calls } = makeBot()
    const msg = (id) => ({ update_id: id, message: { chat: { id: 111 }, from: { id: 111 }, text: 'hola' } })
    await bot.handleUpdate(msg(1))
    await bot.handleUpdate(msg(2))
    const sent = calls.filter((c) => c.url.includes('sendMessage'))
    assert.strictEqual(sent.length, 1, 'solo una respuesta de cortesía por ventana')
    assert.match(String(sent[0].payload.text || ''), /avisos/i)
  })
})

describe('telegram-notify-bot: chat conversacional tras «Continuar»', () => {
  const cbUpdate = (data) => ({
    update_id: 5,
    callback_query: { id: 'cb-1', from: { id: 111 }, data, message: { message_id: 42, chat: { id: 111 } } }
  })
  const msg = (id, text) => ({ update_id: id, message: { chat: { id: 111 }, from: { id: 111 }, text } })

  async function continuar(bot, calls) {
    await bot.sendTaskNotification({
      chatId: '111',
      text: 'aviso',
      session: { sessionId: 'sid-7', cli: 'claude', cwd: '/tmp/p', taskName: 'riego' }
    })
    const data = calls[0].payload.reply_markup.inline_keyboard[0][0].callback_data
    await bot.handleUpdate(cbUpdate(data))
  }

  test('tras Continuar, un texto va a onUserReply y la respuesta vuelve por este chat', async () => {
    const replies = []
    const { bot, calls } = makeBot({
      onUserReply: async (info) => { replies.push(info); return { ok: true, text: 'regado, jefe' } }
    })
    await continuar(bot, calls)
    await bot.handleUpdate(msg(6, 'riega también el huerto'))
    assert.strictEqual(replies.length, 1)
    assert.strictEqual(replies[0].text, 'riega también el huerto')
    assert.strictEqual(replies[0].session.sessionId, 'sid-7')
    const sent = calls.filter((c) => c.url.includes('sendMessage'))
    assert.ok(sent.some((c) => /regado, jefe/.test(String(c.payload.text || ''))))
  })

  test('sin Continuar previo, el texto NO llega a onUserReply (cortesía)', async () => {
    const replies = []
    const { bot, calls } = makeBot({ onUserReply: async (i) => { replies.push(i); return { ok: true, text: 'x' } } })
    await bot.handleUpdate(msg(6, 'hola'))
    assert.strictEqual(replies.length, 0)
  })

  test('la ventana caduca: pasados 30 min sin hablar, vuelve la cortesía', async () => {
    let now = 1000000
    const replies = []
    const { bot, calls } = makeBot({
      nowFn: () => now,
      onUserReply: async (i) => { replies.push(i); return { ok: true, text: 'ok' } }
    })
    await continuar(bot, calls)
    now += 31 * 60 * 1000
    await bot.handleUpdate(msg(6, 'sigues ahí?'))
    assert.strictEqual(replies.length, 0, 'caducado: no debe llegar a onUserReply')
  })

  test('si onUserReply revienta, el error vuelve como mensaje, no en silencio', async () => {
    const { bot, calls } = makeBot({ onUserReply: async () => { throw new Error('sesión perdida') } })
    await continuar(bot, calls)
    await bot.handleUpdate(msg(6, 'hola'))
    const sent = calls.filter((c) => c.url.includes('sendMessage'))
    assert.ok(sent.some((c) => /sesión perdida/.test(String(c.payload.text || ''))))
  })
})
