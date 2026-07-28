'use strict'

// Pequeños helpers puros usados por la gestión de sesiones Claude/Codex.
// No tienen estado: aquí solo van transformaciones de strings y reading triviales.

const fs = require('fs')

function extractTurnText(obj) {
  if (!obj?.message?.content) return ''
  const content = obj.message.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block?.type === 'text' && typeof block.text === 'string') return block.text
        return ''
      })
      .join(' ')
      .trim()
  }
  return ''
}

// Directorio donde el CLI escribe DE VERDAD su transcript.
//
// Con aislamiento git por sesión, claude corre dentro del worktree y su JSONL
// va a ~/.claude/projects/<worktree-codificado>/, mientras que session.cwd sigue
// siendo el path real a propósito (UI y recientes intactos). El relay de
// Telegram debe mirar el worktree: si busca en el cwd real no encuentra el turno
// en curso, nunca ve end_turn y acaba mandando la pantalla raspada.
//
// Fail-open: sin gitWorkspace (toggle off, cwd no-git, path remoto) devuelve el
// cwd de siempre.
function resolveRelayCwd(session) {
  if (!session) return null
  return session.gitWorkspace?.workCwd || session.cwd || null
}

// Los dos sitios donde puede vivir el transcript de la sesión: el worktree
// (sesión nacida ahí) y el cwd real (sesión resumida con --resume, que Claude
// Code sigue escribiendo en su proyecto original). El orden no implica
// prioridad: quien busca se queda con el fichero más reciente.
function relayCwdCandidates(session) {
  if (!session) return []
  const out = []
  for (const cwd of [session.gitWorkspace?.workCwd, session.cwd]) {
    if (cwd && !out.includes(cwd)) out.push(cwd)
  }
  return out
}

function statCacheKey(stat) {
  if (!stat) return ''
  return `${Number(stat.mtimeMs || 0)}:${Number(stat.size || 0)}`
}

function safeStat(filePath) {
  try { return fs.statSync(filePath) } catch { return null }
}

function clipText(text, max = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function escapeSqlLiteral(text) {
  return String(text || '').replace(/'/g, "''")
}

function escapeForCompactedPrompt(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function extractCodexResumeId(args) {
  if (!Array.isArray(args) || args.length < 2) return null
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === 'resume' && args[i + 1]) return String(args[i + 1]).trim()
  }
  return null
}

function extractClaudeResumeId(args) {
  if (!Array.isArray(args) || args.length < 2) return null
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--resume' && args[i + 1]) return String(args[i + 1]).trim()
  }
  return null
}

// `model` solo aplica a claude (prepend `--model`); evita el gate de créditos
// del contexto 1M cuando se le pasa un id estándar (ej. 'opus'). Codex intacto.
function buildResumeArgs(cli, sessionId, model = '') {
  const sid = String(sessionId || '').trim()
  if (cli === 'codex') return sid ? ['resume', sid] : []
  const m = String(model || '').trim()
  const modelArgs = m ? ['--model', m] : []
  return sid ? [...modelArgs, '--resume', sid] : modelArgs
}

// Caches con LRU manual: una vez la clave existe se renueva la posición.
// Capacidad por defecto sensata; quien instancia pasa max.
function createLruCache(max = 300) {
  const m = new Map()
  return {
    get(key) { return m.get(key) },
    has(key) { return m.has(key) },
    set(key, value) {
      if (m.has(key)) m.delete(key)
      m.set(key, value)
      if (m.size > max) {
        const oldest = m.keys().next().value
        if (oldest !== undefined) m.delete(oldest)
      }
    },
    delete(key) { m.delete(key) },
    size() { return m.size },
    clear() { m.clear() },
    raw() { return m }
  }
}

module.exports = {
  extractTurnText,
  resolveRelayCwd,
  relayCwdCandidates,
  statCacheKey,
  safeStat,
  clipText,
  escapeSqlLiteral,
  escapeForCompactedPrompt,
  extractCodexResumeId,
  extractClaudeResumeId,
  buildResumeArgs,
  createLruCache
}
