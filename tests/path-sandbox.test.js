const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const { isPathSafe, isValidSessionId, DENY_ROOTS } = require(path.join(__dirname, '..', 'main', 'path-sandbox.js'))

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pa-acl-'))
}

describe('path-sandbox.isPathSafe', () => {
  test('acepta ruta dentro de root permitido', () => {
    const root = makeTempDir()
    try {
      const inside = path.join(root, 'docs', 'nota.txt')
      assert.strictEqual(isPathSafe(inside, [root]), true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('acepta exactamente el root permitido', () => {
    const root = makeTempDir()
    try {
      assert.strictEqual(isPathSafe(root, [root]), true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('rechaza cuando no hay allowedRoots', () => {
    assert.strictEqual(isPathSafe('/tmp/whatever.txt', []), false)
    assert.strictEqual(isPathSafe('/tmp/whatever.txt', null), false)
  })

  test('rechaza escape por traversal fuera del root', () => {
    const root = makeTempDir()
    try {
      const escaped = path.join(root, '..', 'fuera.txt')
      assert.strictEqual(isPathSafe(escaped, [root]), false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('prioriza DENY_ROOTS sobre allowedRoots amplios', () => {
    const denyRoot = DENY_ROOTS[0]
    const blocked = path.join(denyRoot, 'id_test')
    assert.strictEqual(isPathSafe(blocked, [os.homedir()]), false)
  })

  test('acepta si está dentro de cualquiera de múltiples roots', () => {
    const a = makeTempDir()
    const b = makeTempDir()
    try {
      const target = path.join(b, 'ok.txt')
      assert.strictEqual(isPathSafe(target, [a, b]), true)
    } finally {
      fs.rmSync(a, { recursive: true, force: true })
      fs.rmSync(b, { recursive: true, force: true })
    }
  })

  test('rechaza entradas no string', () => {
    assert.strictEqual(isPathSafe(null, ['/tmp']), false)
    assert.strictEqual(isPathSafe(undefined, ['/tmp']), false)
    assert.strictEqual(isPathSafe(42, ['/tmp']), false)
  })

  test.skip('TODO enterprise hardening: resolver symlink con realpath para evitar escapes indirectos', () => {
    // Caso pendiente para la fase enterprise:
    // `path.resolve` no detecta cuando una ruta "dentro" del root apunta por
    // symlink a un destino fuera del root permitido.
  })
})

describe('path-sandbox.isValidSessionId', () => {
  test('acepta UUID válido', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    assert.strictEqual(isValidSessionId(uuid), true)
  })

  test('acepta UUID con hex en mayúsculas', () => {
    const uuid = '123E4567-E89B-12D3-A456-426614174000'
    assert.strictEqual(isValidSessionId(uuid), true)
  })

  test('rechaza IDs inválidos', () => {
    assert.strictEqual(isValidSessionId('not-a-uuid'), false)
    assert.strictEqual(isValidSessionId('123e4567e89b12d3a456426614174000'), false)
    assert.strictEqual(isValidSessionId(''), false)
    assert.strictEqual(isValidSessionId(null), false)
  })
})
