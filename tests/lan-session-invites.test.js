'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createLanSessionInvites,
  MAX_TTL_MS,
  MIRROR_QR_TTL_MS,
  MIRROR_QR_MAX_USES,
  MIRROR_RENEWAL_TTL_MS,
  MIRROR_RENEWAL_MAX_USES
} = require('../main/lan-session-invites')

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

// El QR espejo es 1 uso / 90 s: quien lo fotografíe a tu espalda tiene una
// ventana mínima. La continuidad la da un RENEWAL que solo emite el servidor
// tras conectar, viaja por el propio WS (jamás por un canal externo) y admite
// TTL largo — pero nunca se encadena: su vida es el techo absoluto de acceso.
test('un renewal de espejo admite TTL largo, se marca como tal y no lo crea nadie por defecto', () => {
  let clock = 1000
  const invites = createLanSessionInvites({
    now: () => clock,
    randomBytes: (size) => require('crypto').randomBytes(size)
  })

  const renewal = invites.create({
    mode: 'mirror',
    mirrorId: 'mirror-id-valido-123',
    cli: 'claude',
    ttlMs: MIRROR_RENEWAL_TTL_MS,
    maxUses: MIRROR_RENEWAL_MAX_USES,
    renewal: true
  })
  // El TTL supera el techo normal de 30 min: solo lo permite el flag renewal.
  assert.ok(renewal.expiresAt - clock > MAX_TTL_MS)
  assert.equal(renewal.expiresAt - clock, MIRROR_RENEWAL_TTL_MS)
  assert.equal(renewal.maxUses, MIRROR_RENEWAL_MAX_USES)

  const claimed = invites.claim(renewal.token)
  assert.equal(claimed.mode, 'mirror')
  assert.equal(claimed.renewal, true)

  // Un invite normal NUNCA es renewal ni rebasa el techo de 30 min, aunque lo pida.
  const normal = invites.create({
    mode: 'mirror',
    mirrorId: 'mirror-id-valido-123',
    cli: 'claude',
    ttlMs: MIRROR_RENEWAL_TTL_MS,
    maxUses: MIRROR_RENEWAL_MAX_USES
  })
  assert.equal(normal.expiresAt - clock, MAX_TTL_MS)
  assert.ok(normal.maxUses <= 10)
  assert.equal(invites.claim(normal.token).renewal, false)

  // El flag renewal solo existe en modo espejo.
  const session = invites.create({
    cwd: '/tmp',
    sessionId: 'session-abc',
    cli: 'claude',
    ttlMs: MIRROR_RENEWAL_TTL_MS,
    renewal: true
  })
  assert.equal(session.expiresAt - clock, MAX_TTL_MS)
  assert.equal(invites.claim(session.token).renewal, false)
})

test('las constantes del QR espejo son 1 uso / 90 segundos', () => {
  assert.equal(MIRROR_QR_TTL_MS, 90_000)
  assert.equal(MIRROR_QR_MAX_USES, 1)
})

test('no crea invitaciones con ruta, CLI o ID inválidos', () => {
  const invites = createLanSessionInvites({ randomBytes: () => Buffer.alloc(32, 9) })
  assert.throws(() => invites.create({ cwd: 'relative', sessionId: 'ok', cli: 'claude' }))
  assert.throws(() => invites.create({ cwd: '/tmp', sessionId: 'bad id', cli: 'claude' }))
  assert.throws(() => invites.create({ cwd: '/tmp', sessionId: 'ok', cli: 'other' }))
})
