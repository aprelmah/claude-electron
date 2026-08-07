'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function createClaudeSessionCache({
  resolveClaudeProjectDir,
  listClaudeSessionFilesWithMtime,
  extractTurnText,
  clipText,
  safeStat,
  statCacheKey,
  codexSessionReader,
  CODEX_HISTORY_PATH,
  CODEX_SESSION_INDEX_PATH,
  CODEX_STATE_DB_PATH,
  CLAUDE_TITLE_CACHE_MAX = 600,
  SESSION_META_CACHE_MAX = 300,
  PERF = false
}) {
  const claudeSessionTitleCache = new Map()
  const currentSessionMetaCache = new Map()
  const {
    loadCodexSessionIndexMap,
    readCodexStateThreadMeta,
    guessCodexSessionFromHistory,
    fileCacheKey
  } = codexSessionReader

  function rememberClaudeSessionTitle(filePath, entry) {
    if (!filePath || !entry) return
    if (claudeSessionTitleCache.has(filePath)) claudeSessionTitleCache.delete(filePath)
    claudeSessionTitleCache.set(filePath, entry)
    if (claudeSessionTitleCache.size > CLAUDE_TITLE_CACHE_MAX) {
      const oldest = claudeSessionTitleCache.keys().next().value
      if (oldest) claudeSessionTitleCache.delete(oldest)
    }
  }

  function forgetClaudeSessionTitle(filePath) {
    if (!filePath) return
    claudeSessionTitleCache.delete(filePath)
  }

  function rememberSessionMeta(cacheKey, entry) {
    if (!cacheKey || !entry) return
    if (currentSessionMetaCache.has(cacheKey)) currentSessionMetaCache.delete(cacheKey)
    currentSessionMetaCache.set(cacheKey, entry)
    if (currentSessionMetaCache.size > SESSION_META_CACHE_MAX) {
      const oldest = currentSessionMetaCache.keys().next().value
      if (oldest) currentSessionMetaCache.delete(oldest)
    }
  }

  function readClaudeSessionTitle(cwd, sessionId) {
    const _perfT0 = PERF ? Date.now() : 0
    const sid = String(sessionId || '').trim()
    if (!sid) return { title: '', path: null, statKey: '' }
    const dir = resolveClaudeProjectDir(cwd)
    const file = dir ? path.join(dir, `${sid}.jsonl`) : null
    if (!file) {
      return { title: '', path: null, statKey: '' }
    }

    const stat = safeStat(file)
    if (!stat) {
      if (file) forgetClaudeSessionTitle(file)
      return { title: '', path: file, statKey: '' }
    }

    const nextStatKey = statCacheKey(stat)
    const cached = claudeSessionTitleCache.get(file)
    if (cached && cached.statKey === nextStatKey) {
      if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] readClaudeSessionTitle=${dt}ms (cached-stat)`) }
      return { title: cached.title || '', path: file, statKey: nextStatKey }
    }
    // El título viene del primer turno de usuario y suele ser estable.
    // Si el archivo solo crece (append), evitamos releer todo el JSONL.
    if (cached && cached.title && Number(stat.size || 0) > Number(cached.size || 0)) {
      rememberClaudeSessionTitle(file, {
        title: cached.title,
        statKey: nextStatKey,
        mtimeMs: Number(stat.mtimeMs || 0),
        size: Number(stat.size || 0)
      })
      if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] readClaudeSessionTitle=${dt}ms (cached-append)`) }
      return { title: cached.title || '', path: file, statKey: nextStatKey }
    }

    let title = ''
    try {
      const raw = fs.readFileSync(file, 'utf-8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          if (obj?.type !== 'user') continue
          const text = extractTurnText(obj).replace(/<[^>]+>/g, '').trim()
          if (text && !text.startsWith('Caveat:')) {
            title = clipText(text)
            break
          }
        } catch {}
      }
    } catch {}
    rememberClaudeSessionTitle(file, {
      title,
      statKey: nextStatKey,
      mtimeMs: Number(stat?.mtimeMs || 0),
      size: Number(stat?.size || 0)
    })
    if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] readClaudeSessionTitle=${dt}ms (read size=${Number(stat?.size || 0)})`) }
    return { title, path: file, statKey: nextStatKey }
  }

  function buildCurrentSessionMeta(session) {
    const _perfT0 = PERF ? Date.now() : 0
    const cli = session?.activeCli === 'codex' ? 'codex' : 'claude'
    const cwd = session?.cwd || os.homedir()
    const wcId = Number(session?.wcId || 0)

    if (cli === 'claude') {
      // Sin id NO se adivina con "la última .jsonl del proyecto por mtime" ni
      // se persiste nada: una sesión nueva aún sin conversación adoptaba la
      // conversación VIEJA más reciente, el vigía de startPty veía el campo
      // relleno y dejaba de buscar el id real para siempre, y todo lo que
      // cuelga del id (Llevar a Terminal, sub-chat, modo voz) heredaba la
      // sesión equivocada. El id lo ponen el spawn (--resume), el vigía o el
      // relay; aquí solo se pinta.
      const sessionId = session?.claudeSessionId || null
      const info = readClaudeSessionTitle(cwd, sessionId)
      const cacheKey = `${wcId}|claude|${cwd}|${sessionId || ''}`
      const sourceKey = `${info.statKey || ''}|${sessionId || ''}`
      const cachedMeta = currentSessionMetaCache.get(cacheKey)
      if (cachedMeta && cachedMeta.sourceKey === sourceKey) {
        if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] buildCurrentSessionMeta(claude)=${dt}ms (cache-hit)`) }
        return cachedMeta.meta
      }
      const nextMeta = {
        cli,
        cwd,
        sessionId: sessionId || null,
        title: info.title || (sessionId ? '(sin título)' : '(sesión nueva)'),
        path: info.path || null
      }
      rememberSessionMeta(cacheKey, { sourceKey, meta: nextMeta })
      if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] buildCurrentSessionMeta(claude)=${dt}ms`) }
      return nextMeta
    }

    let sessionId = session?.codexSessionId || null
    let fallbackTitle = ''
    if (!sessionId) {
      const guess = guessCodexSessionFromHistory(session)
      if (guess?.sessionId) {
        sessionId = guess.sessionId
        session.codexSessionId = sessionId
        fallbackTitle = guess.text || ''
      }
    }

    const historyKey = fileCacheKey(CODEX_HISTORY_PATH)
    const indexKey = fileCacheKey(CODEX_SESSION_INDEX_PATH)
    const stateDbKey = fileCacheKey(CODEX_STATE_DB_PATH)
    const cacheKey = `${wcId}|codex|${cwd}|${sessionId || ''}`
    const sourceKey = `${historyKey}|${indexKey}|${stateDbKey}|${sessionId || ''}`
    const cachedMeta = currentSessionMetaCache.get(cacheKey)
    if (cachedMeta && cachedMeta.sourceKey === sourceKey) {
      if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] buildCurrentSessionMeta(codex)=${dt}ms (cache-hit)`) }
      return cachedMeta.meta
    }

    const stateMeta = sessionId ? readCodexStateThreadMeta(sessionId) : null
    const indexTitle = sessionId ? (loadCodexSessionIndexMap().get(sessionId) || '') : ''
    const title = clipText(stateMeta?.title || indexTitle || fallbackTitle, 160) || '(sin título)'
    const nextMeta = {
      cli,
      cwd,
      sessionId: sessionId || null,
      title,
      path: null
    }
    rememberSessionMeta(cacheKey, { sourceKey, meta: nextMeta })
    if (PERF) { const dt = Date.now() - _perfT0; if (dt > 5) console.log(`[PERF meta] buildCurrentSessionMeta(codex)=${dt}ms`) }
    return nextMeta
  }

  return {
    claudeSessionTitleCache,
    currentSessionMetaCache,
    rememberClaudeSessionTitle,
    forgetClaudeSessionTitle,
    rememberSessionMeta,
    readClaudeSessionTitle,
    buildCurrentSessionMeta
  }
}

module.exports = { createClaudeSessionCache }
