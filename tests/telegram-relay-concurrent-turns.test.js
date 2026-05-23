'use strict'

// Regresión: cuando llegan dos mensajes Telegram al mismo chat enlazado, la cola
// del bridge serializa los _runQuery. Pero entre que un relayThroughPty completa
// (cleanup) y el siguiente entra, puede haber un margen donde session.relayActive
// aún esté en true (cleanup tardío). El comportamiento anterior devolvía null
// inmediatamente → el turno bound caía a "PTY enlazado falló". Ahora debe esperar
// (busy-wait corto) a que se libere.
//
// Este test verifica el patrón de busy-wait usado en main.js:relayThroughPty.

const test = require('node:test')
const assert = require('node:assert/strict')

// Réplica del busy-wait que prepende relayThroughPty.
async function waitForRelayFree(session, { signal, busyWaitMs = 1000, pollMs = 10 } = {}) {
  if (!session.relayActive) return { proceeded: true, waited: 0 }
  const start = Date.now()
  while (session.relayActive && Date.now() - start < busyWaitMs) {
    if (signal?.aborted) {
      const err = new Error('Request aborted')
      err.name = 'AbortError'
      throw err
    }
    await new Promise((r) => setTimeout(r, pollMs))
    if (!session?.pty) return { proceeded: false, waited: Date.now() - start, reason: 'pty-died' }
  }
  if (session.relayActive) return { proceeded: false, waited: Date.now() - start, reason: 'timeout' }
  return { proceeded: true, waited: Date.now() - start }
}

test('busy-wait: si relayActive se libera dentro del timeout, procede', async () => {
  const session = { pty: {}, relayActive: true }
  // Liberar al cabo de 50ms
  setTimeout(() => { session.relayActive = false }, 50)
  const res = await waitForRelayFree(session, { busyWaitMs: 500, pollMs: 10 })
  assert.equal(res.proceeded, true)
  assert.ok(res.waited >= 40 && res.waited < 200, `esperó ~50ms, fue ${res.waited}`)
})

test('busy-wait: si relayActive nunca se libera, falla por timeout (no bloquea para siempre)', async () => {
  const session = { pty: {}, relayActive: true }
  const t0 = Date.now()
  const res = await waitForRelayFree(session, { busyWaitMs: 100, pollMs: 10 })
  const elapsed = Date.now() - t0
  assert.equal(res.proceeded, false)
  assert.equal(res.reason, 'timeout')
  assert.ok(elapsed >= 90 && elapsed < 300, `esperó ~100ms, fue ${elapsed}`)
})

test('busy-wait: si pty muere mientras espera, sale limpio sin bloquear', async () => {
  const session = { pty: {}, relayActive: true }
  setTimeout(() => { session.pty = null }, 30)
  const res = await waitForRelayFree(session, { busyWaitMs: 500, pollMs: 5 })
  assert.equal(res.proceeded, false)
  assert.equal(res.reason, 'pty-died')
})

test('busy-wait: si signal.aborted llega durante la espera, lanza AbortError', async () => {
  const session = { pty: {}, relayActive: true }
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 20)
  await assert.rejects(
    () => waitForRelayFree(session, { signal: ctrl.signal, busyWaitMs: 500, pollMs: 5 }),
    /aborted/i
  )
})

test('busy-wait: si relayActive ya es false al entrar, procede sin esperar', async () => {
  const session = { pty: {}, relayActive: false }
  const res = await waitForRelayFree(session, { busyWaitMs: 1000, pollMs: 10 })
  assert.equal(res.proceeded, true)
  assert.equal(res.waited, 0)
})

test('escenario carga: turno 2 entra justo cuando turno 1 cleanea → procede en lugar de devolver null', async () => {
  // Simulación realista: turno 1 marca relayActive=true, lo libera tras 80ms.
  // Turno 2 entra a los 60ms con la flag aún en true. Antes del fix devolvía null;
  // ahora espera 20ms y procede.
  const session = { pty: {}, relayActive: true }
  setTimeout(() => { session.relayActive = false }, 80)
  await new Promise((r) => setTimeout(r, 60))
  const res = await waitForRelayFree(session, { busyWaitMs: 500, pollMs: 5 })
  assert.equal(res.proceeded, true)
  assert.ok(res.waited >= 10 && res.waited < 100)
})
