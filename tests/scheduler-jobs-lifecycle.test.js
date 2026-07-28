// tests/scheduler-jobs-lifecycle.test.js
// Ciclo de vida de los jobs de node-cron dentro del TaskScheduler: programar,
// reprogramar, parar y disparar de verdad. Es la red de seguridad del salto
// node-cron 3 -> 4, donde `schedule()` cambió de opciones y `stop()` puede
// devolver una promesa.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const TaskScheduler = require(path.join(REPO_ROOT, 'scheduler', 'index.js'))

function makeScheduler() {
  return new TaskScheduler({
    executor: async () => ({ ok: true }),
    persistence: {
      loadTasks: async () => [],
      getTask: async () => null,
      updateTask: async () => {},
      saveTask: async () => {},
      deleteTask: async () => {},
      appendRun: async () => {}
    },
    sinks: {},
    broadcast: () => {}
  })
}

describe('TaskScheduler: ciclo de vida de los jobs', () => {
  test('_schedule registra el job y expone stop()', () => {
    const s = makeScheduler()
    s._schedule({ id: 't1', cron: '0 21 * * *', enabled: true })
    assert.strictEqual(s.jobs.size, 1)
    assert.strictEqual(typeof s.jobs.get('t1').stop, 'function')
    s.destroy()
  })

  test('reprogramar la misma tarea reemplaza el job sin duplicar', () => {
    const s = makeScheduler()
    s._schedule({ id: 't1', cron: '0 21 * * *', enabled: true })
    const primero = s.jobs.get('t1')
    s._schedule({ id: 't1', cron: '0 9 * * *', enabled: true })
    assert.strictEqual(s.jobs.size, 1, 'sigue habiendo un solo job')
    assert.notStrictEqual(s.jobs.get('t1'), primero, 'el job se sustituyó')
    s.destroy()
  })

  test('una expresión inválida no programa nada', () => {
    const s = makeScheduler()
    s._schedule({ id: 't1', cron: '60 * * * *', enabled: true })
    assert.strictEqual(s.jobs.size, 0)
  })

  test('destroy vacía el registro de jobs', () => {
    const s = makeScheduler()
    s._schedule({ id: 't1', cron: '0 21 * * *', enabled: true })
    s._schedule({ id: 't2', cron: '0 9 * * *', enabled: true })
    assert.strictEqual(s.jobs.size, 2)
    s.destroy()
    assert.strictEqual(s.jobs.size, 0)
  })

  test('el job dispara de verdad al cumplirse la expresión', async () => {
    const s = makeScheduler()
    let disparos = 0
    s.runNow = async () => { disparos++ }
    // Cada segundo: la expresión de 6 campos vale igual en node-cron 3 y 4.
    s._schedule({ id: 'tick', cron: '* * * * * *', enabled: true })
    await new Promise((r) => setTimeout(r, 2200))
    s.destroy()
    assert.ok(disparos >= 1, `el callback debería haber corrido al menos una vez (corrió ${disparos})`)
  })

  test('tras destroy el job deja de disparar', async () => {
    const s = makeScheduler()
    let disparos = 0
    s.runNow = async () => { disparos++ }
    s._schedule({ id: 'tick', cron: '* * * * * *', enabled: true })
    await new Promise((r) => setTimeout(r, 1200))
    s.destroy()
    const trasParar = disparos
    await new Promise((r) => setTimeout(r, 2200))
    assert.strictEqual(disparos, trasParar, 'no debe dispararse tras destroy')
  })
})
