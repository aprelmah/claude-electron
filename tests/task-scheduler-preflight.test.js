'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const TaskScheduler = require('../scheduler')

function fakePersistence(task) {
  const runs = []
  const updates = []
  return {
    runs,
    updates,
    async loadTasks() { return [task] },
    async getTask() { return task },
    async appendRun(run) { runs.push(run) },
    async updateTask(id, patch) { updates.push({ id, patch }); return { ...task, ...patch } },
    async deleteTask() {},
  }
}

test('bloquea antes de llamar al modelo cuando falla el preflight', async () => {
  let executions = 0
  const task = {
    id: 'task-1',
    name: 'CLI roto',
    enabled: false,
    cron: '0 9 * * *',
    cli: 'unknown',
    prompt: 'Revisa el repo',
    resume: true,
    sessionId: null,
  }
  const persistence = fakePersistence(task)
  const scheduler = new TaskScheduler({
    persistence,
    executor: async () => { executions += 1 },
    preflight: (value) => ({
      ok: false,
      errors: ['CLI inválido'],
      warnings: [],
      securityMode: 'safe',
      skills: [],
    }),
  })

  const result = await scheduler.runNow(task.id)
  assert.equal(result.status, 'blocked_config')
  assert.equal(executions, 0)
  assert.equal(persistence.runs[0].status, 'blocked_config')
  assert.match(persistence.runs[0].error, /CLI inválido/)
  assert.equal(persistence.updates[0].patch.lastStatus, 'blocked_config')
})
