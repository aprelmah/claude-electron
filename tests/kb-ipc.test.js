'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { registerKbIpc } = require('../main/kb-ipc')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function initRepo(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
}

function gitLogMessages(dir) {
  return execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString('utf-8').trim().split('\n').filter(Boolean)
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

test('kb:toggle comitea automáticamente el CLAUDE.md cuando el proyecto es un repo git', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  initRepo(project)
  fs.mkdirSync(path.join(project, 'kb', 'fichas'), { recursive: true })
  fs.writeFileSync(path.join(project, 'kb', 'fichas', 'a.md'), '# A\n')
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '## Conocimiento precargado\n\n`@kb/fichas/a.md`\n')
  execFileSync('git', ['add', '-A'], { cwd: project })
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: project })

  const result = await ipcMain.invoke('kb:toggle', {}, { cwd: project, relPath: 'kb/fichas/a.md', active: true })

  assert.equal(result.ok, true)
  const messages = gitLogMessages(project)
  assert.equal(messages[0], 'kb: activa kb/fichas/a.md')
})

test('kb:write-ficha comitea automáticamente cuando el proyecto es un repo git', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  initRepo(project)
  const fichaPath = path.join(project, 'kb', 'fichas', 'atajos.md')
  fs.mkdirSync(path.dirname(fichaPath), { recursive: true })
  fs.writeFileSync(fichaPath, '# Atajos\n')
  execFileSync('git', ['add', '-A'], { cwd: project })
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: project })

  const result = await ipcMain.invoke('kb:write-ficha', {}, { cwd: project, relPath: 'kb/fichas/atajos.md', text: '# Atajos\n\n## 1 · Nuevo\n' })

  assert.equal(result.ok, true)
  const messages = gitLogMessages(project)
  assert.equal(messages[0], 'kb: edita kb/fichas/atajos.md')
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
