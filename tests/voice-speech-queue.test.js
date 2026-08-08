'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createSpeechQueue } = require(path.join(REPO_ROOT, 'main', 'voice-speech-queue.js'))

function makeQueue(opts = {}) {
  const dichas = []
  const idles = []
  const queue = createSpeechQueue({
    speak: (id, text) => {
      dichas.push({ id, text })
      return !(opts.failOn || []).includes(text)
    },
    onIdle: () => idles.push(true),
    log: () => {}
  })
  return { queue, dichas, idles }
}

test('la primera frase se dice en el acto', () => {
  const { queue, dichas } = makeQueue()

  queue.push('hola')

  assert.equal(dichas.length, 1)
  assert.equal(dichas[0].text, 'hola')
  assert.ok(queue.isBusy())
})

test('la segunda espera a que termine la primera', () => {
  const { queue, dichas } = makeQueue()

  queue.push('una')
  queue.push('dos')
  assert.equal(dichas.length, 1, 'el helper solo dice una frase a la vez')

  queue.handleSpeechEnd(dichas[0].id, true)
  assert.equal(dichas.length, 2)
  assert.equal(dichas[1].text, 'dos')
})

test('avisa de que quedó libre cuando se acaba la cola', () => {
  const { queue, dichas, idles } = makeQueue()

  queue.push('una')
  queue.push('dos')
  queue.handleSpeechEnd(dichas[0].id, true)
  assert.equal(idles.length, 0, 'todavía quedaba una frase')

  queue.handleSpeechEnd(dichas[1].id, true)
  assert.equal(idles.length, 1)
  assert.equal(queue.isBusy(), false)
})

test('un speech-end de otra frase no adelanta la cola', () => {
  const { queue, dichas } = makeQueue()

  queue.push('una')
  queue.push('dos')
  queue.handleSpeechEnd('id-de-otra-cosa', true)

  assert.equal(dichas.length, 1)
})

// El usuario corta (botón del modo voz) o el helper cancela: lo que quedaba por
// leer ya no interesa, y seguir leyéndolo sería hablar solo.
test('una frase cancelada tira el resto de la cola', () => {
  const { queue, dichas, idles } = makeQueue()

  queue.push('una')
  queue.push('dos')
  queue.push('tres')
  queue.handleSpeechEnd(dichas[0].id, false)

  assert.equal(dichas.length, 1)
  assert.equal(queue.isBusy(), false)
  assert.equal(idles.length, 1)
})

test('si el helper no acepta la frase, la cola sigue con la siguiente', () => {
  const { queue, dichas } = makeQueue({ failOn: ['dos'] })

  queue.push('una')
  queue.push('dos')
  queue.push('tres')
  queue.handleSpeechEnd(dichas[0].id, true)

  assert.deepEqual(dichas.map((d) => d.text), ['una', 'dos', 'tres'])
  assert.equal(queue.currentText(), 'tres', 'se quedó colgada en la frase perdida')
})

test('clear vacía la cola sin avisar de que quedó libre', () => {
  const { queue, idles } = makeQueue()

  queue.push('una')
  queue.push('dos')
  queue.clear()

  assert.equal(queue.isBusy(), false)
  assert.equal(queue.pending(), 0)
  assert.equal(idles.length, 0)
})

test('un speech-end tardío tras clear no revive la cola', () => {
  const { queue, dichas, idles } = makeQueue()

  queue.push('una')
  queue.push('dos')
  const idVieja = dichas[0].id
  queue.clear()
  queue.handleSpeechEnd(idVieja, true)

  assert.equal(dichas.length, 1)
  assert.equal(idles.length, 0)
})

test('el texto en blanco no ocupa turno', () => {
  const { queue, dichas } = makeQueue()

  queue.push('   ')
  queue.push('')
  queue.push(null)

  assert.equal(dichas.length, 0)
  assert.equal(queue.isBusy(), false)
})

test('los identificadores no se repiten entre frases', () => {
  const { queue, dichas } = makeQueue()

  queue.push('una')
  queue.handleSpeechEnd(dichas[0].id, true)
  queue.push('dos')

  assert.notEqual(dichas[0].id, dichas[1].id)
})

test('sabe cuánto le queda por decir', () => {
  const { queue, dichas } = makeQueue()

  queue.push('una')
  queue.push('dos')
  queue.push('tres')
  assert.equal(queue.pending(), 2)

  queue.handleSpeechEnd(dichas[0].id, true)
  assert.equal(queue.pending(), 1)
})
