const { spawn } = require('child_process')
const fs = require('fs')

// Lanza claude headless con persona como --system-prompt y devuelve texto.
// No usa --resume; cada turno es independiente (todo el contexto va en el prompt).
function runClaudePersona({ claudeBin, systemPrompt, prompt, env, cwd, timeoutMs = 60_000, signal }) {
  return new Promise((resolve, reject) => {
    if (!claudeBin || !fs.existsSync(claudeBin)) {
      return reject(new Error(`Claude no disponible (${claudeBin})`))
    }
    const args = [
      '-p', prompt,
      '--system-prompt', systemPrompt,
      '--permission-mode', 'bypassPermissions',
      '--output-format', 'text',
      '--no-session-persistence'
    ]

    let child
    try {
      child = spawn(claudeBin, args, { cwd: cwd || process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return reject(err)
    }

    let stdout = ''
    let stderr = ''
    let killed = false

    const to = setTimeout(() => {
      killed = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
    }, timeoutMs)

    const abortHandler = () => {
      killed = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
    }
    if (signal) {
      if (signal.aborted) abortHandler()
      else signal.addEventListener('abort', abortHandler, { once: true })
    }

    child.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    child.stderr.on('data', (d) => { stderr += d.toString('utf8') })
    child.on('error', (err) => {
      clearTimeout(to)
      if (signal) signal.removeEventListener('abort', abortHandler)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(to)
      if (signal) signal.removeEventListener('abort', abortHandler)
      if (killed) {
        const err = new Error('Auto-reply cancelado o timeout')
        err.name = 'AbortError'
        return reject(err)
      }
      if (code !== 0) {
        return reject(new Error(`claude exit ${code}: ${stderr.slice(-300).trim() || 'sin stderr'}`))
      }
      resolve(stdout.trim())
    })
  })
}

function buildPrompt({ displayNumber, history, body, maxHistory }) {
  const recent = (history || []).slice(-maxHistory)
  const turns = recent.map((m) => {
    const who = m.fromMe ? 'Tú' : 'Cliente'
    const text = (m.body || `[${m.type}]`).replace(/\s+/g, ' ').trim()
    return `${who}: ${text}`
  }).join('\n')
  const histBlock = turns ? `Histórico reciente:\n${turns}\n\n` : ''
  return [
    `Conversación con cliente ${displayNumber}.`,
    '',
    histBlock + `Mensaje nuevo del cliente: ${body}`,
    '',
    'Responde como el asistente de Luismi. Solo el texto de la respuesta, sin prefijos.'
  ].join('\n')
}

module.exports = { runClaudePersona, buildPrompt }
