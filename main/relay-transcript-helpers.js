'use strict'

const fs = require('fs')
const os = require('os')
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

  // Localiza el transcript de un turno SIN adivinar el directorio.
  //
  // Claude Code decide dónde escribe según cómo nació la sesión: una sesión
  // nueva lanzada dentro de un worktree escribe en el proyecto del worktree,
  // pero una sesión resumida (`--resume <id>`) sigue escribiendo en el proyecto
  // ORIGINAL aunque el proceso corra en el worktree. Adivinar por cwd falla en
  // una de las dos direcciones siempre, y entonces el relay no ve end_turn y
  // acaba mandando el TUI raspado.
  //
  // Estrategia: el fichero se llama <sessionId>.jsonl, así que se busca por
  // nombre — primero en los cwds conocidos, luego en todo ~/.claude/projects.
  function findRelayTranscript({ sessionId, cwds = [] } = {}) {
    const dirs = []
    for (const cwd of cwds) {
      if (!cwd) continue
      const dir = claudeProjectSessionsDir(cwd)
      if (dir && !dirs.includes(dir)) dirs.push(dir)
    }

    const stat = (filePath, sid) => {
      try {
        const st = fs.statSync(filePath)
        if (!st.isFile()) return null
        return { filePath, sessionId: sid, size: st.size, mtimeMs: st.mtimeMs }
      } catch {
        return null
      }
    }
    const newest = (rows) => rows.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null

    if (sessionId) {
      const inKnownDirs = newest(dirs.map((d) => stat(path.join(d, `${sessionId}.jsonl`), sessionId)))
      if (inKnownDirs) return inKnownDirs

      // Barrido global: la sesión puede vivir en un proyecto que no corresponde
      // a ninguno de los cwds actuales.
      try {
        const root = path.dirname(dirs[0] || claudeProjectSessionsDir(os.homedir()) || '')
        if (root) {
          const hits = fs.readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => stat(path.join(root, e.name, `${sessionId}.jsonl`), sessionId))
          const hit = newest(hits)
          if (hit) return hit
        }
      } catch {}
    }

    // Sin sessionId (o sesión aún sin fichero): el .jsonl más reciente de los
    // directorios candidatos.
    const fallback = []
    for (const dir of dirs) {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.jsonl')) continue
          fallback.push(stat(path.join(dir, f), f.replace(/\.jsonl$/, '')))
        }
      } catch {}
    }
    return newest(fallback)
  }

  // Busca en las líneas del transcript un cwd VÁLIDO para resume: uno cuyo
  // proyecto codificado sea exactamente el directorio donde vive el fichero y
  // que siga existiendo en disco. No vale "el primero que aparezca": una sesión
  // nacida en worktree y continuada en el dir real lleva varios cwds mezclados
  // (worktrees ya borrados, scratchpads, el dir real) — caso real 2026-08-02.
  function findResumableCwdInTranscript(filePath, containingDir) {
    let content = ''
    try {
      const st = fs.statSync(filePath)
      const CAP = 50 * 1024 * 1024
      if (st.size <= CAP) {
        content = fs.readFileSync(filePath, 'utf8')
      } else {
        // Transcript gigante: con la cola basta, las líneas recientes llevan
        // el cwd vigente.
        const fd = fs.openSync(filePath, 'r')
        try {
          const len = 4 * 1024 * 1024
          const buf = Buffer.allocUnsafe(len)
          const read = fs.readSync(fd, buf, 0, len, st.size - len)
          content = buf.toString('utf8', 0, read)
        } finally {
          try { fs.closeSync(fd) } catch {}
        }
      }
    } catch {
      return null
    }
    const target = path.resolve(containingDir)
    const seen = new Set()
    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line || !line.includes('"cwd"')) continue
      let obj
      try { obj = JSON.parse(line) } catch { continue }
      const cwd = obj?.cwd
      if (typeof cwd !== 'string' || !cwd.trim() || seen.has(cwd)) continue
      seen.add(cwd)
      let dir = null
      try { dir = claudeProjectSessionsDir(cwd) } catch {}
      if (!dir || path.resolve(dir) !== target) continue
      try {
        if (fs.statSync(cwd).isDirectory()) return cwd
      } catch {}
    }
    return null
  }

  // Resuelve el cwd desde el que `claude --resume <sessionId>` SÍ encuentra la
  // sesión. El resume busca el transcript en el proyecto codificado del cwd del
  // spawn; lanzarlo desde otro directorio da "No conversation found". Decodificar
  // el nombre del directorio de proyecto es lossy, así que el cwd se lee del
  // propio JSONL. Una sesión puede tener copias en varios proyectos (worktree +
  // real): vale la más reciente cuyo cwd siga existiendo en disco.
  function resolveResumeCwd(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return null
    let root = null
    try {
      root = path.dirname(claudeProjectSessionsDir(os.homedir()) || '')
    } catch {
      return null
    }
    if (!root || root === '.') return null

    let entries = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      return null
    }

    const hits = []
    for (const e of entries) {
      const dir = path.join(root, e.name)
      const filePath = path.join(dir, `${sessionId}.jsonl`)
      let st
      try { st = fs.statSync(filePath) } catch { continue }
      if (!st.isFile()) continue
      hits.push({ filePath, dir, mtimeMs: st.mtimeMs })
    }
    hits.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const hit of hits) {
      const cwd = findResumableCwdInTranscript(hit.filePath, hit.dir)
      if (cwd) return cwd
    }
    return null
  }

  // Detecta el transcript FORKEADO de un `--resume` interactivo. Claude Code,
  // al resumir una sesión en el TUI, no apendiza al fichero viejo: crea un
  // sessionId nuevo con el historial copiado y escribe ahí los turnos nuevos.
  // Un relay enganchado al sessionId del spawn se queda mirando un fichero que
  // nunca crece. Señal de adopción: fichero nuevo (o crecido) en los proyectos
  // candidatos, distinto del esperado, que contenga el prompt recién escrito —
  // sin promptMarker no se adopta nada (mejor quieto que secuestrar la sesión
  // concurrente de otra ventana).
  //
  //   cwds: proyectos candidatos (los mismos del relay)
  //   before: [{ cwd, snap }] con snap = snapshotClaudeSessionMeta(cwd) PRE-write
  //   excludeSessionId: el sessionId esperado (nunca se devuelve a sí mismo)
  //   promptMarker: texto del prompt del turno (se busca JSON-escapado)
  //
  // Devuelve { filePath, sessionId, baseOffset } o null.
  function detectForkedRelayTranscript({ cwds = [], before = [], excludeSessionId = null, promptMarker = '' } = {}) {
    const marker = String(promptMarker || '').split('\n')[0].trim().slice(0, 64)
    if (!marker) return null
    // El transcript guarda el texto JSON-escapado (comillas, backslashes).
    const escapedMarker = JSON.stringify(marker).slice(1, -1)
    const snapByCwd = new Map()
    for (const b of before) {
      if (b && b.cwd && b.snap) snapByCwd.set(b.cwd, b.snap)
    }
    const excludeFile = excludeSessionId ? `${excludeSessionId}.jsonl` : null

    const candidates = []
    for (const cwd of cwds) {
      if (!cwd) continue
      const dir = claudeProjectSessionsDir(cwd)
      if (!dir) continue
      const snap = snapByCwd.get(cwd) || new Map()
      let files = []
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      } catch {
        continue
      }
      for (const f of files) {
        if (excludeFile && f === excludeFile) continue
        const filePath = path.join(dir, f)
        let st
        try { st = fs.statSync(filePath) } catch { continue }
        if (!st.isFile()) continue
        const prev = snap.get(f)
        if (prev && st.size <= prev.size) continue
        candidates.push({
          filePath,
          sessionId: f.replace(/\.jsonl$/, ''),
          baseOffset: prev ? prev.size : 0,
          mtimeMs: st.mtimeMs,
          size: st.size
        })
      }
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const c of candidates) {
      let slice = ''
      try {
        const fd = fs.openSync(c.filePath, 'r')
        try {
          const len = Math.min(c.size - c.baseOffset, 1024 * 1024)
          if (len <= 0) continue
          const buf = Buffer.allocUnsafe(len)
          const read = fs.readSync(fd, buf, 0, len, c.baseOffset)
          slice = buf.toString('utf8', 0, read)
        } finally {
          try { fs.closeSync(fd) } catch {}
        }
      } catch {
        continue
      }
      if (slice.includes(escapedMarker)) {
        return { filePath: c.filePath, sessionId: c.sessionId, baseOffset: c.baseOffset }
      }
    }
    return null
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
      // Lectura parcial: solo la cola nueva desde el offset del turno. Con
      // readFileSync entero, el poll de 300ms releía transcripts de MBs varias
      // veces por segundo para sacar dos líneas.
      let slice = ''
      let start = 0
      let startsAtLineBoundary = true
      const fd = fs.openSync(transcriptPath, 'r')
      try {
        const size = fs.fstatSync(fd).size
        if (size === 0) return { text: '', sawAssistant: false, sawEndTurn: false, lastStopReason: null, turnComplete: false }
        start = Math.max(0, Math.min(offsetBytes || 0, size))
        if (start > 0) {
          // ¿El offset cae justo tras un \n? Entonces la primera línea del slice
          // está completa y NO hay que descartarla. Sin esta comprobación se
          // perdía la primera línea nueva, que suele ser la propia respuesta.
          const probe = Buffer.allocUnsafe(1)
          const n = fs.readSync(fd, probe, 0, 1, start - 1)
          startsAtLineBoundary = n === 1 && probe[0] === 0x0a
        }
        const length = size - start
        if (length > 0) {
          const buf = Buffer.allocUnsafe(length)
          const read = fs.readSync(fd, buf, 0, length, start)
          slice = buf.toString('utf8', 0, read)
        }
      } finally {
        try { fs.closeSync(fd) } catch {}
      }
      if (start > 0 && !startsAtLineBoundary) {
        // Arrancamos en mitad de una línea JSON: descarta hasta el siguiente \n.
        const firstNl = slice.indexOf('\n')
        slice = firstNl === -1 ? '' : slice.slice(firstNl + 1)
      }
      if (!slice.trim()) return { text: '', sawAssistant: false, sawEndTurn: false, lastStopReason: null, turnComplete: false }

      const tolerance = Number.isFinite(opts?.toleranceMs) && opts.toleranceMs >= 0
        ? opts.toleranceMs
        : DEFAULT_MIN_TS_TOLERANCE_MS
      const minTs = Number.isFinite(minTimestampMs) && minTimestampMs > 0
        ? Math.max(0, minTimestampMs - tolerance)
        : 0
      let lastAssistantText = ''
      let sawAssistant = false
      let sawEndTurn = false
      let lastStopReason = null
      const lines = slice.split('\n')
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (obj?.type !== 'assistant') continue
        // Los sub-agentes (Task) escriben sus propios turnos con end_turn en el
        // mismo fichero. Si los contáramos, el relay cerraría el turno a mitad.
        if (obj?.isSidechain) continue
        // Si el turno actual marca un tiempo mínimo, descartar respuestas anteriores
        // (evita devolver la respuesta tardía del turno previo como respuesta al actual).
        if (minTs > 0 && typeof obj.timestamp === 'string') {
          const ts = Date.parse(obj.timestamp)
          if (Number.isFinite(ts) && ts < minTs) continue
        }
        sawAssistant = true
        const text = extractTurnText(obj)
        if (text) lastAssistantText = text
        const stop = obj?.message?.stop_reason
        if (stop !== undefined && stop !== null) lastStopReason = stop
        if (stop === 'end_turn') sawEndTurn = true
      }
      // turnComplete: el ÚLTIMO evento del turno es end_turn. Con tool_use por
      // medio, sawEndTurn puede ser cierto mientras el turno sigue vivo.
      const turnComplete = lastStopReason === 'end_turn' && !!lastAssistantText
      return { text: lastAssistantText, sawAssistant, sawEndTurn, lastStopReason, turnComplete }
    } catch {
      return { text: '', sawAssistant: false, sawEndTurn: false, lastStopReason: null, turnComplete: false }
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
    findRelayTranscript,
    findResumableCwdInTranscript,
    resolveResumeCwd,
    detectForkedRelayTranscript,
    pickRelayTranscriptCandidate,
    extractAssistantTextFromTranscript,
    cleanRelayFallbackText
  }
}

module.exports = { createRelayTranscriptHelpers }
