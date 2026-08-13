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
  const logs = []
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
    log: (...args) => logs.push(args.join(' '))
  })
  return { ipcMain, logs }
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

// Un borrado que el usuario da por hecho y que git no llegó a registrar es el
// bug entero: si el commit falla, tiene que verse (aviso al panel + log).
test('kb:remove avisa cuando el borrado no se pudo commitear, en vez de callar', async () => {
  const { ipcMain, logs } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  initRepo(project)
  fs.mkdirSync(path.join(project, 'kb', 'fichas'), { recursive: true })
  fs.writeFileSync(path.join(project, 'kb', 'fichas', 'a.md'), '# A\n')
  fs.writeFileSync(project + '/CLAUDE.md', '## Conocimiento precargado\n\n@kb/fichas/a.md\n')
  execFileSync('git', ['add', '-A'], { cwd: project })
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: project })
  fs.writeFileSync(path.join(project, '.git', 'index.lock'), '')

  const result = await ipcMain.invoke('kb:remove', {}, { cwd: project, relPath: 'kb/fichas/a.md', deleteFile: true })

  assert.equal(result.ok, true, 'la ficha sí se quitó del disco: la operación no se deshace')
  assert.ok(result.commitWarning, 'la respuesta debe avisar de que no quedó registrado en git')
  assert.ok(logs.some((l) => /kb-git|commit/i.test(l)), 'y dejar rastro en el log')
})

test('kb:remove sin incidencias no mete ruido de aviso en la respuesta', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  initRepo(project)
  fs.mkdirSync(path.join(project, 'kb', 'fichas'), { recursive: true })
  fs.writeFileSync(path.join(project, 'kb', 'fichas', 'a.md'), '# A\n')
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '## Conocimiento precargado\n\n@kb/fichas/a.md\n')
  execFileSync('git', ['add', '-A'], { cwd: project })
  execFileSync('git', ['commit', '-q', '-m', 'inicial'], { cwd: project })

  const result = await ipcMain.invoke('kb:remove', {}, { cwd: project, relPath: 'kb/fichas/a.md', deleteFile: true })

  assert.equal(result.ok, true)
  assert.equal(result.commitWarning, undefined)
  assert.equal(gitLogMessages(project)[0], 'kb: quita kb/fichas/a.md')
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

test('kb:update-shortcut edita título y cuerpo, y comitea', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  initRepo(project)
  const addResult = await ipcMain.invoke('kb:add-shortcut', {}, { cwd: project, title: 'Original', body: 'Cuerpo original.', related: [] })
  assert.equal(addResult.ok, true) // kb:add-shortcut ya comitea; no hace falta un commit "inicial" aparte

  const result = await ipcMain.invoke('kb:update-shortcut', {}, { cwd: project, id: 1, title: 'Editado', body: 'Cuerpo editado.' })

  assert.equal(result.ok, true)
  assert.equal(result.num, 1)
  assert.equal(result.relPath, path.join('kb', 'fichas', 'atajos.md'))
  const text = fs.readFileSync(path.join(project, 'kb', 'fichas', 'atajos.md'), 'utf-8')
  assert.ok(text.includes('## 1 · Editado'))
  assert.ok(text.includes('Cuerpo editado.'))
  const messages = gitLogMessages(project)
  assert.equal(messages[0], 'kb: edita caso 1 · Editado')
})

test('kb:update-shortcut rechaza cwd inválido y related fuera del proyecto', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  initRepo(project)
  await ipcMain.invoke('kb:add-shortcut', {}, { cwd: project, title: 'Original', body: 'Cuerpo original.' })

  const badCwd = await ipcMain.invoke('kb:update-shortcut', {}, { cwd: 'no-es-absoluto', id: 1, title: 'x', body: 'y' })
  assert.equal(badCwd.ok, false)

  const before = fs.readFileSync(path.join(project, 'kb', 'fichas', 'atajos.md'), 'utf-8')
  const traversal = await ipcMain.invoke('kb:update-shortcut', {}, {
    cwd: project,
    id: 1,
    title: 'x',
    body: 'y',
    related: ['../../etc/passwd']
  })
  assert.equal(traversal.ok, false)
  assert.match(traversal.error, /fuera del proyecto/)
  assert.equal(fs.readFileSync(path.join(project, 'kb', 'fichas', 'atajos.md'), 'utf-8'), before)
})

test('kb:delete-shortcut borra la entrada y comitea', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  initRepo(project)
  await ipcMain.invoke('kb:add-shortcut', {}, { cwd: project, title: 'Uno', body: 'Cuerpo uno.' })
  await ipcMain.invoke('kb:add-shortcut', {}, { cwd: project, title: 'Dos', body: 'Cuerpo dos.' })

  const result = await ipcMain.invoke('kb:delete-shortcut', {}, { cwd: project, id: 1 })

  assert.equal(result.ok, true)
  assert.equal(result.num, 1)
  const text = fs.readFileSync(path.join(project, 'kb', 'fichas', 'atajos.md'), 'utf-8')
  assert.ok(!text.includes('Uno'))
  assert.ok(text.includes('## 2 · Dos'))
  const messages = gitLogMessages(project)
  assert.equal(messages[0], 'kb: borra caso 1')
})

test('kb:delete-shortcut rechaza cwd inválido e id inexistente', async () => {
  const { ipcMain } = makeDeps()
  const project = tmpDir('kb-ipc-project-')
  await ipcMain.invoke('kb:add-shortcut', {}, { cwd: project, title: 'Uno', body: 'Cuerpo uno.' })

  const badCwd = await ipcMain.invoke('kb:delete-shortcut', {}, { cwd: 'relativo', id: 1 })
  assert.equal(badCwd.ok, false)

  const missing = await ipcMain.invoke('kb:delete-shortcut', {}, { cwd: project, id: 99 })
  assert.equal(missing.ok, false)
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
