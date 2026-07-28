// tests/session-git-discover.test.js
// Descubrimiento de worktrees huérfanos NO registrados en session-git-map.
// El registro solo se escribe cuando la sesión llega a producir un
// claudeSessionId, así que un crash/pkill deja worktrees que el sweep basado
// en el registro no puede ver. Al arrancar no hay ningún PTY vivo: todo
// worktree presente en worktreesRoot es huérfano por definición.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createSessionGit } = require('../main/session-git')

function mkTmp(prefix) { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))) }
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
function makeSg(worktreesRoot, overrides = {}) {
  return createSessionGit({
    worktreesRoot,
    looksRemotePath: () => false,
    isEnabled: () => true,
    ...overrides
  })
}

test('discover: encuentra el worktree que el registro nunca llegó a apuntar', async () => {
  const root = mkTmp('sg-wt-')
  const repo = initRepo()
  const sg = makeSg(root)
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.ok(ws, 'prepare debe crear el worktree')

  // Registro vacío: la sesión murió antes de generar claudeSessionId.
  const found = await sg.discoverUnregisteredWorkspaces({ knownWorktreePaths: [] })

  assert.equal(found.length, 1)
  assert.equal(fs.realpathSync(found[0].worktreePath), fs.realpathSync(ws.worktreePath))
  assert.equal(found[0].branch, ws.branch)
  assert.equal(fs.realpathSync(found[0].realCwd), repo, 'realCwd apunta a la raíz del repo principal')
})

test('discover: ignora los worktrees ya registrados', async () => {
  const root = mkTmp('sg-wt-')
  const repo = initRepo()
  const sg = makeSg(root)
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })

  const found = await sg.discoverUnregisteredWorkspaces({ knownWorktreePaths: [ws.worktreePath] })
  assert.deepEqual(found, [])
})

test('discover: basura en worktreesRoot no lanza ni se devuelve', async () => {
  const root = mkTmp('sg-wt-')
  fs.mkdirSync(path.join(root, 'no-soy-un-worktree'))
  fs.writeFileSync(path.join(root, 'suelto.txt'), 'x')
  const sg = makeSg(root)

  const found = await sg.discoverUnregisteredWorkspaces({ knownWorktreePaths: [] })
  assert.deepEqual(found, [])
})

test('discover: worktreesRoot inexistente devuelve lista vacía', async () => {
  const sg = makeSg(path.join(mkTmp('sg-wt-'), 'no', 'existe'))
  const found = await sg.discoverUnregisteredWorkspaces({ knownWorktreePaths: [] })
  assert.deepEqual(found, [])
})

test('discover + recover: el trabajo del worktree no registrado acaba en el repo', async () => {
  const root = mkTmp('sg-wt-')
  const repo = initRepo()
  const sg = makeSg(root)
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'rescatado.txt'), 'trabajo sin registrar\n')

  const found = await sg.discoverUnregisteredWorkspaces({ knownWorktreePaths: [] })
  const results = await sg.recoverOrphanedWorkspaces({ entries: found })

  assert.equal(results.length, 1)
  assert.equal(results[0].outcome, 'merged')
  assert.ok(fs.existsSync(path.join(repo, 'rescatado.txt')), 'el trabajo llega al repo real')
  assert.ok(!fs.existsSync(ws.worktreePath), 'el worktree huérfano se limpia')
})

test('discover: worktree de repo borrado se ignora sin lanzar', async () => {
  const root = mkTmp('sg-wt-')
  const repo = initRepo()
  const sg = makeSg(root)
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  // El repo desaparece (proyecto borrado) → el worktree queda descolgado.
  fs.rmSync(repo, { recursive: true, force: true })

  const found = await sg.discoverUnregisteredWorkspaces({ knownWorktreePaths: [] })
  assert.deepEqual(found, [])
  assert.ok(fs.existsSync(ws.worktreePath), 'no se toca lo que no se puede resolver')
})
