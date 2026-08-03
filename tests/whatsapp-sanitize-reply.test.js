const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const wa = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-client.js'))
const { sanitizeAutoReplyText } = wa.__private || {}

// sanitizeAutoReplyText aplastaba TODO el whitespace a espacios simples. Daba
// igual mientras la persona contestaba en una o dos frases, pero la KB responde
// con los "## Solución N" del editor — pasos numerados — y llegaban al cliente
// como una parrafada de una sola línea, que es justo lo contrario de lo que la
// ficha existe para entregar.
describe('sanitizeAutoReplyText', () => {
  test('preserva los saltos entre pasos numerados', () => {
    const reply = '1. Apaga el inversor\n2. Espera 30 segundos\n3. Vuelve a encenderlo'
    assert.strictEqual(sanitizeAutoReplyText(reply), reply)
  })

  test('preserva el párrafo en blanco entre bloques', () => {
    assert.strictEqual(
      sanitizeAutoReplyText('Vamos por partes.\n\n1. Mira el led\n2. Dime de qué color está'),
      'Vamos por partes.\n\n1. Mira el led\n2. Dime de qué color está'
    )
  })

  test('colapsa espacios y tabs dentro de cada línea, y las líneas en blanco de más', () => {
    assert.strictEqual(
      sanitizeAutoReplyText('  Hola   \t buenas  \n\n\n\n  segundo   paso  '),
      'Hola buenas\n\nsegundo paso'
    )
  })

  test('normaliza CRLF a \\n', () => {
    assert.strictEqual(sanitizeAutoReplyText('uno\r\ndos'), 'uno\ndos')
  })

  test('sigue filtrando el patrón tóxico aunque lleve un salto por medio', () => {
    // La moderación mira el texto en una línea a propósito: un \n no puede
    // servir para colar un insulto partido.
    const conSalto = sanitizeAutoReplyText('eres\nimbécil')
    assert.strictEqual(conSalto, '', `debería filtrarse, devolvió ${JSON.stringify(conSalto)}`)
  })

  test('vacío o solo whitespace → cadena vacía', () => {
    assert.strictEqual(sanitizeAutoReplyText('   \n\n \t '), '')
    assert.strictEqual(sanitizeAutoReplyText(null), '')
    assert.strictEqual(sanitizeAutoReplyText(undefined), '')
  })
})
