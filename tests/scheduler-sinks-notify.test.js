// El sink telegram del scheduler con bot de avisos separado (tarea A+3):
// si hay notify bot corriendo, el aviso sale por él y NO se toca el estado
// del bridge principal (ni rememberRunForChat ni pool oculto). Sin notify
// bot, la ruta legacy queda intacta.
const { describe, test } = require('node:test')
const assert = require('node:assert')

const { createSinks } = require('../scheduler/sinks')

function makeBridge() {
  const calls = { sent: [], remembered: [] }
  return {
    calls,
    running: true,
    config: { allowedUsers: ['111'] },
    sendMessageTo: async (chatId, text) => { calls.sent.push({ chatId, text }) },
    rememberRunForChat: (chatId, info) => { calls.remembered.push({ chatId, info }) }
  }
}

function makeNotify({ running = true } = {}) {
  const calls = []
  return {
    calls,
    running,
    sendTaskNotification: async (payload) => { calls.push(payload) }
  }
}

const okRun = { status: 'ok', output: 'salida', durationMs: 1200, sessionId: 'sid-1', cwd: '/tmp/p', runId: 'r1' }
const task = { name: 'riego', cli: 'claude', cwd: '/tmp/p' }

describe('sink telegram con bot de avisos', () => {
  test('notify corriendo: aviso por notify bot, bridge principal INTACTO', async () => {
    const bridge = makeBridge()
    const notify = makeNotify()
    let hiddenCalls = 0
    const sinks = createSinks({
      telegramBridge: bridge,
      broadcastToAllWindows: () => {},
      onEnsureHiddenPty: async () => { hiddenCalls++; return { ok: true } },
      getNotifyBot: () => notify
    })
    await sinks.telegram({ task, run: okRun })
    assert.strictEqual(notify.calls.length, 1)
    assert.strictEqual(notify.calls[0].session.sessionId, 'sid-1')
    assert.match(notify.calls[0].text, /riego/)
    assert.strictEqual(bridge.calls.sent.length, 0, 'no debe usar el bot principal')
    assert.strictEqual(bridge.calls.remembered.length, 0, 'no debe tocar rememberRunForChat')
    assert.strictEqual(hiddenCalls, 0, 'no debe abrir PTY oculto')
  })

  test('run con error: sin session (sin botón de continuar)', async () => {
    const notify = makeNotify()
    const sinks = createSinks({
      telegramBridge: makeBridge(),
      broadcastToAllWindows: () => {},
      getNotifyBot: () => notify
    })
    await sinks.telegram({ task, run: { status: 'error', error: 'boom', sessionId: 'sid-1' } })
    assert.strictEqual(notify.calls.length, 1)
    assert.strictEqual(notify.calls[0].session, null)
    assert.match(notify.calls[0].text, /boom/)
  })

  test('sin bridge principal pero con notifyChatId: el aviso sale igual', async () => {
    const notify = makeNotify()
    const sinks = createSinks({
      telegramBridge: null,
      broadcastToAllWindows: () => {},
      getNotifyBot: () => notify,
      getNotifyChatId: () => '222'
    })
    await sinks.telegram({ task, run: okRun })
    assert.strictEqual(notify.calls.length, 1)
    assert.strictEqual(String(notify.calls[0].chatId), '222')
  })

  test('notify parado: ruta legacy intacta (bridge principal + remember)', async () => {
    const bridge = makeBridge()
    const notify = makeNotify({ running: false })
    const sinks = createSinks({
      telegramBridge: bridge,
      broadcastToAllWindows: () => {},
      onEnsureHiddenPty: async () => ({ ok: true }),
      getNotifyBot: () => notify
    })
    await sinks.telegram({ task, run: okRun })
    assert.strictEqual(notify.calls.length, 0)
    assert.strictEqual(bridge.calls.sent.length, 1)
    assert.strictEqual(bridge.calls.remembered.length, 1)
  })

  test('sin getNotifyBot: comportamiento actual sin cambios', async () => {
    const bridge = makeBridge()
    const sinks = createSinks({
      telegramBridge: bridge,
      broadcastToAllWindows: () => {},
      onEnsureHiddenPty: async () => ({ ok: true })
    })
    await sinks.telegram({ task, run: okRun })
    assert.strictEqual(bridge.calls.sent.length, 1)
    assert.strictEqual(bridge.calls.remembered.length, 1)
  })
})
