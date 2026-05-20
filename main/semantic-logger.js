'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const DEFAULT_LOG_PATH = path.join(os.homedir(), '.claude', 'power-agent-log.jsonl')
const MAX_ACTION_LEN = 80
const MAX_DETAIL_LEN = 4000
const MAX_SESSION_LEN = 128

function clipString(value, maxLen) {
  const s = typeof value === 'string' ? value : String(value || '')
  if (!s) return ''
  return s.length > maxLen ? s.slice(0, maxLen) : s
}

function normalizeCli(value) {
  return value === 'codex' ? 'codex' : 'claude'
}

function normalizeEvent(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const ts = Number.isFinite(raw.ts) ? Math.floor(raw.ts) : Date.now()
  const action = clipString(raw.action || '', MAX_ACTION_LEN).trim() || 'evento'
  const detail = clipString(raw.detail || '', MAX_DETAIL_LEN)
    .replace(/\r?\n/g, ' ')
    .trim()
  const session = clipString(raw.session || '', MAX_SESSION_LEN).trim()

  return {
    ts,
    session,
    cli: normalizeCli(raw.cli),
    action,
    detail,
    ok: raw.ok !== false
  }
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath)
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
}

function parseLine(line) {
  if (!line || !line.trim()) return null
  try {
    const obj = JSON.parse(line)
    return normalizeEvent(obj)
  } catch {
    return null
  }
}

function escapeCsv(value) {
  const raw = value == null ? '' : String(value)
  const escaped = raw.replace(/"/g, '""')
  if (/[",\n\r]/.test(escaped)) return `"${escaped}"`
  return escaped
}

function createSemanticLogger({ filePath = DEFAULT_LOG_PATH } = {}) {
  ensureParentDir(filePath)

  function log(event) {
    const normalized = normalizeEvent(event)
    try {
      fs.appendFileSync(filePath, `${JSON.stringify(normalized)}\n`, 'utf-8')
      return { ok: true, event: normalized }
    } catch (err) {
      console.error('[semantic-logger] append failed:', err?.message || err)
      return { ok: false, error: err?.message || String(err), event: normalized }
    }
  }

  function readRecent({ limit = 500 } = {}) {
    const max = Math.max(1, Math.min(5000, Number(limit) || 500))
    try {
      const text = fs.readFileSync(filePath, 'utf-8')
      const lines = text.split('\n')
      const parsed = []
      for (const line of lines) {
        const ev = parseLine(line)
        if (ev) parsed.push(ev)
      }
      return parsed.slice(-max).reverse()
    } catch {
      return []
    }
  }

  function toCsv(events) {
    const list = Array.isArray(events) ? events : []
    const header = ['ts', 'hora', 'session', 'cli', 'action', 'detail', 'ok']
    const rows = [header.join(',')]
    for (const ev of list) {
      const item = normalizeEvent(ev)
      const humanTime = new Date(item.ts).toISOString()
      rows.push([
        escapeCsv(item.ts),
        escapeCsv(humanTime),
        escapeCsv(item.session),
        escapeCsv(item.cli),
        escapeCsv(item.action),
        escapeCsv(item.detail),
        escapeCsv(item.ok ? 'true' : 'false')
      ].join(','))
    }
    return rows.join('\n') + '\n'
  }

  return {
    filePath,
    log,
    readRecent,
    toCsv
  }
}

module.exports = {
  createSemanticLogger,
  DEFAULT_LOG_PATH
}
