'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { computeProjectGraph } = require('../main/graph-builder')

test('graph-builder: root remoto /Volumes/NAS-inexistente no cuelga, devuelve graph vacío', () => {
  const remoteFake = '/Volumes/NAS-AUDITORIA-INEXISTENTE-' + Date.now()
  const t0 = Date.now()
  const result = computeProjectGraph(remoteFake)
  const elapsed = Date.now() - t0

  // Generosamente < 2s — lo que medimos es "no cuelga indefinidamente",
  // no "es tan rápido como local". El statSync sobre SMB puede tardar minutos.
  assert.ok(elapsed < 2000, `Tardó ${elapsed}ms, debería ser «rápido» (< 2s)`)
  assert.equal(result.ok, true)
  assert.deepEqual(result.nodes, [])
  assert.deepEqual(result.edges, [])
  assert.deepEqual(result.dirs, [])
})

test('graph-builder: root remoto UNC //host/share no cuelga', () => {
  const t0 = Date.now()
  const result = computeProjectGraph('//192.168.1.156/share-inexistente')
  const elapsed = Date.now() - t0

  assert.ok(elapsed < 2000, `Tardó ${elapsed}ms, debería ser «rápido» (< 2s)`)
  assert.equal(result.ok, true)
  assert.equal(result.nodes.length, 0)
})

test('graph-builder: dir local existente devuelve graph normal con nodes', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-test-'))
  try {
    // Estructura mínima: 2 archivos JS con import entre ellos
    const fooPath = path.join(tmpRoot, 'foo.js')
    const barPath = path.join(tmpRoot, 'bar.js')
    fs.writeFileSync(fooPath, "require('./bar')\n")
    fs.writeFileSync(barPath, "module.exports = 1\n")

    const result = computeProjectGraph(tmpRoot)
    assert.equal(result.ok, true)
    assert.ok(Array.isArray(result.nodes))
    assert.ok(Array.isArray(result.edges))
    assert.ok(Array.isArray(result.dirs))
    // Debe contener los 2 archivos creados
    const labels = result.nodes.map((n) => n.label).sort()
    assert.deepEqual(labels, ['bar.js', 'foo.js'])
    // Y el edge foo -> bar
    assert.ok(
      result.edges.some((e) => e.source === fooPath && e.target === barPath),
      'falta edge foo.js -> bar.js'
    )
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('graph-builder: dir vacío devuelve graph vacío sin error', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-empty-'))
  try {
    const result = computeProjectGraph(tmpRoot)
    assert.equal(result.ok, true)
    assert.deepEqual(result.nodes, [])
    assert.deepEqual(result.edges, [])
    // dirs debe contener al menos el root
    assert.ok(result.dirs.length >= 1)
    assert.equal(result.dirs[0].path, tmpRoot)
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('graph-builder: rootPath vacío/nulo devuelve error claro', () => {
  const r1 = computeProjectGraph('')
  assert.equal(r1.ok, false)
  const r2 = computeProjectGraph(null)
  assert.equal(r2.ok, false)
  const r3 = computeProjectGraph(undefined)
  assert.equal(r3.ok, false)
})

test('graph-builder: subdir remoto enlazado dentro de root local se salta sin colgar', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-mixed-'))
  try {
    // Archivo local válido
    fs.writeFileSync(path.join(tmpRoot, 'real.js'), '// real\n')
    // Symlink hacia path remoto inexistente — el walker NO debe seguirlo
    // (a) por filtro looksRemotePath sobre `full`, (b) por filtro symlink ya existente.
    const remoteFake = '/Volumes/NAS-AUDITORIA-INEXISTENTE-' + Date.now()
    try { fs.symlinkSync(remoteFake, path.join(tmpRoot, 'nas-link')) } catch {}

    const t0 = Date.now()
    const result = computeProjectGraph(tmpRoot)
    const elapsed = Date.now() - t0

    assert.ok(elapsed < 500, `Tardó ${elapsed}ms, debería < 500ms`)
    assert.equal(result.ok, true)
    // Debe contener real.js, NO debe contener nada de /Volumes/
    const labels = result.nodes.map((n) => n.label)
    assert.ok(labels.includes('real.js'))
    assert.ok(!result.nodes.some((n) => n.path.startsWith('/Volumes/')))
    assert.ok(!result.dirs.some((d) => d.path.startsWith('/Volumes/')))
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})
