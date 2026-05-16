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

function createExecutor({ runClaudeHeadless, runCodexHeadless, appConfig }) {
  if (typeof runClaudeHeadless !== 'function' || typeof runCodexHeadless !== 'function') {
    throw new Error('executor: runners requeridos')
  }

  return async function executeTask(task, { signal, onProgress } = {}) {
    if (!task) throw new Error('executor: task requerido')
    const { model, effort } = resolveModelEffort(task, appConfig)

    let buffer = ''
    let capturedSessionId = null

    const opts = {
      prompt: task.prompt,
      cwd: task.cwd || undefined,
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
