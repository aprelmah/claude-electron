'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  createSessionModelReader,
  shortClaudeModel,
  extractClaudeModelFromTail,
  extractCodexTurnContextFromTail,
  codexRolloutDayCandidates
} = require('../main/session-model-reader')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'model-reader-'))
}

test('shortClaudeModel: ids conocidos a nombre corto', () => {
  assert.strictEqual(shortClaudeModel('claude-haiku-4-5-20251001'), 'Haiku 4.5')
  assert.strictEqual(shortClaudeModel('claude-fable-5'), 'Fable 5')
  assert.strictEqual(shortClaudeModel('claude-opus-4-1-20250805'), 'Opus 4.1')
  assert.strictEqual(shortClaudeModel('claude-sonnet-5'), 'Sonnet 5')
})

test('shortClaudeModel: desconocido devuelve el id tal cual, synthetic/vacío devuelven vacío', () => {
  assert.strictEqual(shortClaudeModel('modelo-raro-x'), 'modelo-raro-x')
  assert.strictEqual(shortClaudeModel('<synthetic>'), '')
  assert.strictEqual(shortClaudeModel(''), '')
  assert.strictEqual(shortClaudeModel(null), '')
})

test('extractClaudeModelFromTail: gana el último assistant, no el primero', () => {
  const tail = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5-20251001' } }),
    JSON.stringify({ type: 'user', message: { content: 'hola' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-fable-5' } })
  ].join('\n')
  assert.strictEqual(extractClaudeModelFromTail(tail), 'claude-fable-5')
})

test('extractClaudeModelFromTail: ignora sidechains y synthetic', () => {
  const tail = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-fable-5' } }),
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { model: 'claude-haiku-4-5-20251001' } }),
    JSON.stringify({ type: 'assistant', message: { model: '<synthetic>' } })
  ].join('\n')
  assert.strictEqual(extractClaudeModelFromTail(tail), 'claude-fable-5')
})

test('extractClaudeModelFromTail: tolera primera línea partida (cola de tail)', () => {
  const tail = 'sistant","message":{"model":"claude-opus-5"}}\n' +
    JSON.stringify({ type: 'assistant', message: { model: 'claude-fable-5' } })
  assert.strictEqual(extractClaudeModelFromTail(tail), 'claude-fable-5')
})

test('extractCodexTurnContextFromTail: último turn_context con model y effort', () => {
  const tail = [
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'medium' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message' } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-luna', effort: 'xhigh' } })
  ].join('\n')
  assert.deepStrictEqual(extractCodexTurnContextFromTail(tail), { model: 'gpt-5.6-luna', effort: 'xhigh' })
})

test('extractCodexTurnContextFromTail: sin turn_context devuelve null', () => {
  assert.strictEqual(extractCodexTurnContextFromTail('{"type":"event_msg"}\n'), null)
})

test('codexRolloutDayCandidates: deriva el día del UUIDv7 y mira ±1', () => {
  // 2026-08-07T18:59:06Z ≈ 0x019fdd2a03c2 (ver rollout real del Mac)
  const days = codexRolloutDayCandidates('019fdd2a-03c2-7ef1-9697-da69861b7d2c')
  assert.strictEqual(days.length, 3)
  assert.ok(days[0].includes('2026'))
  assert.ok(days.every((d) => /^\d{4}[/\\]\d{2}[/\\]\d{2}$/.test(d)))
})

test('codexRolloutDayCandidates: id no-uuid devuelve vacío', () => {
  assert.deepStrictEqual(codexRolloutDayCandidates('nope'), [])
  assert.deepStrictEqual(codexRolloutDayCandidates(''), [])
})

test('readClaudeSessionModel: lee del fichero y cachea por stat', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'abc.jsonl')
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5-20251001' } }) + '\n')
  const reader = createSessionModelReader()
  assert.strictEqual(reader.readClaudeSessionModel(file), 'claude-haiku-4-5-20251001')
  // Append con otro modelo → el stat cambia → se relee y gana el nuevo
  fs.appendFileSync(file, JSON.stringify({ type: 'assistant', message: { model: 'claude-fable-5' } }) + '\n')
  assert.strictEqual(reader.readClaudeSessionModel(file), 'claude-fable-5')
})

test('readClaudeSessionModel: fichero inexistente devuelve vacío', () => {
  const reader = createSessionModelReader()
  assert.strictEqual(reader.readClaudeSessionModel('/no/existe.jsonl'), '')
  assert.strictEqual(reader.readClaudeSessionModel(''), '')
})

test('readCodexSessionModel: localiza el rollout por UUIDv7 y saca model+effort', () => {
  const root = tmpDir()
  const sid = '019fdd2a-03c2-7ef1-9697-da69861b7d2c'
  const day = codexRolloutDayCandidates(sid)[0]
  const dir = path.join(root, day)
  fs.mkdirSync(dir, { recursive: true })
  const rollout = path.join(dir, `rollout-2026-08-07T18-59-06-${sid}.jsonl`)
  fs.writeFileSync(rollout, [
    JSON.stringify({ type: 'session_meta', payload: { session_id: sid } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-luna', effort: 'xhigh' } })
  ].join('\n') + '\n')
  const reader = createSessionModelReader({ codexSessionsRoot: root })
  assert.deepStrictEqual(reader.readCodexSessionModel(sid), { model: 'gpt-5.6-luna', effort: 'xhigh' })
})

test('readCodexSessionModel: sin rollout devuelve null', () => {
  const reader = createSessionModelReader({ codexSessionsRoot: tmpDir() })
  assert.strictEqual(reader.readCodexSessionModel('019fdd2a-03c2-7ef1-9697-da69861b7d2c'), null)
})
