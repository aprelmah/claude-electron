'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceHelperProcess, checkHelperBinary } = require(path.join(REPO_ROOT, 'main', 'voice-helper-process.js'))

function errCon(code) {
  const e = new Error(code)
  e.code = code
  return e
}

function makeFakeProc() {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.killed = false
  proc.written = []
  // stdin como EventEmitter real (no un objeto plano): hace falta para poder
  // simular el 'error' asíncrono de un pipe roto (ronda de revisión 1).
  const stdin = new EventEmitter()
  stdin.write = (d) => { proc.written.push(d); return true }
  stdin.end = () => {}
  proc.stdin = stdin
  // kill() NO dispara 'close' síncrono: en un proceso real, matar es async
  // (el 'close' llega más tarde, cuando el SO confirma que murió). Hace
  // falta ese hueco temporal para reproducir carreras stop()+start() donde
  // el close tardío del proceso viejo llega después de que ya hay uno nuevo
  // (ronda de revisión 2). Los tests que necesiten el 'close' lo emiten a
  // mano sobre la referencia guardada al proceso.
  proc.kill = () => { proc.killed = true }
  return proc
}

function makeHarness(opts = {}) {
  const spawned = []
  const events = []
  const logs = []
  const timers = []
  let current = null
  // Reloj de mentira: la vida del proceso decide si su caída cuenta como
  // incidente aislado o como parte de un bucle, así que hay que poder mentir.
  let ahora = 1000
  const helper = createVoiceHelperProcess({
    helperPath: '/fake/voice-helper',
    spawnFn: (bin, args, o) => { spawned.push({ bin, args, o }); current = makeFakeProc(); return current },
    onEvent: (e) => events.push(e),
    log: (m) => logs.push(m),
    maxRestarts: opts.maxRestarts,
    stableMs: opts.stableMs,
    nowFn: () => ahora,
    // Sin temporizadores reales: el kill de respaldo de stop() se dispara a mano.
    setTimeoutFn: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t },
    clearTimeoutFn: (t) => { if (t) t.live = false }
  })
  return {
    helper,
    spawned,
    events,
    logs,
    timers,
    avanzar: (ms) => { ahora += ms },
    proc: () => current,
    fireTimers: () => { for (const t of timers) { if (t.live) { t.live = false; t.fn() } } },
    liveTimers: () => timers.filter((t) => t.live).length
  }
}

describe('voice-helper-process: arranque y parseo', () => {
  test('exige helperPath y spawnFn', () => {
    assert.throws(() => createVoiceHelperProcess({}), /helperPath requerido/)
    assert.throws(() => createVoiceHelperProcess({ helperPath: '/x' }), /spawnFn requerido/)
  })

  test('arranca el binario y queda vivo', () => {
    const h = makeHarness()
    h.helper.start()
    assert.strictEqual(h.spawned.length, 1)
    assert.strictEqual(h.spawned[0].bin, '/fake/voice-helper')
    assert.strictEqual(h.helper.isRunning(), true)
  })

  test('parsea una línea JSON completa', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"hello","pid":1}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'hello', pid: 1 }])
  })

  test('reensambla un evento partido entre dos chunks', () => {
    // El bug clásico de leer stdout: un JSON puede llegar cortado por la mitad.
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"par'))
    h.proc().stdout.emit('data', Buffer.from('tial","text":"hola"}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'partial', text: 'hola' }])
  })

  test('varios eventos en un solo chunk salen en orden', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"a"}\n{"type":"b"}\n'))
    assert.deepStrictEqual(h.events.map((e) => e.type), ['a', 'b'])
  })

  test('una línea no-JSON se ignora sin tumbar el parser', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('basura no json\n{"type":"ok"}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'ok' }])
  })

  test('send escribe una línea JSON', () => {
    const h = makeHarness()
    h.helper.start()
    assert.strictEqual(h.helper.send({ cmd: 'start' }), true)
    assert.deepStrictEqual(h.proc().written, ['{"cmd":"start"}\n'])
  })

  test('send devuelve false si no está vivo', () => {
    const h = makeHarness()
    assert.strictEqual(h.helper.send({ cmd: 'start' }), false)
  })
})

describe('voice-helper-process: caídas', () => {
  test('reinicia si el helper muere solo', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().emit('close', 1)
    assert.strictEqual(h.spawned.length, 2, 'debe respawnear')
  })

  test('no reinicia tras un stop pedido', () => {
    const h = makeHarness()
    h.helper.start()
    // stop() pone proc=null de inmediato: hay que guardar la referencia
    // ANTES de llamar, para poder emitir su 'close' tardío a mano (kill()
    // del fake ya no lo dispara solo — ver makeFakeProc) y así ejercer de
    // verdad el guard de onClose/stoppingGen, no solo la asignación directa.
    const proc = h.proc()
    h.helper.stop()
    proc.emit('close', 0)
    assert.strictEqual(h.spawned.length, 1, 'el close del propio stop no debe disparar un respawn')
    assert.strictEqual(h.helper.isRunning(), false)
  })

  test('deja de reintentar tras maxRestarts y avisa una sola vez', () => {
    const h = makeHarness({ maxRestarts: 2 })
    h.helper.start()
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    assert.strictEqual(h.spawned.length, 3, 'arranque + 2 reintentos')
    assert.strictEqual(h.helper.isBroken(), true)
    const avisos = h.logs.filter((m) => /no se pudo mantener|se rinde/i.test(m))
    assert.strictEqual(avisos.length, 1, 'el aviso se emite una vez, no en cada caída')
  })

  test('reset vuelve a permitir arrancar', () => {
    const h = makeHarness({ maxRestarts: 1 })
    h.helper.start()
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    assert.strictEqual(h.helper.isBroken(), true)
    h.helper.reset()
    assert.strictEqual(h.helper.isBroken(), false)
    h.helper.start()
    assert.ok(h.spawned.length >= 3)
  })

  test('un spawn que lanza se degrada sin propagar', () => {
    const events = []
    const helper = createVoiceHelperProcess({
      helperPath: '/fake/voice-helper',
      spawnFn: () => { throw new Error('ENOENT') },
      onEvent: (e) => events.push(e)
    })
    assert.doesNotThrow(() => helper.start())
    assert.strictEqual(helper.isRunning(), false)
    assert.ok(events.some((e) => e.type === 'error' && e.fatal === true))
  })
})

describe('voice-helper-process: blindajes ronda de revisión 1', () => {
  test('un error asíncrono en stdin (pipe roto) no tumba el proceso main', () => {
    // Un write() sobre un pipe ya roto dispara 'error' de forma asíncrona en
    // el stream. Sin listener, Node lo trata como excepción no capturada.
    const h = makeHarness()
    h.helper.start()
    assert.doesNotThrow(() => {
      h.proc().stdin.emit('error', new Error('EPIPE'))
    })
    const avisos = h.logs.filter((m) => /stdin/i.test(m))
    assert.strictEqual(avisos.length, 1, 'debe registrar el error de stdin sin propagarlo')
  })

  test('un close tardío del proceso viejo tras stop()+start() no pisa el proceso nuevo (carrera de identidad)', () => {
    const h = makeHarness()
    h.helper.start()
    const oldProc = h.proc()
    h.helper.stop()
    h.helper.start()
    const newProc = h.proc()
    assert.notStrictEqual(oldProc, newProc)

    // El proceso nuevo ya tiene un JSON a medias en su buffer cuando llega
    // el close tardío del viejo (carrera real: en un proceso de verdad el
    // close es asíncrono y puede llegar después de que ya se haya respawneado).
    newProc.stdout.emit('data', Buffer.from('{"type":"par'))

    oldProc.emit('close', 1)

    assert.strictEqual(h.spawned.length, 2, 'el close tardío no debe disparar un respawn extra')
    assert.strictEqual(h.helper.isRunning(), true, 'el proceso nuevo debe seguir vivo')
    assert.strictEqual(h.helper.send({ cmd: 'ping' }), true)
    assert.deepStrictEqual(newProc.written, ['{"cmd":"ping"}\n'], 'el ping debe llegar al proceso nuevo, no a uno espurio')

    // El buffer a medias del proceso nuevo debe seguir intacto pese al close tardío.
    newProc.stdout.emit('data', Buffer.from('tial"}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'partial' }])
  })

  test('un onEvent que lanza no tumba el parseo de las siguientes líneas del chunk', () => {
    const events = []
    let current = null
    const helper = createVoiceHelperProcess({
      helperPath: '/fake/voice-helper',
      spawnFn: () => { current = makeFakeProc(); return current },
      onEvent: (e) => {
        events.push(e)
        if (e.type === 'a') throw new Error('boom consumidor')
      }
    })
    helper.start()
    assert.doesNotThrow(() => {
      current.stdout.emit('data', Buffer.from('{"type":"a"}\n{"type":"b"}\n'))
    })
    assert.deepStrictEqual(events.map((e) => e.type), ['a', 'b'])
  })

  test('un onEvent que lanza al fallar el spawn no propaga (protegido con safeEmit)', () => {
    const helper = createVoiceHelperProcess({
      helperPath: '/fake/voice-helper',
      spawnFn: () => { throw new Error('ENOENT') },
      onEvent: () => { throw new Error('el consumidor también revienta') }
    })
    assert.doesNotThrow(() => helper.start())
    assert.strictEqual(helper.isRunning(), false)
  })
})

describe('voice-helper-process: el binario que no está', () => {
  // spawn() NO lanza con ENOENT/EACCES: emite 'error' asíncrono. Sin comprobar
  // antes, el fallo tarda tres respawns en salir a la luz y mientras tanto el
  // consumidor ya recibió su ok y el botón dice "escuchando" con el micro cerrado.
  test('un binario que no existe se explica con su ruta y cómo arreglarlo', () => {
    const r = checkHelperBinary('/fake/voice-helper', () => { throw errCon('ENOENT') })
    assert.strictEqual(r.ok, false)
    assert.match(r.reason, /falta el helper de voz/i)
    assert.match(r.reason, /\/fake\/voice-helper/)
    assert.match(r.reason, /build:voice-helper/)
  })

  test('un binario sin permiso de ejecución se distingue del que falta', () => {
    const r = checkHelperBinary('/fake/voice-helper', () => { throw errCon('EACCES') })
    assert.strictEqual(r.ok, false)
    assert.match(r.reason, /no es ejecutable/i)
    assert.match(r.reason, /chmod/)
  })

  test('cualquier otro fallo del filesystem también sale con motivo, no en silencio', () => {
    const r = checkHelperBinary('/fake/voice-helper', () => { throw new Error('EIO raro') })
    assert.strictEqual(r.ok, false)
    assert.match(r.reason, /EIO raro/)
  })

  test('sin ruta no se intenta nada', () => {
    assert.strictEqual(checkHelperBinary('').ok, false)
  })

  test('un binario ejecutable pasa', () => {
    assert.deepStrictEqual(checkHelperBinary('/fake/voice-helper', () => {}), { ok: true })
  })

  test('checkBinary del proceso comprueba SU ruta, no otra', () => {
    const h = makeHarness()
    const vistas = []
    assert.strictEqual(h.helper.checkBinary((p) => { vistas.push(p) }).ok, true)
    assert.deepStrictEqual(vistas, ['/fake/voice-helper'])
  })
})

describe('voice-helper-process: blindajes ronda de revisión 2', () => {
  test('un crash real del proceso nuevo tras stop()+start() sí respawnea y avisa (stopping no debe quedar pegado a la generación vieja)', () => {
    const h = makeHarness()
    h.helper.start()
    const oldProc = h.proc()
    h.helper.stop()
    // kill() no cierra síncrono (ver makeFakeProc): el close asíncrono del
    // proceso viejo aún no ha llegado cuando arrancamos el nuevo — la
    // carrera real que dejaba 'stopping' pegado a true.
    h.helper.start()
    const newProc = h.proc()
    assert.notStrictEqual(oldProc, newProc)

    // Close tardío del viejo: se ignora por generación (ronda 1). No debe
    // dejar ningún resto de "estamos parando" para la generación nueva.
    oldProc.emit('close', 1)

    // El proceso NUEVO cae de verdad: nadie pidió stop de esta generación.
    newProc.emit('close', 1)

    assert.strictEqual(h.spawned.length, 3, 'el crash real debe disparar un respawn, no tragárselo en silencio')
    assert.strictEqual(h.helper.isRunning(), true, 'debe quedar vivo tras el respawn')
    const avisos = h.logs.filter((m) => /cayó/i.test(m))
    assert.strictEqual(avisos.length, 1, 'debe avisar del crash real de la generación nueva')
  })
})

describe('voice-helper-process: correcciones del review final', () => {
  test('una caída tras horas de servicio bueno no cuenta para rendirse', () => {
    // El freno existe para cortar un BUCLE de respawn, no para acumular caídas
    // sueltas: sin reiniciar el contador, tres crashes repartidos a lo largo de
    // horas dejan el modo voz muerto hasta reiniciar la app.
    const h = makeHarness({ maxRestarts: 2, stableMs: 10000 })
    h.helper.start()
    for (let i = 0; i < 6; i += 1) {
      h.avanzar(60 * 60 * 1000)
      h.proc().emit('close', 1)
    }
    assert.strictEqual(h.helper.isBroken(), false, 'cada proceso que aguantó de pie borra la cuenta anterior')
    assert.strictEqual(h.helper.isRunning(), true)
  })

  test('un helper que SALUDA y muere en el acto sigue rindiéndose: el hello no prueba nada', () => {
    // `hello` sale en el top-level de VoiceHelper.swift, antes de tocar audio ni
    // permisos, y `ready` sale dentro del flujo de permisos: los dos llegan ANTES
    // de openMic(), que es donde revienta el crash típico (installTap tras
    // setVoiceProcessingEnabled). Resetear la cuenta con cualquiera de los dos
    // hace el bucle infinito: saluda, reinicia, muere, repite — sin llegar nunca
    // a MAX, sin `broken`, sin error fatal, con el botón en "escuchando" para
    // siempre y respawneando a varios procesos por segundo.
    const h = makeHarness({ maxRestarts: 2, stableMs: 10000 })
    h.helper.start()
    for (let i = 0; i < 3; i += 1) {
      h.proc().stdout.emit('data', Buffer.from('{"type":"hello","pid":1}\n'))
      h.avanzar(20)
      h.proc().emit('close', 1)
    }
    assert.strictEqual(h.helper.isBroken(), true, 'el bucle tiene que cortarse pese a los saludos')
    assert.strictEqual(h.spawned.length, 3, 'arranque + 2 reintentos, y para')
    assert.ok(h.events.some((e) => e.type === 'error' && e.fatal === true), 'y sube el fatal que apaga el modo voz')
  })

  test('un helper que llega a `ready` y muere tampoco desarma el freno', () => {
    const h = makeHarness({ maxRestarts: 2, stableMs: 10000 })
    h.helper.start()
    for (let i = 0; i < 3; i += 1) {
      h.proc().stdout.emit('data', Buffer.from('{"type":"hello"}\n{"type":"ready","locale":"es-ES"}\n'))
      h.avanzar(120)
      h.proc().emit('close', 1)
    }
    assert.strictEqual(h.helper.isBroken(), true)
  })

  test('un bucle de respawn rápido se corta', () => {
    const h = makeHarness({ maxRestarts: 2, stableMs: 10000 })
    h.helper.start()
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    assert.strictEqual(h.helper.isBroken(), true)
  })

  test('aguantar de pie no da barra libre: tras el reset se vuelve a contar desde cero', () => {
    const h = makeHarness({ maxRestarts: 2, stableMs: 10000 })
    h.helper.start()
    h.avanzar(60 * 60 * 1000)
    h.proc().emit('close', 1)   // incidente aislado: la cuenta se borra y sube a 1
    h.proc().emit('close', 1)   // ya en bucle: 2
    h.proc().emit('close', 1)   // 2 >= MAX
    assert.strictEqual(h.helper.isBroken(), true)
  })

  test('stop() le da una vuelta de reloj al quit antes del SIGTERM', () => {
    // Mandar `quit` y matar en la misma vuelta es mandar solo SIGTERM: el helper
    // no ha llegado a leer su stdin y el motor de audio queda sin cerrar.
    const h = makeHarness()
    h.helper.start()
    const proc = h.proc()
    h.helper.stop()
    assert.deepStrictEqual(proc.written, ['{"cmd":"quit"}\n'])
    assert.strictEqual(proc.killed, false, 'todavía no: se le deja procesar el quit')
    h.fireTimers()
    assert.strictEqual(proc.killed, true, 'si no salió solo, el kill sigue de red de seguridad')
  })

  test('si sale solo tras el quit, el kill de respaldo se cancela', () => {
    const h = makeHarness()
    h.helper.start()
    const proc = h.proc()
    h.helper.stop()
    proc.emit('close', 0)
    assert.strictEqual(h.liveTimers(), 0, 'no queda un temporizador suelto apuntando a un pid muerto')
    h.fireTimers()
    assert.strictEqual(proc.killed, false)
  })

  test('el kill diferido apunta al proceso que se paró, no al que arrancó después', () => {
    const h = makeHarness()
    h.helper.start()
    const viejo = h.proc()
    h.helper.stop()
    h.helper.start()
    const nuevo = h.proc()
    h.fireTimers()
    assert.strictEqual(viejo.killed, true)
    assert.strictEqual(nuevo.killed, false, 'matar el proceso nuevo dejaría el modo voz sordo')
    assert.strictEqual(h.helper.isRunning(), true)
  })
})
