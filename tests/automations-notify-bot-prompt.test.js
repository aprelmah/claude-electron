'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { buildSystemPrompt } = require('../automations/system-prompt')

test('el prompt del generador manda las notificaciones por el notify bot con fallback al principal', () => {
  const prompt = buildSystemPrompt({ patternsPath: '/nonexistent/patterns.md' })
  assert.match(prompt, /notifyBotToken/)
  assert.match(prompt, /notifyChatId/)
  assert.match(prompt, /botToken/)
  assert.match(prompt, /allowedUsers\[0\]/)
})
