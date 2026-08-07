'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const {
  buildHandoffCommand,
  buildAppleScript,
  captureHandoffTarget,
  openInTerminal
} = require('../main/terminal-handoff')

test('buildHandoffCommand: claude con cd al cwd y resume', () => {
  const cmd = buildHandoffCommand({ cli: 'claude', cwd: '/Users/isabel/Desktop/LUISMI/proyecto', sessionId: 'abc-123' })
  assert.strictEqual(cmd, "cd '/Users/isabel/Desktop/LUISMI/proyecto' && claude --resume 'abc-123'")
})

test('buildHandoffCommand: codex usa "resume" sin --', () => {
  const cmd = buildHandoffCommand({ cli: 'codex', cwd: '/tmp/p', sessionId: 'xyz' })
  assert.strictEqual(cmd, "cd '/tmp/p' && codex resume 'xyz'")
})

test('buildHandoffCommand: escapa comillas simples del path', () => {
  const cmd = buildHandoffCommand({ cli: 'claude', cwd: "/tmp/o'brien", sessionId: 'id' })
  assert.ok(cmd.includes("'/tmp/o'\\''brien'"))
})

test('buildHandoffCommand: rechaza cli desconocido y campos vacíos', () => {
  assert.throws(() => buildHandoffCommand({ cli: 'bash', cwd: '/tmp', sessionId: 'x' }))
  assert.throws(() => buildHandoffCommand({ cli: 'claude', cwd: '', sessionId: 'x' }))
  assert.throws(() => buildHandoffCommand({ cli: 'claude', cwd: '/tmp', sessionId: '' }))
})

test('buildAppleScript: envuelve en tell Terminal y escapa backslash y comillas dobles', () => {
  const script = buildAppleScript('echo "a\\b"')
  assert.ok(script.startsWith('tell application "Terminal"'))
  assert.ok(script.includes('activate'))
  assert.ok(script.includes('do script "echo \\"a\\\\b\\""'))
  assert.ok(script.trimEnd().endsWith('end tell'))
})

test('captureHandoffTarget: claude con worktree usa realCwd y claudeSessionId', () => {
  const session = {
    activeCli: 'claude',
    claudeSessionId: 'sid-1',
    cwd: '/real/proyecto',
    pty: {},
    gitWorkspace: { realCwd: '/real/proyecto', workCwd: '/worktrees/x' }
  }
  assert.deepStrictEqual(captureHandoffTarget(session), { cli: 'claude', cwd: '/real/proyecto', sessionId: 'sid-1' })
})

test('captureHandoffTarget: codex sin worktree usa session.cwd y codexSessionId', () => {
  const session = { activeCli: 'codex', codexSessionId: 'rollout-9', cwd: '/tmp/p', pty: {}, gitWorkspace: null }
  assert.deepStrictEqual(captureHandoffTarget(session), { cli: 'codex', cwd: '/tmp/p', sessionId: 'rollout-9' })
})

// Con codex el id no lo escribe ningún vigía (solo el spawn con `resume`), así
// que una sesión nueva llega aquí con el campo vacío: se resuelve EN EL CLIC
// leyendo el historial filtrado por el arranque del PTY. Antes el meta lo
// rellenaba con la conversación anterior y el botón abría esa (bug 2026-08-07).
test('captureHandoffTarget: codex sin id lo resuelve en el momento del clic', () => {
  const session = { activeCli: 'codex', codexSessionId: '', cwd: '/tmp/p', pty: {}, ptyStartedAt: 1000 }
  const seen = []
  const target = captureHandoffTarget(session, {
    resolveCodexSessionId: (s) => { seen.push(s); return 'rollout-nuevo' }
  })
  assert.deepStrictEqual(target, { cli: 'codex', cwd: '/tmp/p', sessionId: 'rollout-nuevo' })
  assert.strictEqual(seen.length, 1)
  assert.strictEqual(seen[0], session)
})

test('captureHandoffTarget: codex con id propio no consulta el historial', () => {
  const session = { activeCli: 'codex', codexSessionId: 'rollout-9', cwd: '/tmp/p', pty: {} }
  let llamadas = 0
  const target = captureHandoffTarget(session, {
    resolveCodexSessionId: () => { llamadas += 1; return 'otro' }
  })
  assert.strictEqual(target.sessionId, 'rollout-9')
  assert.strictEqual(llamadas, 0)
})

test('captureHandoffTarget: codex sin conversación aún da error, no abre otra', () => {
  const session = { activeCli: 'codex', codexSessionId: '', cwd: '/tmp/p', pty: {} }
  const r = captureHandoffTarget(session, { resolveCodexSessionId: () => null })
  assert.ok(r.error)
  assert.match(r.error, /conversación/i)
})

test('captureHandoffTarget: un resolver que revienta no tumba el botón', () => {
  const session = { activeCli: 'codex', codexSessionId: '', cwd: '/tmp/p', pty: {} }
  const r = captureHandoffTarget(session, {
    resolveCodexSessionId: () => { throw new Error('historial ilegible') }
  })
  assert.ok(r.error)
})

test('captureHandoffTarget: claude no consulta el resolver de codex', () => {
  const session = { activeCli: 'claude', claudeSessionId: 'sid-1', cwd: '/tmp/p', pty: {} }
  let llamadas = 0
  const target = captureHandoffTarget(session, {
    resolveCodexSessionId: () => { llamadas += 1; return 'rollout' }
  })
  assert.strictEqual(target.sessionId, 'sid-1')
  assert.strictEqual(llamadas, 0)
})

test('captureHandoffTarget: sin sesión o sin sessionId devuelve error', () => {
  assert.ok(captureHandoffTarget(null).error)
  assert.ok(captureHandoffTarget({ activeCli: 'claude', claudeSessionId: '', cwd: '/tmp', pty: {} }).error)
  assert.ok(captureHandoffTarget({ activeCli: 'codex', codexSessionId: null, cwd: '/tmp', pty: {} }).error)
})

test('captureHandoffTarget: sin PTY vivo devuelve error aunque haya sessionId restaurado', () => {
  const session = { activeCli: 'claude', claudeSessionId: 'sid-viejo', cwd: '/tmp/p', pty: null }
  const r = captureHandoffTarget(session)
  assert.ok(r.error)
  assert.match(r.error, /sesión corriendo/i)
})

test('openInTerminal: llama osascript -e con el script y resuelve', async () => {
  const calls = []
  const fakeExec = (bin, args, cb) => { calls.push({ bin, args }); cb(null) }
  await openInTerminal({ cli: 'claude', cwd: '/tmp/p', sessionId: 'sid', execFileImpl: fakeExec })
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].bin, 'osascript')
  assert.strictEqual(calls[0].args[0], '-e')
  assert.ok(calls[0].args[1].includes("claude --resume 'sid'"))
})

test('openInTerminal: propaga el error de osascript', async () => {
  const fakeExec = (_b, _a, cb) => cb(new Error('boom'))
  await assert.rejects(
    () => openInTerminal({ cli: 'claude', cwd: '/tmp/p', sessionId: 'sid', execFileImpl: fakeExec }),
    /boom/
  )
})

test('openInTerminal: input inválido rechaza sin llamar a exec', async () => {
  let called = false
  const fakeExec = (_b, _a, cb) => { called = true; cb(null) }
  await assert.rejects(() => openInTerminal({ cli: 'nope', cwd: '/tmp', sessionId: 'x', execFileImpl: fakeExec }))
  assert.strictEqual(called, false)
})
