const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createSemanticLogger } = require(path.join(__dirname, '..', 'main', 'semantic-logger.js'))

function makeTempLogPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-bitacora-'))
  return {
    dir,
    filePath: path.join(dir, 'semantic-log.jsonl')
  }
}

describe('semantic-logger (normalización y lectura)', () => {
  test('normaliza evento de auditoría empresa en log()', () => {
    const { dir, filePath } = makeTempLogPath()
    try {
      const logger = createSemanticLogger({ filePath })
      const result = logger.log({
        ts: 1710000000000,
        action: ' empresa_login_operador ',
        detail: 'línea 1\nlínea 2',
        session: ' sesion-01 ',
        cli: 'otro-cli',
        ok: false
      })
      assert.strictEqual(result.ok, true)
      assert.strictEqual(result.event.ts, 1710000000000)
      assert.strictEqual(result.event.action, 'empresa_login_operador')
      assert.strictEqual(result.event.detail, 'línea 1 línea 2')
      assert.strictEqual(result.event.session, 'sesion-01')
      assert.strictEqual(result.event.cli, 'claude')
      assert.strictEqual(result.event.ok, false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('respeta codex como valor CLI permitido', () => {
    const { dir, filePath } = makeTempLogPath()
    try {
      const logger = createSemanticLogger({ filePath })
      const result = logger.log({ action: 'empresa_mcp_policy_aplicada', cli: 'codex' })
      assert.strictEqual(result.ok, true)
      assert.strictEqual(result.event.cli, 'codex')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('recorta action/detail/session a longitudes máximas', () => {
    const { dir, filePath } = makeTempLogPath()
    try {
      const logger = createSemanticLogger({ filePath })
      const result = logger.log({
        action: `a${'x'.repeat(200)}`,
        detail: `d${'y'.repeat(5000)}`,
        session: `s${'z'.repeat(300)}`
      })
      assert.strictEqual(result.ok, true)
      assert.ok(result.event.action.length <= 80)
      assert.ok(result.event.detail.length <= 4000)
      assert.ok(result.event.session.length <= 128)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('readRecent devuelve en orden inverso (más nuevo primero) y aplica limit', () => {
    const { dir, filePath } = makeTempLogPath()
    try {
      const logger = createSemanticLogger({ filePath })
      logger.log({ ts: 1000, action: 'empresa_sesion_iniciada', detail: '1' })
      logger.log({ ts: 2000, action: 'empresa_perfil_aplicado', detail: '2' })
      logger.log({ ts: 3000, action: 'empresa_persona_aplicada', detail: '3' })

      const events = logger.readRecent({ limit: 2 })
      assert.strictEqual(events.length, 2)
      assert.strictEqual(events[0].ts, 3000)
      assert.strictEqual(events[1].ts, 2000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('toCsv escapa comillas y comas correctamente', () => {
    const { dir, filePath } = makeTempLogPath()
    try {
      const logger = createSemanticLogger({ filePath })
      const csv = logger.toCsv([{
        ts: 1000,
        session: 'sess-1',
        cli: 'claude',
        action: 'empresa_permiso_denegado_fs',
        detail: 'ruta="/tmp,a.txt"',
        ok: true
      }])
      assert.ok(csv.startsWith('ts,hora,session,cli,action,detail,ok\n'))
      assert.ok(csv.includes('"ruta=""/tmp,a.txt"""'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
