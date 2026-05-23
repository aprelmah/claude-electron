'use strict'

// Regresión: cuando el pool oculto spawnea un PTY para un chat, debe persistir
// la sessionId en bridge.sessions[chatId]['claude'] como red de seguridad.
// Si más tarde el PTY oculto cae (TTL, exit, no output), onRunQuery puede
// usar esa sid del bridge para fallback a runClaudeHeadless --resume y no
// dejar a Telegram mudo.
//
// Replicamos el wrapper onEnsureHiddenPty del main.js que envuelve al pool.

const test = require('node:test')
const assert = require('node:assert/strict')

function makeBridgeStub() {
  const sessions = {}
  return {
    sessions,
    adoptSession(chatId, cli, sessionId) {
      if (!chatId || !sessionId) return false
      const c = (cli === 'codex') ? 'codex' : 'claude'
      sessions[chatId] = sessions[chatId] || {}
      sessions[chatId][c] = sessionId
      return true
    },
    getSessionId(chatId, cli) {
      const c = (cli === 'codex') ? 'codex' : 'claude'
      return sessions[String(chatId)]?.[c] || null
    }
  }
}

function makePoolStub({ result = { ok: true, wcId: 1, reused: false } } = {}) {
  return {
    ensureHiddenPtyForChat: async () => result
  }
}

function makeOnEnsureHiddenPty({ pool, bridge }) {
  return async ({ chatId, sessionId, cli, cwd, taskName }) => {
    if (!pool) return { ok: false, error: 'pool no inicializado' }
    if (cli !== 'claude') return { ok: true, skipped: true, reason: 'cli-not-claude' }
    const res = await pool.ensureHiddenPtyForChat({ chatId, sessionId, cli, cwd, taskName })
    if (res && res.ok && sessionId && bridge && typeof bridge.adoptSession === 'function') {
      try { bridge.adoptSession(String(chatId), 'claude', sessionId) } catch {}
    }
    return res
  }
}

test('cuando el pool spawnea PTY oculto OK, persiste la sid en bridge.sessions[chatId][claude]', async () => {
  const bridge = makeBridgeStub()
  const pool = makePoolStub({ result: { ok: true, wcId: 42, reused: false } })
  const onEnsure = makeOnEnsureHiddenPty({ pool, bridge })

  const res = await onEnsure({ chatId: '789', sessionId: 'sid-task-1', cli: 'claude', cwd: '/tmp/x' })
  assert.equal(res.ok, true)
  assert.equal(bridge.getSessionId('789', 'claude'), 'sid-task-1',
    'la sid debe quedar persistida en el bridge para fallback futuro')
})

test('cuando el pool reusa entry existente, también persiste sid (idempotente)', async () => {
  const bridge = makeBridgeStub()
  const pool = makePoolStub({ result: { ok: true, wcId: 42, reused: true } })
  const onEnsure = makeOnEnsureHiddenPty({ pool, bridge })

  await onEnsure({ chatId: '789', sessionId: 'sid-task-1', cli: 'claude' })
  assert.equal(bridge.getSessionId('789', 'claude'), 'sid-task-1')
})

test('cuando el pool falla, NO persiste sid (evita falso positivo)', async () => {
  const bridge = makeBridgeStub()
  const pool = makePoolStub({ result: { ok: false, error: 'startPty falló' } })
  const onEnsure = makeOnEnsureHiddenPty({ pool, bridge })

  await onEnsure({ chatId: '789', sessionId: 'sid-task-1', cli: 'claude' })
  assert.equal(bridge.getSessionId('789', 'claude'), null)
})

test('cuando cli es codex, skip (no persiste y no llama al pool)', async () => {
  const bridge = makeBridgeStub()
  let called = false
  const pool = {
    ensureHiddenPtyForChat: async () => { called = true; return { ok: true } }
  }
  const onEnsure = makeOnEnsureHiddenPty({ pool, bridge })

  const res = await onEnsure({ chatId: '789', sessionId: 'sid-task-1', cli: 'codex' })
  assert.equal(res.skipped, true)
  assert.equal(called, false)
  assert.equal(bridge.getSessionId('789', 'codex'), null)
})

test('sin sessionId, no persiste nada', async () => {
  const bridge = makeBridgeStub()
  const pool = makePoolStub({ result: { ok: true, wcId: 1 } })
  const onEnsure = makeOnEnsureHiddenPty({ pool, bridge })

  await onEnsure({ chatId: '789', sessionId: '', cli: 'claude' })
  assert.equal(bridge.getSessionId('789', 'claude'), null)
})

test('una excepción en adoptSession no rompe el flujo (catch silencioso)', async () => {
  const bridge = makeBridgeStub()
  bridge.adoptSession = () => { throw new Error('crash') }
  const pool = makePoolStub({ result: { ok: true, wcId: 1 } })
  const onEnsure = makeOnEnsureHiddenPty({ pool, bridge })

  // No debe relanzar la excepción del adoptSession
  const res = await onEnsure({ chatId: '789', sessionId: 'sid-task-1', cli: 'claude' })
  assert.equal(res.ok, true)
})
