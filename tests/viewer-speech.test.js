'use strict'

const { describe, test, beforeEach } = require('node:test')
const assert = require('node:assert')

const { chunkSpeakableFromMarkdown, speakableFromMarkdown } = require('../main/voice-speakable')
const { createViewerSpeech } = require('../main/viewer-speech')

describe('chunkSpeakableFromMarkdown — documento entero, sin tope (botón Léemelo)', () => {
  test('un documento corto sale en un único trozo, limpio de markdown', () => {
    const chunks = chunkSpeakableFromMarkdown('# Título\n\nHola **mundo**.')
    assert.strictEqual(chunks.length, 1)
    assert.ok(chunks[0].includes('Hola mundo'))
    assert.ok(!chunks[0].includes('#'))
  })

  test('un documento largo se trocea SIN perder texto (a diferencia del tope de 2000)', () => {
    const frase = 'Esta es una frase de prueba con contenido variado que suma caracteres. '
    const doc = frase.repeat(80) // ~5700 caracteres
    const chunks = chunkSpeakableFromMarkdown(doc)
    assert.ok(chunks.length >= 3, `esperaba 3+ trozos, hay ${chunks.length}`)
    const total = chunks.join(' ').replace(/\s+/g, ' ')
    const original = doc.trim().replace(/\s+/g, ' ')
    assert.strictEqual(total, original, 'la unión de los trozos debe ser el documento entero')
  })

  test('cada trozo corta en fin de frase, no a mitad de palabra', () => {
    const frase = 'Una frase completa que termina bien y aporta información útil al oyente. '
    const chunks = chunkSpeakableFromMarkdown(frase.repeat(60))
    for (const c of chunks.slice(0, -1)) {
      assert.ok(/[.?!]$/.test(c), `trozo sin fin de frase: "…${c.slice(-40)}"`)
    }
  })

  test('solo código devuelve lista vacía: no hay nada que leer', () => {
    assert.deepStrictEqual(chunkSpeakableFromMarkdown('```js\nconst a = 1\n```'), [])
    assert.deepStrictEqual(chunkSpeakableFromMarkdown(''), [])
    assert.deepStrictEqual(chunkSpeakableFromMarkdown(null), [])
  })

  test('el refactor no cambió speakableFromMarkdown: el tope de 2000 sigue vivo', () => {
    const largo = 'Frase que ocupa espacio de verdad en el texto. '.repeat(100)
    const out = speakableFromMarkdown(largo)
    assert.ok(out.length <= 2000)
    assert.ok(out.length > 500)
  })
})

describe('createViewerSpeech — cola de trozos sobre el helper', () => {
  let sent, helperRunning, helperStarts, helperStops, ended, voiceOn, prefsApplied
  let vs

  function makeHelper() {
    return {
      isRunning: () => helperRunning,
      start: () => { helperRunning = true; helperStarts++ },
      stop: () => { helperRunning = false; helperStops++ },
      send: (msg) => { if (!helperRunning) return false; sent.push(msg); return true }
    }
  }

  beforeEach(() => {
    sent = []
    helperRunning = false
    helperStarts = 0
    helperStops = 0
    ended = []
    voiceOn = false
    prefsApplied = 0
    vs = createViewerSpeech({
      helper: makeHelper(),
      chunker: (md) => (md ? md.split('|').filter(Boolean) : []),
      isVoiceModeEnabled: () => voiceOn,
      applyPrefs: () => { prefsApplied++ },
      notifyEnded: (wcId) => ended.push(wcId)
    })
  })

  test('speak arranca el helper, aplica preferencias y manda SOLO el primer trozo', () => {
    const res = vs.speak(7, 'uno|dos|tres')
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.chunks, 3)
    assert.strictEqual(helperStarts, 1)
    assert.strictEqual(prefsApplied, 1)
    assert.strictEqual(sent.length, 1)
    assert.strictEqual(sent[0].cmd, 'speak')
    assert.strictEqual(sent[0].text, 'uno')
    assert.ok(sent[0].id.startsWith('viewer:'))
  })

  test('cada speech-end del trozo actual dispara el siguiente; el último avisa y para el helper', () => {
    vs.speak(7, 'uno|dos')
    const id1 = sent[0].id
    assert.strictEqual(vs.handleHelperEvent({ type: 'speech-end', id: id1, finished: true }), true)
    assert.strictEqual(sent.length, 2)
    assert.strictEqual(sent[1].text, 'dos')
    const id2 = sent[1].id
    vs.handleHelperEvent({ type: 'speech-end', id: id2, finished: true })
    assert.deepStrictEqual(ended, [7])
    assert.strictEqual(vs.isReading(), false)
    assert.strictEqual(helperStops, 1, 'el helper arrancado para leer se para al terminar')
  })

  test('un speech-end con id viejo se consume pero NO avanza la cola', () => {
    vs.speak(7, 'uno|dos')
    assert.strictEqual(vs.handleHelperEvent({ type: 'speech-end', id: 'viewer:99:0', finished: true }), true)
    assert.strictEqual(sent.length, 1)
    assert.strictEqual(vs.isReading(), true)
  })

  test('stop calla (shutup), no avisa y descarta el resto de la cola', () => {
    vs.speak(7, 'uno|dos|tres')
    vs.stop(7)
    assert.strictEqual(sent.filter((m) => m.cmd === 'shutup').length, 1)
    assert.strictEqual(vs.isReading(), false)
    assert.deepStrictEqual(ended, [])
    // El speech-end (finished:false) del shutup llega tarde y no resucita nada.
    vs.handleHelperEvent({ type: 'speech-end', id: 'viewer:1:0', finished: false })
    assert.strictEqual(sent.filter((m) => m.cmd === 'speak').length, 1)
  })

  test('stop de otra ventana no toca la lectura en curso', () => {
    vs.speak(7, 'uno|dos')
    vs.stop(9)
    assert.strictEqual(vs.isReading(), true)
  })

  test('con el modo voz encendido se rechaza con motivo', () => {
    voiceOn = true
    const res = vs.speak(7, 'uno')
    assert.strictEqual(res.ok, false)
    assert.ok(/modo voz/.test(res.reason))
    assert.strictEqual(sent.length, 0)
  })

  test('con el modo voz encendido, terminar la lectura NO para el helper ajeno', () => {
    helperRunning = true // el helper ya estaba vivo (p.ej. lo dejó otra cosa)
    vs.speak(7, 'uno')
    voiceOn = true // el modo voz se enciende a mitad de lectura
    vs.handleHelperEvent({ type: 'speech-end', id: sent[0].id, finished: true })
    assert.strictEqual(helperStops, 0)
  })

  test('sin prosa legible se rechaza sin arrancar el helper', () => {
    const res = vs.speak(7, '')
    assert.strictEqual(res.ok, false)
    assert.strictEqual(helperStarts, 0)
  })

  test('una lectura nueva pisa a la anterior (aunque sea de otra ventana)', () => {
    vs.speak(7, 'uno|dos')
    vs.speak(9, 'a|b')
    assert.strictEqual(vs.isReading(), true)
    assert.strictEqual(sent.filter((m) => m.cmd === 'shutup').length, 1)
    const speaks = sent.filter((m) => m.cmd === 'speak')
    assert.strictEqual(speaks[speaks.length - 1].text, 'a')
    // El fin del trozo de la lectura vieja no mueve la nueva.
    vs.handleHelperEvent({ type: 'speech-end', id: speaks[0].id, finished: false })
    assert.strictEqual(vs.isReading(), true)
  })

  test('cerrar la ventana dueña calla sin avisar', () => {
    vs.speak(7, 'uno|dos')
    vs.handleWindowClosed(7)
    assert.strictEqual(vs.isReading(), false)
    assert.deepStrictEqual(ended, [])
  })

  test('el primer hello del helper que ESTA lectura arrancó no la mata; un segundo hello sí', () => {
    vs.speak(7, 'uno|dos')
    assert.strictEqual(vs.handleHelperEvent({ type: 'hello', pid: 1 }), false, 'el hello no se consume')
    assert.strictEqual(vs.isReading(), true)
    vs.handleHelperEvent({ type: 'hello', pid: 2 })
    assert.strictEqual(vs.isReading(), false)
    assert.deepStrictEqual(ended, [7])
  })

  test('con el helper ya vivo, CUALQUIER hello a mitad de lectura es un reinicio y la cierra', () => {
    helperRunning = true
    vs.speak(7, 'uno|dos')
    vs.handleHelperEvent({ type: 'hello', pid: 2 })
    assert.strictEqual(vs.isReading(), false)
    assert.deepStrictEqual(ended, [7])
  })

  test('si el helper muere al mandar un trozo intermedio, la lectura termina avisando', () => {
    vs.speak(7, 'uno|dos')
    helperRunning = false // muere entre trozo y trozo
    vs.handleHelperEvent({ type: 'speech-end', id: sent[0].id, finished: true })
    assert.strictEqual(vs.isReading(), false)
    assert.deepStrictEqual(ended, [7])
  })

  test('eventos que no son del visor no se consumen', () => {
    assert.strictEqual(vs.handleHelperEvent({ type: 'speech-end', id: 'x' }), false)
    assert.strictEqual(vs.handleHelperEvent({ type: 'partial', text: 'hola' }), false)
    assert.strictEqual(vs.handleHelperEvent(null), false)
  })
})
