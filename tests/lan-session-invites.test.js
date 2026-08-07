'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createLanSessionInvites } = require('../main/lan-session-invites')

test('las invitaciones caducan y limitan sus usos', () => {
  let clock = 1000
  const invites = createLanSessionInvites({
    now: () => clock,
    randomBytes: () => Buffer.alloc(32, 7)
  })
  const created = invites.create({
    cwd: '/tmp/power-agent-project',
    sessionId: 'session-abc',
    cli: 'claude',
    label: 'Proyecto demo',
    ttlMs: 60_000,
    maxUses: 2
  })

  assert.equal(invites.has(created.token), true)

  const first = invites.claim(created.token)
  assert.equal(first.cwd, '/tmp/power-agent-project')
  assert.equal(first.sessionId, 'session-abc')
  assert.equal(first.usesRemaining, 1)
  assert.equal(invites.size(), 1)

  const second = invites.claim(created.token)
  assert.equal(second.usesRemaining, 0)
  assert.equal(invites.size(), 0)
  assert.equal(invites.claim(created.token), null)
  assert.equal(invites.has(created.token), false)

  const other = invites.create({ cwd: '/tmp/power-agent-project', sessionId: 's2', cli: 'codex' })
  clock += 10 * 60 * 1000 + 1
  assert.equal(invites.claim(other.token), null)
})

test('no crea invitaciones con ruta, CLI o ID inválidos', () => {
  const invites = createLanSessionInvites({ randomBytes: () => Buffer.alloc(32, 9) })
  assert.throws(() => invites.create({ cwd: 'relative', sessionId: 'ok', cli: 'claude' }))
  assert.throws(() => invites.create({ cwd: '/tmp', sessionId: 'bad id', cli: 'claude' }))
  assert.throws(() => invites.create({ cwd: '/tmp', sessionId: 'ok', cli: 'other' }))
})
