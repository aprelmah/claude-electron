'use strict'

const qrcode = require('qrcode-generator')

// El QR viaja al renderer como data URL para un <img>: imagen, no markup, así
// no hay innerHTML con datos. Se genera en local (qrcode-generator, sin red).
function buildQrSvgDataUrl(text) {
  const value = String(text || '')
  if (!value) return ''
  try {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const svg = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true })
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  } catch {
    // Un QR imposible (texto que no cabe) no puede tumbar la invitación.
    return ''
  }
}

module.exports = { buildQrSvgDataUrl }
