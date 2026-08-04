'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceHelperProcess } = require(path.join(REPO_ROOT, 'main', 'voice-helper-process.js'))

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
  let current = null
  const helper = createVoiceHelperProcess({
    helperPath: '/fake/voice-helper',
    spawnFn: (bin, args, o) => { spawned.push({ bin, args, o }); current = makeFakeProc(); return current },
    onEvent: (e) => events.push(e),
    log: (m) => logs.push(m),
    maxRestarts: opts.maxRestarts
  })
  return { helper, spawned, events, logs, proc: () => current }
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
