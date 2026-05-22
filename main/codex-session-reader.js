'use strict'

// Lectura/cache de history.jsonl, session_index.jsonl y state_5.sqlite de Codex.
// Devuelve siempre desde caché si el stat (mtime+size) no cambió.

const fs = require('fs')
const { spawnSync } = require('child_process')
const {
  statCacheKey,
  safeStat,
  clipText,
  escapeSqlLiteral
} = require('./session-helpers')

function fileCacheKey(filePath) {
  return statCacheKey(safeStat(filePath))
}

function createCodexSessionReader({ historyPath, sessionIndexPath, stateDbPath }) {
  let codexHistoryCache = { key: '', rows: [] }
  let codexSessionIndexCache = { key: '', byId: new Map() }
  let codexStateThreadCache = new Map()
  let codexStateDbCacheKey = ''

  function loadCodexHistoryRows() {
    const key = fileCacheKey(historyPath)
    if (!key) return []
    if (codexHistoryCache.key === key) return codexHistoryCache.rows

    let rows = []
    try {
      const raw = fs.readFileSync(historyPath, 'utf-8')
      rows = raw
        .split('\n')
        .map((line) => {
          if (!line.trim()) return null
          try {
            const obj = JSON.parse(line)
            const sessionId = typeof obj?.session_id === 'string' ? obj.session_id.trim() : ''
            const ts = Number(obj?.ts)
            const tsMs = Number.isFinite(ts) ? ts * 1000 : 0
            const text = typeof obj?.text === 'string' ? clipText(obj.text, 220) : ''
            if (!sessionId) return null
            return { sessionId, tsMs, text }
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {}

    if (rows.length > 5000) rows = rows.slice(-5000)
    codexHistoryCache = { key, rows }
    return rows
  }

  function loadCodexSessionIndexMap() {
    const key = fileCacheKey(sessionIndexPath)
    if (!key) return new Map()
    if (codexSessionIndexCache.key === key) return codexSessionIndexCache.byId

    const byId = new Map()
    try {
      const raw = fs.readFileSync(sessionIndexPath, 'utf-8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          const id = typeof obj?.id === 'string' ? obj.id.trim() : ''
          const title = clipText(obj?.thread_name || obj?.title || obj?.preview || '', 220)
          if (id && title) byId.set(id, title)
        } catch {}
      }
    } catch {}

    codexSessionIndexCache = { key, byId }
    return byId
  }

  function readCodexStateThreadMeta(threadId) {
    const id = String(threadId || '').trim()
    if (!id) return null
    const dbKey = fileCacheKey(stateDbPath)
    if (!dbKey) return null
    if (codexStateDbCacheKey !== dbKey) {
      codexStateDbCacheKey = dbKey
      codexStateThreadCache = new Map()
    }
    if (codexStateThreadCache.has(id)) return codexStateThreadCache.get(id)

    const sql = `select json_object('title', coalesce(title,''), 'cwd', coalesce(cwd,'')) from threads where id='${escapeSqlLiteral(id)}' order by updated_at desc limit 1;`
    let meta = null
    try {
      const out = spawnSync('sqlite3', [stateDbPath, sql], {
        encoding: 'utf8',
        timeout: 1200,
        maxBuffer: 1024 * 256
      })
      if (!out.error && out.status === 0) {
        const line = String(out.stdout || '').trim().split('\n')[0] || ''
        if (line.startsWith('{')) {
          const obj = JSON.parse(line)
          meta = {
            title: clipText(obj?.title || '', 220),
            cwd: String(obj?.cwd || '').trim()
          }
        }
      }
    } catch {}

    codexStateThreadCache.set(id, meta)
    if (codexStateThreadCache.size > 500) {
      const oldest = codexStateThreadCache.keys().next().value
      if (oldest) codexStateThreadCache.delete(oldest)
    }
    return meta
  }

  function guessCodexSessionFromHistory(session) {
    const rows = loadCodexHistoryRows()
    if (!rows.length) return null

    const sinceMs = Math.max(
      Number(session?.ptyStartedAt || 0),
      Number(session?.lastLocalInputAt || 0) - 1500
    )

    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]
      if (!row?.sessionId) continue
      if (sinceMs > 0 && row.tsMs > 0 && row.tsMs + 2000 < sinceMs) continue
      return row
    }

    return rows[rows.length - 1] || null
  }

  return {
    loadCodexHistoryRows,
    loadCodexSessionIndexMap,
    readCodexStateThreadMeta,
    guessCodexSessionFromHistory,
    fileCacheKey
  }
}

module.exports = {
  createCodexSessionReader,
  fileCacheKey
}
