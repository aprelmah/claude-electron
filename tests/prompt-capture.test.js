'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createPromptCapture } = require('../prompt-capture')

test('devuelve el prompt escrito aunque no se haya enviado', () => {
  const cap = createPromptCapture()
  cap.absorb('arregla el bug del panel')
  assert.strictEqual(cap.current(), 'arregla el bug del panel')
})

test('tras enviar conserva el prompt enviado', () => {
  const cap = createPromptCapture()
  cap.absorb('resume la sesion')
  cap.absorb('\r')
  assert.strictEqual(cap.current(), 'resume la sesion')
})

test('lo que se esta escribiendo pisa al ultimo enviado', () => {
  const cap = createPromptCapture()
  cap.absorb('prompt viejo\r')
  cap.absorb('prompt nuevo a medias')
  assert.strictEqual(cap.current(), 'prompt nuevo a medias')
})

test('un buffer vivo demasiado corto no tapa al ultimo enviado', () => {
  const cap = createPromptCapture()
  cap.absorb('prompt viejo\r')
  cap.absorb('x')
  assert.strictEqual(cap.current(), 'prompt viejo')
})

test('sin nada escrito devuelve cadena vacia', () => {
  const cap = createPromptCapture()
  assert.strictEqual(cap.current(), '')
})

test('backspace borra del buffer vivo', () => {
  const cap = createPromptCapture()
  cap.absorb('holaX\x7f')
  assert.strictEqual(cap.current(), 'hola')
})

test('las flechas y otras secuencias ESC no contaminan el buffer', () => {
  const cap = createPromptCapture()
  cap.absorb('ho\x1b[Dla\x1b[A')
  assert.strictEqual(cap.current(), 'hola')
})

test('el bracketed paste conserva los saltos de linea', () => {
  const cap = createPromptCapture()
  cap.absorb('\x1b[200~linea uno\rlinea dos\x1b[201~')
  assert.strictEqual(cap.current(), 'linea uno\nlinea dos')
})

test('el texto inyectado cuenta como prompt escrito', () => {
  const cap = createPromptCapture()
  cap.noteInjected('@src/main.js ')
  assert.strictEqual(cap.current(), '@src/main.js')
})

test('el texto inyectado se mezcla con lo tecleado', () => {
  const cap = createPromptCapture()
  cap.absorb('mira ')
  cap.noteInjected('@src/main.js ')
  cap.absorb('y arreglalo')
  assert.strictEqual(cap.current(), 'mira @src/main.js y arreglalo')
})

test('enviar limpia el buffer vivo', () => {
  const cap = createPromptCapture()
  cap.absorb('un prompt\r')
  assert.strictEqual(cap.pending(), '')
})
