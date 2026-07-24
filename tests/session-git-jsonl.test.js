// tests/session-git-jsonl.test.js
// Copia de transcripts .jsonl de Claude Code entre el proyecto real y el
// worktree de sesión (resume al entrar, sincronizar turnos nuevos al salir).
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createSessionGit } = require('../main/session-git')

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }

// Simula el mapeo cwd -> dir codificado de ~/.claude/projects/<encoded>/
// usando un Map real->dir y otro work->dir, igual que haría
// resolveClaudeProjectDir(cwd) en main.js pero sin tocar el filesystem real.
function makeResolver(map) {
  return (cwd) => map.get(cwd) || null
}

function makeSg({ resolveClaudeProjectDir } = {}) {
  return createSessionGit({
    worktreesRoot: mkTmp('sg-wt-'),
    looksRemotePath: () => false,
    isEnabled: () => true,
    resolveClaudeProjectDir
  })
}

test('copySessionToWorktree copia el jsonl del proyecto real al worktree (creando el dir)', () => {
  const realDir = mkTmp('sg-real-')
  const workDir = mkTmp('sg-work-') // no existe el subdir encoded todavia
  const encodedWork = path.join(workDir, 'encoded-worktree')
  const map = new Map([
    ['/real/cwd', realDir],
    ['/work/cwd', encodedWork]
  ])
  const sid = 'abc-123'
  fs.writeFileSync(path.join(realDir, `${sid}.jsonl`), '{"turn":1}\n')

  const sg = makeSg({ resolveClaudeProjectDir: makeResolver(map) })
  const ok = sg.copySessionToWorktree({ claudeSessionId: sid, realCwd: '/real/cwd', workCwd: '/work/cwd' })

  assert.equal(ok, true)
  assert.ok(fs.existsSync(encodedWork), 'debe crear el dir codificado del worktree')
  const copied = fs.readFileSync(path.join(encodedWork, `${sid}.jsonl`), 'utf8')
  assert.equal(copied, '{"turn":1}\n')
})

test('copySessionToWorktree: dir/fichero origen inexistente -> false sin excepcion', () => {
  const map = new Map([
    ['/work/cwd', mkTmp('sg-work-')]
  ]) // sin entrada para /real/cwd -> resolver devuelve null
  const sg = makeSg({ resolveClaudeProjectDir: makeResolver(map) })

  assert.doesNotThrow(() => {
    const ok = sg.copySessionToWorktree({ claudeSessionId: 'nope', realCwd: '/real/cwd', workCwd: '/work/cwd' })
    assert.equal(ok, false)
  })

  // dir sí resuelto pero fichero no existe dentro
  const realDir = mkTmp('sg-real-')
  const map2 = new Map([
    ['/real/cwd', realDir],
    ['/work/cwd', mkTmp('sg-work2-')]
  ])
  const sg2 = makeSg({ resolveClaudeProjectDir: makeResolver(map2) })
  assert.equal(sg2.copySessionToWorktree({ claudeSessionId: 'nope', realCwd: '/real/cwd', workCwd: '/work/cwd' }), false)
})

test('copySessionToWorktree sin resolveClaudeProjectDir inyectado -> no-op false', () => {
  const sg = makeSg({})
  assert.equal(sg.copySessionToWorktree({ claudeSessionId: 'x', realCwd: '/a', workCwd: '/b' }), false)
})

test('copySessionsHome copia todos los jsonl del worktree al proyecto real sobrescribiendo', () => {
  const realDir = mkTmp('sg-real-')
  const workDir = mkTmp('sg-work-')
  const map = new Map([
    ['/real/cwd', realDir],
    ['/work/cwd', workDir]
  ])

  fs.writeFileSync(path.join(realDir, 'sid-1.jsonl'), '{"turn":"viejo"}\n')
  fs.writeFileSync(path.join(workDir, 'sid-1.jsonl'), '{"turn":"nuevo"}\n')
  fs.writeFileSync(path.join(workDir, 'sid-2.jsonl'), '{"turn":"otro"}\n')
  fs.writeFileSync(path.join(workDir, 'no-es-sesion.txt'), 'ignorame')

  const sg = makeSg({ resolveClaudeProjectDir: makeResolver(map) })
  const copied = sg.copySessionsHome({ realCwd: '/real/cwd', workCwd: '/work/cwd' })

  assert.deepEqual(copied.sort(), ['sid-1', 'sid-2'])
  assert.equal(fs.readFileSync(path.join(realDir, 'sid-1.jsonl'), 'utf8'), '{"turn":"nuevo"}\n', 'debe sobrescribir con la version del worktree')
  assert.equal(fs.readFileSync(path.join(realDir, 'sid-2.jsonl'), 'utf8'), '{"turn":"otro"}\n')
  assert.ok(!fs.existsSync(path.join(realDir, 'no-es-sesion.txt')), 'solo copia .jsonl')
})

test('copySessionsHome: dir origen (worktree) inexistente -> [] sin excepcion', () => {
  const map = new Map([
    ['/real/cwd', mkTmp('sg-real-')]
  ]) // sin entrada para /work/cwd -> resolver devuelve null
  const sg = makeSg({ resolveClaudeProjectDir: makeResolver(map) })

  assert.doesNotThrow(() => {
    const copied = sg.copySessionsHome({ realCwd: '/real/cwd', workCwd: '/work/cwd' })
    assert.deepEqual(copied, [])
  })

  // resuelto pero el directorio fisico no existe en disco
  const map2 = new Map([
    ['/real/cwd', mkTmp('sg-real-')],
    ['/work/cwd', path.join(mkTmp('sg-parent-'), 'no-existe')]
  ])
  const sg2 = makeSg({ resolveClaudeProjectDir: makeResolver(map2) })
  assert.deepEqual(sg2.copySessionsHome({ realCwd: '/real/cwd', workCwd: '/work/cwd' }), [])
})

test('copySessionsHome sin resolveClaudeProjectDir inyectado -> no-op []', () => {
  const sg = makeSg({})
  assert.deepEqual(sg.copySessionsHome({ realCwd: '/a', workCwd: '/b' }), [])
})
