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
  const timers = []
  let watchHandle = null
  let onDoneCb = null
  let onTimeoutCb = null

  const session = createVoiceSession({
    helper: {
      start: () => helperCmds.push({ cmd: '__start__' }),
      send: (c) => { helperCmds.push(c); return !(opts.sendFails || []).includes(c.cmd) },
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
    notifyRenderer: (e) => {
      renderer.push(e)
      if (opts.notifyThrows) throw new Error('webContents destruido')
    },
    log: () => {},
    setTimeoutFn: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t },
    clearTimeoutFn: (t) => { if (t) t.live = false }
  })

  return {
    session,
    sent,
    helperCmds,
    renderer,
    fireDone: (r) => onDoneCb && onDoneCb(r),
    fireTimeout: () => onTimeoutCb && onTimeoutCb(),
    hasWatch: () => !!watchHandle,
    count: (cmd) => helperCmds.filter((c) => c.cmd === cmd).length,
    liveTimers: () => timers.filter((t) => t.live).length,
    timerMs: () => timers.filter((t) => t.live).map((t) => t.ms),
    fireTimers: () => { for (const t of timers) { if (t.live) { t.live = false; t.fn() } } },
    // Dispara UNO concreto, vivo o cancelado. Sin esto no hay forma de simular
    // un temporizador que ya estaba en vuelo cuando lo cancelaron: clearTimeout
    // no desconvoca una callback que el bucle de eventos ya sacó de la cola, y
    // ese es justo el caso que el corte por carrera tiene que aguantar solo.
    fireTimerRaw: (i) => { const t = timers[i]; if (t) { t.live = false; t.fn() } },
    states: () => renderer.filter((e) => e.type === 'state').map((e) => e.state)
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

  // El de arriba (verbatim del plan) se autocumple: sin enviar nada, `sent`
  // estaría vacío igual aunque la máquina no hiciera nada. Este ejerce lo que
  // aquel dice probar: que el `empty` además REARMA el micro.
  test('un final vacío se ignora, pero rearma el micro (el de arriba se autocumple)', async () => {
    const h = makeHarness()
    h.session.enable()
    const antes = h.count('start')
    await h.session.handleHelperEvent({ type: 'empty' })
    assert.strictEqual(h.sent.length, 0)
    assert.strictEqual(h.count('start'), antes + 1, 'el helper cerró su micro al cerrar el turno en vacío')
    assert.strictEqual(h.session.getState(), 'listening')
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

  // El de arriba (verbatim del plan) se autocumple: nunca llegó a hablar, así
  // que ya estaba en `listening` antes del corte. Este lo ejerce de verdad,
  // con una frase sonando.
  test('hablarle encima la calla y reabre el micro, con una frase sonando de verdad', async () => {
    const h = makeHarness()
    const speak = await hastaHablando(h)
    assert.strictEqual(h.session.getState(), 'speaking')
    h.session.handleHelperEvent({ type: 'user-interrupt' })
    assert.strictEqual(h.session.getState(), 'listening')
    assert.deepStrictEqual(h.states().slice(-2), ['speaking', 'listening'], 'el salto tiene que ser speaking → listening')
    assert.strictEqual(h.liveTimers(), 0, 'el guardia de la frase se suelta al cortar')
    // Y el cerrojo queda echado: el speech-end de esa frase ya no manda nada.
    const antes = h.count('start')
    h.session.handleHelperEvent({ type: 'speech-end', id: speak.id, finished: false })
    assert.strictEqual(h.count('start'), antes)
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
    await hastaHablando(h)
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

  test('un speech-end de cancelación no cierra el turno por su cuenta', async () => {
    // Puede adelantarse a su user-interrupt: uno sale del hilo de CoreAudio y
    // otro de la cola principal. Se ignora y se espera al que sí manda.
    const h = makeHarness()
    const speak = await hastaHablando(h)
    h.session.handleHelperEvent({ type: 'speech-end', id: speak.id, finished: false })
    assert.strictEqual(h.session.getState(), 'speaking', 'todavía no se sabe por qué se canceló')
    h.session.handleHelperEvent({ type: 'user-interrupt' })
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

  test('un final mientras habla se atiende como barge-in y calla la frase', async () => {
    // El user-interrupt puede perderse; el final es prueba suficiente de que
    // el usuario habló encima. Aquí sí hay que callar la síntesis a mano.
    const h = makeHarness()
    await hastaHablando(h)
    await h.session.handleHelperEvent({ type: 'final', text: 'para, mejor otra cosa' })
    assert.strictEqual(h.sent.length, 2)
    assert.strictEqual(h.sent[1].text, 'para, mejor otra cosa')
    assert.strictEqual(h.session.getState(), 'thinking')
    assert.ok(h.helperCmds.some((c) => c.cmd === 'shutup'), 'la frase seguía sonando: hay que callarla')
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

  test('apagar mientras habla calla la frase en el acto y suelta el guardia', async () => {
    const h = makeHarness()
    await hastaHablando(h)
    assert.strictEqual(h.liveTimers(), 1)
    h.session.disable()
    assert.ok(h.helperCmds.some((c) => c.cmd === 'shutup'), 'no se espera a que acabe la frase')
    assert.strictEqual(h.liveTimers(), 0, 'ni un temporizador vivo tras apagar')
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
    assert.strictEqual(h.liveTimers(), 0, 'y su guardia se suelta con ella')
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

describe('voice-session: el renderer no puede tumbar el main', () => {
  // Un webContents destruido con el modo voz encendido hace que notifyRenderer
  // lance. Si el fallo sube, se lleva el proceso main de Electron entero.

  test('un renderer que lanza no impide arrancar', () => {
    const h = makeHarness({ notifyThrows: true })
    assert.doesNotThrow(() => h.session.enable())
    assert.strictEqual(h.session.getState(), 'listening')
  })

  test('un renderer que lanza no deja un rechazo sin dueño en el turno', async () => {
    // onFinal es async: el safeEmit del helper solo envuelve la parte síncrona.
    const h = makeHarness({ notifyThrows: true })
    h.session.enable()
    await assert.doesNotReject(() => h.session.handleHelperEvent({ type: 'final', text: 'hola' }))
    assert.strictEqual(h.sent.length, 1, 'y el turno sale igual')
    assert.strictEqual(h.session.getState(), 'thinking')
  })

  test('un renderer que lanza no revienta el cierre del turno', async () => {
    // Este camino entra desde el setInterval del vigía, que no envuelve la
    // llamada: una excepción aquí es no capturada en el main.
    const h = makeHarness({ notifyThrows: true })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.doesNotThrow(() => h.fireDone({ text: 'Todo bien.', sessionId: 'sid' }))
    assert.strictEqual(h.session.getState(), 'speaking')
  })

  test('un renderer que lanza no revienta el vencimiento del turno', async () => {
    // Hay que mandar un final primero: el onTimeout no existe hasta que
    // `onFinal` levanta el vigía. Sin eso, fireTimeout() es un no-op y el test
    // no prueba nada.
    const h = makeHarness({ notifyThrows: true })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.doesNotThrow(() => h.fireTimeout())
    assert.strictEqual(h.session.getState(), 'listening', 'y aun así vuelve a escuchar')
  })

  test('un renderer que lanza no impide apagar', () => {
    const h = makeHarness({ notifyThrows: true })
    h.session.enable()
    assert.doesNotThrow(() => h.session.disable())
    assert.strictEqual(h.session.isEnabled(), false)
  })
})

describe('voice-session: nadie se queda hablando para siempre', () => {
  test('si el fin de la frase no llega nunca, el guardia rearma el micro', async () => {
    // `thinking` tiene el tope de 180 s del vigía; `speaking` depende de que un
    // proceso externo avise, y si no avisa la máquina se queda muda y sorda.
    const h = makeHarness()
    await hastaHablando(h)
    assert.strictEqual(h.liveTimers(), 1)
    h.fireTimers()
    assert.strictEqual(h.session.getState(), 'listening')
    assert.ok(h.helperCmds.some((c) => c.cmd === 'shutup'), 'por si seguía sonando')
    assert.ok(h.renderer.some((e) => e.type === 'warn'))
  })

  test('el guardia se suelta al llegar el fin de la frase', async () => {
    const h = makeHarness()
    const speak = await hastaHablando(h)
    h.session.handleHelperEvent({ type: 'speech-end', id: speak.id, finished: true })
    assert.strictEqual(h.session.getState(), 'listening')
    assert.strictEqual(h.liveTimers(), 0)
  })

  test('el guardia vencido de una carrera vieja no toca la nueva', async () => {
    // El guardia viejo se dispara IGNORANDO su cancelación (clearTimeout no
    // desconvoca una callback que el bucle de eventos ya sacó de la cola), y
    // con la carrera nueva hablando también: así el único cerrojo que queda en
    // pie es el de la carrera, no el del estado.
    const h = makeHarness()
    await hastaHablando(h)
    h.session.disable()
    await hastaHablando(h, 'La respuesta de la carrera nueva.')
    assert.strictEqual(h.session.getState(), 'speaking')
    const shutupsAntes = h.count('shutup')
    h.fireTimerRaw(0)
    assert.strictEqual(h.session.getState(), 'speaking', 'el guardia viejo no puede cortar la frase de la carrera nueva')
    assert.strictEqual(h.count('shutup'), shutupsAntes, 'ni callarla')
    assert.strictEqual(h.liveTimers(), 1, 'ni llevarse por delante el guardia de la frase que sí está sonando')
  })

  test('la duración del guardia crece con la frase, no es fija', async () => {
    // Un tope fijo cortaría las lecturas largas, que es justo lo que no puede
    // pasar: el guardia es un antibloqueo, no un límite de UX.
    const corta = makeHarness()
    await hastaHablando(corta, 'Ya.')
    const larga = makeHarness()
    await hastaHablando(larga, 'x'.repeat(600))
    const [msCorta] = corta.timerMs()
    const [msLarga] = larga.timerMs()
    assert.ok(msLarga > msCorta, 'una frase de 600 caracteres necesita más margen que "Ya."')
    // ~62 ms/carácter es el ritmo real medido del sintetizador a rate 0,52:
    // el margen tiene que quedar por encima o cortaría una lectura legítima.
    assert.ok(msLarga > 600 * 62, 'el margen no puede quedarse por debajo del ritmo real de lectura')
  })
})

describe('voice-session: órdenes que no llegan al helper', () => {
  test('si el speak no llega, no se queda hablando sin frase', async () => {
    const h = makeHarness({ sendFails: ['speak'] })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: 'Todo bien.', sessionId: 'sid' })
    assert.strictEqual(h.session.getState(), 'listening', 'sin frase no habrá speech-end que esperar')
    assert.ok(h.renderer.some((e) => e.type === 'error' && /voz alta/.test(e.message)))
    assert.strictEqual(h.liveTimers(), 0, 'ni guardia para una frase que no existe')
  })

  test('si el micro no responde, la UI se entera de que está sorda', () => {
    const h = makeHarness({ sendFails: ['start'] })
    h.session.enable()
    assert.ok(h.renderer.some((e) => e.type === 'warn' && /micrófono/i.test(e.message)))
  })

  test('un helper que rechaza todo no revienta la máquina', () => {
    const h = makeHarness({ sendFails: ['start', 'stop', 'speak', 'shutup'] })
    assert.doesNotThrow(() => h.session.enable())
    assert.doesNotThrow(() => h.session.disable())
  })
})

describe('voice-session: la sesión puede cambiar bajo los pies', () => {
  test('si la sesión pasa a codex, el turno no se envía y el modo voz se apaga', async () => {
    // El hot session switch de la app deja cambiar de CLI con la voz encendida.
    // Codex no delimita el fin de turno: el vigía polearía un .jsonl que no
    // crece hasta morir a los 180 s.
    let cli = 'claude'
    const h = makeHarness({ router: {
      routeVoiceText: () => ({ mode: 'charla', reason: 'test' }),
      resolveVoiceTarget: () => (cli === 'claude'
        ? { ok: true, target: 'subchat', reuseSubchat: false }
        : { ok: false, reason: 'el modo voz solo funciona con claude, no con codex' })
    } })
    h.session.enable()
    assert.strictEqual(h.session.isEnabled(), true)
    cli = 'codex'
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(h.sent.length, 0, 'no se manda un turno a una sesión que no sirve')
    assert.strictEqual(h.session.isEnabled(), false)
    assert.strictEqual(h.session.getState(), 'idle')
    assert.ok(h.renderer.some((e) => e.type === 'error' && /codex/i.test(e.message)))
  })

  test('si la sesión muere entre turnos, se apaga con motivo en vez de colgarse', async () => {
    let viva = true
    const h = makeHarness({ router: {
      routeVoiceText: () => ({ mode: 'charla', reason: 'test' }),
      resolveVoiceTarget: () => (viva
        ? { ok: true, target: 'subchat', reuseSubchat: false }
        : { ok: false, reason: 'la sesión no tiene un proceso vivo' })
    } })
    h.session.enable()
    viva = false
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(h.sent.length, 0)
    assert.strictEqual(h.session.isEnabled(), false)
    assert.ok(h.renderer.some((e) => e.type === 'error' && /proceso vivo/.test(e.message)))
  })
})

describe('voice-session: contrato de eventos con el renderer', () => {
  // La Tarea 7 se apoya en estos siete eventos: si cambian sin querer, aquí
  // salta.

  test('cada salto de estado se anuncia, y en orden', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: 'Todo bien.', sessionId: 'sid' })
    const speak = h.helperCmds.find((c) => c.cmd === 'speak')
    h.session.handleHelperEvent({ type: 'speech-end', id: speak.id })
    assert.deepStrictEqual(h.states(), ['listening', 'thinking', 'speaking', 'listening'])
    h.session.disable()
    assert.deepStrictEqual(h.states().slice(-1), ['idle'])
  })

  test('el mismo estado dos veces no se repite al renderer', async () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'listening' })
    h.session.handleHelperEvent({ type: 'empty' })
    assert.deepStrictEqual(h.states(), ['listening'])
  })

  test('heard lleva lo que entendió, el modo y el porqué', async () => {
    const h = makeHarness({ router: {
      routeVoiceText: () => ({ mode: 'encargo', reason: 'verbo de ejecución' }),
      resolveVoiceTarget: () => ({ ok: true, target: 'subchat', reuseSubchat: false })
    } })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: '  arréglalo  ' })
    const heard = h.renderer.find((e) => e.type === 'heard')
    assert.ok(heard, 'sin heard, la UI no puede enseñar a dónde fue la frase')
    assert.strictEqual(heard.text, 'arréglalo', 'ya viene recortado')
    assert.strictEqual(heard.mode, 'encargo')
    assert.strictEqual(heard.reason, 'verbo de ejecución')
  })

  test('saying lleva el texto ya decible, no el markdown crudo', async () => {
    const h = makeHarness({ speakable: () => 'Todo bien, tres tests verdes.' })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: '**Todo bien**, tres tests verdes.', sessionId: 'sid' })
    const saying = h.renderer.find((e) => e.type === 'saying')
    assert.ok(saying)
    assert.strictEqual(saying.text, 'Todo bien, tres tests verdes.')
    const speak = h.helperCmds.find((c) => c.cmd === 'speak')
    assert.strictEqual(saying.text, speak.text, 'la UI enseña exactamente lo que se lee')
  })

  test('nothing-to-say avisa de que el turno no tenía nada que leer', async () => {
    const h = makeHarness({ speakable: () => '' })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: '```js\nconst x = 1\n```', sessionId: 'sid' })
    assert.ok(h.renderer.some((e) => e.type === 'nothing-to-say'))
    assert.ok(!h.renderer.some((e) => e.type === 'saying'))
  })

  test('no se cuela ningún evento fuera del contrato', async () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'partial', text: 'arre' })
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: 'Todo bien.', sessionId: 'sid' })
    h.session.handleHelperEvent({ type: 'warn', message: 'ojo' })
    h.session.handleHelperEvent({ type: 'error', message: 'ojo', fatal: false })
    const permitidos = ['state', 'partial', 'heard', 'saying', 'nothing-to-say', 'warn', 'error']
    for (const e of h.renderer) {
      assert.ok(permitidos.includes(e.type), `evento no documentado para la Tarea 7: ${e.type}`)
    }
  })
})
