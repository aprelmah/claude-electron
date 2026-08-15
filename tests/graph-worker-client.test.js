'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { computeProjectGraphAsync, shutdownGraphWorker } = require('../main/graph-worker-client')

test('graph-worker-client: construye el grafo en worker con nodes y edges', async (t) => {
  t.after(() => shutdownGraphWorker())
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-worker-'))
  try {
    fs.writeFileSync(path.join(tmpRoot, 'a.js'), "const b = require('./b')\n")
    fs.writeFileSync(path.join(tmpRoot, 'b.js'), 'module.exports = 1\n')
    const result = await computeProjectGraphAsync(tmpRoot)
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.nodes.length, 2)
    assert.strictEqual(result.edges.length, 1)
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('graph-worker-client: root vacío devuelve error claro sin reventar', async (t) => {
  t.after(() => shutdownGraphWorker())
  const result = await computeProjectGraphAsync('')
  assert.strictEqual(result.ok, false)
})

test('graph-worker-client: builds concurrentes resuelven todos', async (t) => {
  t.after(() => shutdownGraphWorker())
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-worker-c-'))
  try {
    fs.writeFileSync(path.join(tmpRoot, 'x.js'), 'module.exports = 1\n')
    const [r1, r2, r3] = await Promise.all([
      computeProjectGraphAsync(tmpRoot),
      computeProjectGraphAsync(tmpRoot),
      computeProjectGraphAsync(tmpRoot)
    ])
    assert.strictEqual(r1.ok, true)
    assert.strictEqual(r2.ok, true)
    assert.strictEqual(r3.ok, true)
    assert.strictEqual(r1.nodes.length, 1)
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})
