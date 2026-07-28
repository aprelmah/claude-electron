'use strict'

// Regresión 2026-07-28 (segunda vuelta): el relay localizaba el transcript
// adivinando el directorio a partir del cwd. Con aislamiento git eso falla en
// las DOS direcciones:
//   - sesión nueva dentro del worktree  -> el JSONL está en el proyecto del worktree
//   - sesión resumida con --resume <id> -> Claude Code sigue escribiendo en el
//     proyecto ORIGINAL, aunque el proceso corra en el worktree
// Al no encontrarlo, nunca veía end_turn y a los 45s mandaba el TUI raspado.
// La fuente de verdad es el fichero <sessionId>.jsonl, esté donde esté.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createRelayTranscriptHelpers } = require('../main/relay-transcript-helpers')

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-locate-'))
}

// Réplica mínima de la codificación de Claude Code: / y espacios -> '-'
function makeHelpers(root) {
  return createRelayTranscriptHelpers({
    resolveClaudeProjectDir: (cwd) => {
      if (!cwd) return null
      return path.join(root, String(cwd).replace(/\/$/, '').replace(/[/\s_]+/g, '-'))
    },
    extractTurnText: (obj) => {
      const c = obj?.message?.content
      if (!Array.isArray(c)) return ''
      return c.filter((b) => b?.type === 'text').map((b) => b.text).join(' ').trim()
    },
    flattenTerminal: (s) => s,
    stripAnsi: (s) => s
  })
}

function writeTranscript(dir, sessionId, lines) {
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, `${sessionId}.jsonl`)
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

const SID = 'f3b0eccc-1b03-498d-ad6d-8836d47a96d1'
const REAL = '/Users/isabel/Desktop/turbo-e'
const WORK = '/Users/isabel/Library/Application Support/CLAUDE-NOVAK/worktrees/turbo-e-01caf6'

const turn = (text, stop) => ({
  type: 'assistant',
  timestamp: new Date().toISOString(),
  message: { stop_reason: stop, content: [{ type: 'text', text }] }
})

test('sesión resumida: encuentra el transcript en el proyecto real aunque el cwd sea el worktree', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const realDir = path.join(root, '-Users-isabel-Desktop-turbo-e')
  const expected = writeTranscript(realDir, SID, [turn('Hola Luismi. Dime.', 'end_turn')])
  // el worktree ni siquiera tiene directorio de proyecto

  const found = h.findRelayTranscript({ sessionId: SID, cwds: [WORK, REAL] })
  assert.ok(found, 'debe encontrar el transcript')
  assert.strictEqual(found.filePath, expected)
})

test('sesión nueva en el worktree: encuentra el transcript del worktree', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const workDir = path.join(root, '-Users-isabel-Library-Application-Support-CLAUDE-NOVAK-worktrees-turbo-e-01caf6')
  const expected = writeTranscript(workDir, SID, [turn('respuesta', 'end_turn')])

  const found = h.findRelayTranscript({ sessionId: SID, cwds: [WORK, REAL] })
  assert.strictEqual(found?.filePath, expected)
})

test('si está en los dos sitios, gana el más reciente', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const realDir = path.join(root, '-Users-isabel-Desktop-turbo-e')
  const workDir = path.join(root, '-Users-isabel-Library-Application-Support-CLAUDE-NOVAK-worktrees-turbo-e-01caf6')
  const viejo = writeTranscript(workDir, SID, [turn('viejo', 'end_turn')])
  const nuevo = writeTranscript(realDir, SID, [turn('nuevo', 'end_turn')])
  fs.utimesSync(viejo, new Date(Date.now() - 60000), new Date(Date.now() - 60000))

  assert.strictEqual(h.findRelayTranscript({ sessionId: SID, cwds: [WORK, REAL] })?.filePath, nuevo)
})

test('barrido global: lo encuentra aunque no esté en ninguno de los cwds conocidos', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const otro = path.join(root, '-Users-isabel-otro-proyecto')
  const expected = writeTranscript(otro, SID, [turn('respuesta', 'end_turn')])

  assert.strictEqual(h.findRelayTranscript({ sessionId: SID, cwds: [WORK, REAL] })?.filePath, expected)
})

test('sin sessionId cae al .jsonl más reciente de los cwds candidatos', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const realDir = path.join(root, '-Users-isabel-Desktop-turbo-e')
  const viejo = writeTranscript(realDir, 'aaaaaaaa-0000-0000-0000-000000000000', [turn('viejo', 'end_turn')])
  const nuevo = writeTranscript(realDir, 'bbbbbbbb-0000-0000-0000-000000000000', [turn('nuevo', 'end_turn')])
  fs.utimesSync(viejo, new Date(Date.now() - 60000), new Date(Date.now() - 60000))

  assert.strictEqual(h.findRelayTranscript({ sessionId: null, cwds: [WORK, REAL] })?.filePath, nuevo)
})

test('devuelve size y sessionId para poder anclar el offset del turno', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const realDir = path.join(root, '-Users-isabel-Desktop-turbo-e')
  const p = writeTranscript(realDir, SID, [turn('hola', 'end_turn')])

  const found = h.findRelayTranscript({ sessionId: SID, cwds: [REAL] })
  assert.strictEqual(found.sessionId, SID)
  assert.strictEqual(found.size, fs.statSync(p).size)
})

test('no encuentra nada: devuelve null sin lanzar', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  assert.strictEqual(h.findRelayTranscript({ sessionId: SID, cwds: [WORK, REAL] }), null)
  assert.strictEqual(h.findRelayTranscript({ sessionId: null, cwds: [] }), null)
})

test('lectura parcial: solo parsea lo nuevo desde el offset', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = path.join(root, '-Users-isabel-Desktop-turbo-e')
  const p = writeTranscript(dir, SID, [turn('respuesta VIEJA de otro turno', 'end_turn')])
  const offset = fs.statSync(p).size
  fs.appendFileSync(p, JSON.stringify(turn('respuesta NUEVA', 'end_turn')) + '\n')

  const r = h.extractAssistantTextFromTranscript(p, offset, 0)
  assert.strictEqual(r.text, 'respuesta NUEVA')
  assert.strictEqual(r.turnComplete, true)
})

test('turnComplete solo si el ÚLTIMO evento cierra el turno', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = path.join(root, '-Users-isabel-Desktop-turbo-e')
  // texto + end_turn, pero después arranca una herramienta: el turno sigue vivo
  const p = writeTranscript(dir, SID, [
    turn('voy a mirar el archivo', 'end_turn'),
    turn('', 'tool_use')
  ])
  const r = h.extractAssistantTextFromTranscript(p, 0, 0)
  assert.strictEqual(r.sawEndTurn, true, 'hubo un end_turn por el medio')
  assert.strictEqual(r.turnComplete, false, 'pero el turno no ha terminado')
})

test('los turnos de sub-agentes (isSidechain) no cierran el turno', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = path.join(root, '-Users-isabel-Desktop-turbo-e')
  const sub = { ...turn('resultado del sub-agente', 'end_turn'), isSidechain: true }
  const p = writeTranscript(dir, SID, [turn('', 'tool_use'), sub])
  const r = h.extractAssistantTextFromTranscript(p, 0, 0)
  assert.strictEqual(r.turnComplete, false)
  assert.strictEqual(r.text, '')
})

test('fichero vacío o inexistente no revienta', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = path.join(root, '-x')
  fs.mkdirSync(dir, { recursive: true })
  const vacio = path.join(dir, 'v.jsonl')
  fs.writeFileSync(vacio, '')
  assert.strictEqual(h.extractAssistantTextFromTranscript(vacio, 0, 0).turnComplete, false)
  assert.strictEqual(h.extractAssistantTextFromTranscript(path.join(dir, 'no-existe.jsonl'), 0, 0).text, '')
})

test('offset a mitad de línea sí descarta la línea partida', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = path.join(root, '-Users-isabel-Desktop-turbo-e')
  const p = writeTranscript(dir, SID, [turn('respuesta VIEJA', 'end_turn')])
  const size = fs.statSync(p).size
  fs.appendFileSync(p, JSON.stringify(turn('respuesta NUEVA', 'end_turn')) + '\n')

  // offset 10 bytes ANTES del fin de la línea vieja: el slice empieza partido
  const r = h.extractAssistantTextFromTranscript(p, size - 10, 0)
  assert.strictEqual(r.text, 'respuesta NUEVA', 'descarta el resto partido y lee la nueva')
})
