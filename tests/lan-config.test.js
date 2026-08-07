'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createConfigNormalizers } = require('../main/config-store')

function normalizers() {
  return createConfigNormalizers({
    clampLanPort: (value) => Number(value) || 9999,
    normalizeEnterpriseConfig: (value) => value || { enabled: false },
    defaultEnterpriseRoleId: 'role-default'
  })
}

test('las URLs públicas LAN solo aceptan HTTPS/WSS y no guardan query', () => {
  const cfg = normalizers().normalizeLanServerConfig({
    publicClientUrl: 'http://agent.example.test/client?token=leak',
    publicWsUrl: 'ws://agent-ws.example.test?token=leak'
  })
  assert.equal(cfg.publicClientUrl, '')
  assert.equal(cfg.publicWsUrl, '')

  const safe = normalizers().normalizeLanServerConfig({
    publicClientUrl: 'https://agent.example.test/lan-client.html?token=leak#hash',
    publicWsUrl: 'wss://agent-ws.example.test?invite=leak'
  })
  assert.equal(safe.publicClientUrl, 'https://agent.example.test/lan-client.html')
  assert.equal(safe.publicWsUrl, 'wss://agent-ws.example.test')
})
