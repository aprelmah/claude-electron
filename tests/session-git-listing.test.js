'use strict'

// Task 8: listado de sesiones fusiona las de worktrees activos + dedupe
// por sessionId (gana la copia del worktree, es la más nueva).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createSessionListing } = require('../main/claude-session-listing')
const { extractTurnText } = require('../main/session-helpers')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function userTurn(text) {
  return JSON.stringify({ type: 'user', message: { content: text } })
}

function writeSession(dir, id, text) {
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), userTurn(text))
}

// Mismo patrón fake que tests/session-git-jsonl.test.js: mapa cwd/dir -> ruta
// codificada de ~/.claude/projects/<encoded>/, sin tocar el filesystem real
// más allá de directorios temporales.
function makeResolver(map) {
  return (key) => map.get(key) || null
}

test('listClaudeSessionsForCwd fusiona sesiones de un worktree activo con las del cwd real', () => {
  const realDir = tmpDir('sgl-real-')
  const workDir = tmpDir('sgl-work-')
  writeSession(realDir, 'sid-home', 'sesion del cwd real')
  writeSession(workDir, 'sid-worktree', 'sesion solo en el worktree')

  const listing = createSessionListing({
    resolveClaudeProjectDir: makeResolver(new Map([
      ['/real/cwd', realDir],
      ['/work/tree', workDir]
    ])),
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: null,
    getActiveWorktreeSessionDirs: (cwd) => (cwd === '/real/cwd' ? [workDir] : [])
  })

  const rows = listing.listClaudeSessionsForCwd('/real/cwd')
  const ids = rows.map((r) => r.id).sort()
  assert.deepEqual(ids, ['sid-home', 'sid-worktree'])

  fs.rmSync(realDir, { recursive: true, force: true })
  fs.rmSync(workDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd dedupe por sessionId: gana la copia del worktree', () => {
  const realDir = tmpDir('sgl-real-')
  const workDir = tmpDir('sgl-work-')
  writeSession(realDir, 'sid-1', 'version vieja (cwd real)')
  writeSession(workDir, 'sid-1', 'version nueva (worktree activo)')

  const listing = createSessionListing({
    resolveClaudeProjectDir: makeResolver(new Map([
      ['/real/cwd', realDir],
      ['/work/tree', workDir]
    ])),
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: null,
    getActiveWorktreeSessionDirs: () => [workDir]
  })

  const rows = listing.listClaudeSessionsForCwd('/real/cwd')
  assert.equal(rows.length, 1, 'un solo id tras el dedupe')
  assert.equal(rows[0].id, 'sid-1')
  assert.equal(rows[0].preview, 'version nueva (worktree activo)')

  fs.rmSync(realDir, { recursive: true, force: true })
  fs.rmSync(workDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd sin getter de worktrees: comportamiento idéntico al previo', () => {
  const realDir = tmpDir('sgl-real-')
  writeSession(realDir, 'sid-solo', 'solo el cwd real')

  const listing = createSessionListing({
    resolveClaudeProjectDir: () => realDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: null
    // getActiveWorktreeSessionDirs ausente
  })

  const rows = listing.listClaudeSessionsForCwd('/real/cwd')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'sid-solo')

  fs.rmSync(realDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd: getter presente pero devuelve [] no cambia nada', () => {
  const realDir = tmpDir('sgl-real-')
  writeSession(realDir, 'sid-a', 'a')

  const listing = createSessionListing({
    resolveClaudeProjectDir: () => realDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: null,
    getActiveWorktreeSessionDirs: () => []
  })

  const rows = listing.listClaudeSessionsForCwd('/real/cwd')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'sid-a')

  fs.rmSync(realDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd: cwd real sin dir todavía, pero worktree activo con sesión -> se ve igual', () => {
  const workDir = tmpDir('sgl-work-')
  writeSession(workDir, 'sid-nuevo', 'sesion recien creada en worktree')

  const listing = createSessionListing({
    // El cwd real aún no tiene carpeta .claude/projects/<encoded> creada.
    resolveClaudeProjectDir: makeResolver(new Map([['/work/tree', workDir]])),
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: null,
    getActiveWorktreeSessionDirs: () => [workDir]
  })

  const rows = listing.listClaudeSessionsForCwd('/real/cwd-nuevo')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'sid-nuevo')

  fs.rmSync(workDir, { recursive: true, force: true })
})

test('getActiveWorktreeSessionDirs que lanza excepción -> fail-open, solo dir real', () => {
  const realDir = tmpDir('sgl-real-')
  writeSession(realDir, 'sid-x', 'x')

  const listing = createSessionListing({
    resolveClaudeProjectDir: () => realDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: null,
    getActiveWorktreeSessionDirs: () => { throw new Error('boom') }
  })

  assert.doesNotThrow(() => {
    const rows = listing.listClaudeSessionsForCwd('/real/cwd')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, 'sid-x')
  })

  fs.rmSync(realDir, { recursive: true, force: true })
})

// ── resolveTaskSessionCwd (main.js) — mapeo cwd de worktree borrado -> realCwd ──
// La función vive inline en main.js (entrypoint Electron, no requireable en
// test plano sin `app`). Se cubre aquí SOLO la pieza reutilizable y
// exportada: sessionGitMap.lookupByWorktreePath, que es la que resolveTaskSessionCwd
// usa como fallback fail-open cuando el cwd leído del JSONL ya no existe en
// disco. El cableado exacto en main.js se verificó con `node --check` y
// lectura manual (ver informe de la tarea).
const { createSessionGitMap } = require('../main/session-git-map')
const { atomicWriteJsonSync } = require('../main/atomic-writes')

test('sessionGitMap.lookupByWorktreePath resuelve el realCwd para el fallback de resolveTaskSessionCwd', () => {
  const dataDir = tmpDir('sgl-map-')
  const filePath = path.join(dataDir, 'session-git-map.json')
  const sgMap = createSessionGitMap({ filePath, atomicWriteJsonSync })

  sgMap.recordActive({
    claudeSessionId: 'sid-borrado',
    realCwd: '/real/cwd',
    branch: 'poweragent/session-sid-borrado',
    worktreePath: '/tmp/worktrees/sid-borrado'
  })

  const entry = sgMap.lookupByWorktreePath('/tmp/worktrees/sid-borrado')
  assert.ok(entry, 'debe encontrar la entry por worktreePath')
  assert.equal(entry.realCwd, '/real/cwd')

  assert.equal(sgMap.lookupByWorktreePath('/no/existe'), null)

  fs.rmSync(dataDir, { recursive: true, force: true })
})
