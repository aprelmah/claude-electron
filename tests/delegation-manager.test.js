'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createDelegationManager } = require('../main/delegation-manager')

test('encola delegaciones, conserva el estado y limita el contexto expuesto', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'power-agent-delegations-'))
  const calls = []
  const manager = createDelegationManager({
    userDataDir: root,
    maxConcurrent: 1,
    runChild: async ({ prompt, onText, onSessionId }) => {
      calls.push(prompt)
      onSessionId('session-child')
      onText('resultado')
      return { text: 'resultado final', sessionId: 'session-child' }
    },
  })
  await manager.init()
  const item = await manager.dispatch({
    goal: 'Revisa los tests',
    context: 'contexto privado',
    cli: 'claude',
  })
  for (let i = 0; i < 20 && manager.get(item.id)?.status === 'queued'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  for (let i = 0; i < 20 && manager.get(item.id)?.status === 'running'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const result = manager.get(item.id)
  assert.equal(result.status, 'ok')
  assert.equal(result.sessionId, 'session-child')
  assert.equal(result.context, undefined)
  assert.match(calls[0], /Revisa los tests/)
  assert.match(result.output, /resultado final/)
  assert.ok(fs.existsSync(path.join(root, 'delegations.json')))
  manager.destroy()
  fs.rmSync(root, { recursive: true, force: true })
})
