'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createCodexSessionsIndex } = require('../main/codex-sessions-index')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeRollout(sessionsRoot, { year, month, day, id, cwd, firstUserText = 'hola' }) {
  const dir = path.join(sessionsRoot, year, month, day)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `rollout-${id}.jsonl`)
  const meta = { type: 'session_meta', payload: { id, cwd } }
  const turn = { type: 'user_input', payload: { text: firstUserText } }
  fs.writeFileSync(filePath, JSON.stringify(meta) + '\n' + JSON.stringify(turn) + '\n')
  return filePath
}

function setupFixture() {
  const userDataDir = tmpDir('codex-idx-ud-')
  const sessionsRoot = tmpDir('codex-idx-sr-')
  return { userDataDir, sessionsRoot, cleanup: () => {
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(sessionsRoot, { recursive: true, force: true })
  } }
}

test('isEmpty true cuando no hay JSON ni datos', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  assert.equal(idx.isEmpty(), true)
  cleanup()
})

test('bootstrap escanea árbol y agrupa por cwd', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwdA = '/tmp/proyA-fake'
  const cwdB = '/tmp/proyB-fake'
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'aaa-1', cwd: cwdA, firstUserText: 'primero A' })
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'aaa-2', cwd: cwdA, firstUserText: 'segundo A' })
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '22', id: 'bbb-1', cwd: cwdB })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  const result = await idx.bootstrap()
  assert.equal(result.filesScanned, 3)
  assert.equal(result.byCwdCount, 2)
  const listA = idx.getForCwd(cwdA)
  assert.equal(listA.length, 2)
  assert.ok(listA[0].mtime >= listA[1].mtime, 'orden mtime desc')
  assert.equal(listA[0].path.endsWith('.jsonl'), true)
  assert.ok(['primero A', 'segundo A'].includes(listA[0].preview))
  assert.deepEqual(idx.getForCwd('/no-existe'), [])
  cleanup()
})

test('bootstrap es idempotente', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-idem'
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'idem-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  await idx.bootstrap()
  await idx.bootstrap()
  assert.equal(idx.getForCwd(cwd).length, 1)
  cleanup()
})

test('addOrUpdate inserta entry nueva', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-add'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'add-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  assert.equal(idx.getForCwd(cwd).length, 0)
  const ok = idx.addOrUpdate(file)
  assert.equal(ok, true)
  const list = idx.getForCwd(cwd)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'add-1')
  cleanup()
})

test('addOrUpdate refresca mtime si el archivo cambió', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-up'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'up-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  const mtime1 = idx.getForCwd(cwd)[0].mtime
  // Forzar nuevo mtime
  const future = new Date(Date.now() + 10_000)
  fs.utimesSync(file, future, future)
  idx.addOrUpdate(file)
  const mtime2 = idx.getForCwd(cwd)[0].mtime
  assert.ok(mtime2 > mtime1, `mtime debe actualizarse (${mtime2} > ${mtime1})`)
  cleanup()
})

test('removeByPath borra entry y limpia cwd vacío', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-rm'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'rm-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  assert.equal(idx.getForCwd(cwd).length, 1)
  assert.equal(idx.removeByPath(file), true)
  assert.equal(idx.getForCwd(cwd).length, 0)
  assert.equal(idx.removeByPath(file), false)
  cleanup()
})

test('persistencia entre instancias', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-persist'
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'p-1', cwd })

  const idx1 = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  await idx1.bootstrap()
  assert.equal(idx1.getForCwd(cwd).length, 1)

  const idx2 = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  // Sin volver a hacer bootstrap, debe leer del JSON.
  assert.equal(idx2.isEmpty(), false)
  const list = idx2.getForCwd(cwd)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'p-1')
  cleanup()
})

test('archivo de índice corrupto se trata como vacío', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  fs.writeFileSync(path.join(userDataDir, 'codex-sessions-index.json'), '{not valid json')
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  assert.equal(idx.isEmpty(), true)
  assert.deepEqual(idx.getForCwd('/cualquier'), [])
  cleanup()
})

test('rollout sin session_meta válido se ignora', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const dir = path.join(sessionsRoot, '2026', '05', '23')
  fs.mkdirSync(dir, { recursive: true })
  const bad = path.join(dir, 'rollout-bad.jsonl')
  fs.writeFileSync(bad, 'no es json valido\n')

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  const ok = idx.addOrUpdate(bad)
  assert.equal(ok, false)
  cleanup()
})

test('addOrUpdate mueve entry si cambia el cwd', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwdA = '/tmp/move-A'
  const cwdB = '/tmp/move-B'
  const dir = path.join(sessionsRoot, '2026', '05', '23')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'rollout-mv-1.jsonl')

  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'mv-1', cwd: cwdA } }) + '\n')
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  assert.equal(idx.getForCwd(cwdA).length, 1)

  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'mv-1', cwd: cwdB } }) + '\n')
  idx.addOrUpdate(file)
  assert.equal(idx.getForCwd(cwdA).length, 0)
  assert.equal(idx.getForCwd(cwdB).length, 1)
  cleanup()
})

test('stopWatcher no lanza si no hay watcher activo', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.stopWatcher()
  assert.ok(true)
  cleanup()
})

// ─── PERF-H1: debounce-global de persist ───────────────────────────────────

test('PERF-H1: 100 addOrUpdate consecutivos = 1 solo write tras flush()', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-debounce'
  const files = []
  for (let i = 0; i < 100; i++) {
    files.push(writeRollout(sessionsRoot, {
      year: '2026', month: '05', day: '23',
      id: `deb-${i}`, cwd, firstUserText: `msg ${i}`
    }))
  }

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  const indexPath = path.join(userDataDir, 'codex-sessions-index.json')

  // Contar writes via mtime del archivo. Antes de la primera escritura, no existe.
  assert.equal(fs.existsSync(indexPath), false)

  // 100 set() consecutivos en el mismo tick.
  for (const f of files) idx.addOrUpdate(f)

  // Sincrónicamente, después del bucle, el archivo NO debe existir aún:
  // está pendiente en el debounce timer (250ms).
  assert.equal(fs.existsSync(indexPath), false, 'persist debounced: no write antes de flush ni del timer')

  // Flush sincrónico → 1 write único.
  idx.flush()
  assert.equal(fs.existsSync(indexPath), true, 'flush() persiste inmediato')

  const stat1 = fs.statSync(indexPath)
  // Si llamamos flush() otra vez sin dirty, no debe reescribir.
  idx.flush()
  const stat2 = fs.statSync(indexPath)
  assert.equal(stat1.mtimeMs, stat2.mtimeMs, 'flush sin dirty no reescribe')

  // Verificar que las 100 entries quedaron persistidas.
  const persisted = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  assert.equal(persisted.byCwd[cwd].length, 100)
  cleanup()
})

test('PERF-H1: removeByPath también respeta debounce y se flushea', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-rm-deb'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'rm-deb-1', cwd })
  const indexPath = path.join(userDataDir, 'codex-sessions-index.json')

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  idx.flush()
  const mtime1 = fs.statSync(indexPath).mtimeMs

  // Pequeña pausa para que mtime pueda diferir.
  const start = Date.now()
  while (Date.now() - start < 10) { /* spin */ }

  idx.removeByPath(file)
  // Aún no escrito.
  const mtimeMid = fs.statSync(indexPath).mtimeMs
  assert.equal(mtimeMid, mtime1, 'remove debounced: no write inmediato')

  idx.flush()
  const persisted = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  assert.equal(persisted.byCwd[cwd], undefined, 'cwd vacío purgado tras flush')
  cleanup()
})

test('PERF-H1: timer debounce persiste sin flush manual tras 250ms', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-timer'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'timer-1', cwd })
  const indexPath = path.join(userDataDir, 'codex-sessions-index.json')

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  assert.equal(fs.existsSync(indexPath), false)

  // Esperar 350ms (>250ms del debounce).
  await new Promise((r) => setTimeout(r, 350))
  assert.equal(fs.existsSync(indexPath), true, 'timer persistió automáticamente')
  const persisted = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  assert.equal(persisted.byCwd[cwd].length, 1)
  cleanup()
})

// ─── PERF-H2: bootstrap async real ─────────────────────────────────────────

test('PERF-H2: bootstrap cede al event loop (otros callbacks corren mientras escanea)', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-yield'
  // Crear suficientes archivos para forzar varios yields (BOOTSTRAP_YIELD_EVERY=50).
  for (let i = 0; i < 150; i++) {
    writeRollout(sessionsRoot, {
      year: '2026', month: '05', day: '23',
      id: `yield-${i}`, cwd, firstUserText: `m${i}`
    })
  }

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })

  // Contador que se incrementa en cada tick del event loop.
  let ticks = 0
  const interval = setInterval(() => { ticks++ }, 1)

  const result = await idx.bootstrap()
  clearInterval(interval)

  assert.equal(result.filesScanned, 150)
  assert.equal(result.byCwdCount, 1)
  // Si bootstrap fuera 100% sync bloquearía el event loop y ticks sería 0 o muy bajo.
  // Con yield real, debería haber al menos algunos ticks. Margen amplio para no flakear en CI.
  assert.ok(ticks >= 1, `event loop debe progresar durante bootstrap (ticks=${ticks})`)
  cleanup()
})

test('PERF-H2: bootstrap devuelve Promise resoluble y persiste resultado', async () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-boot-promise'
  writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'bp-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  const indexPath = path.join(userDataDir, 'codex-sessions-index.json')
  const promise = idx.bootstrap()
  assert.ok(promise && typeof promise.then === 'function', 'bootstrap devuelve Promise')

  // En el mismo tick, todavía no debería haber persistido.
  // (No assert estricto porque con pocos archivos puede terminar muy rápido.)
  const result = await promise
  assert.equal(result.filesScanned, 1)
  // Tras bootstrap, índice persistido inmediato (no debounce).
  assert.equal(fs.existsSync(indexPath), true)
  cleanup()
})

test('PERF-H2: bootstrap con sessionsRoot inexistente resuelve vacío', async () => {
  const { userDataDir, cleanup } = setupFixture()
  const fakeRoot = path.join(os.tmpdir(), `codex-idx-noexiste-${Date.now()}`)
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot: fakeRoot })
  const result = await idx.bootstrap()
  assert.equal(result.filesScanned, 0)
  assert.equal(result.byCwdCount, 0)
  cleanup()
})

// ─── flush() defensivo (before-quit simulado) ──────────────────────────────

test('flush() es idempotente y safe sin estado dirty', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  // Sin haber tocado nada: flush no debe lanzar ni crear archivo.
  idx.flush()
  idx.flush()
  const indexPath = path.join(userDataDir, 'codex-sessions-index.json')
  assert.equal(fs.existsSync(indexPath), false)
  cleanup()
})

test('flush() desde before-quit simulado persiste estado pendiente', () => {
  const { userDataDir, sessionsRoot, cleanup } = setupFixture()
  const cwd = '/tmp/proy-before-quit'
  const file = writeRollout(sessionsRoot, { year: '2026', month: '05', day: '23', id: 'bq-1', cwd })

  const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot })
  idx.addOrUpdate(file)
  // Simular before-quit: persistir pendiente sin esperar al timer.
  idx.flush()
  const indexPath = path.join(userDataDir, 'codex-sessions-index.json')
  const persisted = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  assert.equal(persisted.byCwd[cwd].length, 1)
  assert.equal(persisted.byCwd[cwd][0].id, 'bq-1')
  cleanup()
})
