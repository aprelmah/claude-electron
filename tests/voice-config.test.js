'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const configStore = require(path.join(REPO_ROOT, 'main', 'config-store.js'))
const { sanitizeVoiceId, createConfigNormalizers } = configStore

describe('config del modo voz — sanitizeVoiceId', () => {
  test('acepta los identificadores reales de AVSpeechSynthesis', () => {
    assert.strictEqual(sanitizeVoiceId('com.apple.voice.premium.es-ES.Monica'), 'com.apple.voice.premium.es-ES.Monica')
    assert.strictEqual(sanitizeVoiceId('  com.apple.ttsbundle.Samantha-compact  '), 'com.apple.ttsbundle.Samantha-compact')
  })

  test('acentos, espacios y paréntesis NO se descartan en silencio', () => {
    assert.strictEqual(sanitizeVoiceId('Mónica'), 'Mónica')
    assert.strictEqual(sanitizeVoiceId('Eddy (Español)'), 'Eddy (Español)')
  })

  test('un salto de línea partiría el NDJSON del helper: se descarta', () => {
    assert.strictEqual(sanitizeVoiceId('voz\nmala'), '')
    assert.strictEqual(sanitizeVoiceId('voz\r\n{"cmd":"quit"}'), '')
    assert.strictEqual(sanitizeVoiceId('voz\u0000'), '')
  })

  test('comillas, backslash y basura suelta se descartan', () => {
    assert.strictEqual(sanitizeVoiceId('voz"; rm -rf /'), '')
    assert.strictEqual(sanitizeVoiceId('voz\\mala'), '')
    assert.strictEqual(sanitizeVoiceId('a'.repeat(201)), '')
    assert.strictEqual(sanitizeVoiceId(''), '')
    assert.strictEqual(sanitizeVoiceId('   '), '')
    assert.strictEqual(sanitizeVoiceId(42), '')
    assert.strictEqual(sanitizeVoiceId(null), '')
  })
})

describe('config del modo voz — normalizeAppConfig', () => {
  const { normalizeAppConfig } = createConfigNormalizers({
    clampLanPort: (p) => (Number.isFinite(p) ? p : 8765),
    normalizeEnterpriseConfig: () => ({}),
    defaultEnterpriseRoleId: 'admin'
  })

  test('la clave nueva vive en el bloque cli con su default', () => {
    const cfg = normalizeAppConfig({})
    assert.strictEqual(cfg.cli.voiceId, '')
  })

  test('los valores válidos sobreviven a la normalización', () => {
    const cfg = normalizeAppConfig({ cli: { voiceId: 'com.apple.voice.premium.es-ES.Monica' } })
    assert.strictEqual(cfg.cli.voiceId, 'com.apple.voice.premium.es-ES.Monica')
  })

  test('los valores basura caen al default en vez de viajar al helper', () => {
    const cfg = normalizeAppConfig({ cli: { voiceId: 'x\n{"cmd":"quit"}' } })
    assert.strictEqual(cfg.cli.voiceId, '')
  })

  // El modo voz se enciende SIEMPRE desde el botón de la ventana. Persistir un
  // `voiceEnabled` obligaría a pedir micrófono y reconocimiento de voz al
  // arrancar sin que nadie lo haya pedido, y el dueño del micro es una ventana
  // concreta (`voiceOwnerWcId`), no la app: no hay a quién devolvérselo.
  test('NO existe una clave para arrancar la app escuchando', () => {
    const cfg = normalizeAppConfig({ cli: { voiceEnabled: true } })
    assert.ok(!('voiceEnabled' in cfg.cli), 'una config muerta acaba cableándose por error')
    assert.strictEqual(configStore.sanitizeVoiceEnabled, undefined, 'y su sanitizador tampoco sigue por ahí')
  })
})
