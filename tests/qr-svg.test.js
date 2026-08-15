'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildQrSvgDataUrl } = require('../main/qr-svg')

// El QR viaja al renderer como data URL para un <img>: imagen, no markup, así
// no hay innerHTML con datos. Se genera en local (qrcode-generator, sin red).

test('genera un data URL SVG determinista con la URL de invitación dentro', () => {
  const url = 'https://ejemplo.trycloudflare.com/lan-mirror.html?invite=abc-123'
  const dataUrl = buildQrSvgDataUrl(url)
  assert.ok(dataUrl.startsWith('data:image/svg+xml;base64,'))
  const svg = Buffer.from(dataUrl.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.includes('</svg>'))
  // Determinista: mismo texto → mismo QR (nada aleatorio que rompa un re-render).
  assert.equal(buildQrSvgDataUrl(url), dataUrl)
  // Textos distintos → QR distintos.
  assert.notEqual(buildQrSvgDataUrl(`${url}x`), dataUrl)
})

test('entrada vacía o inválida → cadena vacía, nunca un throw', () => {
  assert.equal(buildQrSvgDataUrl(''), '')
  assert.equal(buildQrSvgDataUrl(null), '')
  assert.equal(buildQrSvgDataUrl(undefined), '')
  // Una URL absurdamente larga no revienta la creación de la invitación.
  assert.equal(typeof buildQrSvgDataUrl('x'.repeat(20000)), 'string')
})
