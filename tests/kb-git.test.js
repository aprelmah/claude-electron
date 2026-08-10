'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { commitKbChanges } = require('../main/kb-git')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function initRepo(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
}

function gitLogMessages(dir) {
  try {
    return execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString('utf-8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function gitShowFiles(dir, ref = 'HEAD') {
  return execFileSync('git', ['show', '--name-only', '--format=', ref], { cwd: dir }).toString('utf-8').trim().split('\n').filter(Boolean)
}

test('commitKbChanges comitea CLAUDE.md y kb/ cuando hay cambios', async () => {
  const project = tmpDir('kb-git-project-')
  initRepo(project)
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# X\n')
  fs.mkdirSync(path.join(project, 'kb', 'fichas'), { recursive: true })
  fs.writeFileSync(path.join(project, 'kb', 'fichas', 'a.md'), '# A\n')

  const result = await commitKbChanges(project, 'kb: prueba')

  assert.equal(result.ok, true)
  assert.equal(result.committed, true)
  const messages = gitLogMessages(project)
  assert.equal(messages.length, 1)
  assert.equal(messages[0], 'kb: prueba')
})

test('commitKbChanges no incluye archivos fuera de CLAUDE.md/kb/ aunque estén modificados', async () => {
  const project = tmpDir('kb-git-project-')
  initRepo(project)
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# X\n')
  fs.mkdirSync(path.join(project, 'kb', 'fichas'), { recursive: true })
  fs.writeFileSync(path.join(project, 'kb', 'fichas', 'a.md'), '# A\n')
  fs.writeFileSync(path.join(project, 'secreto.js'), 'const x = 1\n')

  const result = await commitKbChanges(project, 'kb: prueba')

  assert.equal(result.ok, true)
  assert.equal(result.committed, true)
  const files = gitShowFiles(project)
  assert.ok(files.includes('CLAUDE.md'))
  assert.ok(files.includes('kb/fichas/a.md'))
  assert.ok(!files.includes('secreto.js'))
  // secreto.js sigue sin trackear, el commit no lo tocó
  const status = execFileSync('git', ['status', '--short'], { cwd: project }).toString('utf-8')
  assert.match(status, /\?\? secreto\.js/)
})

test('commitKbChanges no falla y no comitea si no hay cambios en CLAUDE.md/kb/', async () => {
  const project = tmpDir('kb-git-project-')
  initRepo(project)
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# X\n')
  execFileSync('git', ['add', 'CLAUDE.md'], { cwd: project })
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: project })

  const result = await commitKbChanges(project, 'kb: nada que hacer')

  assert.equal(result.ok, true)
  assert.equal(result.committed, false)
  assert.equal(gitLogMessages(project).length, 1)
})

test('commitKbChanges no falla si el projectDir no es un repo git', async () => {
  const project = tmpDir('kb-git-noproject-')
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# X\n')

  const result = await commitKbChanges(project, 'kb: prueba')

  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
})

test('commitKbChanges nunca hace push (sin remoto configurado no revienta)', async () => {
  const project = tmpDir('kb-git-project-')
  initRepo(project)
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# X\n')

  const result = await commitKbChanges(project, 'kb: prueba')

  assert.equal(result.ok, true)
  assert.equal(result.committed, true)
})
