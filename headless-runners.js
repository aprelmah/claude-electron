const { spawn } = require('child_process')

const MAX_BUF = 1 * 1024 * 1024
const TRUNCATED_TAG = '...[truncated]...'
const DEFAULT_HEADLESS_TIMEOUT_MS = 300_000

// PERF-H5: antes hacíamos `buf + chunk` y luego slice → pico memoria 2× MAX_BUF.
// Ahora truncamos antes de concatenar cuando el resultado superaría el límite.
function appendBounded(buf, chunk) {
  const incoming = typeof chunk === 'string' ? chunk : String(chunk || '')
  if (buf.length + incoming.length <= MAX_BUF) {
    return buf + incoming
  }
  // Si el chunk solo ya excede MAX_BUF, guardamos su cola.
  if (incoming.length >= MAX_BUF) {
    return TRUNCATED_TAG + incoming.slice(-MAX_BUF + TRUNCATED_TAG.length)
  }
  // Caso normal: nos quedamos con tail de buf + chunk completo.
  const keepFromBuf = MAX_BUF - incoming.length - TRUNCATED_TAG.length
  if (keepFromBuf <= 0) {
    return TRUNCATED_TAG + incoming
  }
  return TRUNCATED_TAG + buf.slice(-keepFromBuf) + incoming
}

// SEC-H7: helper para auditar invocaciones headless. Hash truncado del prompt
// para no loggear contenido sensible, + origen, cli, sessionId.
function hashPromptTruncated(prompt) {
  try {
    const crypto = require('crypto')
    return crypto.createHash('sha256').update(String(prompt || '').slice(0, 4096)).digest('hex').slice(0, 16)
  } catch { return '' }
}

function createHeadlessRunners({ cliMeta, buildRuntimeEnv, commandExists, buildFdLimitCommand, getCwdSync, onAuditEvent }) {
  function _audit(action, details) {
    if (typeof onAuditEvent !== 'function') return
    try { onAuditEvent({ action, ts: Date.now(), ...details }) } catch {}
  }

  function runClaudeHeadless({ prompt, sessionId, signal, onText, onToolUse, onSessionId, model, effort, cwd, timeoutMs, origin }) {
    _audit('headless-claude-invoked', {
      cli: 'claude',
      origin: origin || 'unknown',
      sessionId: sessionId || null,
      model: model || null,
      effort: effort || null,
      prompt_hash: hashPromptTruncated(prompt),
      prompt_len: String(prompt || '').length,
      bypass_permissions: true
    })
    const meta = cliMeta('claude')
    const env = buildRuntimeEnv()
    if (!commandExists(meta.bin, env)) {
      return Promise.reject(new Error(`Claude no disponible (${meta.bin}). Configura ${meta.envVar}.`))
    }

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'bypassPermissions'
    ]
    if (model) args.push('--model', model)
    if (effort) args.push('--effort', effort)
    if (sessionId) args.push('--resume', sessionId)

    return new Promise((resolve, reject) => {
      const startedAt = Date.now()
      let killed = false
      let timedOut = false
      let child
      try {
        child = spawn('/bin/bash', ['-c', buildFdLimitCommand(meta.bin, args)], {
          cwd: cwd || getCwdSync(),
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (err) {
        return reject(err)
      }

      const killNow = () => {
        try { child.kill('SIGTERM') } catch {}
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
      }
      const abortHandler = () => {
        killed = true
        killNow()
      }
      if (signal) {
        if (signal.aborted) return abortHandler()
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_HEADLESS_TIMEOUT_MS
      const timeoutHandle = setTimeout(() => {
        timedOut = true
        killNow()
      }, effectiveTimeout)

      let buffer = ''
      let stderrBuf = ''
      let finalSessionId = null
      let finalText = ''
      let resultError = null

      child.stdout.on('data', (chunk) => {
        buffer = appendBounded(buffer, chunk.toString('utf8'))
        let nl
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          let obj
          try { obj = JSON.parse(line) } catch { continue }
          if (!obj || typeof obj !== 'object') continue

          if (obj.type === 'assistant' && obj.message?.content) {
            for (const block of obj.message.content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                onText?.(block.text)
              } else if (block?.type === 'tool_use' && block.name) {
                onToolUse?.(block.name)
              }
            }
          } else if (obj.type === 'result') {
            if (typeof obj.result === 'string') finalText = obj.result
            if (obj.is_error) resultError = obj.result || 'CLI devolvió error'
            if (obj.session_id) {
              finalSessionId = obj.session_id
              onSessionId?.(obj.session_id)
            }
          }
        }
      })

      child.stderr.on('data', (d) => { stderrBuf = appendBounded(stderrBuf, d.toString()) })
      child.on('error', (err) => {
        clearTimeout(timeoutHandle)
        if (signal) signal.removeEventListener('abort', abortHandler)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timeoutHandle)
        if (signal) signal.removeEventListener('abort', abortHandler)
        if (timedOut) {
          const err = new Error(`claude timeout tras ${effectiveTimeout} ms`)
          err.timedOut = true
          err.duration = Date.now() - startedAt
          return reject(err)
        }
        if (killed) {
          const err = new Error('Cancelado')
          err.name = 'AbortError'
          return reject(err)
        }
        if (resultError) return reject(new Error(String(resultError)))
        if (code !== 0) {
          return reject(new Error(`claude exit ${code}: ${stderrBuf.slice(-500).trim() || 'sin stderr'}`))
        }
        resolve({ sessionId: finalSessionId, text: finalText })
      })
    })
  }

  function runCodexHeadless({ prompt, sessionId, signal, onText, onSessionId, model, effort, cwd, timeoutMs, origin }) {
    _audit('headless-codex-invoked', {
      cli: 'codex',
      origin: origin || 'unknown',
      sessionId: sessionId || null,
      model: model || null,
      effort: effort || null,
      prompt_hash: hashPromptTruncated(prompt),
      prompt_len: String(prompt || '').length
    })
    const meta = cliMeta('codex')
    const env = buildRuntimeEnv()
    if (!commandExists(meta.bin, env)) {
      return Promise.reject(new Error(`Codex no disponible (${meta.bin}). Configura ${meta.envVar}.`))
    }

    const baseFlags = ['--skip-git-repo-check', '--json']
    if (model) baseFlags.push('-m', model)
    if (effort) baseFlags.push('-c', `model_reasoning_effort=${effort}`)

    const args = sessionId
      ? ['exec', 'resume', sessionId, ...baseFlags, prompt]
      : ['exec', ...baseFlags, prompt]

    return new Promise((resolve, reject) => {
      const startedAt = Date.now()
      let killed = false
      let timedOut = false
      let child
      try {
        child = spawn('/bin/bash', ['-c', buildFdLimitCommand(meta.bin, args)], {
          cwd: cwd || getCwdSync(),
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (err) {
        return reject(err)
      }

      const killNow = () => {
        try { child.kill('SIGTERM') } catch {}
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
      }
      const abortHandler = () => {
        killed = true
        killNow()
      }
      if (signal) {
        if (signal.aborted) return abortHandler()
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_HEADLESS_TIMEOUT_MS
      const timeoutHandle = setTimeout(() => {
        timedOut = true
        killNow()
      }, effectiveTimeout)

      let buffer = ''
      let stderrBuf = ''
      let finalSessionId = null
      let finalText = ''

      child.stdout.on('data', (chunk) => {
        buffer = appendBounded(buffer, chunk.toString('utf8'))
        let nl
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          let obj
          try { obj = JSON.parse(line) } catch { continue }
          if (!obj || typeof obj !== 'object') continue

          if (obj.type === 'thread.started' && obj.thread_id) {
            finalSessionId = obj.thread_id
            onSessionId?.(obj.thread_id)
          } else if (obj.type === 'item.completed' && obj.item?.type === 'agent_message' && typeof obj.item.text === 'string') {
            finalText = obj.item.text
            onText?.(obj.item.text)
          }
        }
      })

      child.stderr.on('data', (d) => { stderrBuf = appendBounded(stderrBuf, d.toString()) })
      child.on('error', (err) => {
        clearTimeout(timeoutHandle)
        if (signal) signal.removeEventListener('abort', abortHandler)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timeoutHandle)
        if (signal) signal.removeEventListener('abort', abortHandler)
        if (timedOut) {
          const err = new Error(`codex timeout tras ${effectiveTimeout} ms`)
          err.timedOut = true
          err.duration = Date.now() - startedAt
          return reject(err)
        }
        if (killed) {
          const err = new Error('Cancelado')
          err.name = 'AbortError'
          return reject(err)
        }
        if (code !== 0) {
          return reject(new Error(`codex exit ${code}: ${stderrBuf.slice(-500).trim() || 'sin stderr'}`))
        }
        resolve({ sessionId: finalSessionId, text: finalText })
      })
    })
  }

  return { runClaudeHeadless, runCodexHeadless }
}

module.exports = { createHeadlessRunners }
