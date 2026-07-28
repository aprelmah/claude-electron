// tests/session-git-finalize.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, execFile } = require('node:child_process')
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

test('clean: sin cambios → borra rama y worktree', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'clean')
  assert.ok(!fs.existsSync(ws.worktreePath))
  assert.equal(execFileSync('git', ['branch', '--list', ws.branch], { cwd: repo }).toString().trim(), '')
})

test('merged: cambios en worktree llegan al dir real', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'nuevo.txt'), 'x\n')
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'merged')
  assert.ok(fs.existsSync(path.join(repo, 'nuevo.txt')))
  assert.ok(!fs.existsSync(ws.worktreePath))
})

test('merged-pushed: con upstream hace push', async () => {
  const repo = initRepo()
  const bare = mkTmp('sg-bare-')
  execFileSync('git', ['init', '-q', '--bare'], { cwd: bare })
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo })
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo })
  const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'p.txt'), 'x\n')
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'merged-pushed')
  const remoteLog = execFileSync('git', ['log', '--oneline', 'main'], { cwd: bare }).toString()
  assert.ok(remoteLog.includes('poweragent'))
})

test('conflict: rama sobrevive, worktree no, dir real sin merge a medias', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'a.txt'), 'version-sesion\n')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'version-real\n')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'real', '-q'], { cwd: repo })
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'conflict')
  assert.ok(execFileSync('git', ['branch', '--list', ws.branch], { cwd: repo }).toString().includes(ws.branch))
  assert.ok(!fs.existsSync(ws.worktreePath))
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString().trim(), '')
})

test('un pre-commit hook que falla no bloquea el commit de sesión (--no-verify)', async () => {
  const repo = initRepo(); const sg = makeSg()
  const hooksDir = path.join(repo, '.git', 'hooks')
  fs.mkdirSync(hooksDir, { recursive: true })
  const hookPath = path.join(hooksDir, 'pre-commit')
  fs.writeFileSync(hookPath, '#!/bin/sh\nexit 1\n')
  fs.chmodSync(hookPath, 0o755)
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'hooked.txt'), 'x\n')
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'merged')
  assert.ok(fs.existsSync(path.join(repo, 'hooked.txt')))
  assert.ok(!fs.existsSync(ws.worktreePath))
})

test('si el commit falla con cambios reales, el worktree se conserva en disco', async () => {
  const repo = initRepo()
  const sg = makeSg({
    execFileImpl: (cmd, args, opts, cb) => {
      if (Array.isArray(args) && args.includes('commit')) {
        const err = new Error('commit roto (simulado)')
        return process.nextTick(() => cb(err, '', 'commit roto (simulado)'))
      }
      return execFile(cmd, args, opts, cb)
    }
  })
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'unico.txt'), 'trabajo sin commitear\n')
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'error')
  assert.ok(fs.existsSync(ws.worktreePath), 'el worktree con el trabajo debe sobrevivir')
  assert.ok(fs.existsSync(path.join(ws.workCwd, 'unico.txt')), 'los cambios sin commitear siguen ahí')
  assert.ok(String(r.detail).includes(ws.worktreePath), 'el detalle menciona el worktree conservado')
})

test('dos finalize simultáneos sobre el mismo repo se serializan (ambos merged)', async () => {
  const repo = initRepo(); const sg = makeSg()
  const w1 = await sg.prepareSessionWorkspace({ realCwd: repo })
  const w2 = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(w1.workCwd, 'f1.txt'), 'uno\n')
  fs.writeFileSync(path.join(w2.workCwd, 'f2.txt'), 'dos\n')
  const [r1, r2] = await Promise.all([
    sg.finalizeSessionWorkspace(w1),
    sg.finalizeSessionWorkspace(w2)
  ])
  assert.equal(r1.outcome, 'merged')
  assert.equal(r2.outcome, 'merged')
  assert.ok(fs.existsSync(path.join(repo, 'f1.txt')))
  assert.ok(fs.existsSync(path.join(repo, 'f2.txt')))
})

test('dirty-target: dir real sucio → no merge, rama queda', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'n.txt'), 'x\n')
  fs.writeFileSync(path.join(repo, 'sucio.txt'), 'sin commitear\n')
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'dirty-target')
  assert.ok(!fs.existsSync(path.join(repo, 'n.txt')))
  assert.ok(execFileSync('git', ['branch', '--list', ws.branch], { cwd: repo }).toString().includes(ws.branch))
})
