'use strict'

// Exclusión por carpeta del aislamiento git por sesión: el aislamiento sigue
// donde aporta (repos de desarrollo) y se apaga en las carpetas de trabajo de
// Luismi sin tocar el toggle global.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('node:child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const { cwdExcludedFromIsolation, createSessionGit } = require(path.join(REPO_ROOT, 'main', 'session-git.js'))
const { sanitizeGitIsolationExcludes } = require(path.join(REPO_ROOT, 'main', 'config-store.js'))

describe('cwdExcludedFromIsolation', () => {
  test('dentro de una carpeta excluida (o la propia carpeta) → excluido', () => {
    const ex = ['/Users/luismi/Desktop/TRABAJO']
    assert.strictEqual(cwdExcludedFromIsolation('/Users/luismi/Desktop/TRABAJO', ex), true)
    assert.strictEqual(cwdExcludedFromIsolation('/Users/luismi/Desktop/TRABAJO/sub/carpeta', ex), true)
  })

  test('fuera → no excluido, y no vale el prefijo de string (/a/bc vs /a/b)', () => {
    const ex = ['/Users/luismi/Desktop/TRABAJO']
    assert.strictEqual(cwdExcludedFromIsolation('/Users/luismi/Desktop/OTRA', ex), false)
    assert.strictEqual(cwdExcludedFromIsolation('/Users/luismi/Desktop/TRABAJO-2', ex), false)
  })

  test('insensible a mayúsculas y a barras finales', () => {
    const ex = ['/Users/Luismi/Desktop/Trabajo/']
    assert.strictEqual(cwdExcludedFromIsolation('/users/luismi/desktop/trabajo/x', ex), true)
  })

  test('expande ~ con el home inyectado', () => {
    assert.strictEqual(
      cwdExcludedFromIsolation('/home/luismi/docs/x', ['~/docs'], { home: '/home/luismi' }),
      true
    )
    assert.strictEqual(
      cwdExcludedFromIsolation('/home/otro/docs/x', ['~/docs'], { home: '/home/luismi' }),
      false
    )
  })

  test('entradas vacías o lista ausente → no excluido', () => {
    assert.strictEqual(cwdExcludedFromIsolation('/a/b', []), false)
    assert.strictEqual(cwdExcludedFromIsolation('/a/b', null), false)
    assert.strictEqual(cwdExcludedFromIsolation('', ['/a']), false)
    assert.strictEqual(cwdExcludedFromIsolation('/a/b', ['', '   ']), false)
  })
})

describe('sanitizeGitIsolationExcludes', () => {
  test('string multilínea → array limpio y dedupe', () => {
    const out = sanitizeGitIsolationExcludes('/a/b\n\n /a/b \n~/docs\nrelativa/no\n/c')
    assert.deepStrictEqual(out, ['/a/b', '~/docs', '/c'])
  })

  test('array válido pasa; basura fuera; tope de 50', () => {
    assert.deepStrictEqual(sanitizeGitIsolationExcludes(['/x', 42, null, 'sin-barra']), ['/x'])
    const many = Array.from({ length: 80 }, (_, i) => `/p${i}`)
    assert.strictEqual(sanitizeGitIsolationExcludes(many).length, 50)
  })

  test('no-string/no-array → []', () => {
    assert.deepStrictEqual(sanitizeGitIsolationExcludes(undefined), [])
    assert.deepStrictEqual(sanitizeGitIsolationExcludes({}), [])
  })
})

describe('prepareSessionWorkspace con isEnabled(realCwd)', () => {
  test('isEnabled recibe el cwd real y su false evita el worktree', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ex-repo-'))
    const g = (args) => execFileSync('git', args, { cwd: repo })
    g(['init', '-q', '-b', 'main'])
    g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'base', '-q'])

    const seen = []
    const sg = createSessionGit({
      worktreesRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ex-wt-')),
      looksRemotePath: () => false,
      isEnabled: (realCwd) => { seen.push(realCwd); return false }
    })
    const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
    assert.strictEqual(ws, null)
    assert.deepStrictEqual(seen, [repo])
  })
})
