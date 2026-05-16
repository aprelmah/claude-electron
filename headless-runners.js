const { spawn } = require('child_process')

function createHeadlessRunners({ cliMeta, buildRuntimeEnv, commandExists, buildFdLimitCommand, getCwdSync }) {
  function runClaudeHeadless({ prompt, sessionId, signal, onText, onToolUse, onSessionId, model, effort, cwd }) {
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
      let killed = false
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

      const abortHandler = () => {
        killed = true
        try { child.kill('SIGTERM') } catch {}
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
      }
      if (signal) {
        if (signal.aborted) return abortHandler()
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      let buffer = ''
      let stderrBuf = ''
      let finalSessionId = null
      let finalText = ''
      let resultError = null

      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
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

      child.stderr.on('data', (d) => { stderrBuf += d.toString() })
      child.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', abortHandler)
        reject(err)
      })
      child.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', abortHandler)
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

  function runCodexHeadless({ prompt, sessionId, signal, onText, onSessionId, model, effort, cwd }) {
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
      let killed = false
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

      const abortHandler = () => {
        killed = true
        try { child.kill('SIGTERM') } catch {}
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
      }
      if (signal) {
        if (signal.aborted) return abortHandler()
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      let buffer = ''
      let stderrBuf = ''
      let finalSessionId = null
      let finalText = ''

      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
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

      child.stderr.on('data', (d) => { stderrBuf += d.toString() })
      child.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', abortHandler)
        reject(err)
      })
      child.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', abortHandler)
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
