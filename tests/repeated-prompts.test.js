'use strict'

// Detector de tareas repetidas (adaptación del learning loop de Hermes Agent):
// si el mismo encargo entra 3+ veces en 30 días por los canales (Telegram,
// avisos, voz), se propone convertirlo en tarea programada o skill. Sin LLM:
// normalización + Jaccard de tokens.
const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createRepeatedPromptDetector } = require(path.join(REPO_ROOT, 'main', 'repeated-prompts.js'))

const DAY = 24 * 3600 * 1000

function makeDetector(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repeated-'))
  const storePath = path.join(dir, 'repeated-prompts.json')
  return {
    storePath,
    det: createRepeatedPromptDetector({ storePath, now: overrides.now || Date.now, ...overrides })
  }
}

const PROMPT = 'revisa los issues de github del repo y hazme un resumen de los importantes'

describe('repeated-prompts: detección', () => {
  test('la tercera vez similar en ventana dispara la propuesta', () => {
    let ts = 1000
    const { det } = makeDetector({ now: () => ts })
    assert.strictEqual(det.record({ text: PROMPT, source: 'telegram' }).repeated, false)
    ts += DAY
    assert.strictEqual(det.record({ text: 'Revisa los issues de GitHub del repo y hazme un resumen de los importantes, porfa', source: 'voz' }).repeated, false)
    ts += DAY
    const res = det.record({ text: PROMPT, source: 'telegram' })
    assert.strictEqual(res.repeated, true)
    assert.strictEqual(res.count, 3)
  })

  test('prompts distintos no se agrupan', () => {
    let ts = 1000
    const { det } = makeDetector({ now: () => ts })
    det.record({ text: PROMPT })
    ts += 1000
    det.record({ text: 'mándale un whatsapp a mi hermano felicitándole el cumpleaños desde la agenda' })
    ts += 1000
    const res = det.record({ text: 'apúntame en el calendario la reunión del jueves con el proveedor de baterías' })
    assert.strictEqual(res.repeated, false)
    assert.strictEqual(det.listClusters().length, 3)
  })

  test('prompts cortos se ignoran (no son "tareas")', () => {
    const { det } = makeDetector()
    for (let i = 0; i < 5; i++) {
      const res = det.record({ text: 'sí, hazlo' })
      assert.strictEqual(res.repeated, false)
    }
    assert.strictEqual(det.listClusters().length, 0)
  })

  test('las repeticiones fuera de la ventana de 30 días no cuentan', () => {
    let ts = 1000
    const { det } = makeDetector({ now: () => ts })
    det.record({ text: PROMPT })
    ts += 31 * DAY
    det.record({ text: PROMPT })
    ts += 2 * 3600 * 1000
    const res = det.record({ text: PROMPT })
    assert.strictEqual(res.repeated, false, 'solo hay 2 hits vivos en ventana')
  })

  test('cooldown: propuesta lanzada no se repite hasta pasada una semana', () => {
    let ts = 1000
    const HOUR = 3600 * 1000
    const { det } = makeDetector({ now: () => ts })
    det.record({ text: PROMPT })
    ts += HOUR
    det.record({ text: PROMPT })
    ts += HOUR
    assert.strictEqual(det.record({ text: PROMPT }).repeated, true)
    ts += HOUR
    assert.strictEqual(det.record({ text: PROMPT }).repeated, false, 'en cooldown')
    ts += 8 * DAY
    assert.strictEqual(det.record({ text: PROMPT }).repeated, true, 'cooldown vencido')
  })

  test('reintentos inmediatos (<1 min) no cuentan como repetición', () => {
    let ts = 1000
    const { det } = makeDetector({ now: () => ts })
    det.record({ text: PROMPT })
    ts += 5000
    det.record({ text: PROMPT })
    ts += 5000
    det.record({ text: PROMPT })
    assert.strictEqual(det.listClusters()[0].count, 1, 'un solo hit pese a 3 llamadas')
  })

  test('mayúsculas y tildes no separan clusters', () => {
    let ts = 1000
    const { det } = makeDetector({ now: () => ts })
    det.record({ text: 'Haz el análisis de ventas del mes y guárdalo en el escritorio' })
    ts += 1000
    det.record({ text: 'haz el analisis de ventas del mes y guardalo en el escritorio' })
    assert.strictEqual(det.listClusters().length, 1)
  })
})

describe('repeated-prompts: propuestas para la bandeja', () => {
  const HOUR = 3600 * 1000

  function triggerProposal(det, tsRef) {
    det.record({ text: PROMPT })
    tsRef.v += HOUR
    det.record({ text: PROMPT })
    tsRef.v += HOUR
    return det.record({ text: PROMPT })
  }

  test('al dispararse queda una propuesta pendiente listable', () => {
    const tsRef = { v: 1000 }
    const { det } = makeDetector({ now: () => tsRef.v })
    assert.strictEqual(triggerProposal(det, tsRef).repeated, true)
    const list = det.listProposals()
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].count, 3)
    assert.match(list[0].id, /^[0-9a-f]{12}$/)
  })

  test('resolver como done/dismissed la saca de la lista y no vuelve a proponer', () => {
    const tsRef = { v: 1000 }
    const { det } = makeDetector({ now: () => tsRef.v })
    triggerProposal(det, tsRef)
    const [p] = det.listProposals()
    assert.strictEqual(det.resolveProposal(p.id, 'dismissed').ok, true)
    assert.strictEqual(det.listProposals().length, 0)
    // Pasado el cooldown, un cluster descartado sigue sin proponer.
    tsRef.v += 9 * DAY
    tsRef.v += HOUR
    det.record({ text: PROMPT })
    tsRef.v += HOUR
    assert.strictEqual(det.record({ text: PROMPT }).repeated, false)
    assert.strictEqual(det.listProposals().length, 0)
  })

  test('resolver un id desconocido no revienta', () => {
    const { det } = makeDetector()
    assert.strictEqual(det.resolveProposal('nadie', 'done').ok, false)
  })

  test('las propuestas sobreviven a otra instancia (persisten en el store)', () => {
    const tsRef = { v: 1000 }
    const { det, storePath } = makeDetector({ now: () => tsRef.v })
    triggerProposal(det, tsRef)
    const det2 = createRepeatedPromptDetector({ storePath, now: () => tsRef.v })
    assert.strictEqual(det2.listProposals().length, 1)
  })
})

describe('repeated-prompts: persistencia', () => {
  test('otra instancia con el mismo storePath ve los clusters', () => {
    let ts = 1000
    const HOUR = 3600 * 1000
    const { det, storePath } = makeDetector({ now: () => ts })
    det.record({ text: PROMPT })
    ts += HOUR
    det.record({ text: PROMPT })
    const det2 = createRepeatedPromptDetector({ storePath, now: () => ts + HOUR })
    const res = det2.record({ text: PROMPT })
    assert.strictEqual(res.repeated, true)
    assert.strictEqual(res.count, 3)
  })

  test('store corrupto no revienta: arranca de cero', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repeated-'))
    const storePath = path.join(dir, 'repeated-prompts.json')
    fs.writeFileSync(storePath, '{basura###')
    const det = createRepeatedPromptDetector({ storePath })
    assert.strictEqual(det.record({ text: PROMPT }).repeated, false)
    assert.strictEqual(det.listClusters().length, 1)
  })
})
