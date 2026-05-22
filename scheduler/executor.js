'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function resolveModelEffort(task, appConfig) {
  const tg = (appConfig && appConfig.telegram) || {}
  if (task.cli === 'codex') {
    return {
      model: task.model || tg.codexModel || '',
      effort: task.effort || tg.codexEffort || ''
    }
  }
  return {
    model: task.model || tg.claudeModel || '',
    effort: task.effort || tg.claudeEffort || ''
  }
}

// Cachea la lista de MCPs locales del usuario leída de ~/.claude.json.
// Re-lee como máximo cada 5 minutos. Si el fichero no existe o no se puede parsear,
// devuelve [] y deja la entrada en caché para evitar leer en cada disparo.
const LOCAL_MCP_TTL_MS = 5 * 60 * 1000
let _localMcpCache = { ts: 0, list: [] }

function readLocalMcpServersSync() {
  const now = Date.now()
  if (_localMcpCache.ts && (now - _localMcpCache.ts) < LOCAL_MCP_TTL_MS) {
    return _localMcpCache.list
  }
  let list = []
  try {
    const cfgPath = path.join(os.homedir(), '.claude.json')
    const raw = fs.readFileSync(cfgPath, 'utf8')
    const parsed = JSON.parse(raw)
    const servers = parsed && parsed.mcpServers
    if (servers && typeof servers === 'object') {
      list = Object.keys(servers).filter((name) => name && !/^claude\.ai/i.test(name))
    }
  } catch {
    list = []
  }
  _localMcpCache = { ts: now, list }
  return list
}

function buildPromptWithMcpWait(originalPrompt) {
  const mcps = readLocalMcpServersSync()
  if (!mcps.length) return originalPrompt
  const serversList = mcps.map((n) => JSON.stringify(n)).join(', ')
  const preamble = [
    'PASO 0 (no menciones esto en tu respuesta final, es solo preparación interna):',
    'Si vas a usar algún MCP local (cualquiera cuyo nombre NO empiece por "claude.ai"),',
    'invoca primero la tool WaitForMcpServers con servers=[' + serversList + '] y',
    'timeoutMs=10000 para asegurar que estén conectados antes de continuar.',
    '',
    '---',
    ''
  ].join('\n')
  return preamble + (originalPrompt || '')
}

function createExecutor({ runClaudeHeadless, runCodexHeadless, appConfig }) {
  if (typeof runClaudeHeadless !== 'function' || typeof runCodexHeadless !== 'function') {
    throw new Error('executor: runners requeridos')
  }

  return async function executeTask(task, { signal, onProgress } = {}) {
    if (!task) throw new Error('executor: task requerido')
    const { model, effort } = resolveModelEffort(task, appConfig)

    let buffer = ''
    let capturedSessionId = null

    const effectivePrompt = task.cli === 'claude'
      ? buildPromptWithMcpWait(task.prompt)
      : task.prompt

    const opts = {
      prompt: effectivePrompt,
      cwd: task.cwd || os.homedir(),
      model,
      effort,
      signal,
      onText: (chunk) => {
        if (typeof chunk !== 'string') return
        buffer += chunk
        if (typeof onProgress === 'function') {
          try { onProgress(buffer) } catch {}
        }
      },
      onSessionId: (sid) => {
        if (sid) capturedSessionId = sid
      }
    }

    if (task.resume && task.sessionId) opts.sessionId = task.sessionId

    const runner = task.cli === 'codex' ? runCodexHeadless : runClaudeHeadless
    const t0 = Date.now()
    const result = await runner(opts)
    const durationMs = Date.now() - t0

    const sessionId = (result && result.sessionId) || capturedSessionId || null
    const text = (result && (result.text || result.fullText)) || buffer

    return { output: text, sessionId, durationMs }
  }
}

module.exports = { createExecutor }
module.exports._internal = { readLocalMcpServersSync, buildPromptWithMcpWait }
