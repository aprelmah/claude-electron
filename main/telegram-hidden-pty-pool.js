'use strict'

const DEFAULT_TTL_MS = 15 * 60 * 1000
const DEFAULT_MAX_SIZE = 3
const DEFAULT_SWEEP_MS = 60 * 1000

function normalizeChatKey(chatId) {
  if (chatId == null) return ''
  const k = String(chatId).trim()
  return k || ''
}

function createTelegramHiddenPtyPool({
  openWindow,
  startPty,
  getTaskState,
  closeWindow,
  bindRelay,
  unbindRelay,
  getNow,
  setIntervalFn,
  clearIntervalFn,
  log,
  ttlMs,
  maxSize,
  sweepMs
} = {}) {
  if (typeof openWindow !== 'function') throw new Error('hidden-pty-pool: openWindow requerido')
  if (typeof startPty !== 'function') throw new Error('hidden-pty-pool: startPty requerido')

  const now = typeof getNow === 'function' ? getNow : () => Date.now()
  const setIv = typeof setIntervalFn === 'function' ? setIntervalFn : setInterval
  const clearIv = typeof clearIntervalFn === 'function' ? clearIntervalFn : clearInterval
  const trace = typeof log === 'function' ? log : () => {}

  const TTL = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS
  const MAX = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : DEFAULT_MAX_SIZE
  const SWEEP = Number.isFinite(sweepMs) && sweepMs > 0 ? sweepMs : DEFAULT_SWEEP_MS

  // chatId(string) → { wcId, sessionId, cli, cwd, taskName, ts, createdAt }
  const byChat = new Map()
  let sweepTimer = null
  let destroyed = false

  function _touch(chatId) {
    const key = normalizeChatKey(chatId)
    if (!key) return false
    const entry = byChat.get(key)
    if (!entry) return false
    entry.ts = now()
    return true
  }

  function _closeEntry(chatId, reason = 'manual') {
    const key = normalizeChatKey(chatId)
    if (!key) return false
    const entry = byChat.get(key)
    if (!entry) return false
    byChat.delete(key)
    try { unbindRelay?.(key, entry.wcId) } catch {}
    try {
      if (typeof closeWindow === 'function') closeWindow(entry.wcId, reason)
    } catch (err) {
      trace('close-window-error', { chatId: key, reason, error: err?.message || String(err) })
    }
    if (byChat.size === 0 && sweepTimer) {
      try { clearIv(sweepTimer) } catch {}
      sweepTimer = null
    }
    trace('close', { chatId: key, reason, wcId: entry.wcId })
    return true
  }

  function _evictLruIfNeeded() {
    if (byChat.size < MAX) return
    let oldestKey = null
    let oldestTs = Infinity
    for (const [k, v] of byChat.entries()) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k }
    }
    if (oldestKey) _closeEntry(oldestKey, 'lru')
  }

  async function ensureHiddenPtyForChat({ chatId, sessionId, cli, cwd, taskName } = {}) {
    if (destroyed) return { ok: false, error: 'pool-destroyed' }
    const key = normalizeChatKey(chatId)
    if (!key) return { ok: false, error: 'chatId-invalido' }
    if (!sessionId || typeof sessionId !== 'string') return { ok: false, error: 'sessionId-invalido' }
    const targetCli = cli === 'codex' ? 'codex' : 'claude'

    const existing = byChat.get(key)
    if (existing) {
      if (existing.sessionId === sessionId && existing.cli === targetCli) {
        existing.ts = now()
        // Si el binding se perdió (p.ej. /salir), re-enlazar idempotente.
        try { bindRelay?.(key, existing.wcId) } catch {}
        trace('reuse', { chatId: key, wcId: existing.wcId, sessionId })
        return { ok: true, wcId: existing.wcId, reused: true }
      }
      _closeEntry(key, 'replace')
    }

    _evictLruIfNeeded()

    let win
    try {
      win = await openWindow({
        sessionId,
        cli: targetCli,
        cwd: cwd || '',
        taskName: taskName || '',
        hidden: true
      })
    } catch (err) {
      trace('open-window-error', { chatId: key, error: err?.message || String(err) })
      return { ok: false, error: `openWindow falló: ${err?.message || String(err)}` }
    }
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
      return { ok: false, error: 'openWindow no devolvió ventana válida' }
    }
    const wcId = win.webContents?.id ?? null
    if (wcId == null) {
      return { ok: false, error: 'ventana sin webContents id' }
    }

    const state = typeof getTaskState === 'function' ? getTaskState(wcId) : null
    if (!state) {
      trace('no-task-state', { chatId: key, wcId })
      try { closeWindow?.(wcId, 'no-task-state') } catch {}
      return { ok: false, error: 'task-session state no encontrado' }
    }

    try {
      startPty(state)
    } catch (err) {
      trace('start-pty-error', { chatId: key, wcId, error: err?.message || String(err) })
      try { closeWindow?.(wcId, 'pty-failed') } catch {}
      return { ok: false, error: `startPty falló: ${err?.message || String(err)}` }
    }

    if (typeof bindRelay === 'function') {
      try { bindRelay(key, wcId) } catch (err) {
        trace('bind-relay-error', { chatId: key, wcId, error: err?.message || String(err) })
      }
    }

    const entry = {
      wcId,
      sessionId,
      cli: targetCli,
      cwd: cwd || '',
      taskName: taskName || '',
      ts: now(),
      createdAt: now()
    }
    byChat.set(key, entry)
    trace('spawn', { chatId: key, wcId, sessionId, cli: targetCli })
    _ensureSweepRunning()
    return { ok: true, wcId, reused: false }
  }

  function getHiddenPtyForChat(chatId) {
    const key = normalizeChatKey(chatId)
    if (!key) return null
    const entry = byChat.get(key)
    if (!entry) return null
    return {
      wcId: entry.wcId,
      sessionId: entry.sessionId,
      cli: entry.cli,
      ts: entry.ts,
      ttlMs: TTL
    }
  }

  function showHiddenPty(chatId) {
    const key = normalizeChatKey(chatId)
    if (!key) return false
    const entry = byChat.get(key)
    if (!entry) return false
    const state = typeof getTaskState === 'function' ? getTaskState(entry.wcId) : null
    const win = state?.win
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
      byChat.delete(key)
      try { unbindRelay?.(key, entry.wcId) } catch {}
      return false
    }
    try {
      if (typeof win.isMinimized === 'function' && win.isMinimized() && typeof win.restore === 'function') {
        win.restore()
      }
      if (typeof win.show === 'function') win.show()
      if (typeof win.focus === 'function') win.focus()
    } catch (err) {
      trace('show-error', { chatId: key, error: err?.message || String(err) })
      return false
    }
    entry.ts = now()
    trace('show', { chatId: key, wcId: entry.wcId })
    return true
  }

  function closeHiddenPty(chatId, reason = 'manual') {
    return _closeEntry(chatId, reason)
  }

  function touchHiddenPty(chatId) {
    return _touch(chatId)
  }

  function notifyWindowClosed(wcId) {
    if (wcId == null) return false
    let removed = 0
    for (const [k, v] of byChat.entries()) {
      if (v.wcId === wcId) {
        byChat.delete(k)
        removed++
        try { unbindRelay?.(k, wcId) } catch {}
        trace('window-closed', { chatId: k, wcId })
      }
    }
    if (removed > 0 && byChat.size === 0 && sweepTimer) {
      try { clearIv(sweepTimer) } catch {}
      sweepTimer = null
    }
    return removed > 0
  }

  function notifySessionRotated(wcId, nextSessionId, nextCli) {
    if (wcId == null) return 0
    if (!nextSessionId || typeof nextSessionId !== 'string') return 0
    const cli = nextCli === 'codex' ? 'codex' : 'claude'
    let updated = 0
    for (const entry of byChat.values()) {
      if (entry.wcId !== wcId) continue
      entry.sessionId = nextSessionId
      entry.cli = cli
      entry.ts = now()
      updated++
    }
    if (updated > 0) trace('session-rotated', { wcId, sessionId: nextSessionId, cli, updated })
    return updated
  }

  function getStats() {
    const items = []
    let oldestIdleMs = 0
    const t = now()
    for (const [k, v] of byChat.entries()) {
      const idle = t - v.ts
      if (idle > oldestIdleMs) oldestIdleMs = idle
      items.push({
        chatId: k,
        wcId: v.wcId,
        sessionId: v.sessionId,
        cli: v.cli,
        idleMs: idle,
        ageMs: t - v.createdAt
      })
    }
    return { count: byChat.size, byChat: items, oldestIdleMs, ttlMs: TTL, maxSize: MAX }
  }

  function sweep() {
    const t = now()
    const expired = []
    for (const [k, v] of byChat.entries()) {
      if (t - v.ts > TTL) expired.push(k)
    }
    for (const k of expired) _closeEntry(k, 'ttl-expired')
    if (byChat.size === 0 && sweepTimer) {
      try { clearIv(sweepTimer) } catch {}
      sweepTimer = null
    }
    return expired.length
  }

  function _ensureSweepRunning() {
    if (sweepTimer || destroyed) return
    sweepTimer = setIv(() => { try { sweep() } catch {} }, SWEEP)
    if (sweepTimer && typeof sweepTimer.unref === 'function') {
      try { sweepTimer.unref() } catch {}
    }
  }

  function destroy(reason = 'app-quit') {
    if (destroyed) return
    destroyed = true
    if (sweepTimer) { try { clearIv(sweepTimer) } catch {} ; sweepTimer = null }
    const keys = [...byChat.keys()]
    for (const k of keys) _closeEntry(k, reason)
  }

  return {
    ensureHiddenPtyForChat,
    getHiddenPtyForChat,
    showHiddenPty,
    closeHiddenPty,
    touchHiddenPty,
    notifyWindowClosed,
    notifySessionRotated,
    getStats,
    sweep,
    destroy
  }
}

module.exports = { createTelegramHiddenPtyPool, normalizeChatKey }
