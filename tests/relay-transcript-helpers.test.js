'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')

const { createRelayTranscriptHelpers } = require('../main/relay-transcript-helpers')

function extractTurnText(obj) {
  const blocks = obj?.message?.content || []
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const b of blocks) {
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('').trim()
}

function flattenTerminal(s) { return String(s || '') }
function stripAnsi(s) { return String(s || '') }

function makeHelpers() {
  return createRelayTranscriptHelpers({
    resolveClaudeProjectDir: () => null,
    extractTurnText,
    flattenTerminal,
    stripAnsi
  })
}

function makeAssistantLine({ uuid, ts, text, endTurn = false }) {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp: ts,
    message: {
      content: [{ type: 'text', text }],
      stop_reason: endTurn ? 'end_turn' : null
    }
  }) + '\n'
}

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'))
  const file = path.join(dir, 'session.jsonl')
  fs.writeFileSync(file, lines.join(''), 'utf8')
  return file
}

test('extractAssistantTextFromTranscript devuelve la última asistente sin filtro', () => {
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const file = writeTranscript([
    makeAssistantLine({ uuid: 'a1', ts: '2026-05-23T10:00:00.000Z', text: 'respuesta turno 1' }),
    makeAssistantLine({ uuid: 'a2', ts: '2026-05-23T10:00:05.000Z', text: 'respuesta turno 2', endTurn: true })
  ])
  const res = extractAssistantTextFromTranscript(file, 0)
  assert.equal(res.text, 'respuesta turno 2')
  assert.equal(res.sawAssistant, true)
  assert.equal(res.sawEndTurn, true)
})

test('minTimestampMs filtra respuestas anteriores al inicio del turno', () => {
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const file = writeTranscript([
    makeAssistantLine({ uuid: 'a1', ts: '2026-05-23T10:00:00.000Z', text: 'respuesta vieja' }),
    makeAssistantLine({ uuid: 'a2', ts: '2026-05-23T10:00:05.000Z', text: 'respuesta nueva' })
  ])
  const turnStart = Date.parse('2026-05-23T10:00:03.000Z')
  const res = extractAssistantTextFromTranscript(file, 0, turnStart)
  assert.equal(res.text, 'respuesta nueva')
})

test('minTimestampMs descarta respuesta tardía del turno previo (regresión bug desfase)', () => {
  // Escenario: el turno N escribió su respuesta al transcript DESPUÉS de que el
  // turno N+1 hiciera snapshot, pero el writer real respeta el orden temporal:
  // la línea tardía tiene timestamp < startedAt del turno N+1.
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const turnNStart = '2026-05-23T10:00:00.000Z'
  const turnNplus1Start = '2026-05-23T10:00:10.000Z'
  // Simulamos transcript con offset 0: solo la línea tardía del turno N existe.
  const file = writeTranscript([
    makeAssistantLine({ uuid: 'a-tardio', ts: turnNStart, text: 'esto es del turno anterior, no debería verse' })
  ])
  const res = extractAssistantTextFromTranscript(file, 0, Date.parse(turnNplus1Start))
  assert.equal(res.text, '', 'no debe devolver texto del turno anterior')
  assert.equal(res.sawAssistant, false)
  assert.equal(res.sawEndTurn, false)
})

test('minTimestampMs ignora end_turn de líneas pre-turno', () => {
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const file = writeTranscript([
    makeAssistantLine({ uuid: 'a1', ts: '2026-05-23T10:00:00.000Z', text: 'vieja end_turn', endTurn: true }),
    makeAssistantLine({ uuid: 'a2', ts: '2026-05-23T10:00:10.000Z', text: 'nueva sin end_turn' })
  ])
  const res = extractAssistantTextFromTranscript(file, 0, Date.parse('2026-05-23T10:00:05.000Z'))
  assert.equal(res.text, 'nueva sin end_turn')
  assert.equal(res.sawEndTurn, false, 'end_turn antiguo no debe contar')
})

test('minTimestampMs=0 desactiva el filtro (backward compat)', () => {
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const file = writeTranscript([
    makeAssistantLine({ uuid: 'a1', ts: '2026-05-23T10:00:00.000Z', text: 'vieja' }),
    makeAssistantLine({ uuid: 'a2', ts: '2026-05-23T10:00:05.000Z', text: 'nueva' })
  ])
  const res = extractAssistantTextFromTranscript(file, 0, 0)
  assert.equal(res.text, 'nueva')
})

test('líneas sin timestamp pasan el filtro (no se descartan por falta de campo)', () => {
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const lineNoTs = JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    message: { content: [{ type: 'text', text: 'sin ts' }] }
  }) + '\n'
  const file = writeTranscript([lineNoTs])
  const res = extractAssistantTextFromTranscript(file, 0, Date.now())
  assert.equal(res.text, 'sin ts', 'líneas legacy sin timestamp no se filtran')
})

test('respuesta válida con clock drift de 200ms NO se descarta (tolerancia)', () => {
  // Escenario real reportado: el CLI escribe la respuesta del turno actual con
  // timestamp ligeramente anterior al Date.now() del proceso (drift NTP/wall vs
  // monotonic). Con filtro estricto (sin tolerancia) caería y se devolvería
  // texto vacío ⇒ "falló la lectura de respuesta del PTY". Default 500ms cubre.
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const respuestaTs = '2026-05-23T10:00:00.000Z'
  const file = writeTranscript([
    makeAssistantLine({ uuid: 'a-actual', ts: respuestaTs, text: 'respuesta válida del turno actual', endTurn: true })
  ])
  // startedAt 200ms posterior al timestamp escrito por el CLI.
  const startedAt = Date.parse(respuestaTs) + 200
  const res = extractAssistantTextFromTranscript(file, 0, startedAt)
  assert.equal(res.text, 'respuesta válida del turno actual', 'tolerancia 500ms debe permitir clock drift de 200ms')
  assert.equal(res.sawEndTurn, true)
})

test('tolerancia explícita 0 reactiva filtro estricto (backward strict)', () => {
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const respuestaTs = '2026-05-23T10:00:00.000Z'
  const file = writeTranscript([
    makeAssistantLine({ uuid: 'a-old', ts: respuestaTs, text: 'esto sí debe descartarse' })
  ])
  const startedAt = Date.parse(respuestaTs) + 200
  const res = extractAssistantTextFromTranscript(file, 0, startedAt, { toleranceMs: 0 })
  assert.equal(res.text, '', 'tolerancia 0 = comportamiento estricto previo')
})

test('regresión del desfase sigue protegida con tolerancia default 500ms', () => {
  // Diferencia humana entre turnos de chat suele ser >1s. Verificamos que 800ms
  // de gap (peor caso realista) sigue descartando respuesta del turno anterior.
  const { extractAssistantTextFromTranscript } = makeHelpers()
  const respuestaVieja = '2026-05-23T10:00:00.000Z'
  const file = writeTranscript([
    makeAssistantLine({ uuid: 'a-old', ts: respuestaVieja, text: 'respuesta del turno N (no debe colarse)' })
  ])
  // Turno N+1 arranca 800ms después: 500ms tolerancia ⇒ filtro corta en
  // respuestaVieja + 300ms. La respuesta vieja queda fuera.
  const startedAt = Date.parse(respuestaVieja) + 800
  const res = extractAssistantTextFromTranscript(file, 0, startedAt)
  assert.equal(res.text, '', 'con gap de 800ms y tolerancia 500ms, la vieja se descarta')
})
