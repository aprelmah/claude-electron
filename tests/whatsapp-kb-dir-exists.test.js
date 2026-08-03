const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

// HOME se cambia ANTES del require: BRIDGE_DIR/KB_DIR se calculan al cargar el
// módulo. node --test da un proceso por fichero, así que esto no contamina a
// las demás suites.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-home-'))
process.env.HOME = FAKE_HOME

const REPO_ROOT = path.resolve(__dirname, '..')
const wa = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-client.js'))
const { kbDirExists } = wa.__private || {}

const KB = path.join(FAKE_HOME, '.claude', 'whatsapp-bridge', 'kb')

// En kbMode strict, "no hay fichas" tiene dos causas muy distintas y antes se
// trataban igual (caer a la persona libre, que inventa):
//   - kb/ no existe        → instalación sin KB, legítimo.
//   - kb/ existe y va vacío → la KB estaba montada y se ha roto → escalar.
describe('kbDirExists', () => {
  test('sin directorio kb/ → false (instalación sin KB)', () => {
    assert.strictEqual(kbDirExists(), false)
  })

  test('con kb/ creado → true, aunque esté vacío', () => {
    fs.mkdirSync(KB, { recursive: true })
    assert.strictEqual(kbDirExists(), true)
  })

  test('si kb/ es un fichero y no un directorio → false', () => {
    fs.rmSync(KB, { recursive: true, force: true })
    fs.writeFileSync(KB, 'no soy un directorio')
    assert.strictEqual(kbDirExists(), false)
    fs.rmSync(KB, { force: true })
  })
})
