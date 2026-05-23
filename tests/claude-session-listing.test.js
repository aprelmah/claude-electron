'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  createSessionListing,
  streamFirstUserPreview,
  streamCountLines
} = require('../main/claude-session-listing')
const { createClaudeSessionsIndex } = require('../main/claude-sessions-index')
const { extractTurnText } = require('../main/session-helpers')

function tmpProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-proj-'))
}

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-idx-list-'))
}

function userTurn(text) {
  return JSON.stringify({ type: 'user', message: { content: text } })
}

function assistantTurn(text) {
  return JSON.stringify({ type: 'assistant', message: { content: text } })
}

function writeSession(projectDir, id, lines) {
  fs.writeFileSync(path.join(projectDir, `${id}.jsonl`), lines.join('\n'))
}

test('streamFirstUserPreview encuentra el primer user no-caveat', () => {
  const dir = tmpProjectDir()
  const file = path.join(dir, 's.jsonl')
  fs.writeFileSync(file, [
    userTurn('Caveat: ignorar'),
    assistantTurn('hola'),
    userTurn('hola mundo'),
    userTurn('otro mas')
  ].join('\n'))
  const preview = streamFirstUserPreview(file, extractTurnText)
  assert.equal(preview, 'hola mundo')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('streamFirstUserPreview vacío si no hay turno user válido', () => {
  const dir = tmpProjectDir()
  const file = path.join(dir, 's.jsonl')
  fs.writeFileSync(file, [
    userTurn('Caveat: x'),
    assistantTurn('y')
  ].join('\n'))
  const preview = streamFirstUserPreview(file, extractTurnText)
  assert.equal(preview, '')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('streamFirstUserPreview funciona con chunk pequeño y línea larga partida', () => {
  const dir = tmpProjectDir()
  const file = path.join(dir, 's.jsonl')
  const big = 'X'.repeat(5000)
  fs.writeFileSync(file, [userTurn(big)].join('\n'))
  const preview = streamFirstUserPreview(file, extractTurnText, 512)
  assert.ok(preview.startsWith('X'))
  assert.ok(preview.length <= 160)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('streamCountLines cuenta líneas no vacías y la última sin \\n', () => {
  const dir = tmpProjectDir()
  const file = path.join(dir, 's.jsonl')
  fs.writeFileSync(file, 'a\nb\nc')
  assert.equal(streamCountLines(file), 3)
  fs.writeFileSync(file, 'a\nb\n')
  assert.equal(streamCountLines(file), 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd usa cache cuando mtime+size coinciden', () => {
  const projDir = tmpProjectDir()
  const dataDir = tmpUserData()
  const cwd = '/fake/cwd'
  const listing = createSessionListing({
    resolveClaudeProjectDir: () => projDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: createClaudeSessionsIndex({ userDataDir: dataDir })
  })
  writeSession(projDir, 's1', [userTurn('preview real')])
  const first = listing.listClaudeSessionsForCwd(cwd)
  assert.equal(first.length, 1)
  assert.equal(first[0].preview, 'preview real')

  // Mutar el archivo para detectar lectura — si vuelve a leer fallaría, pero como mtime+size son los mismos,
  // el cache debe devolver "preview real" sin mirar el contenido.
  const before = fs.statSync(path.join(projDir, 's1.jsonl'))
  fs.writeFileSync(path.join(projDir, 's1.jsonl'), userTurn('CONTENIDO DIFERENTE PERO MISMO TAMAÑO'.padEnd(before.size, ' ')).slice(0, before.size))
  fs.utimesSync(path.join(projDir, 's1.jsonl'), before.atime, before.mtime)

  const second = listing.listClaudeSessionsForCwd(cwd)
  assert.equal(second[0].preview, 'preview real', 'usar cache, no releer')

  fs.rmSync(projDir, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd invalida cache cuando size cambia', () => {
  const projDir = tmpProjectDir()
  const dataDir = tmpUserData()
  const cwd = '/fake/cwd2'
  const listing = createSessionListing({
    resolveClaudeProjectDir: () => projDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: createClaudeSessionsIndex({ userDataDir: dataDir })
  })
  writeSession(projDir, 's1', [userTurn('primera version')])
  const first = listing.listClaudeSessionsForCwd(cwd)
  assert.equal(first[0].preview, 'primera version')

  writeSession(projDir, 's1', [userTurn('segunda version mas larga')])
  const second = listing.listClaudeSessionsForCwd(cwd)
  assert.equal(second[0].preview, 'segunda version mas larga')

  fs.rmSync(projDir, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd persiste entry en el índice', () => {
  const projDir = tmpProjectDir()
  const dataDir = tmpUserData()
  const cwd = '/fake/persist'
  const idx = createClaudeSessionsIndex({ userDataDir: dataDir })
  const listing = createSessionListing({
    resolveClaudeProjectDir: () => projDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: idx
  })
  writeSession(projDir, 'sX', [userTurn('hola'), assistantTurn('hi')])
  listing.listClaudeSessionsForCwd(cwd)
  const entry = idx.get(cwd, 'sX')
  assert.ok(entry, 'entry debe existir')
  assert.equal(entry.preview, 'hola')
  assert.equal(entry.msgCount, 2)

  fs.rmSync(projDir, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd ordena por mtime descendente', () => {
  const projDir = tmpProjectDir()
  const dataDir = tmpUserData()
  const cwd = '/fake/order'
  const listing = createSessionListing({
    resolveClaudeProjectDir: () => projDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: createClaudeSessionsIndex({ userDataDir: dataDir })
  })
  writeSession(projDir, 'antigua', [userTurn('a')])
  const old = path.join(projDir, 'antigua.jsonl')
  fs.utimesSync(old, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
  writeSession(projDir, 'nueva', [userTurn('b')])

  const rows = listing.listClaudeSessionsForCwd(cwd)
  assert.equal(rows[0].id, 'nueva')
  assert.equal(rows[1].id, 'antigua')

  fs.rmSync(projDir, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd funciona sin índice (claudeIndex null)', () => {
  const projDir = tmpProjectDir()
  const listing = createSessionListing({
    resolveClaudeProjectDir: () => projDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: null
  })
  writeSession(projDir, 's1', [userTurn('sin cache')])
  const rows = listing.listClaudeSessionsForCwd('/whatever')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].preview, 'sin cache')
  fs.rmSync(projDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd con claudeIndex como función (lazy getter)', () => {
  const projDir = tmpProjectDir()
  const dataDir = tmpUserData()
  let idx = null
  const listing = createSessionListing({
    resolveClaudeProjectDir: () => projDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: () => idx
  })
  writeSession(projDir, 's1', [userTurn('preview')])
  // Sin índice todavía
  let rows = listing.listClaudeSessionsForCwd('/cwd')
  assert.equal(rows[0].preview, 'preview')

  // Inyectamos índice y volvemos a listar — debe persistir
  idx = createClaudeSessionsIndex({ userDataDir: dataDir })
  listing.listClaudeSessionsForCwd('/cwd')
  assert.ok(idx.get('/cwd', 's1'))
  fs.rmSync(projDir, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('listClaudeSessionsForCwd limpia entries huérfanas del cache', () => {
  const projDir = tmpProjectDir()
  const dataDir = tmpUserData()
  const cwd = '/fake/orphan'
  const idx = createClaudeSessionsIndex({ userDataDir: dataDir })
  const listing = createSessionListing({
    resolveClaudeProjectDir: () => projDir,
    resolveExistingDir: (p) => p,
    extractTurnText,
    claudeIndex: idx
  })
  writeSession(projDir, 's1', [userTurn('a')])
  writeSession(projDir, 's2', [userTurn('b')])
  listing.listClaudeSessionsForCwd(cwd)
  assert.ok(idx.get(cwd, 's1'))
  assert.ok(idx.get(cwd, 's2'))

  fs.unlinkSync(path.join(projDir, 's1.jsonl'))
  listing.listClaudeSessionsForCwd(cwd)
  assert.equal(idx.get(cwd, 's1'), null)
  assert.ok(idx.get(cwd, 's2'))

  fs.rmSync(projDir, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
})
