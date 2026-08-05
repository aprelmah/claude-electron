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

describe('config del modo voz — sanitizeVoiceRate (velocidad de la voz, 2026-08-05)', () => {
  const { sanitizeVoiceRate } = configStore

  test('valores dentro del rango pasan tal cual, como texto', () => {
    assert.strictEqual(sanitizeVoiceRate(0.52), '0.52')
    assert.strictEqual(sanitizeVoiceRate('0.4'), '0.4')
    assert.strictEqual(sanitizeVoiceRate(0.7), '0.7')
  })

  test('fuera de rango se acota, no se descarta: el usuario movió el slider a un extremo', () => {
    assert.strictEqual(sanitizeVoiceRate(0.05), '0.3')
    assert.strictEqual(sanitizeVoiceRate(1), '0.7')
    assert.strictEqual(sanitizeVoiceRate('999'), '0.7')
  })

  test('basura devuelve "": sin preferencia, el helper usa su defecto', () => {
    for (const v of ['', 'rápida', null, undefined, NaN, Infinity, {}]) {
      assert.strictEqual(sanitizeVoiceRate(v), '', String(v))
    }
  })

  test('se redondea a dos decimales: es lo que produce el slider y evita colas de float', () => {
    assert.strictEqual(sanitizeVoiceRate(0.5199999), '0.52')
  })
})

describe('config del modo voz — voiceRate en normalizeAppConfig', () => {
  const { normalizeAppConfig } = createConfigNormalizers({
    clampLanPort: (p) => Number(p) || 9999,
    normalizeEnterpriseConfig: () => ({}),
    defaultEnterpriseRoleId: 'role'
  })

  test('voiceRate viaja por la normalización y la basura cae a ""', () => {
    assert.strictEqual(normalizeAppConfig({ cli: { voiceRate: '0.6' } }).cli.voiceRate, '0.6')
    assert.strictEqual(normalizeAppConfig({ cli: { voiceRate: 'no' } }).cli.voiceRate, '')
    assert.strictEqual(normalizeAppConfig({}).cli.voiceRate, '')
  })
})
