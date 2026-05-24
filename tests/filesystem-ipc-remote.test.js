'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { registerFilesystemIpc } = require('../main/filesystem-ipc')

// Mock mínimo de ipcMain + safeIpcHandle para capturar handlers y poder
// invocarlos directamente desde el test sin Electron real.
function setupHandlers() {
  const handlers = {}
  const ipcMain = {
    handle: (channel, fn) => { handlers[channel] = fn }
  }
  function safeIpcHandle(channel, fn) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await fn(event, ...args)
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
    })
  }
  registerFilesystemIpc({
    ipcMain,
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    },
    safeIpcHandle,
    winFromEvent: () => null,
    assertSafeFsPath: () => {}, // sandbox NOOP — el test fuerza paths controlados
    markGraphCacheDirtyByPath: () => {}
  })
  return handlers
}

const fakeEvent = { sender: { send: () => {} } }

describe('filesystem-ipc: defensa NAS/SMB', () => {
  test('fs-read-dir sobre /Volumes/inexistente no cuelga y devuelve error claro', async () => {
    const handlers = setupHandlers()
    const remoteFake = '/Volumes/NAS-AUDITORIA-INEXISTENTE-' + Date.now()
    const t0 = Date.now()
    const res = await handlers['fs-read-dir'](fakeEvent, remoteFake)
    const elapsed = Date.now() - t0
    assert.ok(elapsed < 200, `Tardó ${elapsed}ms, debería < 200ms`)
    assert.equal(res.ok, false)
    assert.equal(res.error, 'remote-path-unsupported')
  })

  test('fs-read-dir sobre UNC //host/share no cuelga', async () => {
    const handlers = setupHandlers()
    const t0 = Date.now()
    const res = await handlers['fs-read-dir'](fakeEvent, '//192.168.1.156/share-inexistente')
    const elapsed = Date.now() - t0
    assert.ok(elapsed < 200, `Tardó ${elapsed}ms, debería < 200ms`)
    assert.equal(res.ok, false)
    assert.equal(res.error, 'remote-path-unsupported')
  })

  test('fs-read-dir local funciona normal', async () => {
    const handlers = setupHandlers()
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fsipc-test-'))
    try {
      fs.writeFileSync(path.join(tmpRoot, 'foo.txt'), 'foo')
      fs.mkdirSync(path.join(tmpRoot, 'sub'))
      const res = await handlers['fs-read-dir'](fakeEvent, tmpRoot)
      assert.equal(res.ok, true)
      assert.ok(Array.isArray(res.entries))
      const names = res.entries.map((e) => e.name).sort()
      assert.deepEqual(names, ['foo.txt', 'sub'])
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test('file-info sobre /Volumes/inexistente respeta timeout < 4s', async () => {
    const handlers = setupHandlers()
    const remoteFake = '/Volumes/NAS-AUDITORIA-INEXISTENTE-' + Date.now() + '/foo.bin'
    const t0 = Date.now()
    const res = await handlers['file-info'](fakeEvent, remoteFake)
    const elapsed = Date.now() - t0
    // /Volumes/... inexistente devuelve ENOENT rápido (no hace falta timeout),
    // pero si fuese montaje muerto, garantizamos < 4s.
    assert.ok(elapsed < 4000, `Tardó ${elapsed}ms, debería < 4000ms`)
    assert.equal(res.ok, false)
  })

  test('file-info local funciona normal', async () => {
    const handlers = setupHandlers()
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fsipc-info-'))
    try {
      const fp = path.join(tmpRoot, 'foo.txt')
      fs.writeFileSync(fp, 'hello')
      const res = await handlers['file-info'](fakeEvent, fp)
      assert.equal(res.ok, true)
      assert.equal(res.name, 'foo.txt')
      assert.equal(res.size, 5)
      assert.equal(res.kind, 'text')
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test('file-read sobre /Volumes/inexistente respeta timeout < 4s', async () => {
    const handlers = setupHandlers()
    const remoteFake = '/Volumes/NAS-AUDITORIA-INEXISTENTE-' + Date.now() + '/foo.bin'
    const t0 = Date.now()
    const res = await handlers['file-read'](fakeEvent, remoteFake)
    const elapsed = Date.now() - t0
    assert.ok(elapsed < 4000, `Tardó ${elapsed}ms, debería < 4000ms`)
    assert.equal(res.ok, false)
  })

  test('file-read local txt funciona normal', async () => {
    const handlers = setupHandlers()
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fsipc-read-'))
    try {
      const fp = path.join(tmpRoot, 'hello.txt')
      fs.writeFileSync(fp, 'hola mundo')
      const res = await handlers['file-read'](fakeEvent, fp)
      assert.equal(res.ok, true)
      assert.equal(res.kind, 'text')
      assert.equal(res.text, 'hola mundo')
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
