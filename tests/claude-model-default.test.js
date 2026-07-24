const { test } = require('node:test')
const assert = require('node:assert')

const { buildResumeArgs } = require('../main/session-helpers')
const { buildLanCliArgs } = require('../main/lan-helpers')
const { sanitizeClaudeModel } = require('../main/config-store')

test('buildResumeArgs: claude sin sesión prepende --model', () => {
  assert.deepStrictEqual(buildResumeArgs('claude', '', 'opus'), ['--model', 'opus'])
})

test('buildResumeArgs: claude con sesión, modelo antes de --resume', () => {
  assert.deepStrictEqual(
    buildResumeArgs('claude', 'sid-123', 'opus'),
    ['--model', 'opus', '--resume', 'sid-123']
  )
})

test('buildResumeArgs: claude sin modelo no añade flag (back-compat)', () => {
  assert.deepStrictEqual(buildResumeArgs('claude', ''), [])
  assert.deepStrictEqual(buildResumeArgs('claude', 'sid'), ['--resume', 'sid'])
})

test('buildResumeArgs: codex intacto, ignora modelo', () => {
  assert.deepStrictEqual(buildResumeArgs('codex', 'sid', 'opus'), ['resume', 'sid'])
  assert.deepStrictEqual(buildResumeArgs('codex', ''), [])
})

test('buildLanCliArgs: claude sin modelo cae a opus (no 1M)', () => {
  assert.deepStrictEqual(buildLanCliArgs('claude', {}), ['--model', 'opus'])
})

test('buildLanCliArgs: claude respeta modelo explícito', () => {
  assert.deepStrictEqual(
    buildLanCliArgs('claude', { model: 'sonnet' }),
    ['--model', 'sonnet']
  )
})

test('buildLanCliArgs: codex no recibe floor opus', () => {
  const args = buildLanCliArgs('codex', {})
  assert.ok(!args.includes('--model'))
  assert.ok(!args.includes('opus'))
})

test('sanitizeClaudeModel: default opus y validación', () => {
  assert.strictEqual(sanitizeClaudeModel(''), 'opus')
  assert.strictEqual(sanitizeClaudeModel(undefined), 'opus')
  assert.strictEqual(sanitizeClaudeModel('  Sonnet  '), 'sonnet')
  assert.strictEqual(sanitizeClaudeModel('claude-opus-4-8'), 'claude-opus-4-8')
  assert.strictEqual(sanitizeClaudeModel('claude-opus-4-8[1m]'), 'claude-opus-4-8[1m]')
  // inyección / basura → fallback
  assert.strictEqual(sanitizeClaudeModel('opus; rm -rf /'), 'opus')
  assert.strictEqual(sanitizeClaudeModel('a'.repeat(70)), 'opus')
})
