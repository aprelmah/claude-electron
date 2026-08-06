'use strict'

// Config del bot de avisos separado (telegram.notifyBotToken / notifyChatId).
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createConfigNormalizers } = require(path.join(REPO_ROOT, 'main', 'config-store.js'))

const { normalizeAppConfig } = createConfigNormalizers({
  clampLanPort: (p) => (Number.isFinite(p) ? p : 8765),
  normalizeEnterpriseConfig: () => ({}),
  defaultEnterpriseRoleId: 'admin'
})

describe('config telegram — bot de avisos', () => {
  test('defaults: cadenas vacías', () => {
    const cfg = normalizeAppConfig({})
    assert.strictEqual(cfg.telegram.notifyBotToken, '')
    assert.strictEqual(cfg.telegram.notifyChatId, '')
  })

  test('normaliza con trim y sobrevive al round-trip', () => {
    const cfg = normalizeAppConfig({
      telegram: { notifyBotToken: '  99:BB  ', notifyChatId: ' 123 ' }
    })
    assert.strictEqual(cfg.telegram.notifyBotToken, '99:BB')
    assert.strictEqual(cfg.telegram.notifyChatId, '123')
    const again = normalizeAppConfig(cfg)
    assert.strictEqual(again.telegram.notifyBotToken, '99:BB')
    assert.strictEqual(again.telegram.notifyChatId, '123')
  })

  test('basura tipada no revienta: no-strings → vacío', () => {
    const cfg = normalizeAppConfig({ telegram: { notifyBotToken: 42, notifyChatId: {} } })
    assert.strictEqual(cfg.telegram.notifyBotToken, '')
    assert.strictEqual(cfg.telegram.notifyChatId, '')
  })
})
