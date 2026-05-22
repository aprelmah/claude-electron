'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { atomicWriteJsonSync } = require('./atomic-writes')

const INBOX_FILE = 'tasks-inbox.json'
const DEFAULT_MAX_ITEMS = 200
const SUMMARY_LIMIT = 240

function buildSummary(output) {
  if (typeof output !== 'string' || !output) return ''
  const flat = output.replace(/\s+/g, ' ').trim()
  if (flat.length <= SUMMARY_LIMIT) return flat
  return flat.slice(0, SUMMARY_LIMIT - 1) + '…'
}

function normalizeItem(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('inbox: item inválido')
  }
  const runId = String(input.runId || '').trim()
  if (!runId) throw new Error('inbox: runId requerido')
  const taskId = String(input.taskId || '').trim()
  if (!taskId) throw new Error('inbox: taskId requerido')

  const cli = input.cli === 'codex' ? 'codex' : 'claude'
  const sessionId = (typeof input.sessionId === 'string' && input.sessionId.trim())
    ? input.sessionId.trim()
    : null
  const cwd = (typeof input.cwd === 'string' && input.cwd.trim())
    ? input.cwd
    : os.homedir()
  const finishedAt = typeof input.finishedAt === 'string' && input.finishedAt
    ? input.finishedAt
    : new Date().toISOString()
  const output = typeof input.output === 'string' ? input.output : ''
  const summary = buildSummary(output)

  return {
    runId,
    taskId,
    taskName: typeof input.taskName === 'string' ? input.taskName : '',
    cli,
    sessionId,
    cwd,
    finishedAt,
    status: 'ok',
    summary,
    output,
    read: false,
    readAt: null
  }
}

function readSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    return []
  }
}

function sortDesc(items) {
  return items.slice().sort((a, b) => {
    const aT = (a && a.finishedAt) || ''
    const bT = (b && b.finishedAt) || ''
    return bT.localeCompare(aT)
  })
}

function applyCap(items, maxItems) {
  if (!Array.isArray(items)) return []
  if (items.length <= maxItems) return items
  // Ordenar ascendente por finishedAt para identificar más antiguos
  const sortedAsc = items.slice().sort((a, b) => {
    const aT = (a && a.finishedAt) || ''
    const bT = (b && b.finishedAt) || ''
    return aT.localeCompare(bT)
  })
  const toRemove = sortedAsc.length - maxItems
  const removeIds = new Set()
  // 1) los leídos más antiguos
  for (const it of sortedAsc) {
    if (removeIds.size >= toRemove) break
    if (it && it.read) removeIds.add(it.runId)
  }
  // 2) si aún faltan, los no leídos más antiguos
  if (removeIds.size < toRemove) {
    for (const it of sortedAsc) {
      if (removeIds.size >= toRemove) break
      if (it && !removeIds.has(it.runId)) removeIds.add(it.runId)
    }
  }
  return items.filter(it => !removeIds.has(it.runId))
}

function createInbox({ userDataDir, __maxItems } = {}) {
  if (!userDataDir) throw new Error('tasks-inbox: userDataDir requerido')
  const filePath = path.join(userDataDir, INBOX_FILE)
  const maxItems = (typeof __maxItems === 'number' && __maxItems > 0) ? __maxItems : DEFAULT_MAX_ITEMS

  try { fs.mkdirSync(userDataDir, { recursive: true }) } catch {}

  function loadAll() {
    return readSafe(filePath)
  }

  function persist(items) {
    atomicWriteJsonSync(filePath, items)
  }

  function appendUnread(rawItem) {
    const normalized = normalizeItem(rawItem)
    const items = loadAll()
    // Si llega un runId duplicado, lo reemplazamos
    const filtered = items.filter(it => it && it.runId !== normalized.runId)
    filtered.push(normalized)
    const capped = applyCap(filtered, maxItems)
    persist(capped)
    return normalized
  }

  function list({ unreadOnly = false, limit = 100 } = {}) {
    const items = loadAll()
    const filtered = unreadOnly ? items.filter(it => it && !it.read) : items
    const sorted = sortDesc(filtered)
    if (typeof limit === 'number' && limit > 0) return sorted.slice(0, limit)
    return sorted
  }

  function count({ unreadOnly = true } = {}) {
    const items = loadAll()
    if (!unreadOnly) return items.length
    let n = 0
    for (const it of items) if (it && !it.read) n++
    return n
  }

  function markRead(runId) {
    if (!runId) return false
    const items = loadAll()
    let changed = false
    for (const it of items) {
      if (it && it.runId === runId && !it.read) {
        it.read = true
        it.readAt = new Date().toISOString()
        changed = true
      }
    }
    if (changed) persist(items)
    return changed
  }

  function markAllRead() {
    const items = loadAll()
    const now = new Date().toISOString()
    let changed = false
    for (const it of items) {
      if (it && !it.read) {
        it.read = true
        it.readAt = now
        changed = true
      }
    }
    if (changed) persist(items)
    return changed
  }

  function getById(runId) {
    if (!runId) return null
    const items = loadAll()
    return items.find(it => it && it.runId === runId) || null
  }

  return {
    appendUnread,
    list,
    count,
    markRead,
    markAllRead,
    getById,
    _paths: { filePath }
  }
}

module.exports = { createInbox, buildSummary }
