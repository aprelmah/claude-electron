'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const {
  detectSourceType,
  isYoutubeUrl,
  isYoutubeRateLimit,
  stripHtml,
  parseVtt,
  resolveYtDlpCandidates,
  createKbExtractor
} = require('../main/kb-extract')

test('isYoutubeRateLimit detecta el 429 en el ruido de yt-dlp', () => {
  assert.equal(isYoutubeRateLimit("ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests"), true)
  assert.equal(isYoutubeRateLimit('yt-dlp salió con código 1: ... Too Many Requests'), true)
  assert.equal(isYoutubeRateLimit('ERROR: Video unavailable'), false)
  assert.equal(isYoutubeRateLimit(''), false)
})

test('detectSourceType distingue youtube, web, pdf, texto y audio', () => {
  assert.equal(detectSourceType('https://www.youtube.com/watch?v=abc123'), 'youtube')
  assert.equal(detectSourceType('https://youtu.be/abc123'), 'youtube')
  assert.equal(detectSourceType('https://m.youtube.com/shorts/xyz'), 'youtube')
  assert.equal(detectSourceType('https://turbo-e.com/soporte'), 'web')
  assert.equal(detectSourceType('/tmp/manual deye.PDF'), 'pdf')
  assert.equal(detectSourceType('/tmp/notas.md'), 'text')
  assert.equal(detectSourceType('/tmp/subs.vtt'), 'text')
  assert.equal(detectSourceType('/tmp/reunion.m4a'), 'audio')
  assert.equal(detectSourceType('/tmp/nota-voz.webm'), 'audio')
  assert.equal(detectSourceType('/tmp/manual.mp3'), 'audio')
  assert.equal(detectSourceType('/tmp/binario.dmg'), null)
  assert.equal(detectSourceType(''), null)
  assert.equal(detectSourceType(null), null)
})

test('extractSource transcribe audio con el motor común y conserva el origen', async () => {
  const calls = []
  const extractor = createKbExtractor({
    userDataDir: '/tmp/kb-test-userdata',
    buildRuntimeEnv: () => ({ TEST_ENV: 'ok' }),
    transcribeAudioFile: async (filePath, env) => {
      calls.push({ filePath, env })
      return 'Primera decisión: usar 24 V.\nSiguiente paso: revisar el fusible.'
    }
  })
  const result = await extractor.extractSource({ kind: 'file', path: '/tmp/reunion.m4a' })
  assert.equal(result.type, 'audio')
  assert.equal(result.title, 'reunion')
  assert.equal(result.origin, '/tmp/reunion.m4a')
  assert.match(result.text, /24 V/)
  assert.deepEqual(calls, [{ filePath: '/tmp/reunion.m4a', env: { TEST_ENV: 'ok' } }])
})

test('isYoutubeUrl no confunde webs normales', () => {
  assert.equal(isYoutubeUrl('https://example.com/watch?v=abc'), false)
  assert.equal(isYoutubeUrl('https://notyoutube.com/watch'), false)
})

test('stripHtml quita scripts, decodifica entidades y saca el título', () => {
  const html = [
    '<html><head><title>Manual &ntilde;o&ntilde;o</title>',
    '<style>body { color: red }</style>',
    '<script>alert("fuera")</script></head>',
    '<body><h1>Secci&oacute;n 1</h1><p>Par&aacute;metro: 63&nbsp;A</p>',
    '<ul><li>uno</li><li>dos &#233;</li></ul>',
    '<!-- comentario --><svg><path d="M0 0"/></svg></body></html>'
  ].join('\n')
  const { title, text } = stripHtml(html)
  assert.equal(title, 'Manual ñoño')
  assert.ok(text.includes('Sección 1'))
  assert.ok(text.includes('Parámetro: 63 A'))
  assert.ok(text.includes('dos é'))
  assert.ok(!text.includes('alert'))
  assert.ok(!text.includes('color: red'))
  assert.ok(!text.includes('comentario'))
})

test('parseVtt deduplica cues rodantes y marca minutos', () => {
  const vtt = [
    'WEBVTT',
    'Kind: captions',
    'Language: es',
    '',
    '00:00:01.000 --> 00:00:03.000',
    'hola a todos',
    '',
    '00:00:03.000 --> 00:00:05.000',
    'hola a todos',
    '',
    '00:00:05.000 --> 00:00:08.000',
    'hoy vemos el <c>inversor</c> trifásico',
    '',
    '00:00:40.000 --> 00:00:43.000',
    'el protocolo se llama P1-TRB',
    '',
    '00:01:20.000 --> 00:01:22.000',
    'y con esto terminamos'
  ].join('\n')
  const out = parseVtt(vtt)
  assert.ok(out.includes('[00:01] hola a todos'))
  assert.equal(out.match(/hola a todos/g).length, 1)
  assert.ok(out.includes('inversor trifásico'))
  assert.ok(!out.includes('<c>'))
  assert.ok(out.includes('[00:40] el protocolo se llama P1-TRB'))
  assert.ok(out.includes('[01:20] y con esto terminamos'))
})

test('parseVtt ignora cabeceras, índices numéricos y NOTE', () => {
  const vtt = [
    'WEBVTT',
    '',
    'NOTE bloque de comentario',
    '',
    '1',
    '00:00:00.500 --> 00:00:02.000',
    'primera frase',
    '',
    '2',
    '00:00:02.000 --> 00:00:04.000',
    'segunda frase'
  ].join('\n')
  const out = parseVtt(vtt)
  assert.ok(!out.includes('NOTE'))
  assert.ok(!/^1$/m.test(out))
  assert.ok(out.includes('primera frase'))
  assert.ok(out.includes('segunda frase'))
})

test('resolveYtDlpCandidates ordena pip user por versión y cierra con python3 -m', () => {
  const home = '/Users/prueba'
  const pyRoot = path.join(home, 'Library', 'Python')
  const candidates = resolveYtDlpCandidates({
    homeDir: home,
    readdirFn: (dir) => {
      assert.equal(dir, pyRoot)
      return ['3.9', '3.14', 'no-version']
    },
    existsFn: (p) => p.includes('3.14') || p.includes('3.9')
  })
  assert.deepEqual(candidates[0], { cmd: 'yt-dlp', args: [] })
  assert.equal(candidates[1].cmd, path.join(pyRoot, '3.14', 'bin', 'yt-dlp'))
  assert.equal(candidates[2].cmd, path.join(pyRoot, '3.9', 'bin', 'yt-dlp'))
  assert.deepEqual(candidates[candidates.length - 1], { cmd: 'python3', args: ['-m', 'yt_dlp'] })
})

test('resolveYtDlpCandidates sobrevive a un home sin Library/Python', () => {
  const candidates = resolveYtDlpCandidates({
    homeDir: '/nada',
    readdirFn: () => { throw new Error('ENOENT') }
  })
  assert.equal(candidates[0].cmd, 'yt-dlp')
  assert.equal(candidates[candidates.length - 1].cmd, 'python3')
})
