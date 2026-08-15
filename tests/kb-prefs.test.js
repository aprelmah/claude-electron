'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createKbPrefs, KB_PREFS_DEFAULT, KB_PREFS_VERSION } = require('../main/kb-prefs')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kb-prefs-'))
}

test('kb-prefs: sin fichero, cualquier carpeta viene con el default (ON)', () => {
  const prefs = createKbPrefs({ userDataDir: tmpDir() })
  assert.equal(KB_PREFS_DEFAULT, true)
  assert.equal(prefs.get('/Users/x/proyecto'), true)
  assert.equal(fs.existsSync(prefs.filePath), false)
})

test('kb-prefs: apagar una carpeta persiste y no afecta a las demás', () => {
  const dir = tmpDir()
  const prefs = createKbPrefs({ userDataDir: dir })
  prefs.set('/Users/x/sin-kb', false)

  assert.equal(prefs.get('/Users/x/sin-kb'), false)
  assert.equal(prefs.get('/Users/x/otro'), true)

  const releida = createKbPrefs({ userDataDir: dir })
  assert.equal(releida.get('/Users/x/sin-kb'), false)
})

test('kb-prefs: volver al default borra la entrada en vez de guardar true', () => {
  const dir = tmpDir()
  const prefs = createKbPrefs({ userDataDir: dir })
  prefs.set('/Users/x/proyecto', false)
  prefs.set('/Users/x/proyecto', true)

  assert.deepEqual(prefs.all(), {})
  assert.equal(prefs.get('/Users/x/proyecto'), true)
})

test('kb-prefs: el path se normaliza (misma carpeta escrita de dos formas)', () => {
  const prefs = createKbPrefs({ userDataDir: tmpDir() })
  prefs.set('/Users/x/proyecto/', false)

  assert.equal(prefs.get('/Users/x/proyecto'), false)
  assert.equal(prefs.get('/Users/x/otra/../proyecto'), false)
})

test('kb-prefs: cwd vacío no escribe nada y devuelve el default', () => {
  const prefs = createKbPrefs({ userDataDir: tmpDir() })
  assert.equal(prefs.set('', false), KB_PREFS_DEFAULT)
  assert.equal(prefs.get(''), true)
  assert.deepEqual(prefs.all(), {})
})

test('kb-prefs: fichero corrupto o de otra versión no rompe, cae al default', () => {
  const dir = tmpDir()
  const prefs = createKbPrefs({ userDataDir: dir })

  fs.writeFileSync(prefs.filePath, '{ esto no es json')
  assert.equal(prefs.get('/Users/x/proyecto'), true)

  fs.writeFileSync(prefs.filePath, JSON.stringify({ version: KB_PREFS_VERSION + 99, byCwd: { '/Users/x/proyecto': false } }))
  assert.equal(prefs.get('/Users/x/proyecto'), true)
})

test('kb-prefs: valores no booleanos del fichero se ignoran', () => {
  const dir = tmpDir()
  const prefs = createKbPrefs({ userDataDir: dir })
  fs.writeFileSync(prefs.filePath, JSON.stringify({
    version: KB_PREFS_VERSION,
    byCwd: { '/Users/x/malo': 'no', '/Users/x/bueno': false }
  }))

  assert.equal(prefs.get('/Users/x/malo'), true)
  assert.equal(prefs.get('/Users/x/bueno'), false)
})

test('kb-prefs: exige userDataDir', () => {
  assert.throws(() => createKbPrefs({}), /userDataDir/)
})
