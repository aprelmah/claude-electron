'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { registerKbIpc } = require('../main/kb-ipc')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, event, args) => handlers.get(channel)(event, args)
  }
}

function makeDeps(overrides = {}) {
  const ipcMain = makeIpcMain()
  const userDataDir = tmpDir('kb-ipc-userdata-')
  registerKbIpc({
    ipcMain,
    shell: { trashItem: async () => {}, showItemInFolder: () => {} },
    getDefaultCwd: () => os.homedir(),
    runClaudeHeadless: async () => ({ text: '{}' }),
    getModel: () => 'test-model',
    getUserDataDir: () => userDataDir,
    transcribeAudioFile: async () => '',
    buildRuntimeEnv: () => ({}),
    sendPromptToSession: overrides.sendPromptToSession || (async () => {}),
    openKnowledgeWindow: overrides.openKnowledgeWindow || (async () => {}),
    log: () => {}
  })
  return { ipcMain }
}

test('kb:edit-apply reemplaza el fragmento cuando aparece una sola vez', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  const fichaPath = path.join(project, 'kb', 'fichas', 'manual.md')
  fs.mkdirSync(path.dirname(fichaPath), { recursive: true })
  fs.writeFileSync(fichaPath, '# Manual\n\nVoltaje: 220 V.\n')

  const result = await ipcMain.invoke('kb:edit-apply', {}, {
    cwd: project, relPath: 'kb/fichas/manual.md', find: 'Voltaje: 220 V.', replace: 'Voltaje: 230 V.'
  })

  assert.equal(result.ok, true)
  assert.equal(fs.readFileSync(fichaPath, 'utf-8'), '# Manual\n\nVoltaje: 230 V.\n')
})

test('kb:edit-apply rechaza rutas fuera de kb/fichas/', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# X\n')

  const result = await ipcMain.invoke('kb:edit-apply', {}, {
    cwd: project, relPath: 'CLAUDE.md', find: 'X', replace: 'Y'
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /kb\/fichas/)
  assert.equal(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf-8'), '# X\n')
})

test('kb:edit-apply rechaza si el fragmento no aparece o aparece más de una vez', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  const fichaPath = path.join(project, 'kb', 'fichas', 'manual.md')
  fs.mkdirSync(path.dirname(fichaPath), { recursive: true })
  fs.writeFileSync(fichaPath, '220 V y otra vez 220 V.\n')

  const noMatch = await ipcMain.invoke('kb:edit-apply', {}, {
    cwd: project, relPath: 'kb/fichas/manual.md', find: '110 V', replace: '230 V'
  })
  assert.equal(noMatch.ok, false)

  const ambiguous = await ipcMain.invoke('kb:edit-apply', {}, {
    cwd: project, relPath: 'kb/fichas/manual.md', find: '220 V', replace: '230 V'
  })
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.error, /más de una vez/)
})

test('kb:read-ficha y kb:write-ficha operan solo dentro de kb/fichas/', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  const fichaPath = path.join(project, 'kb', 'fichas', 'atajos.md')
  fs.mkdirSync(path.dirname(fichaPath), { recursive: true })
  fs.writeFileSync(fichaPath, '# Atajos\n')

  const read = await ipcMain.invoke('kb:read-ficha', {}, { cwd: project, relPath: 'kb/fichas/atajos.md' })
  assert.equal(read.ok, true)
  assert.equal(read.text, '# Atajos\n')

  const write = await ipcMain.invoke('kb:write-ficha', {}, { cwd: project, relPath: 'kb/fichas/atajos.md', text: '# Atajos\n\n## 1 · Nuevo\n' })
  assert.equal(write.ok, true)
  assert.equal(fs.readFileSync(fichaPath, 'utf-8'), '# Atajos\n\n## 1 · Nuevo\n')

  const blocked = await ipcMain.invoke('kb:write-ficha', {}, { cwd: project, relPath: 'CLAUDE.md', text: 'hackeado' })
  assert.equal(blocked.ok, false)
  assert.equal(fs.existsSync(path.join(project, 'CLAUDE.md')), false)
})

test('kb:open-window delega en openKnowledgeWindow con el projectDir resuelto', async () => {
  const calls = []
  const { ipcMain } = makeDeps({ openKnowledgeWindow: async (projectDir, hint) => { calls.push({ projectDir, hint }) } })
  const project = tmpDir('kb-ipc-project-')

  const result = await ipcMain.invoke('kb:open-window', {}, { cwd: project, hint: { x: 1, y: 2, width: 300, height: 400 } })

  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].projectDir, project)
  assert.deepEqual(calls[0].hint, { x: 1, y: 2, width: 300, height: 400 })
})

test('kb:apply-to-session pasa projectDir (no el event) a sendPromptToSession', async () => {
  const calls = []
  const { ipcMain } = makeDeps({ sendPromptToSession: async (projectDir, text) => { calls.push({ projectDir, text }) } })
  const project = tmpDir('kb-ipc-project-')
  const fichaPath = path.join(project, 'kb', 'fichas', 'a.md')
  fs.mkdirSync(path.dirname(fichaPath), { recursive: true })
  fs.writeFileSync(fichaPath, 'contenido')

  const result = await ipcMain.invoke('kb:apply-to-session', {}, { cwd: project, relPaths: ['kb/fichas/a.md'] })

  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].projectDir, project)
})
