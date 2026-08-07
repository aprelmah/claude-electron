'use strict'

// buildCurrentSessionMeta NO debe adivinar el sessionId de una sesión sin id
// cogiendo la última .jsonl del proyecto por mtime, y mucho menos persistirlo
// en session.claudeSessionId: una sesión nueva (aún sin conversación) quedaba
// enganchada a la conversación VIEJA más reciente, el vigía de startPty veía
// el campo relleno y dejaba de buscar el id real para siempre, y "Llevar a
// Terminal" abría esa conversación vieja. Bug real 2026-08-07.

const { test } = require('node:test')
const assert = require('node:assert')
const { createClaudeSessionCache } = require('../main/claude-session-cache')

function makeCache({ latestRows = [], codexGuess = null } = {}) {
  return createClaudeSessionCache({
    resolveClaudeProjectDir: () => null,
    listClaudeSessionFilesWithMtime: () => latestRows,
    extractTurnText: () => '',
    clipText: (t) => String(t || ''),
    safeStat: () => null,
    statCacheKey: () => '',
    codexSessionReader: {
      loadCodexSessionIndexMap: () => new Map(),
      readCodexStateThreadMeta: () => null,
      guessCodexSessionFromHistory: () => codexGuess,
      fileCacheKey: () => ''
    },
    CODEX_HISTORY_PATH: '/dev/null',
    CODEX_SESSION_INDEX_PATH: '/dev/null',
    CODEX_STATE_DB_PATH: '/dev/null'
  })
}

test('sesión claude sin id: no adopta ni persiste la última .jsonl del proyecto', () => {
  const { buildCurrentSessionMeta } = makeCache({
    latestRows: [{ file: 'vieja.jsonl', sessionId: 'vieja-1111', mtimeMs: 999 }]
  })
  const session = { wcId: 7, activeCli: 'claude', cwd: '/tmp/proyecto', claudeSessionId: '' }
  const meta = buildCurrentSessionMeta(session)
  assert.strictEqual(session.claudeSessionId, '', 'no debe escribir en session.claudeSessionId')
  assert.strictEqual(meta.sessionId, null)
})

test('sesión claude sin id: el título dice sesión nueva, no el de la conversación vieja', () => {
  const { buildCurrentSessionMeta } = makeCache({
    latestRows: [{ file: 'vieja.jsonl', sessionId: 'vieja-1111', mtimeMs: 999 }]
  })
  const session = { wcId: 8, activeCli: 'claude', cwd: '/tmp/proyecto', claudeSessionId: null }
  const meta = buildCurrentSessionMeta(session)
  assert.strictEqual(meta.title, '(sesión nueva)')
})

test('sesión codex: la adivinanza del historial se pinta pero NO se persiste', () => {
  const { buildCurrentSessionMeta } = makeCache({
    codexGuess: { sessionId: 'adivinada-3333', tsMs: 1, text: 'hola' }
  })
  const session = { wcId: 11, activeCli: 'codex', cwd: '/tmp/proyecto', codexSessionId: '' }
  const meta = buildCurrentSessionMeta(session)
  assert.strictEqual(meta.sessionId, 'adivinada-3333', 'la tira de sesión sí puede pintarla')
  assert.strictEqual(session.codexSessionId, '', 'no debe escribir en session.codexSessionId')
})

test('sesión codex con id propio: lo respeta', () => {
  const { buildCurrentSessionMeta } = makeCache({
    codexGuess: { sessionId: 'adivinada-3333', tsMs: 1, text: 'hola' }
  })
  const session = { wcId: 12, activeCli: 'codex', cwd: '/tmp/proyecto', codexSessionId: 'propia-4444' }
  const meta = buildCurrentSessionMeta(session)
  assert.strictEqual(meta.sessionId, 'propia-4444')
  assert.strictEqual(session.codexSessionId, 'propia-4444')
})

test('sesión claude con id propio: lo respeta y no lo pisa', () => {
  const { buildCurrentSessionMeta } = makeCache({
    latestRows: [{ file: 'vieja.jsonl', sessionId: 'vieja-1111', mtimeMs: 999 }]
  })
  const session = { wcId: 9, activeCli: 'claude', cwd: '/tmp/proyecto', claudeSessionId: 'propia-2222' }
  const meta = buildCurrentSessionMeta(session)
  assert.strictEqual(meta.sessionId, 'propia-2222')
  assert.strictEqual(session.claudeSessionId, 'propia-2222')
  assert.strictEqual(meta.title, '(sin título)')
})
