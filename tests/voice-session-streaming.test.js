'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceSession } = require(path.join(REPO_ROOT, 'main', 'voice-session.js'))

function makeHarness(opts = {}) {
  const helperCmds = []
  const renderer = []
  let onChunkCb = null
  let onDoneCb = null

  const session = createVoiceSession({
    helper: {
      start: () => {},
      send: (c) => { helperCmds.push(c); return !(opts.sendFails || []).includes(c.cmd) },
      stop: () => {},
      isRunning: () => true
    },
    speakable: (md) => (opts.speakable ? opts.speakable(md) : md),
    watcher: {
      watch: ({ onChunk, onDone }) => {
        onChunkCb = onChunk
        onDoneCb = onDone
        return { cancel: () => {} }
      }
    },
    router: {
      routeVoiceText: () => ({ mode: 'encargo', reason: 'test' }),
      resolveVoiceTarget: () => ({ ok: true, target: 'madre' })
    },
    sendToTarget: async () => ({ ok: true, sessionId: 'sid', cwds: ['/p'], baseOffset: 0 }),
    getSession: () => ({ activeCli: 'claude', claudeSessionId: 'sid', pty: {}, wcId: 1 }),
    getVoiceId: () => '',
    notifyRenderer: (e) => renderer.push(e),
    log: () => {},
    setTimeoutFn: () => ({}),
    clearTimeoutFn: () => {}
  })

  const h = {
    session,
    helperCmds,
    renderer,
    fireChunk: (t) => onChunkCb && onChunkCb(t),
    fireDone: (r) => onDoneCb && onDoneCb(r),
    speaks: () => helperCmds.filter((c) => c.cmd === 'speak'),
    lastSpeak: () => helperCmds.filter((c) => c.cmd === 'speak').slice(-1)[0],
    count: (cmd) => helperCmds.filter((c) => c.cmd === cmd).length,
    endSpeech: (finished = true) => {
      const s = h.lastSpeak()
      if (s) session.handleHelperEvent({ type: 'speech-end', id: s.id, finished })
    }
  }
  return h
}

async function empezarTurno(h) {
  h.session.enable()
  await h.session.handleHelperEvent({ type: 'final', text: 'revisa el arranque' })
}

test('lee el primer trozo sin esperar a que el turno termine', async () => {
  const h = await makeHarness()
  await empezarTurno(h)

  h.fireChunk('Voy a mirar la configuración del arranque.')

  assert.equal(h.speaks().length, 1)
  assert.equal(h.lastSpeak().text, 'Voy a mirar la configuración del arranque.')
  assert.equal(h.session.getState(), 'thinking', 'el turno sigue vivo mientras lee el avance')
})

test('el trozo leído aparece en la interfaz', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.fireChunk('Ya he encontrado el fichero.')

  const saying = h.renderer.filter((e) => e.type === 'saying')
  assert.equal(saying.length, 1)
  assert.equal(saying[0].text, 'Ya he encontrado el fichero.')
})

test('el segundo trozo espera a que termine el primero', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.fireChunk('Primera frase del avance.')
  h.fireChunk('Segunda frase del avance.')
  assert.equal(h.speaks().length, 1, 'el helper solo dice una frase a la vez')

  h.endSpeech()
  assert.equal(h.speaks().length, 2)
  assert.equal(h.lastSpeak().text, 'Segunda frase del avance.')
})

test('al cerrar el turno solo se lee lo que faltaba', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.fireChunk('Ya he mirado los tres módulos.')
  h.endSpeech()
  h.fireDone({ text: 'Ya he mirado los tres módulos. Están todos bien.', remainder: 'Están todos bien.' })

  assert.equal(h.speaks().length, 2)
  assert.equal(h.lastSpeak().text, 'Están todos bien.')
  assert.equal(h.session.getState(), 'speaking')
})

test('cuando acaba de leerlo todo vuelve a escuchar', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.fireChunk('Un avance cualquiera del turno.')
  h.endSpeech()
  h.fireDone({ text: 'Un avance cualquiera del turno. Y el final.', remainder: 'Y el final.' })
  h.endSpeech()

  assert.equal(h.session.getState(), 'listening')
  assert.ok(h.count('start') >= 2, 'no reabrió el micro')
})

test('si ya se leyó todo por el camino no repite nada al cerrar', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.fireChunk('Esto era toda la respuesta.')
  h.endSpeech()
  const antes = h.speaks().length

  h.fireDone({ text: 'Esto era toda la respuesta.', remainder: '' })

  assert.equal(h.speaks().length, antes, 'volvió a leer lo ya dicho')
  assert.equal(h.session.getState(), 'listening')
})

test('un turno que cierra mientras aún está leyendo un trozo no corta la frase', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.fireChunk('Frase larga que todavía se está leyendo.')
  h.fireDone({ text: 'Frase larga que todavía se está leyendo. Y esto al final.', remainder: 'Y esto al final.' })

  assert.equal(h.speaks().length, 1, 'pisó la frase que estaba sonando')

  h.endSpeech()
  assert.equal(h.lastSpeak().text, 'Y esto al final.')
})

test('apagar mientras lee a trozos calla la voz y no sigue con la cola', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.fireChunk('Primera frase del avance.')
  h.fireChunk('Segunda frase del avance.')
  h.session.disable()
  const speaksAlApagar = h.speaks().length

  h.endSpeech()

  assert.equal(h.count('shutup'), 1)
  assert.equal(h.speaks().length, speaksAlApagar)
  assert.equal(h.session.getState(), 'idle')
})

test('un trozo que solo trae código no se lee', async () => {
  const h = makeHarness({ speakable: (md) => (md.includes('```') ? '' : md) })
  await empezarTurno(h)

  h.fireChunk('```js\nconst a = 1\n```')

  assert.equal(h.speaks().length, 0)
  assert.equal(h.session.getState(), 'thinking')
})

test('los trozos de un turno ya abandonado no se leen', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.session.disable()
  h.fireChunk('Un avance que llega tarde.')

  assert.equal(h.speaks().length, 0)
})

test('el turno sin nada que decir vuelve a escuchar y lo dice', async () => {
  const h = makeHarness({ speakable: () => '' })
  await empezarTurno(h)

  h.fireDone({ text: '```js\ncode\n```', remainder: '```js\ncode\n```' })

  assert.equal(h.speaks().length, 0)
  assert.ok(h.renderer.some((e) => e.type === 'nothing-to-say'))
  assert.equal(h.session.getState(), 'listening')
})

// Si el helper se muere a mitad de leer un avance, esa frase no llegó al
// usuario — y el `remainder` del vigía ya la da por dicha. El turno tiene que
// leerse entero al cerrar o se pierde justo el trozo que se quedó a medias.
test('si el helper resucita mientras leía avances, al cerrar lee el turno entero', async () => {
  const h = makeHarness()
  h.session.enable()
  h.session.handleHelperEvent({ type: 'hello' })          // el del arranque
  await h.session.handleHelperEvent({ type: 'final', text: 'revisa esto' })

  h.fireChunk('Primera parte del avance.')
  h.session.handleHelperEvent({ type: 'hello' })          // el proceso se murió y volvió

  h.fireDone({ text: 'Primera parte del avance. Y el final.', remainder: 'Y el final.' })

  assert.equal(h.lastSpeak().text, 'Primera parte del avance. Y el final.')
})

// Compatibilidad: un vigía que no entregue `remainder` (o un onDone antiguo)
// tiene que seguir leyendo el turno entero.
test('sin remainder lee el texto completo del turno', async () => {
  const h = makeHarness()
  await empezarTurno(h)

  h.fireDone({ text: 'La respuesta entera del turno.' })

  assert.equal(h.speaks().length, 1)
  assert.equal(h.lastSpeak().text, 'La respuesta entera del turno.')
})
