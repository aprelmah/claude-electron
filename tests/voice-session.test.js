'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceSession } = require(path.join(REPO_ROOT, 'main', 'voice-session.js'))

function makeHarness(opts = {}) {
  const sent = []
  const helperCmds = []
  const renderer = []
  let watchHandle = null
  let onDoneCb = null
  let onTimeoutCb = null

  const session = createVoiceSession({
    helper: {
      start: () => helperCmds.push({ cmd: '__start__' }),
      send: (c) => { helperCmds.push(c); return true },
      stop: () => helperCmds.push({ cmd: '__stop__' }),
      isRunning: () => true,
      isBroken: () => !!opts.broken,
      reset: () => helperCmds.push({ cmd: '__reset__' })
    },
    speakable: (md) => (opts.speakable ? opts.speakable(md) : md),
    watcher: {
      watch: ({ onDone, onTimeout }) => {
        onDoneCb = onDone
        onTimeoutCb = onTimeout
        watchHandle = { cancel: () => { watchHandle = null } }
        return watchHandle
      }
    },
    router: opts.router || { routeVoiceText: () => ({ mode: 'charla', reason: 'test' }), resolveVoiceTarget: () => ({ ok: true, target: 'subchat', reuseSubchat: false }) },
    sendToTarget: async (payload) => {
      sent.push(payload)
      if (typeof opts.sendToTarget === 'function') return opts.sendToTarget(payload)
      return { ok: true, sessionId: 'sid', cwds: ['/p'], baseOffset: 0 }
    },
    getSession: () => opts.session || { activeCli: 'claude', claudeSessionId: 'sid', pty: {}, wcId: 1 },
    notifyRenderer: (e) => renderer.push(e),
    log: () => {}
  })

  return {
    session,
    sent,
    helperCmds,
    renderer,
    fireDone: (r) => onDoneCb && onDoneCb(r),
    fireTimeout: () => onTimeoutCb && onTimeoutCb(),
    hasWatch: () => !!watchHandle,
    count: (cmd) => helperCmds.filter((c) => c.cmd === cmd).length
  }
}

describe('voice-session: ciclo básico', () => {
  test('empieza apagada', () => {
    const h = makeHarness()
    assert.strictEqual(h.session.getState(), 'idle')
    assert.strictEqual(h.session.isEnabled(), false)
  })

  test('al activarse arranca el helper y escucha', () => {
    const h = makeHarness()
    h.session.enable()
    assert.strictEqual(h.session.isEnabled(), true)
    assert.ok(h.helperCmds.some((c) => c.cmd === 'start'))
    h.session.handleHelperEvent({ type: 'listening' })
    assert.strictEqual(h.session.getState(), 'listening')
  })

  test('no arranca si no hay sesión válida', () => {
    const h = makeHarness({ session: null, router: {
      routeVoiceText: () => ({ mode: 'charla', reason: '' }),
      resolveVoiceTarget: () => ({ ok: false, reason: 'no hay ninguna sesión abierta' })
    } })
    const r = h.session.enable()
    assert.strictEqual(r.ok, false)
    assert.strictEqual(h.session.isEnabled(), false)
    assert.ok(h.renderer.some((e) => e.type === 'error' && /sesión/i.test(e.message)))
  })

  test('un final manda el texto al destino y pasa a pensar', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'qué tal va el relay' })
    assert.strictEqual(h.sent.length, 1)
    assert.strictEqual(h.sent[0].text, 'qué tal va el relay')
    assert.strictEqual(h.session.getState(), 'thinking')
  })

  test('cierra el micro mientras piensa', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.ok(h.helperCmds.some((c) => c.cmd === 'stop'), 'el micro debe cerrarse: si no, capta su propia respuesta')
  })

  test('al cerrar el turno lo lee y vuelve a escuchar', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: 'Todo bien.', sessionId: 'sid' })
    const speak = h.helperCmds.find((c) => c.cmd === 'speak')
    assert.ok(speak)
    assert.strictEqual(speak.text, 'Todo bien.')
    assert.strictEqual(h.session.getState(), 'speaking')
    h.session.handleHelperEvent({ type: 'speech-end', id: speak.id })
    assert.ok(h.helperCmds.filter((c) => c.cmd === 'start').length >= 2, 'debe volver a escuchar')
  })

  test('si no queda nada decible no habla, pero vuelve a escuchar', async () => {
    const h = makeHarness({ speakable: () => '' })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: '```js\nconst x = 1\n```', sessionId: 'sid' })
    assert.ok(!h.helperCmds.some((c) => c.cmd === 'speak'), 'no debe leer un bloque de código')
    assert.ok(h.helperCmds.filter((c) => c.cmd === 'start').length >= 2)
  })

  test('un final vacío se ignora', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'empty' })
    assert.strictEqual(h.sent.length, 0)
  })

  test('ignora un final que llega mientras piensa', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'uno' })
    await h.session.handleHelperEvent({ type: 'final', text: 'dos' })
    assert.strictEqual(h.sent.length, 1, 'un turno cada vez')
  })
})

describe('voice-session: interrupción y apagado', () => {
  test('hablarle encima la calla y reabre el micro', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'speech-start', id: 'a' })
    h.session.handleHelperEvent({ type: 'user-interrupt' })
    assert.strictEqual(h.session.getState(), 'listening')
  })

  test('al apagarse para el helper y cancela el vigía', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(h.hasWatch(), true)
    h.session.disable()
    assert.strictEqual(h.session.isEnabled(), false)
    assert.strictEqual(h.session.getState(), 'idle')
    assert.strictEqual(h.hasWatch(), false, 'el vigía debe cancelarse: si no, sigue vivo tras apagar')
  })

  test('un error fatal del helper apaga el modo voz y avisa', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'error', message: 'el helper de voz no arranca', fatal: true })
    assert.strictEqual(h.session.isEnabled(), false)
    assert.ok(h.renderer.some((e) => e.type === 'error'))
  })

  test('los parciales llegan al renderer', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'partial', text: 'arre' })
    assert.ok(h.renderer.some((e) => e.type === 'partial' && e.text === 'arre'))
  })

  test('setForcedMode se respeta al enrutar', async () => {
    const rutas = []
    const h = makeHarness({ router: {
      routeVoiceText: (t, o) => { rutas.push(o); return { mode: 'encargo', reason: 'forzado' } },
      resolveVoiceTarget: () => ({ ok: true, target: 'subchat', reuseSubchat: false })
    } })
    h.session.enable()
    h.session.setForcedMode('encargo')
    await h.session.handleHelperEvent({ type: 'final', text: 'lo que sea' })
    assert.strictEqual(rutas[0].forcedMode, 'encargo')
  })
})

// Un turno completo hasta dejarla hablando, que es donde empiezan los casos
// borde de verdad (barge-in, eventos tardíos, muerte del helper).
async function hastaHablando(h, texto = 'Todo bien.') {
  h.session.enable()
  await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
  h.fireDone({ text: texto, sessionId: 'sid' })
  return h.helperCmds.find((c) => c.cmd === 'speak')
}

describe('voice-session: barge-in', () => {
  test('mientras habla el micro sigue abierto: si no, el barge-in no existe', async () => {
    // El corte lo detecta el tap de audio del helper (onAudio). Con el micro
    // cerrado ese código no se ejecuta nunca y hablarle encima no hace nada.
    const h = makeHarness()
    const speak = await hastaHablando(h)
    const iSpeak = h.helperCmds.indexOf(speak)
    assert.ok(h.helperCmds.slice(iSpeak).some((c) => c.cmd === 'start'), 'debe reabrir el micro al empezar a hablar')
  })

  test('el corte no cierra el micro: se perdería lo que acaba de reconocer', async () => {
    const h = makeHarness()
    const speak = await hastaHablando(h)
    const antes = h.count('stop')
    h.session.handleHelperEvent({ type: 'user-interrupt' })
    assert.strictEqual(h.session.getState(), 'listening')
    assert.strictEqual(h.count('stop'), antes, 'un stop aquí borraría el turno en curso del helper')
  })

  test('el speech-end de la frase cortada no reabre nada por segunda vez', async () => {
    const h = makeHarness()
    const speak = await hastaHablando(h)
    h.session.handleHelperEvent({ type: 'user-interrupt' })
    const antes = h.count('start')
    h.session.handleHelperEvent({ type: 'speech-end', id: speak.id, finished: false })
    assert.strictEqual(h.count('start'), antes, 'el helper ya está escuchando: otro start resetearía el turno')
    assert.strictEqual(h.session.getState(), 'listening')
  })

  test('un speech-end de una frase vieja no toca un turno nuevo', async () => {
    const h = makeHarness()
    await hastaHablando(h)
    const antes = h.count('start')
    h.session.handleHelperEvent({ type: 'speech-end', id: 'frase-de-hace-tres-turnos' })
    assert.strictEqual(h.count('start'), antes)
    assert.strictEqual(h.session.getState(), 'speaking')
  })

  test('un user-interrupt mientras piensa se ignora', async () => {
    // No hay nada sonando: sería ruido de la sala reabriendo un turno cerrado.
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    const antes = h.count('start')
    h.session.handleHelperEvent({ type: 'user-interrupt' })
    assert.strictEqual(h.session.getState(), 'thinking')
    assert.strictEqual(h.count('start'), antes)
  })
})

describe('voice-session: reentrada y fugas', () => {
  test('dos enable seguidos no arrancan dos helpers', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.enable()
    assert.strictEqual(h.count('__start__'), 1, 'un helper por app')
  })

  test('apagar con un envío en vuelo no deja un vigía huérfano', async () => {
    let soltar = null
    const h = makeHarness({ sendToTarget: () => new Promise((res) => { soltar = res }) })
    h.session.enable()
    const enVuelo = h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.session.disable()
    soltar({ ok: true, sessionId: 'sid', cwds: ['/p'], baseOffset: 0 })
    await enVuelo
    assert.strictEqual(h.hasWatch(), false, 'el turno viejo no puede levantar un vigía tras apagar')
    assert.strictEqual(h.session.getState(), 'idle')
  })

  test('un turno de la carrera anterior no engancha con la nueva', async () => {
    let soltar = null
    const h = makeHarness({ sendToTarget: () => new Promise((res) => { soltar = res }) })
    h.session.enable()
    const enVuelo = h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.session.disable()
    h.session.enable()
    soltar({ ok: true, sessionId: 'sid', cwds: ['/p'], baseOffset: 0 })
    await enVuelo
    assert.strictEqual(h.hasWatch(), false)
    assert.strictEqual(h.session.getState(), 'listening', 'la carrera nueva se queda escuchando, no pensando')
  })

  test('un final que llega tras apagar no envía nada', async () => {
    const h = makeHarness()
    h.session.enable()
    h.session.disable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(h.sent.length, 0)
  })

  test('un done tardío tras apagar no la pone a hablar', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.session.disable()
    h.fireDone({ text: 'Todo bien.', sessionId: 'sid' })
    assert.ok(!h.helperCmds.some((c) => c.cmd === 'speak'))
    assert.strictEqual(h.session.getState(), 'idle')
  })

  test('un error fatal cancela el vigía del turno en vuelo', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(h.hasWatch(), true)
    h.session.handleHelperEvent({ type: 'error', message: 'se fue', fatal: true })
    assert.strictEqual(h.hasWatch(), false)
    assert.strictEqual(h.session.getState(), 'idle')
  })

  test('apagar mientras habla calla la frase en el acto', async () => {
    const h = makeHarness()
    await hastaHablando(h)
    h.session.disable()
    assert.ok(h.helperCmds.some((c) => c.cmd === 'shutup'), 'no se espera a que acabe la frase')
  })

  test('al reactivar tras un error fatal se le da otra oportunidad al helper', () => {
    // El proceso queda marcado como roto y no vuelve a arrancar nunca; sin
    // reset, el toggle no serviría de nada (caso típico: permiso concedido
    // después del fallo).
    const h = makeHarness({ broken: true })
    h.session.enable()
    assert.ok(h.helperCmds.some((c) => c.cmd === '__reset__'))
    assert.ok(h.helperCmds.some((c) => c.cmd === '__start__'))
  })
})

describe('voice-session: caminos que no pueden colgarla', () => {
  test('si el envío falla, vuelve a escuchar y avisa', async () => {
    const h = makeHarness({ sendToTarget: async () => ({ ok: false, reason: 'sin sub-chat' }) })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(h.session.getState(), 'listening')
    assert.ok(h.renderer.some((e) => e.type === 'error' && /sub-chat/.test(e.message)))
  })

  test('si el envío revienta, vuelve a escuchar y avisa', async () => {
    const h = makeHarness({ sendToTarget: async () => { throw new Error('pty muerto') } })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(h.session.getState(), 'listening')
    assert.ok(h.renderer.some((e) => e.type === 'error' && /pty muerto/.test(e.message)))
  })

  test('si el turno no cierra nunca, el timeout la devuelve a escuchar', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireTimeout()
    assert.strictEqual(h.session.getState(), 'listening')
    assert.strictEqual(h.hasWatch(), false)
    assert.ok(h.renderer.some((e) => e.type === 'error'))
  })

  test('un final en blanco rearma el micro en vez de dejarlo cerrado', async () => {
    // El helper cierra su micro al cerrar el turno: si nadie lo rearma, se
    // queda en escucha eterna sin escuchar nada.
    const h = makeHarness()
    h.session.enable()
    const antes = h.count('start')
    await h.session.handleHelperEvent({ type: 'final', text: '   ' })
    assert.strictEqual(h.sent.length, 0)
    assert.strictEqual(h.session.getState(), 'listening')
    assert.strictEqual(h.count('start'), antes + 1)
  })

  test('el primer saludo del helper no rearma el micro dos veces', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'hello', pid: 1 })
    assert.strictEqual(h.count('start'), 1, 'el start de enable ya va en camino')
  })

  test('si el helper resucita mientras hablaba, vuelve a escuchar', async () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'hello', pid: 1 })
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: 'Todo bien.', sessionId: 'sid' })
    assert.strictEqual(h.session.getState(), 'speaking')
    h.session.handleHelperEvent({ type: 'hello', pid: 2 })
    assert.strictEqual(h.session.getState(), 'listening', 'la frase murió con el proceso')
  })

  test('si el helper resucita escuchando, le devuelve el micro', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'hello', pid: 1 })
    const antes = h.count('start')
    h.session.handleHelperEvent({ type: 'hello', pid: 2 })
    assert.strictEqual(h.count('start'), antes + 1, 'el proceso nuevo nace sin micro abierto')
  })

  test('un helper que resucita con la voz apagada no abre el micro', () => {
    const h = makeHarness()
    h.session.handleHelperEvent({ type: 'hello', pid: 1 })
    h.session.handleHelperEvent({ type: 'hello', pid: 2 })
    assert.strictEqual(h.count('start'), 0)
  })

  test('setForcedMode solo acepta los dos modos reales', async () => {
    const rutas = []
    const h = makeHarness({ router: {
      routeVoiceText: (t, o) => { rutas.push(o); return { mode: 'charla', reason: 'test' } },
      resolveVoiceTarget: () => ({ ok: true, target: 'subchat', reuseSubchat: false })
    } })
    h.session.enable()
    h.session.setForcedMode('inventado')
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(rutas[0].forcedMode, null)
  })

  test('los avisos del helper llegan al renderer sin apagar nada', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'warn', message: 'sin cancelación de eco: usa auriculares' })
    assert.ok(h.renderer.some((e) => e.type === 'warn' && /eco/.test(e.message)))
    assert.strictEqual(h.session.isEnabled(), true)
  })

  test('un error no fatal no apaga el modo voz', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'error', message: 'reconocedor no disponible', fatal: false })
    assert.strictEqual(h.session.isEnabled(), true)
    assert.ok(h.renderer.some((e) => e.type === 'error'))
  })

  test('un evento basura no la revienta', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent(null)
    h.session.handleHelperEvent('final')
    h.session.handleHelperEvent({})
    h.session.handleHelperEvent({ type: 'inventado' })
    assert.strictEqual(h.session.getState(), 'listening')
  })

  test('faltan dependencias: lo dice al construirla, no al primer turno', () => {
    assert.throws(() => createVoiceSession(), /helper/)
    assert.throws(() => createVoiceSession({ helper: { send: () => true } }), /speakable/)
    assert.throws(() => createVoiceSession({ helper: { send: () => true }, speakable: () => '' }), /watcher/)
    assert.throws(() => createVoiceSession({
      helper: { send: () => true },
      speakable: () => '',
      watcher: { watch: () => ({}) }
    }), /router/)
    assert.throws(() => createVoiceSession({
      helper: { send: () => true },
      speakable: () => '',
      watcher: { watch: () => ({}) },
      router: { routeVoiceText: () => ({}), resolveVoiceTarget: () => ({}) }
    }), /sendToTarget/)
  })
})
