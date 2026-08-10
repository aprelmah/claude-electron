'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const kb = require('../main/knowledge-base')

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'power-agent-kb-'))
}

test('ensureClaudeMd crea el esqueleto una sola vez', () => {
  const root = tmpProject()
  const first = kb.ensureClaudeMd(root, { projectName: 'demo' })
  assert.equal(first.created, true)
  const text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')
  assert.ok(text.includes('Experto de demo'))
  assert.ok(text.includes(kb.IMPORTS_HEADER))
  const second = kb.ensureClaudeMd(root)
  assert.equal(second.created, false)
})

test('addImport inserta bajo la sección y es idempotente', () => {
  const root = tmpProject()
  kb.addImport(root, 'kb/fichas/una.md')
  kb.addImport(root, 'kb/fichas/dos.md')
  kb.addImport(root, 'kb/fichas/una.md')
  const text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')
  const imports = kb.parseImports(text)
  assert.deepEqual(imports.map((f) => f.relPath), ['kb/fichas/una.md', 'kb/fichas/dos.md'])
  const headerIdx = text.indexOf(kb.IMPORTS_HEADER)
  assert.ok(text.indexOf('@kb/fichas/una.md') > headerIdx)
})

test('addImport respeta un CLAUDE.md existente sin sección (la añade al final)', () => {
  const root = tmpProject()
  const original = '# Mi proyecto\n\nReglas mías.\n'
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), original)
  kb.addImport(root, 'kb/fichas/nueva.md')
  const text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')
  assert.ok(text.startsWith('# Mi proyecto'))
  assert.ok(text.includes('Reglas mías.'))
  assert.ok(text.includes(`${kb.IMPORTS_HEADER}\n`))
  assert.ok(/@kb\/fichas\/nueva\.md/.test(text))
})

test('toggleImport desactiva con backticks y reactiva sin tocar el resto', () => {
  const root = tmpProject()
  kb.addImport(root, 'kb/fichas/a.md')
  kb.addImport(root, 'kb/fichas/b.md')
  const before = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')

  const off = kb.toggleImport(root, 'kb/fichas/a.md', false)
  assert.equal(off.ok, true)
  let text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')
  assert.ok(text.includes('`@kb/fichas/a.md`'))
  assert.ok(text.includes('\n@kb/fichas/b.md'))

  const on = kb.toggleImport(root, 'kb/fichas/a.md', true)
  assert.equal(on.ok, true)
  text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')
  assert.equal(text, before)

  const missing = kb.toggleImport(root, 'kb/fichas/no-existe.md', false)
  assert.equal(missing.ok, false)
})

test('parseImports ignora imports dentro de bloques de código', () => {
  const text = [
    '# Doc',
    '@activa.md',
    '```',
    '@dentro-de-codigo.md',
    '```',
    '`@desactivada.md`'
  ].join('\n')
  const imports = kb.parseImports(text)
  assert.deepEqual(imports.map((f) => [f.relPath, f.active]), [
    ['activa.md', true],
    ['desactivada.md', false]
  ])
})

test('listKnowledge devuelve tamaños, missing y totales solo de activas', () => {
  const root = tmpProject()
  fs.mkdirSync(path.join(root, 'kb', 'fichas'), { recursive: true })
  fs.writeFileSync(path.join(root, 'kb', 'fichas', 'real.md'), 'x'.repeat(4000))
  kb.addImport(root, 'kb/fichas/real.md')
  kb.addImport(root, 'kb/fichas/fantasma.md')
  kb.addImport(root, 'kb/fichas/apagada.md')
  fs.writeFileSync(path.join(root, 'kb', 'fichas', 'apagada.md'), 'y'.repeat(2000))
  kb.toggleImport(root, 'kb/fichas/apagada.md', false)

  const data = kb.listKnowledge(root)
  assert.equal(data.ok, true)
  assert.equal(data.claudeMdExists, true)
  const byPath = Object.fromEntries(data.fichas.map((f) => [f.relPath, f]))
  assert.equal(byPath['kb/fichas/real.md'].missing, false)
  assert.equal(byPath['kb/fichas/real.md'].size, 4000)
  assert.equal(byPath['kb/fichas/fantasma.md'].missing, true)
  assert.equal(byPath['kb/fichas/apagada.md'].active, false)
  assert.equal(data.totalActiveBytes, 4000)
  assert.equal(data.approxTokens, kb.estimateTokens(4000))
})

test('listKnowledge sin CLAUDE.md no revienta', () => {
  const root = tmpProject()
  const data = kb.listKnowledge(root)
  assert.equal(data.ok, true)
  assert.equal(data.claudeMdExists, false)
  assert.deepEqual(data.fichas, [])
})

test('writeFicha slugifica y deduplica nombres', () => {
  const root = tmpProject()
  const first = kb.writeFicha(root, 'Batería Lithium Pro 5,1 — códigos', '# Ficha\ncontenido')
  assert.equal(first.relPath, path.join('kb', 'fichas', 'bateria-lithium-pro-5-1-codigos.md'))
  const second = kb.writeFicha(root, 'Batería Lithium Pro 5,1 — códigos', '# Otra')
  assert.equal(second.relPath, path.join('kb', 'fichas', 'bateria-lithium-pro-5-1-codigos-2.md'))
  assert.ok(fs.existsSync(path.join(root, second.relPath)))
})

test('addShortcut crea el catálogo con instrucción, numera y enlaza relacionados', () => {
  const root = tmpProject()
  const first = kb.addShortcut(root, {
    title: 'Inversor no ve la batería (F58)',
    body: 'Problema: F58.\n1) Protocolo\n2) Cable CAN',
    related: ['kb/fichas/inversor.md', 'kb/fichas/bateria.md']
  })
  assert.equal(first.ok, true)
  assert.equal(first.num, 1)
  const abs = path.join(root, kb.ATAJOS_RELPATH)
  let text = fs.readFileSync(abs, 'utf-8')
  assert.ok(text.includes('Catálogo numerado'))
  assert.ok(text.includes('## 1 · Inversor no ve la batería (F58)'))
  assert.ok(text.includes('Relacionados: `kb/fichas/inversor.md`, `kb/fichas/bateria.md`'))

  const second = kb.addShortcut(root, { title: 'Otro caso', body: 'Problema: X.' })
  assert.equal(second.num, 2)
  text = fs.readFileSync(abs, 'utf-8')
  assert.ok(text.includes('## 2 · Otro caso'))

  // los relacionados en backticks NO cuentan como imports; el catálogo sí está importado
  const md = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')
  const imports = kb.parseImports(md).map((f) => f.relPath)
  assert.deepEqual(imports, [kb.ATAJOS_RELPATH])
  const shortcuts = kb.listShortcuts(root)
  assert.deepEqual(shortcuts.entries.map((e) => [e.num, e.title]), [
    [1, 'Inversor no ve la batería (F58)'],
    [2, 'Otro caso']
  ])
})

test('addShortcut valida título y cuerpo', () => {
  const root = tmpProject()
  assert.equal(kb.addShortcut(root, { title: '', body: 'x' }).ok, false)
  assert.equal(kb.addShortcut(root, { title: 'y', body: '  ' }).ok, false)
  assert.equal(fs.existsSync(path.join(root, 'CLAUDE.md')), false)
})

test('removeImport quita la línea (activa o desactivada) sin tocar el resto', () => {
  const root = tmpProject()
  kb.addImport(root, 'kb/fichas/a.md')
  kb.addImport(root, 'kb/fichas/b.md')
  kb.toggleImport(root, 'kb/fichas/b.md', false)

  assert.equal(kb.removeImport(root, 'kb/fichas/a.md').ok, true)
  assert.equal(kb.removeImport(root, 'kb/fichas/b.md').ok, true)
  const text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')
  assert.ok(!text.includes('a.md'))
  assert.ok(!text.includes('b.md'))
  assert.ok(text.includes(kb.IMPORTS_HEADER))
  assert.equal(kb.removeImport(root, 'kb/fichas/no-esta.md').ok, false)
})

test('isPanelFicha solo acepta rutas dentro de kb/fichas', () => {
  const root = tmpProject()
  assert.equal(kb.isPanelFicha(root, 'kb/fichas/una.md'), true)
  assert.equal(kb.isPanelFicha(root, '.claude/memory/manuales/x.md'), false)
  assert.equal(kb.isPanelFicha(root, 'kb/fuentes/x.pdf'), false)
  assert.equal(kb.isPanelFicha(root, 'kb/fichas/../../fuera.md'), false)
  assert.equal(kb.isPanelFicha(root, 'kb/fichas'), false)
})

test('buildApplyPrompt cita rutas absolutas y pide confirmación', () => {
  const one = kb.buildApplyPrompt(['/proy/kb/fichas/tarifa.md'])
  assert.ok(one.includes('"/proy/kb/fichas/tarifa.md"'))
  assert.ok(one.includes('esa ficha'))
  assert.ok(one.toLowerCase().includes('confirma'))
  const two = kb.buildApplyPrompt(['/a.md', '/b.md'])
  assert.ok(two.includes('"/a.md" y "/b.md"'))
  assert.ok(two.includes('esas fichas'))
})

test('copySourceFile copia a kb/fuentes con dedupe', () => {
  const root = tmpProject()
  const src = path.join(root, 'manual.pdf')
  fs.writeFileSync(src, 'pdf-bytes')
  const first = kb.copySourceFile(root, src)
  assert.equal(first.relPath, path.join('kb', 'fuentes', 'manual.pdf'))
  const second = kb.copySourceFile(root, src)
  assert.equal(second.relPath, path.join('kb', 'fuentes', 'manual-2.pdf'))
  assert.equal(fs.readFileSync(path.join(root, first.relPath), 'utf-8'), 'pdf-bytes')
})

test('parseShortcuts extrae cuerpo multilínea y relacionados, tolerante a formato sin blanco tras la cabecera', () => {
  const text = [
    '## 1 · Título Uno',
    'Línea 1 del cuerpo.',
    'Línea 2 del cuerpo.',
    '',
    '## 2 · Título Dos',
    '',
    'Cuerpo del dos.',
    'Relacionados: `kb/fichas/a.md`, `kb/fichas/b.md`',
    '',
    '## 3 · Título Tres',
    '',
    'Último cuerpo,',
    'con dos líneas.'
  ].join('\n')
  const entries = kb.parseShortcuts(text)
  assert.deepEqual(entries.map((e) => e.num), [1, 2, 3])

  assert.equal(entries[0].title, 'Título Uno')
  assert.equal(entries[0].body, 'Línea 1 del cuerpo.\nLínea 2 del cuerpo.')
  assert.deepEqual(entries[0].related, [])
  assert.equal(entries[0].relatedLine, null)

  assert.equal(entries[1].title, 'Título Dos')
  assert.equal(entries[1].body, 'Cuerpo del dos.')
  assert.deepEqual(entries[1].related, ['kb/fichas/a.md', 'kb/fichas/b.md'])
  assert.equal(entries[1].relatedLine, 'Relacionados: `kb/fichas/a.md`, `kb/fichas/b.md`')

  assert.equal(entries[2].title, 'Título Tres')
  assert.equal(entries[2].body, 'Último cuerpo,\ncon dos líneas.')
  assert.deepEqual(entries[2].related, [])
})

test('parseShortcuts sobre un atajos.md real (sin blanco tras la cabecera) no revienta', () => {
  const text = kb.ATAJOS_HEADER + '## 1 · LAS RANAS CRIAN PELO\nNUNCA\n'
  const entries = kb.parseShortcuts(text)
  assert.deepEqual(entries, [{ num: 1, title: 'LAS RANAS CRIAN PELO', body: 'NUNCA', related: [], relatedLine: null }])
})

function buildCatalog(root) {
  const one = kb.addShortcut(root, { title: 'Primero', body: 'Cuerpo primero.\nSegunda línea.', related: ['kb/fichas/a.md'] })
  const two = kb.addShortcut(root, { title: 'Segundo', body: 'Cuerpo segundo.' })
  const three = kb.addShortcut(root, { title: 'Tercero', body: 'Cuerpo tercero.', related: ['kb/fichas/c.md', 'kb/fichas/d.md'] })
  return { one, two, three }
}

test('updateShortcut reescribe una entrada del medio y deja cabecera y demás entradas intactas', () => {
  const root = tmpProject()
  buildCatalog(root)
  const abs = path.join(root, kb.ATAJOS_RELPATH)
  const before = fs.readFileSync(abs, 'utf-8')
  const entry1Before = before.slice(before.indexOf('## 1 ·'), before.indexOf('## 2 ·'))
  const entry3Before = before.slice(before.indexOf('## 3 ·'))

  const result = kb.updateShortcut(root, 2, { title: 'Segundo (editado)', body: 'Cuerpo nuevo del segundo.' })
  assert.equal(result.ok, true)
  assert.equal(result.num, 2)
  assert.equal(result.relPath, kb.ATAJOS_RELPATH)

  const after = fs.readFileSync(abs, 'utf-8')
  assert.ok(after.startsWith(kb.ATAJOS_HEADER.split('\n')[0]))
  assert.ok(after.includes('Catálogo numerado'))
  assert.equal(after.slice(after.indexOf('## 1 ·'), after.indexOf('## 2 ·')), entry1Before)
  assert.equal(after.slice(after.indexOf('## 3 ·')), entry3Before)
  assert.ok(after.includes('## 2 · Segundo (editado)'))
  assert.ok(after.includes('Cuerpo nuevo del segundo.'))
  assert.ok(!after.includes('Cuerpo segundo.\n'))

  const entries = kb.listShortcuts(root).entries
  assert.deepEqual(entries.map((e) => e.num), [1, 2, 3])
})

test('updateShortcut preserva "Relacionados:" si no se toca', () => {
  const root = tmpProject()
  buildCatalog(root)
  const result = kb.updateShortcut(root, 1, { title: 'Primero (editado)', body: 'Solo cambio el cuerpo.' })
  assert.equal(result.ok, true)
  const entries = kb.listShortcuts(root).entries
  const one = entries.find((e) => e.num === 1)
  assert.equal(one.title, 'Primero (editado)')
  assert.equal(one.body, 'Solo cambio el cuerpo.')
  assert.deepEqual(one.related, ['kb/fichas/a.md'])
})

test('updateShortcut con `related` explícito reemplaza los relacionados', () => {
  const root = tmpProject()
  buildCatalog(root)
  const result = kb.updateShortcut(root, 3, { title: 'Tercero', body: 'Cuerpo tercero.', related: ['kb/fichas/nuevo.md'] })
  assert.equal(result.ok, true)
  const entries = kb.listShortcuts(root).entries
  const three = entries.find((e) => e.num === 3)
  assert.deepEqual(three.related, ['kb/fichas/nuevo.md'])

  const cleared = kb.updateShortcut(root, 3, { title: 'Tercero', body: 'Cuerpo tercero.', related: [] })
  assert.equal(cleared.ok, true)
  const threeCleared = kb.listShortcuts(root).entries.find((e) => e.num === 3)
  assert.deepEqual(threeCleared.related, [])
})

test('updateShortcut edita la primera y la última entrada preservando el resto', () => {
  const root = tmpProject()
  buildCatalog(root)
  const abs = path.join(root, kb.ATAJOS_RELPATH)

  const first = kb.updateShortcut(root, 1, { title: 'Primero editado', body: 'Nuevo cuerpo uno.' })
  assert.equal(first.ok, true)
  let text = fs.readFileSync(abs, 'utf-8')
  assert.ok(text.includes('Catálogo numerado'))
  assert.ok(text.includes('## 2 · Segundo'))
  assert.ok(text.includes('## 3 · Tercero'))

  const last = kb.updateShortcut(root, 3, { title: 'Tercero editado', body: 'Nuevo cuerpo tres.' })
  assert.equal(last.ok, true)
  text = fs.readFileSync(abs, 'utf-8')
  assert.ok(text.endsWith('\n'))
  assert.ok(!text.endsWith('\n\n'))
  const entries = kb.listShortcuts(root).entries
  assert.deepEqual(entries.map((e) => [e.num, e.title]), [
    [1, 'Primero editado'],
    [2, 'Segundo'],
    [3, 'Tercero editado']
  ])
})

test('updateShortcut valida id, título, cuerpo y fichero inexistente', () => {
  const root = tmpProject()
  buildCatalog(root)
  assert.equal(kb.updateShortcut(root, 99, { title: 'x', body: 'y' }).ok, false)
  assert.equal(kb.updateShortcut(root, 1, { title: '', body: 'y' }).ok, false)
  assert.equal(kb.updateShortcut(root, 1, { title: 'x', body: '  ' }).ok, false)
  assert.equal(kb.updateShortcut(root, 'abc', { title: 'x', body: 'y' }).ok, false)

  const other = tmpProject()
  assert.equal(kb.updateShortcut(other, 1, { title: 'x', body: 'y' }).ok, false)
})

test('deleteShortcut quita la entrada del medio sin renumerar el resto', () => {
  const root = tmpProject()
  buildCatalog(root)
  const abs = path.join(root, kb.ATAJOS_RELPATH)

  const result = kb.deleteShortcut(root, 2)
  assert.equal(result.ok, true)
  assert.equal(result.num, 2)

  const entries = kb.listShortcuts(root).entries
  assert.deepEqual(entries.map((e) => e.num), [1, 3])
  const text = fs.readFileSync(abs, 'utf-8')
  assert.ok(text.includes('Catálogo numerado'))
  assert.ok(!text.includes('Segundo'))
  assert.ok(text.includes('## 1 · Primero'))
  assert.ok(text.includes('## 3 · Tercero'))
  assert.ok(!/\n\n\n/.test(text))

  // el siguiente atajo usa max(existentes)+1, no recompacta el hueco dejado
  const four = kb.addShortcut(root, { title: 'Cuarto', body: 'Cuerpo cuarto.' })
  assert.equal(four.num, 4)
})

test('deleteShortcut quita la primera y la última entrada, y deja solo la cabecera si no queda ninguna', () => {
  const root = tmpProject()
  buildCatalog(root)

  assert.equal(kb.deleteShortcut(root, 1).ok, true)
  assert.equal(kb.deleteShortcut(root, 3).ok, true)
  let entries = kb.listShortcuts(root).entries
  assert.deepEqual(entries.map((e) => e.num), [2])

  assert.equal(kb.deleteShortcut(root, 2).ok, true)
  entries = kb.listShortcuts(root).entries
  assert.deepEqual(entries, [])

  const abs = path.join(root, kb.ATAJOS_RELPATH)
  const text = fs.readFileSync(abs, 'utf-8')
  assert.ok(text.includes('Catálogo numerado'))
  assert.ok(!/## \d/.test(text))
  assert.ok(text.endsWith('\n'))
  assert.ok(!text.endsWith('\n\n'))
})

test('deleteShortcut valida id inexistente y fichero inexistente', () => {
  const root = tmpProject()
  buildCatalog(root)
  assert.equal(kb.deleteShortcut(root, 99).ok, false)
  assert.equal(kb.deleteShortcut(root, 'abc').ok, false)

  const other = tmpProject()
  assert.equal(kb.deleteShortcut(other, 1).ok, false)
})
