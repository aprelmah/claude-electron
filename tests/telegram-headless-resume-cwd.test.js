'use strict'

// Bug real 2026-08-02: mensaje directo al bot de Telegram sin sesión abierta en
// el Mac → la ruta headless hacía `claude --resume <sid>` con cwd = homedir
// (lastPrimarySnapshot recién arrancado) → "No conversation found with session
// ID". El resume solo funciona si el cwd del spawn mapea al proyecto donde vive
// el transcript. resolveResumeCwd localiza el <sessionId>.jsonl en
// ~/.claude/projects y devuelve el cwd real leído de sus líneas.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createRelayTranscriptHelpers } = require('../main/relay-transcript-helpers')

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resume-cwd-'))
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

const SID = '2ca73860-074a-4d10-9aa5-cff1d52d11c9'

test('devuelve el cwd leído del transcript cuando el directorio existe', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const realCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'proyecto-real-'))
  writeTranscript(h.claudeProjectSessionsDir(realCwd), SID, [
    { type: 'user', cwd: realCwd, message: { content: 'hola' } }
  ])
  assert.strictEqual(h.resolveResumeCwd(SID), realCwd)
})

test('con copia en worktree borrado y copia en proyecto real, gana la del cwd vivo', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const realCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'proyecto-real-'))
  const deadWorktree = path.join(os.tmpdir(), `worktree-borrado-${Date.now()}`)

  writeTranscript(h.claudeProjectSessionsDir(realCwd), SID, [
    { type: 'user', cwd: realCwd, message: { content: 'hola' } }
  ])
  // La copia del worktree es más reciente, pero su cwd ya no existe.
  const wtPath = writeTranscript(h.claudeProjectSessionsDir(deadWorktree), SID, [
    { type: 'user', cwd: deadWorktree, message: { content: 'hola' } }
  ])
  const future = new Date(Date.now() + 60_000)
  fs.utimesSync(wtPath, future, future)

  assert.strictEqual(h.resolveResumeCwd(SID), realCwd)
})

test('ignora líneas sin cwd (summary) y usa la primera que lo lleva', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const realCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'proyecto-real-'))
  writeTranscript(h.claudeProjectSessionsDir(realCwd), SID, [
    { type: 'summary', summary: 'algo' },
    { type: 'user', cwd: realCwd, message: { content: 'hola' } }
  ])
  assert.strictEqual(h.resolveResumeCwd(SID), realCwd)
})

test('caso real: transcript en el proyecto real cuyas primeras líneas llevan el cwd de un worktree borrado', () => {
  // La sesión nació en un worktree (aislamiento git), el worktree se borró al
  // cerrar, y el transcript del proyecto real mezcla cwds: worktree muerto,
  // scratchpad y el dir real. Solo vale el cwd que codifica al directorio
  // contenedor Y existe.
  const root = tmpRoot()
  const h = makeHelpers(root)
  const realCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'proyecto-real-'))
  const deadWorktree = path.join(os.tmpdir(), `worktree-borrado-${Date.now()}`)
  const scratchpad = fs.mkdtempSync(path.join(os.tmpdir(), 'scratchpad-'))

  writeTranscript(h.claudeProjectSessionsDir(realCwd), SID, [
    { type: 'user', cwd: deadWorktree, message: { content: 'nace en worktree' } },
    { type: 'user', cwd: scratchpad, message: { content: 'toca el scratchpad' } },
    { type: 'user', cwd: realCwd, message: { content: 'sigue en el real' } }
  ])
  assert.strictEqual(h.resolveResumeCwd(SID), realCwd)
})

test('sin transcript en ningún proyecto devuelve null', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  // El root necesita existir para el barrido, aunque esté vacío.
  fs.mkdirSync(path.join(root, 'proyecto-cualquiera'), { recursive: true })
  assert.strictEqual(h.resolveResumeCwd(SID), null)
})

test('transcript cuyo cwd ya no existe devuelve null', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  const dead = path.join(os.tmpdir(), `muerto-${Date.now()}`)
  writeTranscript(h.claudeProjectSessionsDir(dead), SID, [
    { type: 'user', cwd: dead, message: { content: 'hola' } }
  ])
  assert.strictEqual(h.resolveResumeCwd(SID), null)
})

test('sin sessionId devuelve null sin barrer nada', () => {
  const root = tmpRoot()
  const h = makeHelpers(root)
  assert.strictEqual(h.resolveResumeCwd(''), null)
  assert.strictEqual(h.resolveResumeCwd(null), null)
})
