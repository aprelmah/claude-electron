'use strict'

// Cerrojo voz↔Telegram (pendiente inmediato de CLAUDE.md § Git automático):
// un turno de voz marca session.voiceTurnUntil = ahora + 180s y relayThroughPty
// lo respeta igual que relayActive. Caduca SOLO — nada lo suelta a mano, así
// no hay flag pegado si el vigía del turno muere por cualquiera de sus cuatro
// caminos de salida.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const {
  createVoiceSendTarget,
  voiceTurnLockActive,
  VOICE_TURN_LOCK_MS
} = require(path.join(REPO_ROOT, 'main', 'voice-send-target.js'))

describe('voiceTurnLockActive', () => {
  test('sin sesión o sin campo → libre', () => {
    assert.strictEqual(voiceTurnLockActive(null), false)
    assert.strictEqual(voiceTurnLockActive({}), false)
  })

  test('con caducidad futura → ocupado; pasada → libre (caduca solo)', () => {
    assert.strictEqual(voiceTurnLockActive({ voiceTurnUntil: 1000 }, 999), true)
    assert.strictEqual(voiceTurnLockActive({ voiceTurnUntil: 1000 }, 1000), false)
    assert.strictEqual(voiceTurnLockActive({ voiceTurnUntil: 1000 }, 2000), false)
  })
})

function makeHarness(opts = {}) {
  const session = {
    wcId: 7,
    activeCli: 'claude',
    claudeSessionId: 'madre-1',
    cwd: '/proj',
    pty: { write: (d) => { if (opts.ptyWriteThrows) throw new Error('pipe roto') } },
    ...opts.session
  }
  const target = createVoiceSendTarget({
    getSession: () => session,
    subchat: { has: () => false, start: () => ({ ok: true }), write: () => true },
    relayCwdCandidates: () => ['/proj'],
    findRelayTranscript: ({ sessionId }) => ({ filePath: `/d/${sessionId}.jsonl`, sessionId, size: 100, mtimeMs: 1 }),
    snapshotClaudeSessionMeta: () => new Map(),
    detectForkedRelayTranscript: () => null,
    statFn: () => ({ size: 100 }),
    readFileFn: () => { throw new Error('ENOENT') },
    sleep: async () => {},
    log: () => {}
  })
  return { target, session }
}

describe('el encargo de voz marca el cerrojo', () => {
  test('enviar a la madre deja voiceTurnUntil ~180s en el futuro', async () => {
    const { target, session } = makeHarness()
    const antes = Date.now()
    const res = await target({ text: 'haz algo', mode: 'encargo' })
    assert.strictEqual(res.ok, true)
    assert.ok(Number.isFinite(session.voiceTurnUntil), 'debe marcar voiceTurnUntil')
    assert.ok(session.voiceTurnUntil >= antes + VOICE_TURN_LOCK_MS - 5000)
    assert.ok(session.voiceTurnUntil <= Date.now() + VOICE_TURN_LOCK_MS + 5000)
  })

  test('si la escritura al PTY falla, el cerrojo NO queda puesto', async () => {
    const { target, session } = makeHarness({ ptyWriteThrows: true })
    const res = await target({ text: 'haz algo', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(voiceTurnLockActive(session), false)
  })

  test('la charla (sub-chat) NO toca el cerrojo: no comparte PTY con Telegram', async () => {
    const { target, session } = makeHarness()
    await target({ text: 'una duda', mode: 'charla' })
    assert.strictEqual(voiceTurnLockActive(session), false)
  })
})
