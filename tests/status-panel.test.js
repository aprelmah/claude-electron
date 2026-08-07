'use strict'

// Panel "¿qué está pasando?" — builder puro del snapshot.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { buildStatusPanelSnapshot } = require(path.join(REPO_ROOT, 'main', 'status-panel.js'))

describe('buildStatusPanelSnapshot', () => {
  test('sesión claude aislada con voz y telegram', () => {
    const snap = buildStatusPanelSnapshot({
      sessions: [{
        wcId: 7,
        activeCli: 'claude',
        cwd: '/Users/x/proyecto',
        claudeSessionId: 'abcdefgh-1234',
        pty: {},
        gitWorkspace: { branch: 'poweragent/session-x', realCwd: '/Users/x/proyecto' },
        relayActive: true
      }],
      voiceOwnerWcId: 7
    })
    const s = snap.sesiones[0]
    assert.strictEqual(s.cli, 'claude')
    assert.strictEqual(s.sessionId, 'abcdefgh')
    assert.strictEqual(s.ptyVivo, true)
    assert.strictEqual(s.aislada.branch, 'poweragent/session-x')
    assert.strictEqual(s.telegram, true)
    assert.strictEqual(s.voz, true)
  })

  test('sesión codex sin nada: campos en su sitio', () => {
    const snap = buildStatusPanelSnapshot({
      sessions: [{ wcId: 1, activeCli: 'codex', cwd: '/a', codexSessionId: '0123456789' }]
    })
    const s = snap.sesiones[0]
    assert.strictEqual(s.cli, 'codex')
    assert.strictEqual(s.sessionId, '01234567')
    assert.strictEqual(s.ptyVivo, false)
    assert.strictEqual(s.aislada, null)
    assert.strictEqual(s.voz, false)
  })

  test('pool de Telegram con idle en minutos', () => {
    const snap = buildStatusPanelSnapshot({
      poolStats: { items: [{ chatId: 111, cli: 'claude', sessionId: 'ffffffff-x', idleMs: 125000 }] }
    })
    assert.deepStrictEqual(snap.poolTelegram, [{ chatId: '111', cli: 'claude', sessionId: 'ffffffff', idleMin: 2 }])
  })

  test('eventos recortados a 12 y detail limitado', () => {
    const eventos = Array.from({ length: 20 }, (_, i) => ({ ts: `t${i}`, action: 'x', detail: 'd'.repeat(500) }))
    const snap = buildStatusPanelSnapshot({ recentEvents: eventos })
    assert.strictEqual(snap.eventos.length, 12)
    assert.strictEqual(snap.eventos[0].ts, 't8')
    assert.ok(snap.eventos[0].detail.length <= 140)
  })

  test('sin datos: snapshot vacío estable', () => {
    const snap = buildStatusPanelSnapshot({})
    assert.deepStrictEqual(snap.sesiones, [])
    assert.deepStrictEqual(snap.poolTelegram, [])
    assert.deepStrictEqual(snap.eventos, [])
  })
})
