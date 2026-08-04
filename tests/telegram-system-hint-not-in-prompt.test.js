'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')

const { createHeadlessRunners } = require('../headless-runners')

// Bug real 2026-08-04 (Luismi, captura del picker): toda sesión abierta desde
// Telegram se llamaba
//   "[Sistema: si el usuario pide un archivo, búscalo con `find ~ -name …"
// El bridge concatenaba esa instrucción DELANTE del mensaje (`fileHint + prompt`),
// así que pasaba a ser el primer turno de la conversación — y Claude Code titula
// la sesión con el primer prompt. Resultado: todas idénticas en el picker.
// Es una instrucción de la app, no un mensaje del usuario: va por
// --append-system-prompt.

// Captura los args sin ejecutar ningún CLI: buildFdLimitCommand recibe el array
// entero justo antes del spawn.
function capture() {
  const calls = []
  const runners = createHeadlessRunners({
    cliMeta: (cli) => ({ bin: `/fake/${cli}`, name: cli, envVar: 'X' }),
    buildRuntimeEnv: () => ({ PATH: '/usr/bin' }),
    commandExists: () => true,
    buildFdLimitCommand: (bin, args) => {
      calls.push({ bin, args })
      throw new Error('stop-before-spawn') // no queremos proceso real
    },
    getCwdSync: () => '/tmp',
    onAuditEvent: () => {}
  })
  return { runners, calls }
}

async function argsFor(kind, opts) {
  const { runners, calls } = capture()
  const run = kind === 'codex' ? runners.runCodexHeadless : runners.runClaudeHeadless
  await run(opts).catch(() => {})
  return calls[0]?.args || []
}

function valueAfter(args, flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

const HINT = '[Sistema: busca el archivo con find…]'

describe('la instrucción de la app no contamina el prompt del usuario', () => {
  test('claude: el hint va en --append-system-prompt, no en -p', async () => {
    const args = await argsFor('claude', { prompt: 'dame el reporte de ayer', appendSystemPrompt: HINT })
    assert.strictEqual(valueAfter(args, '-p'), 'dame el reporte de ayer')
    assert.strictEqual(valueAfter(args, '--append-system-prompt'), HINT)
  })

  test('claude: el título saldrá del mensaje real — el -p no contiene "[Sistema:"', async () => {
    const args = await argsFor('claude', { prompt: 'dame el reporte de ayer', appendSystemPrompt: HINT })
    assert.ok(!String(valueAfter(args, '-p')).includes('[Sistema:'))
  })

  test('claude: sin hint no se añade el flag', async () => {
    const args = await argsFor('claude', { prompt: 'hola' })
    assert.ok(!args.includes('--append-system-prompt'))
    assert.strictEqual(valueAfter(args, '-p'), 'hola')
  })

  test('codex: no tiene ese flag, así que sí lo antepone al prompt', async () => {
    const args = await argsFor('codex', { prompt: 'dame el reporte', appendSystemPrompt: HINT })
    const last = args[args.length - 1]
    assert.ok(last.startsWith(HINT), last.slice(0, 60))
    assert.ok(last.endsWith('dame el reporte'))
    assert.ok(!args.includes('--append-system-prompt'), 'codex exec no soporta ese flag')
  })

  test('codex: sin hint el prompt va tal cual', async () => {
    const args = await argsFor('codex', { prompt: 'hola' })
    assert.strictEqual(args[args.length - 1], 'hola')
  })
})
