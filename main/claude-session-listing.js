'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function encodeProjectPath(p) {
  return p.replace(/\/$/, '').replace(/[\/\s]/g, '-')
}

function projectDirFor(cwd) {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(cwd))
}

function isReusableClaudeSessionId(raw) {
  const id = String(raw || '').trim()
  return !!id && /^[a-zA-Z0-9._:-]+$/.test(id)
}

function isReusableCodexSessionId(raw) {
  const id = String(raw || '').trim()
  return !!id && /^[a-zA-Z0-9._:-]+$/.test(id)
}

function listCodexSessionFiles() {
  const root = path.join(os.homedir(), '.codex', 'sessions')
  if (!fs.existsSync(root)) return []
  const out = []
  let years = []
  try { years = fs.readdirSync(root).filter((y) => /^\d{4}$/.test(y)) } catch { return [] }
  for (const year of years) {
    const yearDir = path.join(root, year)
    let months = []
    try { months = fs.readdirSync(yearDir).filter((m) => /^\d{2}$/.test(m)) } catch { continue }
    for (const month of months) {
      const monthDir = path.join(yearDir, month)
      let days = []
      try { days = fs.readdirSync(monthDir).filter((d) => /^\d{2}$/.test(d)) } catch { continue }
      for (const day of days) {
        const dayDir = path.join(monthDir, day)
        let files = []
        try { files = fs.readdirSync(dayDir).filter((f) => /^rollout-.+\.jsonl$/i.test(f)) } catch { continue }
        for (const f of files) out.push(path.join(dayDir, f))
      }
    }
  }
  return out
}

function readFirstNonEmptyLine(filePath, maxBytes = 64 * 1024) {
  let fd = -1
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(maxBytes)
    const read = fs.readSync(fd, buf, 0, maxBytes, 0)
    if (read <= 0) return ''
    const slice = buf.slice(0, read).toString('utf-8')
    const idx = slice.indexOf('\n')
    return (idx >= 0 ? slice.slice(0, idx) : slice).trim()
  } catch {
    return ''
  } finally {
    if (fd >= 0) {
      try { fs.closeSync(fd) } catch {}
    }
  }
}

function extractCodexSessionFirstPrompt(filePath, maxBytes = 64 * 1024) {
  let fd = -1
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(maxBytes)
    const read = fs.readSync(fd, buf, 0, maxBytes, 0)
    if (read <= 0) return ''
    const slice = buf.slice(0, read).toString('utf-8')
    const lines = slice.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj = null
      try { obj = JSON.parse(trimmed) } catch { continue }
      if (!obj || typeof obj !== 'object') continue
      const type = String(obj.type || '')
      const payload = obj.payload && typeof obj.payload === 'object' ? obj.payload : null
      if (type === 'event' || type === 'event_msg' || type === 'response_item' || type === 'item') {
        const role = String(payload?.role || payload?.author?.role || '')
        if (role && role !== 'user') continue
        const content = payload?.content
        let text = ''
        if (typeof content === 'string') text = content
        else if (Array.isArray(content)) {
          for (const part of content) {
            if (!part) continue
            if (typeof part.text === 'string' && part.text.trim()) { text = part.text; break }
            if (typeof part === 'string' && part.trim()) { text = part; break }
          }
        }
        text = String(text || '').replace(/\s+/g, ' ').trim()
        if (text) return text.slice(0, 160)
      }
      if (type === 'user_input' || type === 'user_message' || type === 'turn') {
        const text = String(payload?.text || payload?.prompt || '').replace(/\s+/g, ' ').trim()
        if (text) return text.slice(0, 160)
      }
    }
  } catch {} finally {
    if (fd >= 0) {
      try { fs.closeSync(fd) } catch {}
    }
  }
  return ''
}

function createSessionListing({ resolveClaudeProjectDir, resolveExistingDir, extractTurnText }) {
  function listClaudeSessionsForCwd(cwd, options = {}) {
    const dir = resolveClaudeProjectDir(cwd)
    if (!dir || !fs.existsSync(dir)) return []
    let files = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      return []
    }

    const rows = files.map((f) => {
      const id = f.replace(/\.jsonl$/, '')
      if (!isReusableClaudeSessionId(id)) return null
      const fullPath = path.join(dir, f)
      let mtime = 0
      let size = 0
      let preview = ''
      let msgCount = 0
      try {
        const stat = fs.statSync(fullPath)
        mtime = stat.mtime.getTime()
        size = stat.size
        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n').filter((l) => l.trim())
        msgCount = lines.length
        for (const line of lines) {
          try {
            const obj = JSON.parse(line)
            if (obj.type === 'user') {
              const text = extractTurnText(obj).replace(/<[^>]+>/g, '').trim()
              if (text && !text.startsWith('Caveat:')) {
                preview = text.slice(0, 160)
                break
              }
            }
          } catch {}
        }
      } catch {}
      return {
        id,
        mtime,
        size,
        preview: preview || '(sin contenido)',
        msgCount,
        path: fullPath
      }
    })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)

    const limit = Math.max(1, Math.min(Number.parseInt(options?.limit, 10) || 300, 1000))
    return rows.slice(0, limit)
  }

  function listCodexSessionsForCwd(cwd, options = {}) {
    const targetCwd = resolveExistingDir(cwd) || String(cwd || '').trim()
    if (!targetCwd) return []
    const files = listCodexSessionFiles()
    if (!files.length) return []
    const rows = []
    for (const fullPath of files) {
      const firstLine = readFirstNonEmptyLine(fullPath)
      if (!firstLine) continue
      let obj = null
      try { obj = JSON.parse(firstLine) } catch { continue }
      if (!obj || typeof obj !== 'object') continue
      if (String(obj.type || '') !== 'session_meta') continue
      const payload = obj.payload && typeof obj.payload === 'object' ? obj.payload : {}
      const id = String(payload.id || '').trim()
      if (!isReusableCodexSessionId(id)) continue
      const sessionCwd = String(payload.cwd || '').trim()
      if (!sessionCwd || sessionCwd !== targetCwd) continue
      let mtime = 0
      let size = 0
      try {
        const stat = fs.statSync(fullPath)
        mtime = stat.mtime.getTime()
        size = stat.size
      } catch {}
      const preview = extractCodexSessionFirstPrompt(fullPath) || '(sin contenido)'
      rows.push({
        id,
        mtime,
        size,
        preview,
        msgCount: 0,
        path: fullPath,
        cli: 'codex'
      })
    }
    rows.sort((a, b) => b.mtime - a.mtime)
    const limit = Math.max(1, Math.min(Number.parseInt(options?.limit, 10) || 300, 1000))
    return rows.slice(0, limit)
  }

  function listLanReusableSessions(meta = {}) {
    const cli = String(meta?.cli || '').trim().toLowerCase()
    const cwd = resolveExistingDir(meta?.cwd)
    if (!cwd) return []
    if (cli === 'codex') {
      return listCodexSessionsForCwd(cwd, { limit: 300 })
    }
    if (cli && cli !== 'claude') return []
    const rows = listClaudeSessionsForCwd(cwd, { limit: 300 })
    return rows.map((row) => ({ ...row, cli: 'claude' }))
  }

  return {
    listClaudeSessionsForCwd,
    listCodexSessionsForCwd,
    listLanReusableSessions
  }
}

module.exports = {
  encodeProjectPath,
  projectDirFor,
  isReusableClaudeSessionId,
  isReusableCodexSessionId,
  listCodexSessionFiles,
  readFirstNonEmptyLine,
  extractCodexSessionFirstPrompt,
  createSessionListing
}
