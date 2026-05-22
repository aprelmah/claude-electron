'use strict'

const fs = require('fs')
const path = require('path')
const { atomicWriteJsonSync } = require('./atomic-writes')

const TASKS_FILE = 'scheduled-tasks.json'

function readTasksSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    return []
  }
}

function findTaskBySession(tasks, sessionId) {
  if (!sessionId) return null
  for (const t of tasks) {
    if (t && t.sessionId && t.sessionId === sessionId) return t
  }
  return null
}

function createSessionLinks({ userDataDir, getTelegramSessionsByChat, getWhatsAppLinks } = {}) {
  if (!userDataDir) throw new Error('session-links: userDataDir requerido')
  const tasksPath = path.join(userDataDir, TASKS_FILE)

  function _taskLink(sessionId) {
    if (!sessionId) return null
    const tasks = readTasksSafe(tasksPath)
    const t = findTaskBySession(tasks, sessionId)
    if (!t) return null
    return { id: t.id, name: t.name || '' }
  }

  function _telegramLink(sessionId) {
    if (!sessionId) return null
    if (typeof getTelegramSessionsByChat !== 'function') return null
    let map = null
    try { map = getTelegramSessionsByChat() } catch { map = null }
    if (!map) return null
    // map: Map<chatId, sessionId>
    try {
      if (typeof map.entries === 'function') {
        for (const [chatId, sid] of map.entries()) {
          if (sid === sessionId) return { chatId }
        }
      } else if (typeof map === 'object') {
        for (const chatId of Object.keys(map)) {
          if (map[chatId] === sessionId) return { chatId }
        }
      }
    } catch {}
    return null
  }

  function _whatsappLink(sessionId) {
    if (!sessionId) return null
    if (typeof getWhatsAppLinks !== 'function') return null
    let map = null
    try { map = getWhatsAppLinks() } catch { map = null }
    if (!map) return null
    try {
      if (typeof map.entries === 'function') {
        for (const [jid, sid] of map.entries()) {
          if (sid === sessionId) return { jid }
        }
      } else if (typeof map === 'object') {
        for (const jid of Object.keys(map)) {
          if (map[jid] === sessionId) return { jid }
        }
      }
    } catch {}
    return null
  }

  function getLinks(sessionId) {
    return {
      task: _taskLink(sessionId),
      telegram: _telegramLink(sessionId),
      whatsapp: _whatsappLink(sessionId)
    }
  }

  function isLinked(sessionId) {
    const l = getLinks(sessionId)
    return !!(l.task || l.telegram || l.whatsapp)
  }

  async function clearTaskLink(sessionId) {
    if (!sessionId) return false
    const tasks = readTasksSafe(tasksPath)
    let changed = false
    for (const t of tasks) {
      if (t && t.sessionId === sessionId) {
        t.sessionId = null
        t.updatedAt = new Date().toISOString()
        changed = true
      }
    }
    if (!changed) return false
    atomicWriteJsonSync(tasksPath, tasks)
    return true
  }

  return {
    getLinks,
    isLinked,
    clearTaskLink,
    _paths: { tasksPath }
  }
}

module.exports = { createSessionLinks }
