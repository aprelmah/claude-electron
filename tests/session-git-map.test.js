// tests/session-git-map.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createSessionGitMap } = require('../main/session-git-map')
const { createSessionGit } = require('../main/session-git')
const { atomicWriteJsonSync } = require('../main/atomic-writes')

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }

function tmpFilePath() {
  return path.join(mkTmp('sg-map-'), 'session-git-map.json')
}

function makeMap(overrides = {}) {
  return createSessionGitMap({
    filePath: tmpFilePath(),
    atomicWriteJsonSync,
    ...overrides
  })
}

function initRepo() {
  const dir = mkTmp('sgm-repo-')
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
    worktreesRoot: mkTmp('sgm-wt-'),
    looksRemotePath: () => false,
    isEnabled: () => true,
    ...overrides
  })
}

test('lookupBySessionId devuelve null cuando no hay nada registrado', () => {
  const map = makeMap()
  assert.equal(map.lookupBySessionId('inexistente'), null)
})

test('recordActive registra y lookupBySessionId recupera la entrada', () => {
  const map = makeMap()
  map.recordActive({
    claudeSessionId: 's1',
    realCwd: '/repo/a',
    branch: 'poweragent/session-x1',
    worktreePath: '/worktrees/x1'
  })
  const entry = map.lookupBySessionId('s1')
  assert.ok(entry)
  assert.equal(entry.realCwd, '/repo/a')
  assert.equal(entry.branch, 'poweragent/session-x1')
  assert.equal(entry.worktreePath, '/worktrees/x1')
  assert.equal(entry.active, true)
  assert.ok(entry.updatedAt > 0)
})

test('lookupByWorktreePath encuentra la sesión dueña de ese worktree', () => {
  const map = makeMap()
  map.recordActive({
    claudeSessionId: 's1',
    realCwd: '/repo/a',
    branch: 'poweragent/session-x1',
    worktreePath: '/worktrees/x1'
  })
  const entry = map.lookupByWorktreePath('/worktrees/x1')
  assert.ok(entry)
  assert.equal(entry.realCwd, '/repo/a')
  assert.equal(map.lookupByWorktreePath('/worktrees/no-existe'), null)
})

test('listActiveForCwd solo devuelve activas del cwd pedido', () => {
  const map = makeMap()
  map.recordActive({ claudeSessionId: 's1', realCwd: '/repo/a', branch: 'poweragent/session-x1', worktreePath: '/wt/x1' })
  map.recordActive({ claudeSessionId: 's2', realCwd: '/repo/a', branch: 'poweragent/session-x2', worktreePath: '/wt/x2' })
  map.recordActive({ claudeSessionId: 's3', realCwd: '/repo/b', branch: 'poweragent/session-x3', worktreePath: '/wt/x3' })
  map.markFinalized('s2')

  const activeA = map.listActiveForCwd('/repo/a')
  assert.equal(activeA.length, 1)
  assert.equal(activeA[0].branch, 'poweragent/session-x1')

  const activeB = map.listActiveForCwd('/repo/b')
  assert.equal(activeB.length, 1)

  assert.deepEqual(map.listActiveForCwd('/repo/no-existe'), [])
})

test('markFinalized pone active=false y conserva realCwd/branch', () => {
  const map = makeMap()
  map.recordActive({ claudeSessionId: 's1', realCwd: '/repo/a', branch: 'poweragent/session-x1', worktreePath: '/wt/x1' })
  map.markFinalized('s1')
  const entry = map.lookupBySessionId('s1')
  assert.equal(entry.active, false)
  assert.equal(entry.realCwd, '/repo/a')
  assert.equal(entry.branch, 'poweragent/session-x1')
})

test('markFinalized sobre sesión inexistente no lanza', () => {
  const map = makeMap()
  assert.doesNotThrow(() => map.markFinalized('no-existe'))
})

test('all() devuelve el objeto interno completo con todas las sesiones', () => {
  const map = makeMap()
  map.recordActive({ claudeSessionId: 's1', realCwd: '/repo/a', branch: 'poweragent/session-x1', worktreePath: '/wt/x1' })
  map.recordActive({ claudeSessionId: 's2', realCwd: '/repo/b', branch: 'poweragent/session-x2', worktreePath: '/wt/x2' })
  const everything = map.all()
  assert.equal(Object.keys(everything).length, 2)
  assert.ok(everything.s1)
  assert.ok(everything.s2)
})

test('persistencia: recrear el map desde el mismo filePath ve los datos tras flush', () => {
  const filePath = tmpFilePath()
  const map1 = createSessionGitMap({ filePath, atomicWriteJsonSync })
  map1.recordActive({ claudeSessionId: 's1', realCwd: '/repo/a', branch: 'poweragent/session-x1', worktreePath: '/wt/x1' })
  map1.flush()

  assert.ok(fs.existsSync(filePath))
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  assert.equal(raw.version, 1)
  assert.ok(raw.sessions.s1)

  const map2 = createSessionGitMap({ filePath, atomicWriteJsonSync })
  const entry = map2.lookupBySessionId('s1')
  assert.ok(entry)
  assert.equal(entry.realCwd, '/repo/a')
})

test('escrituras consecutivas se debouncean en un único write', () => {
  const filePath = tmpFilePath()
  const map = createSessionGitMap({ filePath, atomicWriteJsonSync })
  for (let i = 0; i < 20; i++) {
    map.recordActive({ claudeSessionId: `s${i}`, realCwd: '/repo/a', branch: `poweragent/session-${i}`, worktreePath: `/wt/${i}` })
  }
  map.flush()
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  assert.equal(Object.keys(raw.sessions).length, 20)
  const tmps = fs.readdirSync(path.dirname(filePath)).filter((f) => f.includes('.tmp.'))
  assert.equal(tmps.length, 0)
})

test('archivo corrupto se trata como registro vacío', () => {
  const filePath = tmpFilePath()
  fs.writeFileSync(filePath, 'no-es-json')
  const map = createSessionGitMap({ filePath, atomicWriteJsonSync })
  assert.equal(map.lookupBySessionId('s1'), null)
  map.recordActive({ claudeSessionId: 's1', realCwd: '/repo/a', branch: 'poweragent/session-x1', worktreePath: '/wt/x1' })
  assert.ok(map.lookupBySessionId('s1'))
})

test('sweepOrphans: worktree borrado a mano desaparece y rama mergeada se borra; rama sin mergear sobrevive', async () => {
  const repo = initRepo()
  const sg = makeSg()

  // ws1: no se toca nada -> su rama queda idéntica a HEAD del repo real => mergeada.
  const ws1 = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.ok(ws1)

  // ws2: se le añade un commit propio que NO se lleva al repo real => rama no mergeada.
  const ws2 = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.ok(ws2)
  fs.writeFileSync(path.join(ws2.workCwd, 'sin-mergear.txt'), 'x\n')
  execFileSync('git', ['add', '-A'], { cwd: ws2.workCwd })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'trabajo sesion 2', '-q'], { cwd: ws2.workCwd })

  // Simula que el usuario/OS borró el directorio del worktree sin pasar por git.
  fs.rmSync(ws1.worktreePath, { recursive: true, force: true })
  fs.rmSync(ws2.worktreePath, { recursive: true, force: true })

  await sg.sweepOrphans({ realCwds: [repo] })

  const worktreeList = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
  assert.ok(!worktreeList.includes(ws1.worktreePath))
  assert.ok(!worktreeList.includes(ws2.worktreePath))

  const branch1 = execFileSync('git', ['branch', '--list', ws1.branch], { cwd: repo }).toString().trim()
  assert.equal(branch1, '', 'la rama mergeada y huérfana debe haberse borrado')

  const branch2 = execFileSync('git', ['branch', '--list', ws2.branch], { cwd: repo }).toString().trim()
  assert.ok(branch2.includes(ws2.branch), 'la rama con commit sin mergear debe sobrevivir')
})

test('sweepOrphans: worktree vivo con rama mergeada sobrevive (no confundir "+" de branch --list con huérfana)', async () => {
  const repo = initRepo()
  const warnCalls = []
  const spyLog = { warn: (msg) => warnCalls.push(msg) }
  const sg = makeSg({ log: spyLog })

  // ws-viva: worktree se deja en pie (sigue existiendo en disco), su rama
  // apunta a HEAD del repo real => mergeada, y además está "ocupada" por ese
  // worktree activo (git branch --list la marcaría con '+', no con '*').
  const wsViva = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.ok(wsViva)

  // ws-huerfana: mismo caso de mergeada, pero su worktree se borra a mano.
  const wsHuerfana = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.ok(wsHuerfana)
  fs.rmSync(wsHuerfana.worktreePath, { recursive: true, force: true })

  await sg.sweepOrphans({ realCwds: [repo] })

  const worktreeList = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
  assert.ok(worktreeList.includes(wsViva.worktreePath), 'el worktree vivo debe seguir listado tras el sweep')
  assert.ok(fs.existsSync(wsViva.worktreePath), 'el directorio del worktree vivo no debe tocarse')

  const branchViva = execFileSync('git', ['branch', '--list', wsViva.branch], { cwd: repo }).toString().trim()
  assert.ok(branchViva.includes(wsViva.branch), 'la rama del worktree vivo debe sobrevivir aunque esté mergeada')

  const branchHuerfana = execFileSync('git', ['branch', '--list', wsHuerfana.branch], { cwd: repo }).toString().trim()
  assert.equal(branchHuerfana, '', 'la rama huérfana y mergeada sí debe borrarse')

  const warnedAboutViva = warnCalls.some((msg) => msg.includes(wsViva.branch))
  assert.equal(warnedAboutViva, false, 'no debe haber log.warn de borrado fallido para la rama viva')
})

test('sweepOrphans nunca lanza aunque el repo no exista', async () => {
  const sg = makeSg()
  await assert.doesNotReject(sg.sweepOrphans({ realCwds: [mkTmp('sgm-no-repo-')] }))
  await assert.doesNotReject(sg.sweepOrphans({ realCwds: [path.join(os.tmpdir(), 'no-existe-de-verdad-123456')] }))
  await assert.doesNotReject(sg.sweepOrphans({}))
})
