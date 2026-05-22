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
  statCacheKey,
  safeStat,
  clipText,
  escapeSqlLiteral,
  escapeForCompactedPrompt,
  extractCodexResumeId,
  extractClaudeResumeId,
  createLruCache
}
