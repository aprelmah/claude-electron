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

function listCodexSessionFiles(sessionsRoot) {
  const root = sessionsRoot || path.join(os.homedir(), '.codex', 'sessions')
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

function streamFirstUserPreview(filePath, extractTurnText, chunkSize = 64 * 1024, maxBytes = 4 * 1024 * 1024) {
  let fd = -1
  try {
    fd = fs.openSync(filePath, 'r')
  } catch {
    return ''
  }
  try {
    const buf = Buffer.alloc(chunkSize)
    let leftover = ''
    let pos = 0
    let totalRead = 0
    while (totalRead < maxBytes) {
      const read = fs.readSync(fd, buf, 0, chunkSize, pos)
      if (read <= 0) break
      pos += read
      totalRead += read
      const chunk = buf.slice(0, read).toString('utf-8')
      const combined = leftover + chunk
      const lines = combined.split('\n')
      leftover = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let obj = null
        try { obj = JSON.parse(trimmed) } catch { continue }
        if (obj?.type !== 'user') continue
        const text = extractTurnText(obj).replace(/<[^>]+>/g, '').trim()
        if (text && !text.startsWith('Caveat:')) {
          return text.slice(0, 160)
        }
      }
      if (read < chunkSize) break
    }
    if (leftover.trim()) {
      try {
        const obj = JSON.parse(leftover.trim())
        if (obj?.type === 'user') {
          const text = extractTurnText(obj).replace(/<[^>]+>/g, '').trim()
          if (text && !text.startsWith('Caveat:')) return text.slice(0, 160)
        }
      } catch {}
    }
  } finally {
    try { fs.closeSync(fd) } catch {}
  }
  return ''
}

function streamCountLines(filePath, chunkSize = 64 * 1024) {
  let fd = -1
  try {
    fd = fs.openSync(filePath, 'r')
  } catch {
    return 0
  }
  try {
    const buf = Buffer.alloc(chunkSize)
    let pos = 0
    let count = 0
    let lastByte = -1
    while (true) {
      const read = fs.readSync(fd, buf, 0, chunkSize, pos)
      if (read <= 0) break
      pos += read
      for (let i = 0; i < read; i++) {
        if (buf[i] === 0x0a) count++
        lastByte = buf[i]
      }
      if (read < chunkSize) break
    }
    if (lastByte !== -1 && lastByte !== 0x0a) count++
    return count
  } finally {
    try { fs.closeSync(fd) } catch {}
  }
}

function createSessionListing(opts = {}) {
  const { resolveClaudeProjectDir, resolveExistingDir, extractTurnText, claudeIndex = null } = opts
  function resolveIndex() {
    if (!claudeIndex) return null
    if (typeof claudeIndex === 'function') {
      try { return claudeIndex() || null } catch { return null }
    }
    return claudeIndex
  }
  function getCodexIndex() {
    return opts.codexIndex || null
  }

  function listClaudeSessionsForCwd(cwd, options = {}) {
    const dir = resolveClaudeProjectDir(cwd)
    if (!dir || !fs.existsSync(dir)) return []
    let files = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      return []
    }

    const idx = resolveIndex()
    const cwdKey = String(cwd || '').trim()
    const cachedMap = idx && cwdKey ? idx.getForCwd(cwdKey) : {}
    const seenIds = new Set()

    const rows = files.map((f) => {
      const id = f.replace(/\.jsonl$/, '')
      if (!isReusableClaudeSessionId(id)) return null
      seenIds.add(id)
      const fullPath = path.join(dir, f)
      let mtime = 0
      let size = 0
      let stat = null
      try {
        stat = fs.statSync(fullPath)
        mtime = stat.mtime.getTime()
        size = stat.size
      } catch {
        return {
          id,
          mtime: 0,
          size: 0,
          preview: '(sin contenido)',
          msgCount: 0,
          path: fullPath
        }
      }

      const cached = cachedMap[id]
      if (cached && cached.mtime === mtime && cached.size === size) {
        return {
          id,
          mtime,
          size,
          preview: cached.preview || '(sin contenido)',
          msgCount: Number.isFinite(cached.msgCount) ? cached.msgCount : 0,
          path: fullPath
        }
      }

      const preview = streamFirstUserPreview(fullPath, extractTurnText)
      const msgCount = streamCountLines(fullPath)

      if (idx && cwdKey) {
        try {
          idx.set(cwdKey, id, { preview, msgCount, mtime, size })
        } catch {}
      }

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

    if (idx && cwdKey) {
      for (const sid of Object.keys(cachedMap)) {
        if (!seenIds.has(sid)) {
          try { idx.removeSession(cwdKey, sid) } catch {}
        }
      }
    }

    const limit = Math.max(1, Math.min(Number.parseInt(options?.limit, 10) || 300, 1000))
    return rows.slice(0, limit)
  }

  function listCodexSessionsForCwd(cwd, options = {}) {
    const targetCwd = resolveExistingDir(cwd) || String(cwd || '').trim()
    if (!targetCwd) return []
    const limit = Math.max(1, Math.min(Number.parseInt(options?.limit, 10) || 300, 1000))
    const idx = getCodexIndex()
    if (idx && typeof idx.getForCwd === 'function') {
      const entries = idx.getForCwd(targetCwd)
      if (entries && entries.length > 0) {
        return entries.slice(0, limit).map((e) => ({
          id: e.id,
          mtime: e.mtime,
          size: e.size,
          preview: e.preview || '(sin contenido)',
          msgCount: 0,
          path: e.path,
          cli: 'codex'
        }))
      }
      // Si el índice está vacío para este cwd, caer al walk como red de seguridad
      // (puede ser que el bootstrap aún no haya completado).
    }
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
  streamFirstUserPreview,
  streamCountLines,
  createSessionListing
}
