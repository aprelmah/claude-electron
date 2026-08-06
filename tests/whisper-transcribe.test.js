'use strict'

// Enrutado de transcripción de audio: Apple Speech (servidor, vía helper de
// voz) primero, whisper.cpp de fallback. ffmpeg y whisper se falsean con un
// spawnFn inyectado que crea los ficheros de salida esperados.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { createTranscriber, APPLE_MAX_SECONDS } = require('../main/whisper-transcribe')

// wav de 16 kHz mono 16-bit: 32000 bytes por segundo + 44 de cabecera.
const BYTES_PER_SEC = 32000

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-'))
}

function fakeProc() {
  const p = new EventEmitter()
  p.stderr = new EventEmitter()
  p.stdout = new EventEmitter()
  return p
}

// spawnFn falso: la llamada ffmpeg de conversión crea el wav (tamaño según
// wavSeconds); la llamada whisper crea el .txt con whisperText.
function makeSpawn({ wavSeconds = 5, whisperText = 'texto whisper', whisperExit = 0 } = {}) {
  const calls = []
  const spawnFn = (bin, args) => {
    const p = fakeProc()
    calls.push({ bin, args })
    setImmediate(() => {
      if (args.includes('-otxt')) {
        const base = args[args.indexOf('-of') + 1]
        if (whisperExit === 0) fs.writeFileSync(`${base}.txt`, whisperText)
        p.emit('close', whisperExit)
        return
      }
      // Conversión ffmpeg: el wav es el último argumento.
      const wavPath = args[args.length - 1]
      fs.writeFileSync(wavPath, Buffer.alloc(44 + Math.round(wavSeconds * BYTES_PER_SEC)))
      p.emit('close', 0)
    })
    return p
  }
  return { spawnFn, calls }
}

function crear({ spawnFn, appleTranscribe, whisperDisponible = true, modelPath, tmpDir }) {
  return createTranscriber({
    getWhisperBin: () => 'whisper-falso',
    modelPath,
    tmpDir,
    appleTranscribe,
    spawnFn,
    commandExistsFn: (bin) => (bin === 'whisper-falso' ? whisperDisponible : true),
    measureVolumeFn: async () => -20,
    log: () => {}
  })
}

function withModel(tmpDir) {
  const modelPath = path.join(tmpDir, 'model.bin')
  fs.writeFileSync(modelPath, 'x')
  return modelPath
}

test('con Apple disponible transcribe por Apple y no toca whisper', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn, calls } = makeSpawn()
  const appleCalls = []
  const t = crear({
    spawnFn,
    tmpDir,
    modelPath: withModel(tmpDir),
    appleTranscribe: async (wavPath, meta) => { appleCalls.push({ wavPath, meta }); return 'texto apple' }
  })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  const texto = await t.transcribeAudioFile(input, {})
  assert.strictEqual(texto, 'texto apple')
  assert.strictEqual(appleCalls.length, 1)
  assert.ok(appleCalls[0].meta.durationSec > 4 && appleCalls[0].meta.durationSec < 6, 'pasa la duración estimada')
  assert.ok(!calls.some((c) => c.args.includes('-otxt')), 'whisper no se invoca')
  assert.ok(!fs.existsSync(appleCalls[0].wavPath), 'el wav se limpia tras el éxito')
})

test('si Apple falla cae a whisper', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn, calls } = makeSpawn({ whisperText: 'texto whisper' })
  const t = crear({
    spawnFn,
    tmpDir,
    modelPath: withModel(tmpDir),
    appleTranscribe: async () => { throw new Error('el helper no contestó') }
  })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  assert.strictEqual(await t.transcribeAudioFile(input, {}), 'texto whisper')
  assert.ok(calls.some((c) => c.args.includes('-otxt')), 'whisper sí se invoca')
})

test('si Apple devuelve vacío cae a whisper', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn } = makeSpawn({ whisperText: 'texto whisper' })
  const t = crear({
    spawnFn,
    tmpDir,
    modelPath: withModel(tmpDir),
    appleTranscribe: async () => '   '
  })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  assert.strictEqual(await t.transcribeAudioFile(input, {}), 'texto whisper')
})

test('audio más largo que el tope de Apple va directo a whisper', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn } = makeSpawn({ wavSeconds: APPLE_MAX_SECONDS + 10, whisperText: 'largo' })
  let appleLlamado = false
  const t = crear({
    spawnFn,
    tmpDir,
    modelPath: withModel(tmpDir),
    appleTranscribe: async () => { appleLlamado = true; return 'no debería' }
  })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  assert.strictEqual(await t.transcribeAudioFile(input, {}), 'largo')
  assert.strictEqual(appleLlamado, false)
})

test('sin appleTranscribe va por whisper como siempre', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn } = makeSpawn({ whisperText: 'clásico' })
  const t = crear({ spawnFn, tmpDir, modelPath: withModel(tmpDir) })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  assert.strictEqual(await t.transcribeAudioFile(input, {}), 'clásico')
})

test('whisper ausente pero Apple funcionando: transcribe igual', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn } = makeSpawn()
  const t = crear({
    spawnFn,
    tmpDir,
    whisperDisponible: false,
    modelPath: path.join(tmpDir, 'no-existe.bin'),
    appleTranscribe: async () => 'apple sin whisper'
  })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  assert.strictEqual(await t.transcribeAudioFile(input, {}), 'apple sin whisper')
})

test('whisper ausente y Apple fallando: error claro de whisper', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn } = makeSpawn()
  const t = crear({
    spawnFn,
    tmpDir,
    whisperDisponible: false,
    modelPath: withModel(tmpDir),
    appleTranscribe: async () => { throw new Error('sin permiso') }
  })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  await assert.rejects(t.transcribeAudioFile(input, {}), /Whisper no disponible/)
})

test('el filtro de alucinaciones sigue aplicando a la salida de whisper', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn } = makeSpawn({ whisperText: 'Subtítulos realizados por la comunidad de Amara.org' })
  const t = crear({ spawnFn, tmpDir, modelPath: withModel(tmpDir) })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  await assert.rejects(t.transcribeAudioFile(input, {}), /Sin voz reconocida/)
})

test('el silencio corta antes de convertir nada', async () => {
  const tmpDir = mkTmpDir()
  const { spawnFn, calls } = makeSpawn()
  const t = createTranscriber({
    getWhisperBin: () => 'whisper-falso',
    modelPath: withModel(tmpDir),
    tmpDir,
    spawnFn,
    commandExistsFn: () => true,
    measureVolumeFn: async () => -60,
    log: () => {}
  })
  const input = path.join(tmpDir, 'nota.oga')
  fs.writeFileSync(input, 'audio')
  await assert.rejects(t.transcribeAudioFile(input, {}), /silencio/)
  assert.strictEqual(calls.length, 0)
})
