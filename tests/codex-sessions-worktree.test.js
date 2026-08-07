'use strict'

// Las sesiones de codex nacidas en un worktree del aislamiento git no aparecían
// en el picker del proyecto: el rollout registra el cwd del worktree y el índice
// bucketiza por ese cwd, así que pedir el cwd real no las encontraba (limitación
// v1 documentada; reportado en vivo el 2026-08-07 — "la última sesión es de mayo
// si acabo de hablar con él"). El nombre del worktree es determinista, así que se
// puede atribuir al repo sin depender de ningún registro.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { worktreeSlugFor, worktreeCwdBelongsTo } = require('../main/session-git')
const { createCodexSessionsIndex } = require('../main/codex-sessions-index')

const PROYECTO = '/Users/isabel/Desktop/LUISMI/claude-electron'

test('worktreeSlugFor: basename + hash corto, estable', () => {
  const slug = worktreeSlugFor(PROYECTO)
  assert.match(slug, /^claude-electron-[0-9a-f]{6}$/)
  assert.equal(slug, worktreeSlugFor(PROYECTO), 'mismo cwd, mismo slug')
  assert.notEqual(slug, worktreeSlugFor('/otro/claude-electron'), 'otro path, otro hash')
})

test('worktreeCwdBelongsTo: reconoce el worktree del repo', () => {
  const root = '/ud/worktrees'
  const wt = path.join(root, `${worktreeSlugFor(PROYECTO)}-msj6v2jt-5b94ec`)
  assert.equal(worktreeCwdBelongsTo({ cwd: wt, realCwd: PROYECTO, worktreesRoot: root }), true)
})

test('worktreeCwdBelongsTo: reconoce un subdirectorio dentro del worktree', () => {
  const root = '/ud/worktrees'
  const wt = path.join(root, `${worktreeSlugFor(PROYECTO)}-abc-123`, 'main')
  assert.equal(worktreeCwdBelongsTo({ cwd: wt, realCwd: PROYECTO, worktreesRoot: root }), true)
})

test('worktreeCwdBelongsTo: no reclama el worktree de OTRO repo', () => {
  const root = '/ud/worktrees'
  const ajeno = path.join(root, `${worktreeSlugFor('/Users/isabel/Desktop/LUISMI/DMWEB')}-x-y`)
  assert.equal(worktreeCwdBelongsTo({ cwd: ajeno, realCwd: PROYECTO, worktreesRoot: root }), false)
})

test('worktreeCwdBelongsTo: el propio cwd real no es un worktree', () => {
  assert.equal(
    worktreeCwdBelongsTo({ cwd: PROYECTO, realCwd: PROYECTO, worktreesRoot: '/ud/worktrees' }),
    false
  )
})

test('worktreeCwdBelongsTo: sin datos no afirma nada', () => {
  assert.equal(worktreeCwdBelongsTo({ cwd: '', realCwd: PROYECTO, worktreesRoot: '/ud/w' }), false)
  assert.equal(worktreeCwdBelongsTo({ cwd: '/x', realCwd: '', worktreesRoot: '/ud/w' }), false)
  assert.equal(worktreeCwdBelongsTo({ cwd: '/x', realCwd: PROYECTO, worktreesRoot: '' }), false)
})

function writeRollout(sessionsRoot, { id, cwd, mtimeMs }) {
  const dir = path.join(sessionsRoot, '2026', '08', '07')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `rollout-${id}.jsonl`)
  const meta = { type: 'session_meta', payload: { id, cwd } }
  const turn = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hola' }] } }
  fs.writeFileSync(filePath, JSON.stringify(meta) + '\n' + JSON.stringify(turn) + '\n')
  if (mtimeMs) fs.utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000)
  return filePath
}

test('getForCwd incluye las sesiones nacidas en los worktrees del proyecto', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt-ud-'))
  const sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt-sr-'))
  const worktreesRoot = path.join(userDataDir, 'worktrees')
  const wtCwd = path.join(worktreesRoot, `${worktreeSlugFor(PROYECTO)}-sesion1-aaaaaa`)
  try {
    writeRollout(sessionsRoot, { id: '019fdd2a-03c2-7ef1-9697-da69861b7d2c', cwd: wtCwd, mtimeMs: Date.now() })
    writeRollout(sessionsRoot, { id: '019f0000-0000-7000-8000-000000000001', cwd: PROYECTO, mtimeMs: Date.now() - 86400_000 })
    writeRollout(sessionsRoot, { id: '019f0000-0000-7000-8000-000000000002', cwd: '/otro/proyecto', mtimeMs: Date.now() })

    const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
    await idx.bootstrap()

    const ids = idx.getForCwd(PROYECTO).map((e) => e.id)
    assert.ok(ids.includes('019fdd2a-03c2-7ef1-9697-da69861b7d2c'), 'la del worktree debe salir')
    assert.ok(ids.includes('019f0000-0000-7000-8000-000000000001'), 'la del cwd real sigue saliendo')
    assert.ok(!ids.includes('019f0000-0000-7000-8000-000000000002'), 'la de otro proyecto no')
    assert.equal(ids[0], '019fdd2a-03c2-7ef1-9697-da69861b7d2c', 'ordenadas por mtime, la de hoy primero')
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(sessionsRoot, { recursive: true, force: true })
  }
})

// El walk es la red de seguridad cuando el índice aún no ha arrancado: si filtra
// por cwd exacto, un arranque en frío vuelve a esconder las sesiones de hoy.
test('el walk de respaldo también reconoce los worktrees del proyecto', () => {
  const sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt3-sr-'))
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt3-ud-'))
  const worktreesRoot = path.join(userDataDir, 'worktrees')
  const wtCwd = path.join(worktreesRoot, `${worktreeSlugFor(PROYECTO)}-s-cccccc`)
  try {
    const mio = writeRollout(sessionsRoot, { id: '019fdd2a-03c2-7ef1-9697-da69861b7d2c', cwd: wtCwd, mtimeMs: Date.now() })
    writeRollout(sessionsRoot, { id: '019f0000-0000-7000-8000-000000000009', cwd: '/otro/proyecto', mtimeMs: Date.now() })
    const { createSessionListing } = require('../main/claude-session-listing')
    const listing = createSessionListing({
      resolveClaudeProjectDir: () => null,
      resolveExistingDir: (d) => String(d || ''),
      extractTurnText: () => '',
      codexIndex: null,
      worktreesRoot,
      listCodexSessionFilesImpl: () => [mio, path.join(sessionsRoot, '2026', '08', '07', 'rollout-019f0000-0000-7000-8000-000000000009.jsonl')]
    })
    const rows = listing.listCodexSessionsForCwd(PROYECTO)
    assert.deepEqual(rows.map((r) => r.id), ['019fdd2a-03c2-7ef1-9697-da69861b7d2c'])
  } finally {
    fs.rmSync(sessionsRoot, { recursive: true, force: true })
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('getForCwd no duplica si se pide directamente el cwd del worktree', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt2-ud-'))
  const sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt2-sr-'))
  const wtCwd = path.join(userDataDir, 'worktrees', `${worktreeSlugFor(PROYECTO)}-s-bbbbbb`)
  try {
    writeRollout(sessionsRoot, { id: '019fdd2a-03c2-7ef1-9697-da69861b7d2c', cwd: wtCwd, mtimeMs: Date.now() })
    const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
    await idx.bootstrap()
    assert.equal(idx.getForCwd(wtCwd).length, 1)
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(sessionsRoot, { recursive: true, force: true })
  }
})
