'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { decideExtractRunner } = require('../main/extract-runner')

const avail = (map) => (cli) => map[cli] || { ok: false, error: `${cli} no disponible` }

test('extract-runner: usa el runner pedido si su CLI está', () => {
  const check = avail({ codex: { ok: true }, claude: { ok: true } })
  assert.strictEqual(decideExtractRunner('codex', check).runner, 'codex')
  assert.strictEqual(decideExtractRunner('claude', check).runner, 'claude')
})

test('extract-runner: cae al otro CLI si el pedido no está', () => {
  const soloClaude = avail({ claude: { ok: true } })
  assert.strictEqual(decideExtractRunner('codex', soloClaude).runner, 'claude')
  const soloCodex = avail({ codex: { ok: true } })
  assert.strictEqual(decideExtractRunner('claude', soloCodex).runner, 'codex')
})

test('extract-runner: sin ninguno, error con el pedido primero', () => {
  const ninguno = avail({})
  const r = decideExtractRunner('codex', ninguno)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'codex no disponible / claude no disponible')
  const r2 = decideExtractRunner('claude', ninguno)
  assert.strictEqual(r2.error, 'claude no disponible / codex no disponible')
})

test('extract-runner: runner desconocido o vacío equivale a claude', () => {
  const check = avail({ claude: { ok: true }, codex: { ok: true } })
  assert.strictEqual(decideExtractRunner(undefined, check).runner, 'claude')
  assert.strictEqual(decideExtractRunner('gpt', check).runner, 'claude')
})

test('extract-runner: no comprueba el secundario si el primario está', () => {
  const llamadas = []
  const check = (cli) => { llamadas.push(cli); return { ok: true } }
  decideExtractRunner('codex', check)
  assert.deepStrictEqual(llamadas, ['codex'])
})
