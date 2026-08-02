'use strict'

// Bug real 2026-08-02: al resumir una sesión en el TUI (`--resume <id>`),
// Claude Code hace FORK a un sessionId nuevo: el .jsonl viejo queda intacto y
// los turnos nuevos van al fichero forkeado. El relay de Telegram, enganchado
// al sessionId del spawn, miraba el fichero viejo hasta agotar los 45s →
// "Error: Relay PTY enlazado falló (RelayEmpty)".
// detectForkedRelayTranscript encuentra el fichero forkeado: uno nuevo (o
// crecido) en los proyectos candidatos, distinto del esperado, que contenga el
// prompt recién escrito.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createRelayTranscriptHelpers } = require('../main/relay-transcript-helpers')

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fork-'))
}

function makeHelpers(root) {
  return createRelayTranscriptHelpers({
    resolveClaudeProjectDir: (cwd) => {
      if (!cwd) return null
      return path.join(root, String(cwd).replace(/\/$/, '').replace(/[/\s_]+/g, '-'))
    },
    extractTurnText: () => '',
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

const OLD_SID = 'd5173326-35c8-4057-834f-9f25990c76dd'
const FORK_SID = 'e95bc91e-217c-463a-a02d-e63b94582d7b'
const CWD = '/Users/x/AGENTES-PROPIOS'

test('detecta el fichero forkeado que contiene el prompt del turno', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = h.claudeProjectSessionsDir(CWD)

  writeTranscript(dir, OLD_SID, [{ type: 'user', cwd: CWD, message: { content: 'historial viejo' } }])
  const before = [{ cwd: CWD, snap: h.snapshotClaudeSessionMeta(CWD) }]

  // Tras el write del prompt aparece el fork con el historial copiado + turno nuevo.
  writeTranscript(dir, FORK_SID, [
    { type: 'last-prompt', sessionId: FORK_SID },
    { type: 'user', cwd: CWD, message: { content: 'historial viejo' } },
    { type: 'user', cwd: CWD, message: { content: 'Hola' } }
  ])

  const hit = h.detectForkedRelayTranscript({
    cwds: [CWD],
    before,
    excludeSessionId: OLD_SID,
    promptMarker: 'Hola'
  })
  assert.ok(hit)
  assert.strictEqual(hit.sessionId, FORK_SID)
  assert.strictEqual(hit.baseOffset, 0)
})

test('ignora ficheros nuevos que NO contienen el prompt (otra sesión concurrente)', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = h.claudeProjectSessionsDir(CWD)

  writeTranscript(dir, OLD_SID, [{ type: 'user', cwd: CWD, message: { content: 'historial' } }])
  const before = [{ cwd: CWD, snap: h.snapshotClaudeSessionMeta(CWD) }]

  writeTranscript(dir, 'aaaa1111-2222-3333-4444-555566667777', [
    { type: 'user', cwd: CWD, message: { content: 'otra conversación distinta' } }
  ])

  const hit = h.detectForkedRelayTranscript({
    cwds: [CWD],
    before,
    excludeSessionId: OLD_SID,
    promptMarker: 'Hola'
  })
  assert.strictEqual(hit, null)
})

test('nunca devuelve el propio transcript esperado aunque haya crecido', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = h.claudeProjectSessionsDir(CWD)

  writeTranscript(dir, OLD_SID, [{ type: 'user', cwd: CWD, message: { content: 'historial' } }])
  const before = [{ cwd: CWD, snap: h.snapshotClaudeSessionMeta(CWD) }]
  writeTranscript(dir, OLD_SID, [
    { type: 'user', cwd: CWD, message: { content: 'historial' } },
    { type: 'user', cwd: CWD, message: { content: 'Hola' } }
  ])

  const hit = h.detectForkedRelayTranscript({
    cwds: [CWD],
    before,
    excludeSessionId: OLD_SID,
    promptMarker: 'Hola'
  })
  assert.strictEqual(hit, null)
})

test('fichero existente que crece con el prompt: baseOffset = tamaño del snapshot', () => {
  // Caso: el claudeSessionId del spawn estaba desactualizado y la sesión real
  // ya tenía fichero; el turno nuevo se apendiza ahí.
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = h.claudeProjectSessionsDir(CWD)

  writeTranscript(dir, OLD_SID, [{ type: 'user', cwd: CWD, message: { content: 'historial' } }])
  const grownPath = writeTranscript(dir, FORK_SID, [
    { type: 'user', cwd: CWD, message: { content: 'base previa' } }
  ])
  const sizeBefore = fs.statSync(grownPath).size
  const before = [{ cwd: CWD, snap: h.snapshotClaudeSessionMeta(CWD) }]

  fs.appendFileSync(grownPath, JSON.stringify({ type: 'user', cwd: CWD, message: { content: 'Hola' } }) + '\n')

  const hit = h.detectForkedRelayTranscript({
    cwds: [CWD],
    before,
    excludeSessionId: OLD_SID,
    promptMarker: 'Hola'
  })
  assert.ok(hit)
  assert.strictEqual(hit.sessionId, FORK_SID)
  assert.strictEqual(hit.baseOffset, sizeBefore)
})

test('sin promptMarker no adopta nada (mejor quieto que secuestrar otra sesión)', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = h.claudeProjectSessionsDir(CWD)

  writeTranscript(dir, OLD_SID, [{ type: 'user', cwd: CWD, message: { content: 'historial' } }])
  const before = [{ cwd: CWD, snap: h.snapshotClaudeSessionMeta(CWD) }]
  writeTranscript(dir, FORK_SID, [{ type: 'user', cwd: CWD, message: { content: 'Hola' } }])

  const hit = h.detectForkedRelayTranscript({
    cwds: [CWD],
    before,
    excludeSessionId: OLD_SID,
    promptMarker: ''
  })
  assert.strictEqual(hit, null)
})

test('prompt con comillas y acentos se encuentra pese al escape JSON del transcript', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dir = h.claudeProjectSessionsDir(CWD)
  const prompt = '¿Qué "proyecto" eres?'

  writeTranscript(dir, OLD_SID, [{ type: 'user', cwd: CWD, message: { content: 'historial' } }])
  const before = [{ cwd: CWD, snap: h.snapshotClaudeSessionMeta(CWD) }]
  writeTranscript(dir, FORK_SID, [{ type: 'user', cwd: CWD, message: { content: prompt } }])

  const hit = h.detectForkedRelayTranscript({
    cwds: [CWD],
    before,
    excludeSessionId: OLD_SID,
    promptMarker: prompt
  })
  assert.ok(hit)
  assert.strictEqual(hit.sessionId, FORK_SID)
})
