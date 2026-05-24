'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { handleOpenTaskSession } = require('../main/telegram-open-task-session')

function makeDeps(overrides = {}) {
  const telegramRelayByChat = new Map()
  const taskSessionStateByWc = new Map()
  return {
    isValidSessionId: (sid) => Boolean(sid),
    normalizeTelegramChatKey: (c) => (c ? String(c) : ''),
    telegramHiddenPtyPool: null,
    taskSessionStateByWc,
    telegramRelayByChat,
    openTaskSessionWindow: async () => ({ webContents: { id: 42 } }),
    ...overrides
  }
}

describe('handleOpenTaskSession — PTY-C1', () => {
  test('hit pool: re-bindea chat→wcId (no debe quedar vacío tras /abrir+unlink)', async () => {
    const telegramRelayByChat = new Map()
    const taskSessionStateByWc = new Map([[7, { hidden: true }]])
    const deps = makeDeps({
      telegramRelayByChat,
      taskSessionStateByWc,
      telegramHiddenPtyPool: {
        getHiddenPtyForChat: () => ({ sessionId: 'sid-1', cli: 'claude', wcId: 7 }),
        showHiddenPty: () => true
      }
    })
    const res = await handleOpenTaskSession(
      { sessionId: 'sid-1', cli: 'claude', chatId: '555' },
      deps
    )
    assert.deepEqual(res, { ok: true, fromPool: true, wcId: 7 })
    assert.equal(telegramRelayByChat.get('555'), 7, 'binding chat→wcId DEBE estar poblado')
    assert.equal(taskSessionStateByWc.get(7).hidden, false, 'state.hidden=false')
  })

  test('hit pool pero showHiddenPty falla: cae a spawn fresca (no rebindea con wcId viejo)', async () => {
    const telegramRelayByChat = new Map()
    const deps = makeDeps({
      telegramRelayByChat,
      telegramHiddenPtyPool: {
        getHiddenPtyForChat: () => ({ sessionId: 'sid-1', cli: 'claude', wcId: 7 }),
        showHiddenPty: () => false
      },
      openTaskSessionWindow: async () => ({ webContents: { id: 99 } })
    })
    const res = await handleOpenTaskSession(
      { sessionId: 'sid-1', cli: 'claude', chatId: '555' },
      deps
    )
    assert.equal(res.ok, true)
    assert.equal(res.fromPool, undefined)
    assert.equal(telegramRelayByChat.get('555'), 99)
  })

  test('miss pool: spawn fresca y bindea con webContents.id nuevo', async () => {
    const telegramRelayByChat = new Map()
    const deps = makeDeps({
      telegramRelayByChat,
      telegramHiddenPtyPool: {
        getHiddenPtyForChat: () => null,
        showHiddenPty: () => false
      },
      openTaskSessionWindow: async () => ({ webContents: { id: 31 } })
    })
    const res = await handleOpenTaskSession(
      { sessionId: 'sid-2', cli: 'claude', chatId: '777' },
      deps
    )
    assert.equal(res.ok, true)
    assert.equal(telegramRelayByChat.get('777'), 31)
  })

  test('hit pool con mismatch sessionId: NO rebindea, abre ventana fresca', async () => {
    const telegramRelayByChat = new Map()
    const deps = makeDeps({
      telegramRelayByChat,
      telegramHiddenPtyPool: {
        getHiddenPtyForChat: () => ({ sessionId: 'OLD-SID', cli: 'claude', wcId: 7 }),
        showHiddenPty: () => true
      },
      openTaskSessionWindow: async () => ({ webContents: { id: 50 } })
    })
    const res = await handleOpenTaskSession(
      { sessionId: 'NEW-SID', cli: 'claude', chatId: '555' },
      deps
    )
    assert.equal(res.fromPool, undefined)
    assert.equal(telegramRelayByChat.get('555'), 50)
  })

  test('hit pool con mismatch cli (claude vs codex): NO rebindea con wcId del pool', async () => {
    const telegramRelayByChat = new Map()
    const deps = makeDeps({
      telegramRelayByChat,
      telegramHiddenPtyPool: {
        getHiddenPtyForChat: () => ({ sessionId: 'sid-1', cli: 'codex', wcId: 7 }),
        showHiddenPty: () => true
      },
      openTaskSessionWindow: async () => ({ webContents: { id: 60 } })
    })
    const res = await handleOpenTaskSession(
      { sessionId: 'sid-1', cli: 'claude', chatId: '555' },
      deps
    )
    assert.equal(res.fromPool, undefined)
    assert.equal(telegramRelayByChat.get('555'), 60)
  })

  test('sessionId inválido: error sin tocar nada', async () => {
    const telegramRelayByChat = new Map()
    const deps = makeDeps({ telegramRelayByChat })
    const res = await handleOpenTaskSession({ sessionId: '', cli: 'claude', chatId: '555' }, deps)
    assert.equal(res.ok, false)
    assert.match(res.error, /sessionId/i)
    assert.equal(telegramRelayByChat.size, 0)
  })

  test('openTaskSessionWindow devuelve null: error claro', async () => {
    const telegramRelayByChat = new Map()
    const deps = makeDeps({
      telegramRelayByChat,
      openTaskSessionWindow: async () => null
    })
    const res = await handleOpenTaskSession(
      { sessionId: 'sid-x', cli: 'claude', chatId: '555' },
      deps
    )
    assert.equal(res.ok, false)
    assert.equal(telegramRelayByChat.size, 0)
  })

  test('cli=codex se normaliza igual', async () => {
    const telegramRelayByChat = new Map()
    const deps = makeDeps({
      telegramRelayByChat,
      telegramHiddenPtyPool: {
        getHiddenPtyForChat: () => ({ sessionId: 'sid-c', cli: 'codex', wcId: 11 }),
        showHiddenPty: () => true
      }
    })
    const res = await handleOpenTaskSession(
      { sessionId: 'sid-c', cli: 'codex', chatId: '999' },
      deps
    )
    assert.equal(res.fromPool, true)
    assert.equal(telegramRelayByChat.get('999'), 11)
  })

  test('cli desconocido se castea a claude', async () => {
    const telegramRelayByChat = new Map()
    const deps = makeDeps({
      telegramRelayByChat,
      telegramHiddenPtyPool: {
        getHiddenPtyForChat: () => ({ sessionId: 'sid-z', cli: 'claude', wcId: 22 }),
        showHiddenPty: () => true
      }
    })
    const res = await handleOpenTaskSession(
      { sessionId: 'sid-z', cli: 'weird-cli', chatId: '1' },
      deps
    )
    assert.equal(res.fromPool, true)
    assert.equal(telegramRelayByChat.get('1'), 22)
  })
})
