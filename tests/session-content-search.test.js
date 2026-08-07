'use strict'

// Búsqueda de contenido en sesiones (.jsonl) — robo de Hermes Agent.
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const REPO_ROOT = path.resolve(__dirname, '..')
const {
  searchSessionContentInFiles,
  extractTextFromLine,
  makeSnippet,
  foldedOf
} = require(path.join(REPO_ROOT, 'main', 'session-content-search.js'))

function writeSession(dir, id, lines) {
  const file = path.join(dir, `${id}.jsonl`)
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return { id, path: file }
}

function userLine(text) {
  return { type: 'user', message: { role: 'user', content: text } }
}

function assistantLine(text) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }
}

describe('extractTextFromLine', () => {
  test('content string, content array y summary', () => {
    assert.strictEqual(extractTextFromLine(JSON.stringify(userLine('hola'))), 'hola')
    assert.strictEqual(extractTextFromLine(JSON.stringify(assistantLine('adiós'))), 'adiós')
    assert.strictEqual(extractTextFromLine(JSON.stringify({ type: 'summary', summary: 'título' })), 'título')
    assert.strictEqual(extractTextFromLine('{basura'), '')
    assert.strictEqual(extractTextFromLine(JSON.stringify({ type: 'x' })), '')
  })
})

describe('searchSessionContentInFiles', () => {
  test('encuentra por contenido sin importar tildes ni mayúsculas', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-'))
    const a = writeSession(dir, 'aaa', [userLine('¿Cómo va la migración de la base de datos?'), assistantLine('La migración va bien')])
    const b = writeSession(dir, 'bbb', [userLine('otra cosa totalmente distinta')])
    const res = await searchSessionContentInFiles({ entries: [a, b], query: 'MIGRACION' })
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].id, 'aaa')
    assert.strictEqual(res[0].count, 2)
    assert.ok(res[0].snippet.toLowerCase().includes('migración'))
  })

  test('respeta maxResults y el orden de entrada', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-'))
    const entries = ['s1', 's2', 's3'].map((id) => writeSession(dir, id, [userLine(`patata frita ${id}`)]))
    const res = await searchSessionContentInFiles({ entries, query: 'patata', maxResults: 2 })
    assert.deepStrictEqual(res.map((r) => r.id), ['s1', 's2'])
  })

  test('archivo ilegible o entrada coja no revienta la búsqueda', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-'))
    const ok = writeSession(dir, 'ok', [userLine('buscando patata')])
    const res = await searchSessionContentInFiles({
      entries: [{ id: 'muerta', path: path.join(dir, 'no-existe.jsonl') }, { id: null, path: null }, ok],
      query: 'patata'
    })
    assert.deepStrictEqual(res.map((r) => r.id), ['ok'])
  })

  test('query vacía o solo espacios devuelve []', async () => {
    assert.deepStrictEqual(await searchSessionContentInFiles({ entries: [], query: '  ' }), [])
  })

  test('archivos gordos se saltan (tope de bytes)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scs-'))
    const a = writeSession(dir, 'aaa', [userLine('patata')])
    const res = await searchSessionContentInFiles({
      entries: [a],
      query: 'patata',
      statFn: () => ({ size: 999 * 1024 * 1024 })
    })
    assert.deepStrictEqual(res, [])
  })
})

describe('makeSnippet', () => {
  test('recorta alrededor de la coincidencia con elipsis', () => {
    const text = 'x'.repeat(200) + ' aquí está la clave ' + 'y'.repeat(200)
    const snip = makeSnippet(text, foldedOf('la clave'))
    assert.ok(snip.includes('la clave'))
    assert.ok(snip.startsWith('…'))
    assert.ok(snip.endsWith('…'))
    assert.ok(snip.length < 250)
  })
})
