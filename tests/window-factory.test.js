'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createWindowFactory } = require('../main/window-factory')

function makeFakeBrowserWindowClass(created) {
  return class FakeBrowserWindow {
    constructor(opts) {
      this.opts = opts
      this.destroyed = false
      this.shown = false
      this.minimized = false
      this.focused = false
      this.listeners = {}
      this.loadedFile = null
      created.push(this)
    }
    loadFile(file, opts) { this.loadedFile = { file, opts } }
    once(evt, cb) { if (evt === 'ready-to-show') cb() }
    on(evt, cb) { this.listeners[evt] = cb }
    show() { this.shown = true }
    focus() { this.focused = true }
    restore() { this.minimized = false }
    isMinimized() { return this.minimized }
    isDestroyed() { return this.destroyed }
    getBounds() { return { x: 0, y: 0, width: 1200, height: 800 } }
    destroy() {
      this.destroyed = true
      if (this.listeners.closed) this.listeners.closed()
    }
  }
}

function makeFactory() {
  const created = []
  const FakeBrowserWindow = makeFakeBrowserWindowClass(created)
  const factory = createWindowFactory({
    BrowserWindow: FakeBrowserWindow,
    nativeTheme: { shouldUseDarkColors: false },
    app: { getPath: () => '/tmp/fake-userdata' },
    getPrimaryWin: () => null,
    getRootDir: () => '/fake/root'
  })
  return { factory, created }
}

test('openKnowledgeWindow crea una ventana nueva para un proyecto sin ventana previa', async () => {
  const { factory, created } = makeFactory()
  const win = await factory.openKnowledgeWindow('/tmp/proyecto-a')
  assert.equal(created.length, 1)
  assert.equal(win, created[0])
  assert.equal(win.loadedFile.file, 'kb-window.html')
  assert.equal(win.loadedFile.opts.query.projectDir, '/tmp/proyecto-a')
  assert.equal(win.shown, true)
})

test('openKnowledgeWindow reutiliza y enfoca la ventana existente del mismo proyecto', async () => {
  const { factory, created } = makeFactory()
  const first = await factory.openKnowledgeWindow('/tmp/proyecto-a')
  const second = await factory.openKnowledgeWindow('/tmp/proyecto-a')
  assert.equal(second, first)
  assert.equal(created.length, 1)
  assert.equal(second.focused, true)
})

test('openKnowledgeWindow abre ventanas distintas para proyectos distintos', async () => {
  const { factory, created } = makeFactory()
  const a = await factory.openKnowledgeWindow('/tmp/proyecto-a')
  const b = await factory.openKnowledgeWindow('/tmp/proyecto-b')
  assert.notEqual(a, b)
  assert.equal(created.length, 2)
})

test('getKnowledgeWindow devuelve null tras cerrar la ventana', async () => {
  const { factory } = makeFactory()
  const win = await factory.openKnowledgeWindow('/tmp/proyecto-a')
  assert.equal(factory.getKnowledgeWindow('/tmp/proyecto-a'), win)
  win.destroy()
  assert.equal(factory.getKnowledgeWindow('/tmp/proyecto-a'), null)
})

test('openKnowledgeWindow usa el hint de bounds cuando se pasa', async () => {
  const { factory } = makeFactory()
  const win = await factory.openKnowledgeWindow('/tmp/proyecto-a', { x: 100, y: 50, width: 900, height: 600 })
  assert.equal(win.opts.width, 900 - 12)
  assert.equal(win.opts.height, 600 - 12)
})
