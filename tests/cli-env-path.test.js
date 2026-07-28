'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  createCliResolver,
  USER_LOCAL_BIN,
  HOMEBREW_BIN,
  LATEST_NVM_NODE_BIN
} = require('../main/cli-resolver')

function pathDirs(getConfig = () => ({})) {
  const resolver = createCliResolver(getConfig)
  return resolver.buildRuntimeEnv().PATH.split(':')
}

test('buildRuntimeEnv pone el bin de nvm antes de /usr/local/bin', { skip: !LATEST_NVM_NODE_BIN }, () => {
  const dirs = pathDirs()
  const nvmIdx = dirs.indexOf(LATEST_NVM_NODE_BIN)
  const brewIdx = dirs.indexOf(HOMEBREW_BIN)
  assert.ok(nvmIdx >= 0, 'el bin de nvm debe estar en el PATH')
  assert.ok(brewIdx >= 0, '/usr/local/bin debe estar en el PATH')
  assert.ok(
    nvmIdx < brewIdx,
    `nvm (${nvmIdx}) debe ir antes que /usr/local/bin (${brewIdx}): si no, ` +
    '`npm install -g` del auto-update de codex usa el node de sistema y falla con EACCES'
  )
})

test('buildRuntimeEnv mantiene ~/.local/bin como primer directorio', () => {
  assert.strictEqual(pathDirs()[0], USER_LOCAL_BIN)
})

test('buildRuntimeEnv antepone los dirs de los bins configurados', () => {
  const dirs = pathDirs(() => ({ cli: { codexBin: '/opt/custom/bin/codex' } }))
  assert.ok(dirs.includes('/opt/custom/bin'))
})

test('buildRuntimeEnv no duplica directorios', () => {
  const dirs = pathDirs()
  assert.strictEqual(new Set(dirs).size, dirs.length)
})
