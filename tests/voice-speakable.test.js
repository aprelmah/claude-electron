'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { speakableFromMarkdown } = require(path.join(REPO_ROOT, 'main', 'voice-speakable.js'))

describe('voice-speakable', () => {
  test('deja la prosa tal cual', () => {
    assert.strictEqual(speakableFromMarkdown('He arreglado el bug del relay.'), 'He arreglado el bug del relay.')
  })

  test('quita los bloques de código y conserva la prosa', () => {
    const md = 'He cambiado esto:\n\n```js\nconst x = 1\nconsole.log(x)\n```\n\nY ya funciona.'
    const out = speakableFromMarkdown(md)
    assert.ok(!out.includes('const x'))
    assert.ok(out.includes('He cambiado esto'))
    assert.ok(out.includes('Y ya funciona'))
  })

  test('un bloque de código sin cerrar no se come el resto', () => {
    const out = speakableFromMarkdown('Mira:\n\n```js\nconst x = 1\n')
    assert.ok(out.includes('Mira'))
    assert.ok(!out.includes('const x'))
  })

  test('quita el código en línea pero deja su contenido legible', () => {
    assert.strictEqual(speakableFromMarkdown('Toca `main.js` y listo.'), 'Toca main.js y listo.')
  })

  test('quita tablas markdown', () => {
    const md = 'Resultado:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEso es todo.'
    const out = speakableFromMarkdown(md)
    assert.ok(!out.includes('|'))
    assert.ok(out.includes('Resultado'))
    assert.ok(out.includes('Eso es todo'))
  })

  test('quita líneas de diff', () => {
    const md = 'Cambio:\n+ añadido\n- quitado\nHecho.'
    const out = speakableFromMarkdown(md)
    assert.ok(!out.includes('añadido'))
    assert.ok(out.includes('Hecho'))
  })

  test('deja el texto de los enlaces, no la URL', () => {
    assert.strictEqual(speakableFromMarkdown('Mira [la doc](https://x.com/y).'), 'Mira la doc.')
  })

  test('quita las marcas de encabezado y de énfasis', () => {
    assert.strictEqual(speakableFromMarkdown('## Resumen\n\nEsto es **importante** y *claro*.'), 'Resumen. Esto es importante y claro.')
  })

  test('convierte viñetas en frases', () => {
    const out = speakableFromMarkdown('- uno\n- dos')
    assert.ok(!out.includes('-'))
    assert.ok(out.includes('uno'))
    assert.ok(out.includes('dos'))
  })

  test('devuelve vacío si solo había código', () => {
    assert.strictEqual(speakableFromMarkdown('```js\nconst x = 1\n```'), '')
  })

  test('devuelve vacío ante entrada vacía o no-string', () => {
    assert.strictEqual(speakableFromMarkdown(''), '')
    assert.strictEqual(speakableFromMarkdown(null), '')
    assert.strictEqual(speakableFromMarkdown(undefined), '')
    assert.strictEqual(speakableFromMarkdown(42), '')
  })

  test('recorta por longitud sin cortar una palabra a la mitad', () => {
    const md = 'palabra '.repeat(300)
    const out = speakableFromMarkdown(md, { maxChars: 100 })
    assert.ok(out.length <= 104, `demasiado largo: ${out.length}`)
    assert.ok(!/palab$/.test(out), 'no debe cortar una palabra por la mitad')
  })

  test('colapsa espacios y líneas en blanco de sobra', () => {
    assert.strictEqual(speakableFromMarkdown('Hola\n\n\n\nqué    tal'), 'Hola. qué tal')
  })
})
