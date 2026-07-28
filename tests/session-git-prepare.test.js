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

test('dos prepare sobre el mismo repo dan worktrees y ramas distintos', async () => {
  const repo = initRepo()
  const sg = makeSg()
  const w1 = await sg.prepareSessionWorkspace({ realCwd: repo })
  const w2 = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.notEqual(w1.branch, w2.branch)
  assert.notEqual(w1.worktreePath, w2.worktreePath)
})
