'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { __test__ } = require('../main/ws-server')
const { ensureSafeRequestedPath, resolveExistingDir, listDirectoryTree } = __test__

// Sesión mínima válida para ensureSafeRequestedPath.
function makeSession(cwd, allowedRoots = null) {
  const roots = (allowedRoots || [cwd]).map((r) => ({ normalized: r, real: r }))
  return {
    cwd,
    pathPolicy: {
      allowedRoots: roots,
      readOnlyRoots: []
    },
    permissions: {
      'fs.read': true,
      'fs.list': true,
      'fs.write': true,
      'viewer.open': true,
      'fs.delete': true,
      'fs.rename': true
    }
  }
}

describe('ws-server: defensa NAS/SMB en perímetro de paths', () => {
  test('ensureSafeRequestedPath rechaza /Volumes/... rápido', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wssrv-'))
    try {
      const session = makeSession(tmpRoot)
      const t0 = Date.now()
      assert.throws(
        () => ensureSafeRequestedPath(session, '/Volumes/NAS-INEXISTENTE-' + Date.now() + '/foo.txt'),
        (err) => err && err.code === 'REMOTE_PATH_UNSUPPORTED'
      )
      const elapsed = Date.now() - t0
      assert.ok(elapsed < 2000, `Tardó ${elapsed}ms, debe ser rápido (rechazo sin tocar fs)`)
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test('ensureSafeRequestedPath rechaza UNC //host/share rápido', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wssrv-'))
    try {
      const session = makeSession(tmpRoot)
      const t0 = Date.now()
      assert.throws(
        () => ensureSafeRequestedPath(session, '//192.168.1.156/share-inexistente/foo'),
        (err) => err && err.code === 'REMOTE_PATH_UNSUPPORTED'
      )
      const elapsed = Date.now() - t0
      assert.ok(elapsed < 2000, `Tardó ${elapsed}ms, debe ser rápido`)
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test('ensureSafeRequestedPath rechaza UNC \\\\host\\share rápido', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wssrv-'))
    try {
      const session = makeSession(tmpRoot)
      assert.throws(
        () => ensureSafeRequestedPath(session, '\\\\nas\\share\\foo'),
        (err) => err && err.code === 'REMOTE_PATH_UNSUPPORTED'
      )
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test('ensureSafeRequestedPath acepta path local válido dentro de root permitido', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wssrv-'))
    try {
      const session = makeSession(tmpRoot)
      const target = path.join(tmpRoot, 'subdir', 'file.txt')
      const res = ensureSafeRequestedPath(session, target)
      assert.equal(res.absolutePath, target)
      assert.equal(res.matchedLexicalRoot.normalized, tmpRoot)
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test('resolveExistingDir rechaza /Volumes/... rápido', () => {
    const t0 = Date.now()
    const res = resolveExistingDir('/Volumes/NAS-INEXISTENTE-' + Date.now())
    const elapsed = Date.now() - t0
    assert.ok(elapsed < 2000, `Tardó ${elapsed}ms, debe ser rápido`)
    assert.equal(res, '')
  })

  test('resolveExistingDir rechaza UNC rápido', () => {
    const t0 = Date.now()
    const res = resolveExistingDir('//192.168.1.156/share-inexistente')
    const elapsed = Date.now() - t0
    assert.ok(elapsed < 2000, `Tardó ${elapsed}ms, debe ser rápido`)
    assert.equal(res, '')
  })

  test('resolveExistingDir acepta dir local existente', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wssrv-dir-'))
    try {
      const res = resolveExistingDir(tmpRoot)
      assert.equal(res, tmpRoot)
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test('listDirectoryTree local funciona normal', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wssrv-list-'))
    try {
      fs.writeFileSync(path.join(tmpRoot, 'foo.txt'), 'foo')
      fs.mkdirSync(path.join(tmpRoot, 'sub'))
      const session = makeSession(tmpRoot)
      const out = listDirectoryTree(session, tmpRoot, 1)
      assert.ok(Array.isArray(out.entries))
      const names = out.entries.map((e) => e.name).sort()
      assert.deepEqual(names, ['foo.txt', 'sub'])
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
