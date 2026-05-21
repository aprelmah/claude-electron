const { test, describe } = require('node:test')
const assert = require('node:assert')
const os = require('os')
const path = require('path')

const {
  clampLanPort,
  pickLanIPv4,
  DEFAULT_LAN_WS_PORT
} = require(path.join(__dirname, '..', 'main', 'ws-server.js'))

function withMockedInterfaces(mockMap, fn) {
  const original = os.networkInterfaces
  os.networkInterfaces = () => mockMap
  try {
    return fn()
  } finally {
    os.networkInterfaces = original
  }
}

describe('ws-server.clampLanPort', () => {
  test('usa default con valores inválidos', () => {
    assert.strictEqual(clampLanPort(undefined), DEFAULT_LAN_WS_PORT)
    assert.strictEqual(clampLanPort(null), DEFAULT_LAN_WS_PORT)
    assert.strictEqual(clampLanPort('abc'), DEFAULT_LAN_WS_PORT)
    assert.strictEqual(clampLanPort(''), DEFAULT_LAN_WS_PORT)
  })

  test('clampa por debajo del mínimo', () => {
    assert.strictEqual(clampLanPort(0), DEFAULT_LAN_WS_PORT)
    assert.strictEqual(clampLanPort(80), 1024)
    assert.strictEqual(clampLanPort('1000'), 1024)
  })

  test('clampa por encima del máximo', () => {
    assert.strictEqual(clampLanPort(70000), 65534)
    assert.strictEqual(clampLanPort('99999'), 65534)
  })

  test('acepta puertos válidos', () => {
    assert.strictEqual(clampLanPort(1024), 1024)
    assert.strictEqual(clampLanPort(9999), 9999)
    assert.strictEqual(clampLanPort('15000'), 15000)
    assert.strictEqual(clampLanPort(65534), 65534)
  })
})

describe('ws-server.pickLanIPv4', () => {
  test('prioriza IP privada si existe', () => {
    const ip = withMockedInterfaces({
      en0: [
        { family: 'IPv4', internal: false, address: '8.8.8.8' },
        { family: 'IPv4', internal: false, address: '192.168.1.20' }
      ]
    }, () => pickLanIPv4())
    assert.strictEqual(ip, '192.168.1.20')
  })

  test('si no hay privada usa la primera pública', () => {
    const ip = withMockedInterfaces({
      en0: [
        { family: 'IPv4', internal: false, address: '203.0.113.8' },
        { family: 'IPv4', internal: false, address: '198.51.100.21' }
      ]
    }, () => pickLanIPv4())
    assert.strictEqual(ip, '203.0.113.8')
  })

  test('ignora interfaces internas o no IPv4', () => {
    const ip = withMockedInterfaces({
      lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      en1: [{ family: 'IPv6', internal: false, address: 'fe80::1' }]
    }, () => pickLanIPv4())
    assert.strictEqual(ip, '127.0.0.1')
  })

  test('devuelve loopback cuando no hay candidatos', () => {
    const ip = withMockedInterfaces({}, () => pickLanIPv4())
    assert.strictEqual(ip, '127.0.0.1')
  })
})
