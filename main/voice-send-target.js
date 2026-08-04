'use strict'

// `sendToTarget` del modo voz: escribe lo que has dicho en el sitio correcto y
// devuelve las coordenadas EXACTAS del transcript que hay que vigilar
// (`{ sessionId, cwds, baseOffset }`). Es la pieza que la máquina de estados
// (main/voice-session.js) no puede resolver sola porque depende de los PTYs.
//
// Vive aquí y no inline en main.js porque es donde están todas las trampas del
// repo y todas necesitan test:
//
// 1. EL sessionId DE LA SESIÓN SE PUDRE. Un `--resume` FORKEA: Claude Code crea
//    un sessionId nuevo con el historial copiado y escribe ahí; el .jsonl viejo
//    no vuelve a crecer jamás. Pasa con el `/resume` del TUI y pasa también con
//    el resume que lanza la propia app (main.js fija `claudeSessionId` desde los
//    args del spawn y el poll de detección se salta la actualización porque el
//    campo ya viene relleno). El vigía usa un sessionId fijo, así que sin esto
//    el turno muere en el timeout de 180 s. Se resuelve como en `relayThroughPty`:
//    snapshot PRE-escritura + `detectForkedRelayTranscript` exigiendo que el
//    fichero contenga el prompt (sin esa exigencia se secuestraría la sesión
//    concurrente de otra ventana).
//
// 2. EL baseOffset NO PUEDE SER 0 EN UN FORK. Un fork nace con TODO el historial
//    copiado, y ese historial acaba en `end_turn`. Con offset 0 el vigía cerraría
//    el turno al instante y la app leería en voz alta la respuesta anterior. Por
//    eso el tamaño se anota SIEMPRE antes de escribir.
//
// 3. EL SUB-CHAT DE LA CHARLA TIENE SU PROPIO sessionId. `--fork-session` crea
//    uno nuevo: devolver el de la madre deja al vigía mirando un fichero que no
//    crece. Se localiza como "el .jsonl que no estaba antes de arrancar el
//    sub-chat", descartando explícitamente el de la madre (que puede ser el más
//    reciente si la sesión principal está trabajando).

const DEFAULT_POLL_MS = 200
const DEFAULT_SUBCHAT_WARMUP_MS = 1200
const DEFAULT_SUBCHAT_FORK_WAIT_MS = 5000
const DEFAULT_FORK_CHECK_AFTER_MS = 1200
const DEFAULT_MOTHER_WAIT_MS = 3000

function createVoiceSendTarget({
  getSession,
  subchat,
  relayCwdCandidates,
  findRelayTranscript,
  snapshotClaudeSessions,
  listClaudeSessionFilesWithMtime,
  snapshotClaudeSessionMeta,
  detectForkedRelayTranscript,
  statFn,
  sleep,
  pollMs,
  subchatWarmupMs,
  subchatForkWaitMs,
  forkCheckAfterMs,
  motherWaitMs,
  log
} = {}) {
  if (typeof getSession !== 'function') throw new Error('voice-send-target: getSession requerido')
  if (!subchat || typeof subchat.has !== 'function' || typeof subchat.start !== 'function' || typeof subchat.write !== 'function') {
    throw new Error('voice-send-target: subchat requerido')
  }
  if (typeof relayCwdCandidates !== 'function') throw new Error('voice-send-target: relayCwdCandidates requerido')
  if (typeof findRelayTranscript !== 'function') throw new Error('voice-send-target: findRelayTranscript requerido')
  if (typeof snapshotClaudeSessions !== 'function') throw new Error('voice-send-target: snapshotClaudeSessions requerido')
  if (typeof listClaudeSessionFilesWithMtime !== 'function') throw new Error('voice-send-target: listClaudeSessionFilesWithMtime requerido')
  if (typeof snapshotClaudeSessionMeta !== 'function') throw new Error('voice-send-target: snapshotClaudeSessionMeta requerido')
  if (typeof detectForkedRelayTranscript !== 'function') throw new Error('voice-send-target: detectForkedRelayTranscript requerido')

  const stat = typeof statFn === 'function' ? statFn : () => null
  const wait = typeof sleep === 'function' ? sleep : (ms) => new Promise((r) => setTimeout(r, ms))
  const trace = typeof log === 'function' ? log : () => {}
  const POLL = num(pollMs, DEFAULT_POLL_MS)
  const WARMUP = num(subchatWarmupMs, DEFAULT_SUBCHAT_WARMUP_MS)
  const SUBCHAT_WAIT = num(subchatForkWaitMs, DEFAULT_SUBCHAT_FORK_WAIT_MS)
  const FORK_AFTER = num(forkCheckAfterMs, DEFAULT_FORK_CHECK_AFTER_MS)
  const MOTHER_WAIT = num(motherWaitMs, DEFAULT_MOTHER_WAIT_MS)

  function num(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback
  }

  function transcriptSize(sessionId, cwds) {
    if (!sessionId) return 0
    let t = null
    try { t = findRelayTranscript({ sessionId, cwds }) } catch { return 0 }
    if (!t || !t.filePath) return 0
    const st = stat(t.filePath)
    if (st && Number.isFinite(st.size)) return st.size
    return Number.isFinite(t.size) ? t.size : 0
  }

  function snapshotAll(cwds) {
    const out = []
    for (const cwd of cwds) {
      try { out.push({ cwd, snap: snapshotClaudeSessionMeta(cwd) }) } catch {}
    }
    return out
  }

  // ── Encargo: al PTY de la sesión madre, con efectos reales en el proyecto ──
  async function sendToMother(session, prompt, cwds) {
    if (!session.pty) return { ok: false, reason: 'la sesión no tiene proceso vivo' }

    const expectedId = session.claudeSessionId
    const baseOffset = transcriptSize(expectedId, cwds)
    const before = snapshotAll(cwds)

    try { session.pty.write(prompt + '\r') } catch (err) {
      return { ok: false, reason: `no se pudo escribir en la sesión: ${err?.message || err}` }
    }

    let waited = 0
    while (waited < MOTHER_WAIT) {
      await wait(POLL)
      waited += POLL
      // El fichero esperado crece: la sesión no está forkeada y no hay más que
      // mirar. Es el caso normal y sale en una o dos vueltas.
      if (transcriptSize(expectedId, cwds) > baseOffset) break
      // Antes de FORK_AFTER el silencio no significa nada (el TUI tarda en
      // volcar la línea del usuario) y buscar fork tan pronto es pedir un falso
      // positivo. Mismo margen que el poll de relayThroughPty.
      if (waited < FORK_AFTER) continue
      let forked = null
      try {
        forked = detectForkedRelayTranscript({ cwds, before, excludeSessionId: expectedId, promptMarker: prompt })
      } catch { forked = null }
      if (!forked) continue
      trace(`la sesión estaba forkeada: ${expectedId} → ${forked.sessionId}`)
      session.claudeSessionId = forked.sessionId
      return { ok: true, sessionId: forked.sessionId, cwds, baseOffset: forked.baseOffset }
    }

    // Ni creció ni se detectó fork: se devuelve lo esperado. El vigía tiene 180 s
    // y el offset es correcto, así que una respuesta lenta se sigue cazando.
    return { ok: true, sessionId: expectedId, cwds, baseOffset }
  }

  // El sub-chat nace con `--fork-session`: su .jsonl no existía antes de
  // arrancarlo. Se busca por ausencia previa, no por mtime: la madre puede tener
  // el fichero más reciente si está trabajando, y adoptarla dejaría al vigía
  // leyendo el turno equivocado.
  async function waitForSubchatSessionId(session, cwds, antes) {
    let waited = 0
    for (;;) {
      for (const cwd of cwds) {
        const previos = antes.get(cwd)
        let filas = []
        try { filas = listClaudeSessionFilesWithMtime(cwd) } catch { filas = [] }
        for (const fila of filas) {
          if (previos && previos.has(fila.file)) continue
          if (!fila.sessionId || fila.sessionId === session.claudeSessionId) continue
          return fila.sessionId
        }
      }
      if (waited >= SUBCHAT_WAIT) return null
      await wait(POLL)
      waited += POLL
    }
  }

  // ── Charla: al sub-chat desechable, sin tocar la sesión de trabajo ──
  async function sendToSubchat(session, prompt, cwds) {
    if (!subchat.has(session.wcId)) {
      // Sub-chat nuevo ⇒ el sessionId que hubiera guardado ya no vale.
      session.voiceSubchatSessionId = null
      const antes = new Map()
      for (const cwd of cwds) {
        try { antes.set(cwd, snapshotClaudeSessions(cwd)) } catch {}
      }
      const started = subchat.start(session, { cols: 100, rows: 30 })
      if (!started || !started.ok) {
        return { ok: false, reason: (started && started.error) || 'no se pudo abrir el sub-chat' }
      }
      // El TUI del fork no acepta texto nada más nacer: sin esta espera el
      // prompt se pierde y el turno no llega a existir.
      await wait(WARMUP)
      session.voiceSubchatSessionId = await waitForSubchatSessionId(session, cwds, antes)
    }

    const conocido = session.voiceSubchatSessionId || null
    const before = snapshotAll(cwds)
    const baseOffset = conocido ? transcriptSize(conocido, cwds) : 0

    try { subchat.write(session.wcId, prompt + '\r') } catch (err) {
      return { ok: false, reason: `no se pudo escribir en el sub-chat: ${err?.message || err}` }
    }

    if (conocido) return { ok: true, sessionId: conocido, cwds, baseOffset }

    // Sub-chat que ya estaba abierto (lo abrió el usuario desde la UI) o fork
    // que no llegó a verse al arrancar: se identifica por el prompt, igual que
    // en el camino de la madre.
    let waited = 0
    while (waited < SUBCHAT_WAIT) {
      await wait(POLL)
      waited += POLL
      let forked = null
      try {
        forked = detectForkedRelayTranscript({ cwds, before, excludeSessionId: session.claudeSessionId, promptMarker: prompt })
      } catch { forked = null }
      if (!forked) continue
      session.voiceSubchatSessionId = forked.sessionId
      return { ok: true, sessionId: forked.sessionId, cwds, baseOffset: forked.baseOffset }
    }

    return { ok: false, reason: 'no se encontró el transcript del sub-chat' }
  }

  async function sendToTarget({ text, mode } = {}) {
    const prompt = String(text || '').trim()
    if (!prompt) return { ok: false, reason: 'no hay nada que enviar' }

    const session = getSession()
    if (!session) return { ok: false, reason: 'la ventana del modo voz ya no existe' }
    // La ventana puede haber cambiado de CLI después de encender el modo voz.
    if (session.activeCli !== 'claude') return { ok: false, reason: 'el modo voz solo funciona con claude, no con codex' }
    if (!session.claudeSessionId) return { ok: false, reason: 'la sesión aún no tiene id de conversación' }

    const cwds = relayCwdCandidates(session) || []
    if (!cwds.length) return { ok: false, reason: 'la sesión no tiene directorio de trabajo' }

    return mode === 'encargo'
      ? sendToMother(session, prompt, cwds)
      : sendToSubchat(session, prompt, cwds)
  }

  return sendToTarget
}

module.exports = {
  createVoiceSendTarget,
  DEFAULT_POLL_MS,
  DEFAULT_SUBCHAT_WARMUP_MS,
  DEFAULT_SUBCHAT_FORK_WAIT_MS,
  DEFAULT_FORK_CHECK_AFTER_MS,
  DEFAULT_MOTHER_WAIT_MS
}
