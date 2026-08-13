// tests/session-git-prepare.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createSessionGit } = require('../main/session-git')

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }
function initRepo() {
  const dir = mkTmp('sg-repo-')
  const g = (args) => execFileSync('git', args, { cwd: dir })
  g(['init', '-q', '-b', 'main'])
  g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'base', '-q'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hola\n')
  g(['add', '-A'])
  g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'a', '-q'])
  return dir
}
function makeSg(overrides = {}) {
  return createSessionGit({
    worktreesRoot: mkTmp('sg-wt-'),
    looksRemotePath: () => false,
    isEnabled: () => true,
    ...overrides
  })
}

test('isGitRepo true en repo, false en dir normal', async () => {
  const sg = makeSg()
  assert.equal(await sg.isGitRepo(initRepo()), true)
  assert.equal(await sg.isGitRepo(mkTmp('sg-plain-')), false)
})

test('prepare crea worktree + rama poweragent/session-*', async () => {
  const repo = initRepo()
  const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.ok(ws)
  assert.match(ws.branch, /^poweragent\/session-/)
  assert.equal(ws.workCwd, ws.worktreePath)
  assert.ok(fs.existsSync(path.join(ws.workCwd, 'a.txt')))
  const branches = execFileSync('git', ['branch', '--list', ws.branch], { cwd: repo }).toString()
  assert.ok(branches.includes(ws.branch))
})

test('prepare devuelve null: no repo, remoto, disabled, repo sin HEAD', async () => {
  assert.equal(await makeSg().prepareSessionWorkspace({ realCwd: mkTmp('sg-plain-') }), null)
  assert.equal(await makeSg({ looksRemotePath: () => true }).prepareSessionWorkspace({ realCwd: initRepo() }), null)
  assert.equal(await makeSg({ isEnabled: () => false }).prepareSessionWorkspace({ realCwd: initRepo() }), null)
  const empty = mkTmp('sg-empty-')
  execFileSync('git', ['init', '-q'], { cwd: empty })
  assert.equal(await makeSg().prepareSessionWorkspace({ realCwd: empty }), null)
})

test('prepare desde un subdirectorio mantiene el cwd equivalente dentro del worktree', async () => {
  const repo = initRepo()
  const sub = path.join(repo, 'apps', 'web')
  fs.mkdirSync(sub, { recursive: true })
  fs.writeFileSync(path.join(sub, 'index.js'), 'x\n')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'sub', '-q'], { cwd: repo })
  const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: sub })
  assert.ok(ws)
  assert.ok(ws.workCwd.endsWith(path.join('apps', 'web')), `workCwd debe acabar en apps/web: ${ws.workCwd}`)
  assert.ok(fs.existsSync(ws.workCwd), 'el subdirectorio existe dentro del worktree')
  assert.notEqual(ws.workCwd, ws.worktreePath)
  assert.ok(ws.workCwd.startsWith(ws.worktreePath), 'workCwd cuelga de worktreePath')
})

// ── Invariante del conocimiento (bug 2026-08-11) ──
// El worktree nace de HEAD: si el conocimiento retirado no está commiteado, la
// sesión lo revive y el experto responde con fichas que el usuario ya borró.
function initRepoConKb() {
  const dir = initRepo()
  const g = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir })
  fs.mkdirSync(path.join(dir, 'kb', 'fichas'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '## Conocimiento precargado\n\n@kb/fichas/a.md\n')
  fs.writeFileSync(path.join(dir, 'kb', 'fichas', 'a.md'), '# Ficha A\n')
  g(['add', '-A'])
  g(['commit', '-m', 'kb', '-q'])
  return dir
}

test('prepare no deja que un borrado de ficha sin commitear reviva en el worktree', async () => {
  const repo = initRepoConKb()
  fs.unlinkSync(path.join(repo, 'kb', 'fichas', 'a.md'))
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '## Conocimiento precargado\n\n')

  const ws = await makeSg().prepareSessionWorkspace({ realCwd: repo })

  assert.ok(ws, 'la sesión sigue aislándose')
  assert.ok(!fs.existsSync(path.join(ws.workCwd, 'kb', 'fichas', 'a.md')), 'la ficha borrada no puede aparecer en el worktree')
  assert.ok(!fs.readFileSync(path.join(ws.workCwd, 'CLAUDE.md'), 'utf-8').includes('@kb/fichas/a.md'), 'el import retirado tampoco')
})

test('prepare tampoco pierde una ficha nueva sin commitear', async () => {
  const repo = initRepoConKb()
  fs.writeFileSync(path.join(repo, 'kb', 'fichas', 'nueva.md'), '# Nueva\n')

  const ws = await makeSg().prepareSessionWorkspace({ realCwd: repo })

  assert.ok(fs.existsSync(path.join(ws.workCwd, 'kb', 'fichas', 'nueva.md')))
})

test('prepare sincroniza el conocimiento sin tocar el código a medias del usuario', async () => {
  const repo = initRepoConKb()
  fs.unlinkSync(path.join(repo, 'kb', 'fichas', 'a.md'))
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a medias\n')
  fs.writeFileSync(path.join(repo, 'sin-trackear.js'), 'x\n')

  await makeSg().prepareSessionWorkspace({ realCwd: repo })

  const status = execFileSync('git', ['status', '--short'], { cwd: repo }).toString()
  assert.match(status, /M\s+a\.txt/, 'el código modificado sigue sin commitear')
  assert.match(status, /\?\?\s+sin-trackear\.js/)
  assert.ok(!/kb\/fichas/.test(status), 'el conocimiento sí quedó commiteado')
})

test('si el conocimiento pendiente no se puede commitear, prepare arranca SIN aislar y avisa', async () => {
  const repo = initRepoConKb()
  fs.unlinkSync(path.join(repo, 'kb', 'fichas', 'a.md'))
  const avisos = []
  const sg = makeSg({
    ensureKbCommitted: async () => ({ ok: false, error: 'git dice que no' }),
    onDegraded: (info) => avisos.push(info)
  })

  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })

  assert.equal(ws, null, 'mejor sin aislamiento que con conocimiento zombi')
  assert.equal(avisos.length, 1)
  assert.equal(avisos[0].realCwd, repo)
  assert.match(avisos[0].detail || '', /git dice que no/)
})

test('un repo sin conocimiento pendiente no genera commits de más', async () => {
  const repo = initRepoConKb()
  const antes = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim()

  await makeSg().prepareSessionWorkspace({ realCwd: repo })

  const despues = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim()
  assert.equal(antes, despues)
})

test('dos prepare sobre el mismo repo dan worktrees y ramas distintos', async () => {
  const repo = initRepo()
  const sg = makeSg()
  const w1 = await sg.prepareSessionWorkspace({ realCwd: repo })
  const w2 = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.notEqual(w1.branch, w2.branch)
  assert.notEqual(w1.worktreePath, w2.worktreePath)
})
