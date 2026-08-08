'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const {
  createVoiceTurnWatcher,
  splitSpeakableChunk,
  MIN_CHUNK_CHARS
} = require(path.join(REPO_ROOT, 'main', 'voice-turn-watcher.js'))

// ── Corte en trozos hablables ────────────────────────────────────────────

test('corta en la última frase cerrada y guarda el resto', () => {
  const largo = 'Voy a mirar el fichero de configuración primero. Después reviso'
  const { chunk, rest } = splitSpeakableChunk(largo)

  assert.equal(chunk, 'Voy a mirar el fichero de configuración primero.')
  assert.equal(rest, 'Después reviso')
})

test('sin final de frase no entrega nada todavía', () => {
  const { chunk, rest } = splitSpeakableChunk('estoy escribiendo una frase que aún no ha terminado y sigue')

  assert.equal(chunk, '')
  assert.equal(rest, 'estoy escribiendo una frase que aún no ha terminado y sigue')
})

test('un salto de línea también cierra un trozo', () => {
  const texto = 'He encontrado tres cosas que revisar en el arranque\ny la primera es'
  const { chunk } = splitSpeakableChunk(texto)

  assert.equal(chunk, 'He encontrado tres cosas que revisar en el arranque')
})

test('no entrega trozos demasiado cortos', () => {
  const { chunk, rest } = splitSpeakableChunk('Vale. Ahora')

  assert.equal(chunk, '')
  assert.equal(rest, 'Vale. Ahora')
  assert.ok(MIN_CHUNK_CHARS > 10)
})

// Si se corta dentro de un bloque de código a medio escribir, el limpiador de
// markdown no lo reconoce como código y acabaría leyendo símbolos en voz alta.
test('espera a que cierre un bloque de código a medias', () => {
  const texto = 'Te lo dejo aquí abajo para que lo veas entero.\n```js\nconst a = 1'
  const { chunk, rest } = splitSpeakableChunk(texto)

  assert.equal(chunk, '')
  assert.equal(rest, texto)
})

test('con el bloque de código cerrado sí entrega', () => {
  const texto = 'Te lo dejo abajo para que lo veas.\n```js\nconst a = 1\n```\nY con eso'
  const { chunk } = splitSpeakableChunk(texto)

  assert.ok(chunk.startsWith('Te lo dejo abajo'))
  assert.ok(chunk.includes('```'))
})

test('el modo final entrega lo que quede aunque sea corto', () => {
  const { chunk, rest } = splitSpeakableChunk('Ya está', { flush: true })

  assert.equal(chunk, 'Ya está')
  assert.equal(rest, '')
})

// ── Vigía leyendo a trozos ───────────────────────────────────────────────

function makeWatcher(pasos, opts = {}) {
  const chunks = []
  const dones = []
  let i = 0
  let tick = null

  const watcher = createVoiceTurnWatcher({
    findRelayTranscript: () => ({ filePath: '/t.jsonl', sessionId: 'sid' }),
    extractAssistantTextFromTranscript: () => pasos[Math.min(i, pasos.length - 1)],
    statFn: () => ({ size: 1000 + i }),
    setIntervalFn: (fn) => { tick = fn; return 1 },
    clearIntervalFn: () => { tick = null },
    pollMs: 100,
    timeoutMs: opts.timeoutMs || 60000
  })

  watcher.watch({
    sessionId: 'sid',
    cwds: ['/p'],
    baseOffset: 0,
    onChunk: (t) => chunks.push(t),
    onDone: (r) => dones.push(r)
  })

  return {
    chunks,
    dones,
    poll: () => { if (tick) tick(); i += 1 }
  }
}

test('va entregando frases antes de que el turno termine', () => {
  const w = makeWatcher([
    { text: 'Voy a revisar la configuración del arranque ahora mismo. Un momento', turnComplete: false },
    { text: 'Voy a revisar la configuración del arranque ahora mismo. Un momento que lo compruebo. Y sigo', turnComplete: false },
    { text: 'Voy a revisar la configuración del arranque ahora mismo. Un momento que lo compruebo. Y sigo con lo demás.', turnComplete: true }
  ])

  w.poll()
  assert.deepEqual(w.chunks, ['Voy a revisar la configuración del arranque ahora mismo.'])

  w.poll()
  assert.equal(w.chunks.length, 2)
  assert.equal(w.chunks[1], 'Un momento que lo compruebo.')
})

test('al terminar el turno entrega solo lo que faltaba por leer', () => {
  const w = makeWatcher([
    { text: 'Ya he mirado los tres módulos que me pediste antes. Ahora', turnComplete: false },
    { text: 'Ya he mirado los tres módulos que me pediste antes. Ahora te cuento el resultado.', turnComplete: true }
  ])

  w.poll()
  w.poll()

  assert.equal(w.dones.length, 1)
  assert.equal(w.dones[0].remainder, 'Ahora te cuento el resultado.')
  assert.ok(w.dones[0].text.startsWith('Ya he mirado'), 'el texto completo sigue estando')
})

test('sin nada entregado por el camino el resto es el turno entero', () => {
  const w = makeWatcher([
    { text: 'Hecho.', turnComplete: true }
  ])

  w.poll()

  assert.equal(w.dones.length, 1)
  assert.equal(w.dones[0].remainder, 'Hecho.')
})

test('no repite un trozo ya entregado', () => {
  const w = makeWatcher([
    { text: 'Esta es la primera frase completa del turno. Y esto', turnComplete: false },
    { text: 'Esta es la primera frase completa del turno. Y esto', turnComplete: false },
    { text: 'Esta es la primera frase completa del turno. Y esto no ha cambiado.', turnComplete: true }
  ])

  w.poll()
  w.poll()

  assert.equal(w.chunks.length, 1)
})
