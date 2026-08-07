'use strict'

// La adivinanza del sessionId de codex NO puede caer a "la última fila del
// historial" cuando ninguna es posterior al arranque del PTY: una sesión nueva
// (codex aún no ha escrito nada) se quedaba con la conversación VIEJA, el meta
// la persistía en session.codexSessionId y "Llevar a Terminal" abría esa.
// Mismo bug que el de claude del 2026-08-07, en la rama codex.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCodexSessionReader } = require('../main/codex-session-reader')

function writeHistory(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hist-'))
  const file = path.join(dir, 'history.jsonl')
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return file
}

function makeReader(rows) {
  return createCodexSessionReader({
    historyPath: writeHistory(rows),
    sessionIndexPath: '/dev/null',
    stateDbPath: '/dev/null'
  })
}

const HOY = Math.floor(Date.now() / 1000)

// Los session_id de codex son UUIDv7: los primeros 48 bits son el instante de
// creación de la sesión en ms. Fabricamos ids con hora conocida para poder
// afirmar de quién es cada conversación sin depender de cuándo se teclea.
function idCreadoEn(ms, sufijo = '0000') {
  const hex = Math.floor(ms).toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${sufijo.slice(0, 3)}-a119-17b16a83${sufijo.slice(0, 4)}`
}

test('sesión nueva sin turnos: no devuelve la conversación anterior', () => {
  const { guessCodexSessionFromHistory } = makeReader([
    { session_id: 'vieja-de-ayer', ts: HOY - 86400, text: 'lo de ayer' }
  ])
  const guess = guessCodexSessionFromHistory({ ptyStartedAt: Date.now() })
  assert.strictEqual(guess, null)
})

test('sesión con turno propio: devuelve su fila, no la vieja', () => {
  const arrancoHace10s = Date.now() - 10_000
  const { guessCodexSessionFromHistory } = makeReader([
    { session_id: 'vieja-de-ayer', ts: HOY - 86400, text: 'lo de ayer' },
    { session_id: 'la-de-ahora', ts: HOY, text: 'hola' }
  ])
  const guess = guessCodexSessionFromHistory({ ptyStartedAt: arrancoHace10s })
  assert.strictEqual(guess?.sessionId, 'la-de-ahora')
})

test('sin ptyStartedAt no se inventa nada', () => {
  const { guessCodexSessionFromHistory } = makeReader([
    { session_id: 'vieja-de-ayer', ts: HOY - 86400, text: 'lo de ayer' }
  ])
  assert.strictEqual(guessCodexSessionFromHistory({}), null)
})

test('historial vacío: null', () => {
  const { guessCodexSessionFromHistory } = makeReader([])
  assert.strictEqual(guessCodexSessionFromHistory({ ptyStartedAt: Date.now() }), null)
})

// El síntoma que reportó Luismi: llevaba rato hablando con codex y el botón
// decía "no hay conversación". sinceMs incluía `lastLocalInputAt - 1500`, o sea
// que teclear movía el filtro a los últimos ~3,5 s y descartaba la propia
// conversación en cuanto el último turno tenía más de unos segundos.
test('sesión con rato de conversación: la encuentra aunque el último turno sea viejo', () => {
  const arranque = Date.now() - 30 * 60_000
  const miId = idCreadoEn(arranque + 1500, 'aaaa')
  const { guessCodexSessionFromHistory } = makeReader([
    { session_id: idCreadoEn(arranque - 60 * 60_000, 'bbbb'), ts: HOY - 3600, text: 'de antes' },
    { session_id: miId, ts: HOY - 1500, text: 'primer turno' },
    { session_id: miId, ts: HOY - 600, text: 'último turno, hace 10 min' }
  ])
  const guess = guessCodexSessionFromHistory({ ptyStartedAt: arranque, lastLocalInputAt: Date.now() })
  assert.strictEqual(guess?.sessionId, miId)
})

test('no adopta la conversación de otra ventana abierta antes que esta', () => {
  const arranque = Date.now() - 5 * 60_000
  const otraVentana = idCreadoEn(arranque - 20 * 60_000, 'cccc')
  const { guessCodexSessionFromHistory } = makeReader([
    { session_id: otraVentana, ts: HOY - 30, text: 'turno reciente de la otra ventana' }
  ])
  assert.strictEqual(guessCodexSessionFromHistory({ ptyStartedAt: arranque }), null)
})

test('con dos sesiones posteriores al arranque coge la que nació con este PTY', () => {
  const arranque = Date.now() - 10 * 60_000
  const miId = idCreadoEn(arranque + 900, 'dddd')
  const ventanaPosterior = idCreadoEn(arranque + 5 * 60_000, 'eeee')
  const { guessCodexSessionFromHistory } = makeReader([
    { session_id: miId, ts: HOY - 500, text: 'lo mío' },
    { session_id: ventanaPosterior, ts: HOY - 10, text: 'lo de la otra ventana' }
  ])
  const guess = guessCodexSessionFromHistory({ ptyStartedAt: arranque })
  assert.strictEqual(guess?.sessionId, miId)
})

test('id que no es UUIDv7: cae al filtro por hora de la fila', () => {
  const arranque = Date.now() - 60_000
  const { guessCodexSessionFromHistory } = makeReader([
    { session_id: 'formato-raro-sin-timestamp', ts: HOY, text: 'hola' }
  ])
  const guess = guessCodexSessionFromHistory({ ptyStartedAt: arranque })
  assert.strictEqual(guess?.sessionId, 'formato-raro-sin-timestamp')
})
