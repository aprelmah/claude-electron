'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { shellQuote } = require('../main/shell-quote')

test('shellQuote envuelve en comillas simples', () => {
  assert.strictEqual(shellQuote('abc'), "'abc'")
})

test('shellQuote escapa comillas simples embebidas', () => {
  assert.strictEqual(shellQuote("a'b"), "'a'\\''b'")
})

test('shellQuote neutraliza metacaracteres de shell', () => {
  assert.strictEqual(shellQuote('$(rm -rf /); `id`'), "'$(rm -rf /); `id`'")
})

test('shellQuote convierte valores no-string', () => {
  assert.strictEqual(shellQuote(5), "'5'")
  assert.strictEqual(shellQuote(undefined), "'undefined'")
})
