'use strict'
// El invariante del conocimiento: ninguna sesión puede arrancar con fichas o
// casos que el usuario ya retiró. Como el worktree de sesión nace de HEAD, todo
// borrado que no esté commiteado revive en la siguiente sesión (bug 2026-08-11:
// 10 fichas borradas en disco a las 16:55 seguían sirviéndose desde HEAD).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { ensureKbCommitted, hasPendingKbChanges } = require('../main/kb-git')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir }).toString('utf-8')
}

// Repo con conocimiento ya commiteado: CLAUDE.md con un import y una ficha.
function initRepoConKb() {
  const dir = tmpDir('kb-ensure-')
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  fs.mkdirSync(path.join(dir, 'kb', 'fichas'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '## Conocimiento precargado\n\n@kb/fichas/a.md\n')
  fs.writeFileSync(path.join(dir, 'kb', 'fichas', 'a.md'), '# Ficha A\n')
  fs.writeFileSync(path.join(dir, 'codigo.js'), 'const x = 1\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'base'])
  return dir
}

function ficherosEnHead(dir) {
  return git(dir, ['ls-tree', '-r', 'HEAD', '--name-only']).trim().split('\n').filter(Boolean)
}

test('hasPendingKbChanges detecta borrado en disco de una ficha commiteada', async () => {
  const dir = initRepoConKb()
  assert.equal(await hasPendingKbChanges(dir), false)

  fs.unlinkSync(path.join(dir, 'kb', 'fichas', 'a.md'))

  assert.equal(await hasPendingKbChanges(dir), true)
})

test('hasPendingKbChanges ignora los cambios ajenos al conocimiento', async () => {
  const dir = initRepoConKb()
  fs.writeFileSync(path.join(dir, 'codigo.js'), 'const x = 2\n')
  fs.writeFileSync(path.join(dir, 'otro.txt'), 'nuevo\n')

  assert.equal(await hasPendingKbChanges(dir), false)
})

test('hasPendingKbChanges ve una ficha nueva sin trackear', async () => {
  const dir = initRepoConKb()
  fs.writeFileSync(path.join(dir, 'kb', 'fichas', 'nueva.md'), '# Nueva\n')

  assert.equal(await hasPendingKbChanges(dir), true)
})

test('ensureKbCommitted deja HEAD sin la ficha borrada — el worktree ya no puede resucitarla', async () => {
  const dir = initRepoConKb()
  fs.unlinkSync(path.join(dir, 'kb', 'fichas', 'a.md'))
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '## Conocimiento precargado\n\n')

  const r = await ensureKbCommitted(dir, 'kb: sincroniza antes de aislar')

  assert.equal(r.ok, true)
  assert.equal(r.committed, true)
  const head = ficherosEnHead(dir)
  assert.ok(!head.includes('kb/fichas/a.md'), 'la ficha borrada no puede seguir en HEAD')
  assert.ok(head.includes('codigo.js'), 'el resto del repo sigue intacto')
})

test('ensureKbCommitted no arrastra el código a medias del usuario', async () => {
  const dir = initRepoConKb()
  fs.unlinkSync(path.join(dir, 'kb', 'fichas', 'a.md'))
  fs.writeFileSync(path.join(dir, 'codigo.js'), 'const x = 2 // a medias\n')
  fs.writeFileSync(path.join(dir, 'sin-trackear.js'), 'nuevo\n')

  const r = await ensureKbCommitted(dir, 'kb: sincroniza')

  assert.equal(r.committed, true)
  const status = git(dir, ['status', '--short'])
  assert.match(status, /M\s+codigo\.js/, 'el código modificado sigue sin commitear')
  assert.match(status, /\?\?\s+sin-trackear\.js/, 'lo no trackeado sigue fuera')
})

test('ensureKbCommitted no hace nada si no hay conocimiento pendiente', async () => {
  const dir = initRepoConKb()

  const r = await ensureKbCommitted(dir, 'kb: sincroniza')

  assert.equal(r.ok, true)
  assert.equal(r.committed, false)
  assert.equal(git(dir, ['log', '--format=%s']).trim(), 'base')
})

test('ensureKbCommitted esquiva un pre-commit hook que rechaza (el conocimiento no es código)', async () => {
  const dir = initRepoConKb()
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit')
  fs.writeFileSync(hook, '#!/bin/sh\necho "no paso"\nexit 1\n')
  fs.chmodSync(hook, 0o755)
  fs.unlinkSync(path.join(dir, 'kb', 'fichas', 'a.md'))

  const r = await ensureKbCommitted(dir, 'kb: sincroniza')

  assert.equal(r.ok, true)
  assert.equal(r.committed, true)
})

test('ensureKbCommitted informa del fallo en vez de callar cuando git no puede commitear', async () => {
  const dir = initRepoConKb()
  fs.unlinkSync(path.join(dir, 'kb', 'fichas', 'a.md'))
  // index.lock presente = cualquier escritura del índice falla.
  fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '')

  const r = await ensureKbCommitted(dir, 'kb: sincroniza')

  assert.equal(r.ok, false, 'un borrado que no llega a HEAD no puede reportarse como éxito')
  assert.ok(r.error, 'debe traer el detalle del fallo')
  assert.ok(ficherosEnHead(dir).includes('kb/fichas/a.md'), 'HEAD sigue con la ficha: por eso ok=false')
})

test('ensureKbCommitted no estorba fuera de un repo git', async () => {
  const dir = tmpDir('kb-ensure-norepo-')
  fs.mkdirSync(path.join(dir, 'kb'), { recursive: true })

  const r = await ensureKbCommitted(dir, 'kb: sincroniza')

  assert.equal(r.ok, true)
  assert.equal(r.committed, false)
})
