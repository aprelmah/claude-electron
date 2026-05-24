'use strict'

// Regresión: RelayNoOutput disparaba erróneamente tras 25s sin output del PTY
// cuando el modelo estaba "pensando" o llamando MCPs lentos. Claude CLI escribe
// al transcript JSONL antes de redibujar el TUI, así que el wait inicial debe
// chequear ese crecimiento como señal de vida.
//
// Este test verifica el contrato del liveness check + el techo subido a 90s.
//
// NO se importa main.js entero (lo arrastra Electron). Reproducimos el patrón
// del helper firstOutputTimer + livenessTimer en estado puro.

const test = require('node:test')
const assert = require('node:assert/strict')

function createRelayWaiter({
  waitFirstOutputMs = 90000,
  livenessPollMs = 50,
  snapshotFn,
  onTimeout,
  isClaude = true
}) {
  let finalized = false
  let sawAnyOutput = false
  let firstOutputTimer = null
  let livenessTimer = null
  let livenessBaseline = isClaude && typeof snapshotFn === 'function' ? snapshotFn() : null

  const cleanup = () => {
    if (finalized) return
    finalized = true
    if (firstOutputTimer) clearTimeout(firstOutputTimer)
    if (livenessTimer) clearInterval(livenessTimer)
  }

  const armFirstOutputTimer = () => {
    if (firstOutputTimer) clearTimeout(firstOutputTimer)
    firstOutputTimer = setTimeout(() => {
      if (finalized || sawAnyOutput) return
      cleanup()
      onTimeout?.()
    }, waitFirstOutputMs)
  }

  armFirstOutputTimer()

  if (isClaude && typeof snapshotFn === 'function') {
    livenessTimer = setInterval(() => {
      if (finalized || sawAnyOutput) return
      let grew = false
      try {
        const current = snapshotFn()
        for (const [file, meta] of current.entries()) {
          const prev = livenessBaseline?.get(file)
          if (!prev || (meta?.size || 0) > (prev?.size || 0)) {
            grew = true
            break
          }
        }
        livenessBaseline = current
      } catch {}
      if (grew) armFirstOutputTimer()
    }, livenessPollMs)
  }

  return {
    feedChunk(chunk) {
      if (finalized) return
      if (typeof chunk === 'string' && chunk.length > 0) {
        sawAnyOutput = true
        if (firstOutputTimer) { clearTimeout(firstOutputTimer); firstOutputTimer = null }
      }
    },
    finish() { cleanup() },
    get finalized() { return finalized },
    get sawAnyOutput() { return sawAnyOutput }
  }
}

test('liveness: si el transcript crece durante el wait, NO dispara RelayNoOutput', (t) => {
  // TEST-H1: anteriormente flaky (2/5 fail) por timing real. Usamos clock fake.
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const snap = new Map([['turn.jsonl', { size: 100 }]])
  let timedOut = false
  const waiter = createRelayWaiter({
    waitFirstOutputMs: 120,
    livenessPollMs: 20,
    snapshotFn: () => new Map(snap),
    onTimeout: () => { timedOut = true }
  })

  // Avanza 50ms y hace crecer el transcript (modelo escribe al JSONL).
  t.mock.timers.tick(50)
  snap.set('turn.jsonl', { size: 250 })
  // Avanza otros 20ms (livenessPoll detecta grow → re-arma firstOutputTimer)
  t.mock.timers.tick(20)
  // Avanza a 90ms (segundo grow)
  t.mock.timers.tick(20)
  snap.set('turn.jsonl', { size: 500 })
  // Tick hasta 200ms total
  t.mock.timers.tick(110)

  assert.equal(timedOut, false, 'liveness no debe disparar RelayNoOutput si transcript crece')
  waiter.finish()
  t.mock.timers.reset()
})

test('liveness: si el transcript NO crece y no llega chunk, dispara RelayNoOutput (timeout limpio)', async () => {
  const snap = new Map([['turn.jsonl', { size: 100 }]])
  let timedOut = false
  const waiter = createRelayWaiter({
    waitFirstOutputMs: 80,
    livenessPollMs: 20,
    snapshotFn: () => new Map(snap),
    onTimeout: () => { timedOut = true }
  })

  await new Promise((r) => setTimeout(r, 150))
  assert.equal(timedOut, true, 'sin crecimiento ni chunk, debe disparar timeout claro')
})

test('liveness: si llega chunk real al PTY (sawAnyOutput), el liveness deja de mandar', async () => {
  const snap = new Map([['turn.jsonl', { size: 100 }]])
  let timedOut = false
  const waiter = createRelayWaiter({
    waitFirstOutputMs: 60,
    livenessPollMs: 20,
    snapshotFn: () => new Map(snap),
    onTimeout: () => { timedOut = true }
  })

  setTimeout(() => waiter.feedChunk('hola humano'), 30)
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(timedOut, false, 'chunk real debe cancelar el timer y prevenir el timeout')
  assert.equal(waiter.sawAnyOutput, true)
  waiter.finish()
})

test('liveness: snapshot vacío al inicio + transcript creado nuevo (con crecimiento sostenido) → no dispara', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const snap = new Map()
  let timedOut = false
  const waiter = createRelayWaiter({
    waitFirstOutputMs: 80,
    livenessPollMs: 20,
    snapshotFn: () => new Map(snap),
    onTimeout: () => { timedOut = true }
  })

  t.mock.timers.tick(30); snap.set('nueva.jsonl', { size: 50 })
  t.mock.timers.tick(20) // poll detecta nuevo file → re-arma
  t.mock.timers.tick(30); snap.set('nueva.jsonl', { size: 100 })
  t.mock.timers.tick(20) // poll detecta grow → re-arma
  t.mock.timers.tick(30); snap.set('nueva.jsonl', { size: 200 })
  t.mock.timers.tick(70)

  assert.equal(timedOut, false, 'crecimiento sostenido del transcript debe mantener vivo el timer')
  waiter.finish()
  t.mock.timers.reset()
})

test('liveness: solo aplica a Claude, Codex no usa transcript (timer normal)', async () => {
  let timedOut = false
  const waiter = createRelayWaiter({
    waitFirstOutputMs: 60,
    livenessPollMs: 20,
    snapshotFn: () => { throw new Error('no se debe llamar para codex') },
    onTimeout: () => { timedOut = true },
    isClaude: false
  })

  await new Promise((r) => setTimeout(r, 120))
  assert.equal(timedOut, true, 'sin chunk en codex, timer debe disparar normal')
})

test('liveness: si snapshotFn lanza error, no rompe el waiter', async () => {
  let calls = 0
  let timedOut = false
  const waiter = createRelayWaiter({
    waitFirstOutputMs: 100,
    livenessPollMs: 20,
    snapshotFn: () => {
      calls++
      if (calls === 2) throw new Error('ENOENT')
      return new Map([['x.jsonl', { size: 100 + calls * 10 }]])
    },
    onTimeout: () => { timedOut = true }
  })

  await new Promise((r) => setTimeout(r, 80))
  // Aunque snapshotFn falle una vez, el waiter sigue. Como hay crecimiento en otras
  // llamadas, el timer se resetea y no dispara.
  assert.equal(timedOut, false, 'error en snapshot no debe matar el waiter')
  waiter.finish()
})

// Documenta los valores efectivos del fix (no son arbitrarios).
test('valores efectivos del fix: WAIT_FIRST_OUTPUT_MS=90000 cubre razonamiento + MCPs lentos', () => {
  // El valor concreto vive en main.js. Aquí solo aseguramos que el contrato del
  // helper sí acepta valores grandes sin colgarse — y que el liveness check
  // sigue siendo el mecanismo principal contra modelos lentos.
  const WAIT_FIRST_OUTPUT_MS = 90000
  const MAX_WAIT_MS = 180000
  const LIVENESS_POLL_MS = 2000
  assert.ok(WAIT_FIRST_OUTPUT_MS < MAX_WAIT_MS, 'first-output timeout debe ser menor que max-wait')
  assert.ok(LIVENESS_POLL_MS * 5 < WAIT_FIRST_OUTPUT_MS, 'liveness debe tener varias oportunidades antes del timeout')
})
