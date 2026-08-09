'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHeadlessRunners } = require('../headless-runners')

async function captureArgs(cli, options = {}) {
  let args = null
  const runners = createHeadlessRunners({
    cliMeta: () => ({ bin: '/fake/cli', envVar: 'FAKE' }),
    buildRuntimeEnv: () => ({ PATH: '/usr/bin' }),
    commandExists: () => true,
    buildFdLimitCommand: (_bin, captured) => {
      args = captured
      throw new Error('stop-before-spawn')
    },
    getCwdSync: () => '/tmp',
  })
  const runner = cli === 'codex' ? runners.runCodexHeadless : runners.runClaudeHeadless
  await runner({ prompt: 'test', ...options }).catch(() => {})
  return args
}

test('headless seguro es el default para Claude y Codex', async () => {
  const claude = await captureArgs('claude')
  assert.deepEqual(claude.slice(-2), ['--permission-mode', 'acceptEdits'])
  const codex = await captureArgs('codex')
  assert.deepEqual(codex.slice(3, 7), ['--sandbox', 'workspace-write', '--approve-for-me', 'test'])
})

test('trusted solo aparece cuando el caller lo pide explícitamente', async () => {
  const claude = await captureArgs('claude', { securityMode: 'trusted' })
  assert.ok(claude.includes('--permission-mode'))
  assert.ok(claude.includes('bypassPermissions'))
  const codex = await captureArgs('codex', { securityMode: 'trusted' })
  assert.ok(codex.includes('--dangerously-bypass-approvals-and-sandbox'))
})
