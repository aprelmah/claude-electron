// Tests del validador de cron del scheduler.
// `TaskScheduler.validateCron` (scheduler/index.js:48) es método de instancia.
// Lo testeamos instanciando un TaskScheduler con dependencias mínimas mockeadas.
// `validateCron` es puro: no toca persistencia ni timers.

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const TaskScheduler = require(path.join(REPO_ROOT, 'scheduler', 'index.js'))

function makeScheduler() {
  // Dependencias mínimas. `validateCron` no las usa, pero el ctor las exige.
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

describe('TaskScheduler.validateCron', () => {
  const scheduler = makeScheduler()

  describe('expresiones válidas', () => {
    const valid = [
      '* * * * *',          // cada minuto
      '0 * * * *',          // en punto cada hora
      '*/5 * * * *',        // cada 5 min
      '0 9 * * 1-5',        // 9:00 L-V
      '0 0 1 * *',          // día 1 de cada mes
      '30 14 * * 0',        // domingos 14:30
      '0 0 * * *'           // medianoche diaria
    ]
    for (const expr of valid) {
      test(`acepta "${expr}"`, () => {
        const r = scheduler.validateCron(expr)
        assert.strictEqual(r.ok, true, `${expr} debería ser válida`)
        assert.ok(Array.isArray(r.nextRunsPreview), 'devuelve preview de próximas ejecuciones')
      })
    }
  })

  describe('preview de próximas ejecuciones', () => {
    test('devuelve 3 entradas ISO 8601 para una expresión válida', () => {
      const r = scheduler.validateCron('*/15 * * * *')
      assert.strictEqual(r.ok, true)
      assert.strictEqual(r.nextRunsPreview.length, 3)
      for (const iso of r.nextRunsPreview) {
        assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'formato ISO 8601')
      }
    })

    test('las previsiones están en orden ascendente', () => {
      const r = scheduler.validateCron('0 * * * *')
      const times = r.nextRunsPreview.map((s) => new Date(s).getTime())
      assert.ok(times[0] < times[1] && times[1] < times[2], 'orden cronológico')
    })
  })

  describe('expresiones inválidas', () => {
    const invalid = [
      'sesenta * * * *',    // texto no numérico
      '60 * * * *',         // minuto fuera de rango (0-59)
      '* 25 * * *',         // hora fuera de rango (0-23)
      '* * 32 * *',         // día fuera de rango (1-31)
      '* * * 13 *',         // mes fuera de rango (1-12)
      'abc',                // basura
      '* * *'               // pocos campos
    ]
    for (const expr of invalid) {
      test(`rechaza "${expr}"`, () => {
        const r = scheduler.validateCron(expr)
        assert.strictEqual(r.ok, false, `${expr} debería ser inválida`)
        assert.ok(typeof r.error === 'string' && r.error.length > 0, 'incluye mensaje de error')
      })
    }
  })

  describe('entradas no string', () => {
    const cases = [
      ['', 'string vacío'],
      ['   ', 'solo whitespace'],
      [null, 'null'],
      [undefined, 'undefined'],
      [123, 'number'],
      [{}, 'objeto']
    ]
    for (const [input, label] of cases) {
      test(`rechaza ${label}`, () => {
        const r = scheduler.validateCron(input)
        assert.strictEqual(r.ok, false)
        assert.ok(typeof r.error === 'string' && r.error.length > 0)
      })
    }
  })

  test('no muta el input ni el estado del scheduler', () => {
    const expr = '*/5 * * * *'
    const before = scheduler.jobs.size
    scheduler.validateCron(expr)
    scheduler.validateCron(expr)
    assert.strictEqual(scheduler.jobs.size, before, 'validateCron no debe programar jobs')
  })
})
