'use strict'

const fs = require('fs')
const path = require('path')

function createRelayTranscriptHelpers({
  resolveClaudeProjectDir,
  extractTurnText,
  flattenTerminal,
  stripAnsi
}) {
  function claudeProjectSessionsDir(cwd) {
    if (!cwd) return null
    return resolveClaudeProjectDir(cwd)
  }

  function listClaudeSessionFilesWithMtime(cwd) {
    const dir = claudeProjectSessionsDir(cwd)
    if (!dir) return []
    try {
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const p = path.join(dir, f)
          let mtimeMs = 0
          try { mtimeMs = fs.statSync(p).mtimeMs } catch {}
          return { file: f, sessionId: f.replace(/\.jsonl$/, ''), mtimeMs }
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
    } catch {
      return []
    }
  }

  function snapshotClaudeSessions(cwd) {
    const snap = new Map()
    for (const row of listClaudeSessionFilesWithMtime(cwd)) snap.set(row.file, row.mtimeMs)
    return snap
  }

  function findUpdatedOrNewClaudeSessionId(cwd, snapshotBefore) {
    if (!snapshotBefore) return null
    const rows = listClaudeSessionFilesWithMtime(cwd)
    for (const row of rows) {
      const prevMtime = snapshotBefore.get(row.file)
      if (prevMtime == null) return row.sessionId
      if (row.mtimeMs > prevMtime) return row.sessionId
    }
    return null
  }

  function snapshotClaudeSessionMeta(cwd) {
    const dir = claudeProjectSessionsDir(cwd)
    const snap = new Map()
    if (!dir) return snap
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.jsonl')) continue
        const p = path.join(dir, file)
        try {
          const st = fs.statSync(p)
          snap.set(file, { size: st.size, mtimeMs: st.mtimeMs })
        } catch {}
      }
    } catch {}
    return snap
  }

  function pickRelayTranscriptCandidate(cwd, beforeMeta, preferredSessionId) {
    const dir = claudeProjectSessionsDir(cwd)
    if (!dir) return null
    const rows = listClaudeSessionFilesWithMtime(cwd)
    if (rows.length === 0) return null

    const preferredFile = preferredSessionId ? `${preferredSessionId}.jsonl` : null
    const isChanged = (row) => {
      const before = beforeMeta.get(row.file)
      return !before || row.mtimeMs > before.mtimeMs
    }

    if (preferredFile) {
      const changedPreferred = rows.find((r) => r.file === preferredFile && isChanged(r))
      if (changedPreferred) {
        return { ...changedPreferred, filePath: path.join(dir, changedPreferred.file), before: beforeMeta.get(changedPreferred.file) || null }
      }
    }

    const changedAny = rows.find((r) => isChanged(r))
    if (changedAny) {
      return { ...changedAny, filePath: path.join(dir, changedAny.file), before: beforeMeta.get(changedAny.file) || null }
    }

    if (preferredFile) {
      const preferred = rows.find((r) => r.file === preferredFile)
      if (preferred) {
        return { ...preferred, filePath: path.join(dir, preferred.file), before: beforeMeta.get(preferred.file) || null }
      }
    }

    const latest = rows[0]
    return latest ? { ...latest, filePath: path.join(dir, latest.file), before: beforeMeta.get(latest.file) || null } : null
  }

  // Tolerancia para clock drift entre Date.now() del proceso y el timestamp que
  // escribe el CLI al transcript. Sin esto, una respuesta legítima podía caer
  // pocos ms antes de startedAt y quedar filtrada ⇒ Relay Empty / "falló la
  // lectura de respuesta del PTY". Margen humano entre turnos de chat (>1s),
  // 500ms es seguro y no reabre el bug del desfase de turnos.
  const DEFAULT_MIN_TS_TOLERANCE_MS = 500

  function extractAssistantTextFromTranscript(transcriptPath, offsetBytes = 0, minTimestampMs = 0, opts = {}) {
    try {
      const rawBuf = fs.readFileSync(transcriptPath)
      if (!rawBuf || rawBuf.length === 0) return { text: '', sawAssistant: false, sawEndTurn: false }

      const start = Math.max(0, Math.min(offsetBytes || 0, rawBuf.length))
      let slice = rawBuf.slice(start).toString('utf8')
      if (start > 0) {
        // Si arrancamos en mitad de línea JSON, descarta hasta el siguiente \n.
        const firstNl = slice.indexOf('\n')
        slice = firstNl === -1 ? '' : slice.slice(firstNl + 1)
      }
      if (!slice.trim()) return { text: '', sawAssistant: false, sawEndTurn: false }

      const tolerance = Number.isFinite(opts?.toleranceMs) && opts.toleranceMs >= 0
        ? opts.toleranceMs
        : DEFAULT_MIN_TS_TOLERANCE_MS
      const minTs = Number.isFinite(minTimestampMs) && minTimestampMs > 0
        ? Math.max(0, minTimestampMs - tolerance)
        : 0
      let lastAssistantText = ''
      let sawAssistant = false
      let sawEndTurn = false
      const lines = slice.split('\n')
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (obj?.type !== 'assistant') continue
        // Si el turno actual marca un tiempo mínimo, descartar respuestas anteriores
        // (evita devolver la respuesta tardía del turno previo como respuesta al actual).
        if (minTs > 0 && typeof obj.timestamp === 'string') {
          const ts = Date.parse(obj.timestamp)
          if (Number.isFinite(ts) && ts < minTs) continue
        }
        sawAssistant = true
        const text = extractTurnText(obj)
        if (text) lastAssistantText = text
        if (obj?.message?.stop_reason === 'end_turn') sawEndTurn = true
      }
      return { text: lastAssistantText, sawAssistant, sawEndTurn }
    } catch {
      return { text: '', sawAssistant: false, sawEndTurn: false }
    }
  }

  function cleanRelayFallbackText(raw, cli = 'claude') {
    const clean = flattenTerminal(stripAnsi(String(raw || '')))
    if (!clean) return ''
    return clean
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => {
        const t = line.trim()
        if (!t) return false
        if (/^(\*+\s*(Brewed|Sauteed|Cogitated)\b)/i.test(t)) return false
        if (/^bypass permissions on\b/i.test(t)) return false
        if (/^\$0\.0000\b/.test(t)) return false
        if (/^\/model\b/i.test(t)) return false
        if (/^Claude Code v/i.test(t)) return false
        if (/^Haiku\b/i.test(t)) return false
        if (cli === 'codex' && /^OpenAI Codex\b/i.test(t)) return false
        if (cli === 'codex' && /^model:\s*/i.test(t)) return false
        if (/^\s*[›>]\s*$/.test(t)) return false
        return true
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  return {
    claudeProjectSessionsDir,
    listClaudeSessionFilesWithMtime,
    snapshotClaudeSessions,
    findUpdatedOrNewClaudeSessionId,
    snapshotClaudeSessionMeta,
    pickRelayTranscriptCandidate,
    extractAssistantTextFromTranscript,
    cleanRelayFallbackText
  }
}

module.exports = { createRelayTranscriptHelpers }
