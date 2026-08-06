'use strict'

// El ENTER va SIEMPRE en su propia escritura al PTY, nunca pegado al texto:
// el TUI de Claude Code trata lo que llega junto como un pegado y el '\r'
// final se convierte en salto de línea DENTRO del prompt (queda escrito sin
// enviar). Regla dura del modo voz (2026-08-05) que el relay de Telegram
// violaba con `message + '\r'`.

const test = require('node:test')
const assert = require('node:assert')
const { writePromptThenEnter, DEFAULT_ENTER_DELAY_MS } = require('../main/pty-prompt-write')

test('escribe el prompt y el ENTER en dos escrituras separadas, con espera entre medias', async () => {
  const writes = []
  const waits = []
  await writePromptThenEnter((chunk) => writes.push(chunk), 'hola mundo', {
    waitFn: (ms) => { waits.push(ms); return Promise.resolve() }
  })
  assert.deepStrictEqual(writes, ['hola mundo', '\r'])
  assert.deepStrictEqual(waits, [DEFAULT_ENTER_DELAY_MS])
})

test('si la escritura del prompt falla, no manda el ENTER y rechaza', async () => {
  const writes = []
  await assert.rejects(
    writePromptThenEnter((chunk) => {
      writes.push(chunk)
      throw new Error('pty muerto')
    }, 'hola', { waitFn: () => Promise.resolve() }),
    /pty muerto/
  )
  assert.deepStrictEqual(writes, ['hola'])
})

test('si la escritura del ENTER falla, rechaza', async () => {
  await assert.rejects(
    writePromptThenEnter((chunk) => {
      if (chunk === '\r') throw new Error('se cerró')
    }, 'hola', { waitFn: () => Promise.resolve() }),
    /se cerró/
  )
})

test('la espera por defecto son 150 ms', () => {
  assert.strictEqual(DEFAULT_ENTER_DELAY_MS, 150)
})
