const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const wa = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-client.js'))
const priv = wa.__private || {}

describe('whatsapp-client jid normalization', () => {
  test('detecta tipo de jid', () => {
    assert.strictEqual(priv.isGroupJid('12345-67890@g.us'), true)
    assert.strictEqual(priv.isLidJid('123456789@lid'), true)
    assert.strictEqual(priv.isPnJid('34600100200@s.whatsapp.net'), true)
    assert.strictEqual(priv.isPnJid('16505361212@c.us'), true)
    assert.strictEqual(priv.isPnJid('status@broadcast'), false)
  })

  test('jidToNumber sólo devuelve número para JID PN', () => {
    assert.strictEqual(priv.jidToNumber('34600100200@s.whatsapp.net'), '34600100200')
    assert.strictEqual(priv.jidToNumber('16505361212@c.us'), '16505361212')
    assert.strictEqual(priv.jidToNumber('12345-67890@g.us'), '')
    assert.strictEqual(priv.jidToNumber('246183784116374@lid'), '')
  })

  test('sanitizePhoneForJid bloquea phone en grupos', () => {
    assert.strictEqual(priv.sanitizePhoneForJid('12345-67890@g.us', '34600100200'), '')
  })

  test('sanitizePhoneForJid para @lid evita confundir lid local con teléfono real', () => {
    assert.strictEqual(priv.sanitizePhoneForJid('246183784116374@lid', '246183784116374'), '')
    assert.strictEqual(priv.sanitizePhoneForJid('246183784116374@lid', '34600100200'), '34600100200')
  })

  test('deriveDisplayNumber usa local id legible en grupos', () => {
    assert.strictEqual(
      priv.deriveDisplayNumber('34692932809-1368036185@g.us', '346929328091368036185'),
      '34692932809-1368036185'
    )
  })

  test('deriveDisplayNumber para DMs prioriza número PN y para LID mantiene fallback', () => {
    assert.strictEqual(
      priv.deriveDisplayNumber('34600100200@s.whatsapp.net', ''),
      '34600100200'
    )
    assert.strictEqual(
      priv.deriveDisplayNumber('246183784116374@lid', '246183784116374'),
      '246183784116374'
    )
  })
})
