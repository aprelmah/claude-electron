'use strict'

// Regresión 2026-07-28: con aislamiento git por sesión, claude corre en el
// worktree y escribe su transcript en ~/.claude/projects/<worktree-codificado>/.
// El relay de Telegram lo buscaba en session.cwd (el path REAL), no encontraba
// el turno en curso, nunca veía end_turn y a los 45s mandaba el TUI raspado
// (spinners, banner de bienvenida, historial repetido).

const test = require('node:test')
const assert = require('node:assert')

const { resolveRelayCwd } = require('../main/session-helpers')

const REAL = '/Users/isabel/Desktop/turbo-e'
const WORK = '/Users/isabel/Library/Application Support/CLAUDE-NOVAK/worktrees/turbo-e-01caf6-ms4ytyb9-371415'

test('con worktree activo, el relay lee el transcript del worktree', () => {
  const session = { cwd: REAL, gitWorkspace: { realCwd: REAL, workCwd: WORK, branch: 'poweragent/session-x' } }
  assert.strictEqual(resolveRelayCwd(session), WORK)
})

test('sin aislamiento git, usa el cwd de siempre (fail-open)', () => {
  assert.strictEqual(resolveRelayCwd({ cwd: REAL }), REAL)
  assert.strictEqual(resolveRelayCwd({ cwd: REAL, gitWorkspace: null }), REAL)
})

test('gitWorkspace sin workCwd cae al cwd real, no a null', () => {
  assert.strictEqual(resolveRelayCwd({ cwd: REAL, gitWorkspace: { realCwd: REAL } }), REAL)
  assert.strictEqual(resolveRelayCwd({ cwd: REAL, gitWorkspace: { workCwd: '' } }), REAL)
})

test('no revienta con sesión ausente o vacía', () => {
  assert.strictEqual(resolveRelayCwd(null), null)
  assert.strictEqual(resolveRelayCwd(undefined), null)
  assert.strictEqual(resolveRelayCwd({}), null)
})

test('el cwd del relay y el del spawn coinciden', () => {
  // startPty spawnea en `session.gitWorkspace?.workCwd || session.cwd`; el relay
  // debe mirar exactamente ese mismo sitio o vuelve la regresión.
  const session = { cwd: REAL, gitWorkspace: { workCwd: WORK } }
  const spawnCwd = session.gitWorkspace?.workCwd || session.cwd
  assert.strictEqual(resolveRelayCwd(session), spawnCwd)
})
