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

test('copySessionsHome: un directorio llamado "*.jsonl" se omite (EISDIR), el resto se copia y avisa', () => {
  const realDir = mkTmp('sg-real-')
  const workDir = mkTmp('sg-work-')
  const map = new Map([
    ['/real/cwd', realDir],
    ['/work/cwd', workDir]
  ])

  fs.writeFileSync(path.join(workDir, 'sid-1.jsonl'), '{"turn":"uno"}\n')
  fs.mkdirSync(path.join(workDir, 'x.jsonl')) // patológico: "sesión" que en realidad es un directorio
  fs.writeFileSync(path.join(workDir, 'sid-3.jsonl'), '{"turn":"tres"}\n')

  const warnCalls = []
  const sg = createSessionGit({
    worktreesRoot: mkTmp('sg-wt-'),
    looksRemotePath: () => false,
    isEnabled: () => true,
    resolveClaudeProjectDir: makeResolver(map),
    log: { warn: (...args) => warnCalls.push(args.join(' ')) }
  })

  const copied = sg.copySessionsHome({ realCwd: '/real/cwd', workCwd: '/work/cwd' })

  assert.deepEqual(copied.sort(), ['sid-1', 'sid-3'])
  assert.equal(fs.readFileSync(path.join(realDir, 'sid-1.jsonl'), 'utf8'), '{"turn":"uno"}\n')
  assert.equal(fs.readFileSync(path.join(realDir, 'sid-3.jsonl'), 'utf8'), '{"turn":"tres"}\n')
  assert.ok(!fs.existsSync(path.join(realDir, 'x.jsonl')), 'no debe copiar el directorio')
  assert.ok(warnCalls.some((m) => m.includes('x.jsonl')), 'debe avisar del elemento omitido')
})

test('copySessionsHome: fallo de copyFileSync en un fichero no aborta el resto (warn + continue)', (t) => {
  const realDir = mkTmp('sg-real-')
  const workDir = mkTmp('sg-work-')
  const map = new Map([
    ['/real/cwd', realDir],
    ['/work/cwd', workDir]
  ])

  fs.writeFileSync(path.join(workDir, 'sid-1.jsonl'), '{"turn":"uno"}\n')
  fs.writeFileSync(path.join(workDir, 'sid-2.jsonl'), '{"turn":"dos"}\n')
  fs.writeFileSync(path.join(workDir, 'sid-3.jsonl'), '{"turn":"tres"}\n')

  const originalCopyFileSync = fs.copyFileSync
  t.mock.method(fs, 'copyFileSync', (src, dest, ...rest) => {
    if (String(src).endsWith('sid-2.jsonl')) throw new Error('EACCES simulado')
    return originalCopyFileSync(src, dest, ...rest)
  })

  const warnCalls = []
  const sg = createSessionGit({
    worktreesRoot: mkTmp('sg-wt-'),
    looksRemotePath: () => false,
    isEnabled: () => true,
    resolveClaudeProjectDir: makeResolver(map),
    log: { warn: (...args) => warnCalls.push(args.join(' ')) }
  })

  const copied = sg.copySessionsHome({ realCwd: '/real/cwd', workCwd: '/work/cwd' })

  assert.deepEqual(copied.sort(), ['sid-1', 'sid-3'])
  assert.equal(fs.readFileSync(path.join(realDir, 'sid-1.jsonl'), 'utf8'), '{"turn":"uno"}\n')
  assert.equal(fs.readFileSync(path.join(realDir, 'sid-3.jsonl'), 'utf8'), '{"turn":"tres"}\n')
  assert.ok(!fs.existsSync(path.join(realDir, 'sid-2.jsonl')), 'el fichero que falla no debe quedar copiado')
  assert.ok(warnCalls.some((m) => m.includes('sid-2')), 'debe avisar del fallo puntual')
})

test('copySessionToWorktree: si el destino ya es igual o más nuevo que el origen, no lo pisa', () => {
  const realDir = mkTmp('sg-real-')
  const workDir = mkTmp('sg-work-')
  const encodedWork = path.join(workDir, 'encoded-worktree')
  fs.mkdirSync(encodedWork, { recursive: true })
  const map = new Map([
    ['/real/cwd', realDir],
    ['/work/cwd', encodedWork]
  ])
  const sid = 'sid-fresh'
  const sourceFile = path.join(realDir, `${sid}.jsonl`)
  const targetFile = path.join(encodedWork, `${sid}.jsonl`)
  fs.writeFileSync(sourceFile, '{"turn":"viejo-en-real"}\n')
  fs.writeFileSync(targetFile, '{"turn":"nuevo-en-worktree"}\n')

  const now = Date.now() / 1000
  fs.utimesSync(sourceFile, now - 100, now - 100) // origen más antiguo
  fs.utimesSync(targetFile, now, now) // destino más nuevo

  const sg = makeSg({ resolveClaudeProjectDir: makeResolver(map) })
  const ok = sg.copySessionToWorktree({ claudeSessionId: sid, realCwd: '/real/cwd', workCwd: '/work/cwd' })

  assert.equal(ok, true)
  assert.equal(fs.readFileSync(targetFile, 'utf8'), '{"turn":"nuevo-en-worktree"}\n', 'no debe pisar una versión más nueva en el worktree')
})

test('copySessionToWorktree: si el destino es más antiguo que el origen, lo sobrescribe', () => {
  const realDir = mkTmp('sg-real-')
  const workDir = mkTmp('sg-work-')
  const encodedWork = path.join(workDir, 'encoded-worktree')
  fs.mkdirSync(encodedWork, { recursive: true })
  const map = new Map([
    ['/real/cwd', realDir],
    ['/work/cwd', encodedWork]
  ])
  const sid = 'sid-stale'
  const sourceFile = path.join(realDir, `${sid}.jsonl`)
  const targetFile = path.join(encodedWork, `${sid}.jsonl`)
  fs.writeFileSync(targetFile, '{"turn":"viejo-en-worktree"}\n')
  fs.writeFileSync(sourceFile, '{"turn":"nuevo-en-real"}\n')

  const now = Date.now() / 1000
  fs.utimesSync(targetFile, now - 100, now - 100) // destino más antiguo
  fs.utimesSync(sourceFile, now, now) // origen más nuevo

  const sg = makeSg({ resolveClaudeProjectDir: makeResolver(map) })
  const ok = sg.copySessionToWorktree({ claudeSessionId: sid, realCwd: '/real/cwd', workCwd: '/work/cwd' })

  assert.equal(ok, true)
  assert.equal(fs.readFileSync(targetFile, 'utf8'), '{"turn":"nuevo-en-real"}\n', 'debe sobrescribir cuando el destino es más antiguo')
})
