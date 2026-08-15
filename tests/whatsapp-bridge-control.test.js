'use strict'

// La escalera bootout→bootstrap→kickstart del bridge de WhatsApp vivía dentro
// de ipcMain.handle('whatsapp:bridge-control') y la suite corre sin Electron:
// nadie la cubría. Extraída a main/whatsapp-bridge-control.js con `exec`
// inyectado, aquí se prueba la matriz completa: acciones, fallos benignos
// ("no such process", "already loaded"...) y fallos reales.

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  BRIDGE_CONTROL_ACTIONS,
  normalizeBridgeAction,
  isBenignBootoutFailure,
  isBenignBootstrapFailure,
  runBridgeControl
} = require('../main/whatsapp-bridge-control')

const DOMAIN = 'gui/501'
const LABEL = 'com.luismi.whatsapp-bridge'
const TARGET = `${DOMAIN}/${LABEL}`
const PLIST = `/Users/x/Library/LaunchAgents/${LABEL}.plist`

function okRun(extra = {}) {
  return { ok: true, status: 0, stdout: '', stderr: '', error: '', ...extra }
}

function failRun(stderr = '', extra = {}) {
  return { ok: false, status: 1, stdout: '', stderr, error: '', ...extra }
}

// exec falso: devuelve los resultados en orden y registra cada llamada.
function makeExec(results) {
  const calls = []
  const exec = (args) => {
    calls.push(args)
    if (calls.length > results.length) {
      throw new Error(`exec llamado ${calls.length} veces, solo hay ${results.length} resultados`)
    }
    return results[calls.length - 1]
  }
  return { exec, calls }
}

function run(action, results, hooks = {}) {
  const { exec, calls } = makeExec(results)
  const events = []
  const op = runBridgeControl({
    action,
    exec: (args) => { events.push(`exec:${args.join(' ')}`); return exec(args) },
    domain: DOMAIN,
    serviceTarget: TARGET,
    plistPath: PLIST,
    stopClient: hooks.stopClient || (() => events.push('stopClient')),
    startClient: hooks.startClient || (() => events.push('startClient'))
  })
  return { op, calls, events }
}

// ── Normalización de la acción ──

test('normalizeBridgeAction acepta start/stop/restart con trim y case-insensitive', () => {
  assert.equal(normalizeBridgeAction('start'), 'start')
  assert.equal(normalizeBridgeAction('stop'), 'stop')
  assert.equal(normalizeBridgeAction('restart'), 'restart')
  assert.equal(normalizeBridgeAction('  ReStart '), 'restart')
  assert.deepEqual(BRIDGE_CONTROL_ACTIONS, ['start', 'stop', 'restart'])
})

test('normalizeBridgeAction rechaza acciones desconocidas o vacías', () => {
  assert.equal(normalizeBridgeAction('kill'), null)
  assert.equal(normalizeBridgeAction(''), null)
  assert.equal(normalizeBridgeAction(null), null)
  assert.equal(normalizeBridgeAction(undefined), null)
  assert.equal(normalizeBridgeAction(42), null)
})

// ── Clasificación de fallos ──

test('bootout benigno: el servicio no estaba cargado', () => {
  assert.equal(isBenignBootoutFailure('Boot-out failed: 3: No such process'), true)
  assert.equal(isBenignBootoutFailure('Could not find service "x" in domain'), true)
  assert.equal(isBenignBootoutFailure('Service is not loaded'), true)
})

test('bootout real: cualquier otro fallo NO es benigno', () => {
  assert.equal(isBenignBootoutFailure('Boot-out failed: 1: Operation not permitted'), false)
  assert.equal(isBenignBootoutFailure(''), false)
  assert.equal(isBenignBootoutFailure(null), false)
})

test('bootstrap benigno: ya cargado, en curso o el I/O error tipico de launchd', () => {
  assert.equal(isBenignBootstrapFailure('Bootstrap failed: 5: Input/output error'), true)
  assert.equal(isBenignBootstrapFailure('service already loaded'), true)
  assert.equal(isBenignBootstrapFailure('Bootstrap already in progress'), true)
})

test('bootstrap real: cualquier otro fallo NO es benigno', () => {
  assert.equal(isBenignBootstrapFailure('Bootstrap failed: 125: Unknown error'), false)
  assert.equal(isBenignBootstrapFailure(''), false)
})

// ── stop ──

test('stop: bootout por label OK → un solo comando', () => {
  const { op, calls, events } = run('stop', [okRun()])
  assert.deepEqual(op, { ok: true, step: 'bootout-label', run: okRun() })
  assert.deepEqual(calls, [['bootout', TARGET]])
  // El cliente se para ANTES de tumbar el servicio.
  assert.deepEqual(events, ['stopClient', `exec:bootout ${TARGET}`])
})

test('stop: fallo benigno por label → ok sin escalar al plist', () => {
  const byLabel = failRun('Boot-out failed: 3: No such process')
  const { op, calls } = run('stop', [byLabel])
  assert.deepEqual(op, { ok: true, step: 'bootout-label-benign', run: byLabel })
  assert.equal(calls.length, 1)
})

test('stop: fallo real por label escala a bootout por plist', () => {
  const byPlist = okRun({ stdout: 'done' })
  const { op, calls } = run('stop', [failRun('Operation not permitted'), byPlist])
  assert.deepEqual(op, { ok: true, step: 'bootout-plist', run: byPlist })
  assert.deepEqual(calls, [['bootout', TARGET], ['bootout', DOMAIN, PLIST]])
})

test('stop: fallo real por label + benigno por plist → ok', () => {
  const byPlist = failRun('Could not find service')
  const { op } = run('stop', [failRun('Operation not permitted'), byPlist])
  assert.deepEqual(op, { ok: true, step: 'bootout-plist-benign', run: byPlist })
})

test('stop: dos fallos reales → error con el mensaje del plist', () => {
  const byPlist = failRun('Boot-out failed: 1: Operation not permitted')
  const { op } = run('stop', [failRun('permiso denegado'), byPlist])
  assert.deepEqual(op, {
    ok: false,
    step: 'bootout-failed',
    run: byPlist,
    error: 'Boot-out failed: 1: Operation not permitted'
  })
})

test('stop: si el fallo del plist no trae mensaje, cae al del label; sin ninguno, al generico', () => {
  const conMsg1 = run('stop', [failRun('permiso denegado'), failRun('')])
  assert.equal(conMsg1.op.error, 'permiso denegado')
  const sinMsgs = run('stop', [failRun(''), failRun('')])
  assert.equal(sinMsgs.op.error, 'bootout failed')
})

test('stop: el mensaje combina error de spawn y stderr para clasificar', () => {
  // launchctl puede fallar sin stderr (error de spawn): tambien clasifica.
  const byLabel = failRun('', { error: 'no such process' })
  const { op } = run('stop', [byLabel])
  assert.equal(op.step, 'bootout-label-benign')
})

test('stop: un stopClient que revienta no rompe la escalera', () => {
  const { op } = run('stop', [okRun()], { stopClient: () => { throw new Error('boom') } })
  assert.equal(op.ok, true)
  assert.equal(op.step, 'bootout-label')
})

// ── start ──

test('start: bootstrap + kickstart OK → arranca el cliente al final', () => {
  const kick = okRun({ stdout: 'kicked' })
  const { op, calls, events } = run('start', [okRun(), kick])
  assert.deepEqual(op, { ok: true, step: 'kickstart', run: kick })
  assert.deepEqual(calls, [['bootstrap', DOMAIN, PLIST], ['kickstart', '-k', TARGET]])
  assert.equal(events[events.length - 1], 'startClient')
})

test('start: bootstrap benigno (already loaded) sigue al kickstart igual', () => {
  const { op, calls } = run('start', [failRun('service already loaded'), okRun()])
  assert.equal(op.ok, true)
  assert.equal(op.step, 'kickstart')
  assert.equal(calls.length, 2)
})

test('start: bootstrap con Input/output error tambien es benigno', () => {
  const { op } = run('start', [failRun('Bootstrap failed: 5: Input/output error'), okRun()])
  assert.equal(op.ok, true)
})

test('start: fallo real de bootstrap corta sin kickstart ni cliente', () => {
  const boot = failRun('Bootstrap failed: 125: Unknown error')
  const { op, calls, events } = run('start', [boot])
  assert.deepEqual(op, {
    ok: false,
    step: 'bootstrap-failed',
    run: boot,
    error: 'Bootstrap failed: 125: Unknown error'
  })
  assert.equal(calls.length, 1)
  assert.equal(events.includes('startClient'), false)
})

test('start: fallo de kickstart → error sin arrancar el cliente', () => {
  const kick = failRun('could not kickstart')
  const { op, events } = run('start', [okRun(), kick])
  assert.deepEqual(op, { ok: false, step: 'kickstart-failed', run: kick, error: 'could not kickstart' })
  assert.equal(events.includes('startClient'), false)
})

test('start: kickstart fallido sin mensaje cae al error generico', () => {
  const { op } = run('start', [okRun(), failRun('')])
  assert.equal(op.error, 'kickstart failed')
})

test('start: un startClient que revienta no convierte el exito en fallo', () => {
  const { op } = run('start', [okRun(), okRun()], { startClient: () => { throw new Error('boom') } })
  assert.equal(op.ok, true)
})

// ── restart ──

test('restart: para, arranca y reporta el paso final', () => {
  const { op, calls, events } = run('restart', [okRun(), okRun(), okRun()])
  assert.equal(op.ok, true)
  assert.equal(op.step, 'kickstart')
  assert.deepEqual(calls, [
    ['bootout', TARGET],
    ['bootstrap', DOMAIN, PLIST],
    ['kickstart', '-k', TARGET]
  ])
  assert.equal(events[0], 'stopClient')
  assert.equal(events[events.length - 1], 'startClient')
})

test('restart: con el servicio sin cargar (benigno) arranca igual', () => {
  const { op, calls } = run('restart', [failRun('No such process'), okRun(), okRun()])
  assert.equal(op.ok, true)
  assert.equal(op.step, 'kickstart')
  assert.equal(calls.length, 3)
})

test('restart: si el stop falla de verdad, no intenta arrancar', () => {
  const { op, calls } = run('restart', [failRun('permiso denegado'), failRun('otro fallo real')])
  assert.equal(op.ok, false)
  assert.equal(op.step, 'bootout-failed')
  // Solo los dos bootout: ni bootstrap ni kickstart.
  assert.deepEqual(calls, [['bootout', TARGET], ['bootout', DOMAIN, PLIST]])
})
