'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { retitleTranscript } = require('../main/retitle-transcript')

const line = (obj) => JSON.stringify(obj)

test('retitle: reemplaza el primer turno user con content string', () => {
  const raw = [
    line({ type: 'summary', summary: 'x' }),
    line({ type: 'user', message: { role: 'user', content: 'hola mundo' } }),
    line({ type: 'assistant', message: { role: 'assistant', content: 'resp' } })
  ].join('\n') + '\n'
  const r = retitleTranscript(raw, 'Título nuevo')
  assert.strictEqual(r.updated, true)
  const parsed = r.text.trim().split('\n').map(JSON.parse)
  assert.strictEqual(parsed[1].message.content, 'Título nuevo')
  assert.strictEqual(parsed[2].message.content, 'resp')
})

test('retitle: content array — sustituye solo el primer bloque text', () => {
  const raw = line({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'viejo' }, { type: 'text', text: 'otro' }] }
  }) + '\n'
  const r = retitleTranscript(raw, 'Nuevo')
  assert.strictEqual(r.updated, true)
  const parsed = JSON.parse(r.text.trim())
  assert.strictEqual(parsed.message.content[0].text, 'Nuevo')
  assert.strictEqual(parsed.message.content[1].text, 'otro')
})

test('retitle: salta turnos Caveat y turnos que solo son bloques <...>', () => {
  const raw = [
    line({ type: 'user', message: { role: 'user', content: 'Caveat: esto no cuenta' } }),
    line({ type: 'user', message: { role: 'user', content: '<system-reminder></system-reminder>' } }),
    line({ type: 'user', message: { role: 'user', content: 'el real' } })
  ].join('\n') + '\n'
  const r = retitleTranscript(raw, 'T')
  assert.strictEqual(r.updated, true)
  const parsed = r.text.trim().split('\n').map(JSON.parse)
  assert.strictEqual(parsed[0].message.content, 'Caveat: esto no cuenta')
  assert.strictEqual(parsed[2].message.content, 'T')
})

test('retitle: preserva la presencia y ausencia de trailing newline', () => {
  const base = line({ type: 'user', message: { role: 'user', content: 'x' } })
  assert.ok(retitleTranscript(base + '\n', 'T').text.endsWith('\n'))
  assert.ok(!retitleTranscript(base, 'T').text.endsWith('\n'))
})

test('retitle: sin turno user real devuelve updated false', () => {
  const raw = [
    line({ type: 'assistant', message: { role: 'assistant', content: 'r' } }),
    'no-es-json',
    ''
  ].join('\n')
  const r = retitleTranscript(raw, 'T')
  assert.strictEqual(r.updated, false)
  assert.strictEqual(r.text, null)
})

test('retitle: líneas corruptas se conservan tal cual', () => {
  const raw = 'linea{rota\n' + line({ type: 'user', message: { role: 'user', content: 'x' } }) + '\n'
  const r = retitleTranscript(raw, 'T')
  assert.strictEqual(r.updated, true)
  assert.ok(r.text.startsWith('linea{rota\n'))
})
