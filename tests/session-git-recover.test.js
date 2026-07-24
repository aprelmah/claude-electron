// tests/session-git-recover.test.js
// Recuperación tras crash: entradas activas del registro sin PTY vivo se
// integran (copia de transcripts + commit + merge) o se marcan 'gone'.
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

test('recover: worktree vivo se mergea al repo; worktree borrado da gone', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'huerfano.txt'), 'trabajo perdido en crash\n')
  // Simular crash: no se llama a finalize; solo queda la entrada del registro.
  const results = await sg.recoverOrphanedWorkspaces({
    entries: [
      {
        claudeSessionId: 'sess-viva',
        realCwd: repo,
        branch: ws.branch,
        worktreePath: ws.worktreePath,
        active: true
      },
      {
        claudeSessionId: 'sess-gone',
        realCwd: repo,
        branch: 'poweragent/session-borrada',
        worktreePath: path.join(mkTmp('sg-borrado-'), 'no-existe'),
        active: true
      }
    ]
  })
  assert.equal(results.length, 2)

  const viva = results.find((r) => r.claudeSessionId === 'sess-viva')
  assert.equal(viva.outcome, 'merged')
  assert.ok(fs.existsSync(path.join(repo, 'huerfano.txt')), 'los cambios del crash llegan al repo')
  assert.ok(!fs.existsSync(ws.worktreePath), 'el worktree recuperado se limpia')

  const gone = results.find((r) => r.claudeSessionId === 'sess-gone')
  assert.equal(gone.outcome, 'gone')
})

test('recover: entrada malformada no lanza y devuelve gone', async () => {
  const sg = makeSg()
  const results = await sg.recoverOrphanedWorkspaces({
    entries: [{ claudeSessionId: 'sess-rota', realCwd: '', branch: '', worktreePath: '', active: true }]
  })
  assert.equal(results.length, 1)
  assert.equal(results[0].outcome, 'gone')
})
