'use strict'

// Detección de fork/rotación de sessionId para task-sessions y pool oculto de
// Telegram (tarea 2 de la sesión 2026-08-06). Sustituye al viejo
// findUpdatedOrNewClaudeSessionId en startTaskSessionPty, que adoptaba el
// primer .jsonl nuevo O CRECIDO sin exclusiones: si el usuario trabajaba en
// vivo en el mismo proyecto, el task-session adoptaba SU sessionId, lo
// persistía en la tarea y el relay de Telegram pasaba a vigilar la sesión
// interactiva — la "mezcla de sesiones" en su forma más dañina.
const { describe, test, beforeEach } = require('node:test')
const assert = require('node:assert')

const { createTaskSessionForkWatch } = require('../main/task-session-fork-watch')
const { pickForkedSessionId } = require('../main/voice-send-target')

function makeWorld() {
  const filesByCwd = new Map() // cwd -> [{file, sessionId, mtimeMs}]
  const world = {
    filesByCwd,
    known: [],
    subchatAlive: false,
    resumeCwdBySid: new Map(),
    addFile(cwd, sessionId, mtimeMs = 1) {
      if (!filesByCwd.has(cwd)) filesByCwd.set(cwd, [])
      filesByCwd.get(cwd).push({ file: `${sessionId}.jsonl`, sessionId, mtimeMs })
    },
    growFile(cwd, sessionId) {
      const row = (filesByCwd.get(cwd) || []).find((r) => r.sessionId === sessionId)
      if (row) row.mtimeMs += 10
    }
  }
  const list = (cwd) => (filesByCwd.get(cwd) || []).slice().sort((a, b) => b.mtimeMs - a.mtimeMs)
  world.watchFactory = createTaskSessionForkWatch({
    listClaudeSessionFilesWithMtime: list,
    snapshotClaudeSessions: (cwd) => new Map(list(cwd).map((r) => [r.file, r.mtimeMs])),
    pickForkedSessionId,
    knownClaudeSessionIds: () => world.known,
    hasLiveSubchat: () => world.subchatAlive,
    resolveResumeCwd: (sid) => world.resumeCwdBySid.get(sid) || null
  })
  return world
}

describe('task-session fork watch', () => {
  let world
  beforeEach(() => {
    world = makeWorld()
    world.addFile('/p', 'sid-resumido')
  })

  test('BUG CAZADO: la sesión viva de otro que solo CRECE no se adopta jamás', () => {
    world.addFile('/p', 'sid-usuario')
    const watch = world.watchFactory.begin({ cwd: '/p', resumedSessionId: 'sid-resumido' })
    world.growFile('/p', 'sid-usuario')
    assert.strictEqual(world.watchFactory.tick(watch), null)
  })

  test('fork legítimo: un único .jsonl NUEVO sin dueño → se adopta', () => {
    const watch = world.watchFactory.begin({ cwd: '/p', resumedSessionId: 'sid-resumido' })
    world.addFile('/p', 'sid-fork', 5)
    assert.strictEqual(world.watchFactory.tick(watch), 'sid-fork')
  })

  test('nuevo pero con dueño (knownClaudeSessionIds) → null', () => {
    const watch = world.watchFactory.begin({ cwd: '/p', resumedSessionId: 'sid-resumido' })
    world.known = ['sid-ajeno']
    world.addFile('/p', 'sid-ajeno', 5)
    assert.strictEqual(world.watchFactory.tick(watch), null)
  })

  test('dos nuevos a la vez = otro actor → null', () => {
    const watch = world.watchFactory.begin({ cwd: '/p', resumedSessionId: 'sid-resumido' })
    world.addFile('/p', 'sid-a', 5)
    world.addFile('/p', 'sid-b', 6)
    assert.strictEqual(world.watchFactory.tick(watch), null)
  })

  test('sub-chat vivo: no se adopta y la foto se refresca (el fork del sub-chat queda absorbido)', () => {
    const watch = world.watchFactory.begin({ cwd: '/p', resumedSessionId: 'sid-resumido' })
    world.subchatAlive = true
    world.addFile('/p', 'sid-subchat', 5)
    assert.strictEqual(world.watchFactory.tick(watch), null)
    world.subchatAlive = false
    assert.strictEqual(world.watchFactory.tick(watch), null, 'absorbido: ya no cuenta como nuevo')
    world.addFile('/p', 'sid-fork', 9)
    assert.strictEqual(world.watchFactory.tick(watch), 'sid-fork')
  })

  test('mira también el proyecto ORIGINAL del resumido (resolveResumeCwd), no solo el cwd', () => {
    world.resumeCwdBySid.set('sid-resumido', '/orig')
    world.addFile('/orig', 'sid-resumido')
    const watch = world.watchFactory.begin({ cwd: '/p', resumedSessionId: 'sid-resumido' })
    world.addFile('/orig', 'sid-fork', 5)
    assert.strictEqual(world.watchFactory.tick(watch), 'sid-fork')
  })
})
