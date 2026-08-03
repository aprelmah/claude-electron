'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')

const { createCliResolver, CLAUDE_SESSION_IDENTITY_VARS } = require('../main/cli-resolver')

function envWith(vars) {
  const saved = {}
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  try {
    return createCliResolver(() => ({})).buildRuntimeEnv()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// Lanzar la app desde una sesión de Claude Code (un `npm run deploy`, un `open -a`
// desde un agente) le pega la identidad de esa sesión. El PTY hijo se cree entonces
// una sub-sesión y desactiva el guardado del transcript:
//   "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker"
// Sin .jsonl no hay --resume, ni historial, ni relay de Telegram (que lee ese
// fichero para saber qué contestó Claude), ni pool de PTYs ocultos, ni
// task-sessions. Y el único aviso es una línea amarilla al fondo del TUI.
// Caso real 2026-08-03: la app corrió media tarde así.
describe('buildRuntimeEnv: no hereda la identidad de la sesión que lanzó la app', () => {
  test('borra el marcador de sesión hija y el id de sesión', () => {
    const env = envWith({
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: '783226cd-569f-42ba-b41f-f7395f8ae2f7',
      CLAUDE_CODE_ENTRYPOINT: 'cli'
    })
    for (const k of CLAUDE_SESSION_IDENTITY_VARS) {
      assert.strictEqual(env[k], undefined, `${k} no debe llegar al PTY`)
    }
  })

  test('la lista cubre las tres variables de identidad', () => {
    assert.deepStrictEqual(
      [...CLAUDE_SESSION_IDENTITY_VARS].sort(),
      ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID']
    )
  })

  test('no toca CLAUDE_CODE_EXECPATH: apunta al binario, no a una sesión', () => {
    const env = envWith({
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_EXECPATH: '/Users/isabel/.local/share/claude/versions/2.1.220'
    })
    assert.strictEqual(env.CLAUDE_CODE_EXECPATH, '/Users/isabel/.local/share/claude/versions/2.1.220')
  })

  test('sigue arrastrando el resto del entorno (PATH, color, idioma)', () => {
    const env = envWith({ CLAUDE_CODE_CHILD_SESSION: '1' })
    assert.ok(env.PATH && env.PATH.length > 0)
    assert.strictEqual(env.TERM, 'xterm-256color')
    assert.strictEqual(env.FORCE_COLOR, '1')
    assert.ok(env.LANG)
  })
})
