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
//    el resume que lanza la propia app. El vigía usa un sessionId fijo, así que
//    sin esto el turno muere en el timeout de 180 s. Se resuelve como en
//    `relayThroughPty`: snapshot PRE-escritura + `detectForkedRelayTranscript`
//    exigiendo que el fichero contenga el prompt (sin esa exigencia se
//    secuestraría la sesión concurrente de otra ventana).
//
// 2. EL baseOffset NO PUEDE SER 0 EN UN FORK. Un fork nace con TODO el historial
//    copiado, y ese historial acaba en `end_turn`. El vigía llama a
//    `extractAssistantTextFromTranscript` con `minTimestampMs = 0` (a diferencia
//    de `relayThroughPty`, que pasa `startedAt`), así que con offset 0 cerraría
//    el turno en el primer poll: la app leería en voz alta la respuesta ANTERIOR
//    y dejaría de vigilar, con lo que la respuesta de verdad no se lee nunca.
//    `detectForkedRelayTranscript` devuelve exactamente 0 cuando el fichero no
//    estaba en el snapshot, así que ese 0 NO se propaga: se recalcula el offset
//    buscando la línea del propio prompt (`safeForkOffset`) y, si no se puede,
//    el fork se rechaza. Mejor un timeout ruidoso que leer la respuesta de otro
//    turno como si fuera esta.
//
// 3. TODO SE IDENTIFICA POR EL PROMPT, NUNCA POR "EL FICHERO MÁS NUEVO". El
//    sub-chat de la charla tiene su propio sessionId (`--fork-session`), pero
//    adoptarlo por "el .jsonl que no estaba antes" secuestra la sesión de otra
//    ventana, un PTY oculto de Telegram o una task-session que naciera en el
//    mismo proyecto durante el arranque. Es la regla escrita en
//    `relay-transcript-helpers.js`: sin coincidencia de prompt no se adopta nada.

const DEFAULT_POLL_MS = 200
// Pausa entre el texto y su ENTER. El TUI de Claude Code agrupa lo que llega
// de golpe como un pegado: con el '\r' pegado al texto, lo mete como salto de
// línea DENTRO del prompt y el turno se queda escrito sin enviar.
const DEFAULT_ENTER_DELAY_MS = 150
const DEFAULT_SUBCHAT_WARMUP_MS = 1200
const DEFAULT_SUBCHAT_FORK_WAIT_MS = 5000
const DEFAULT_FORK_CHECK_AFTER_MS = 1200
const DEFAULT_MOTHER_WAIT_MS = 3000
// Tope de lectura al recalcular el offset de un fork. La lectura es SÍNCRONA y
// corre en el proceso main: bloquea IPC y PTYs mientras dura. 5 MB sobra de
// largo para localizar la línea de un prompt y mantiene la pausa en pocos ms.
const MAX_FORK_SCAN_BYTES = 5 * 1024 * 1024

// Localiza el .jsonl del fork que crea un `--resume` en el spawn: el que ha
// aparecido desde `before` y no pertenece ya a nadie. Se usa SOLO donde todavía
// no hay prompt con el que verificar (en el spawn aún no se ha escrito nada);
// donde lo hay, manda siempre `detectForkedRelayTranscript`.
//
// Dos guardas, porque "el fichero nuevo más reciente" es exactamente la
// adopción a ciegas que este módulo prohíbe en su cabecera:
//
// - `excludeIds` trae los sessionIds que YA tienen dueño (sesiones vivas,
//   sub-chats, PTYs ocultos de Telegram, task-sessions). Sin esto, abrir un
//   sub-chat dentro de la ventana de detección hacía que la madre adoptase el
//   id de su propio sub-chat: a partir de ahí el sub-chat siguiente forkea del
//   sub-chat y `sessionGitMap` guarda el id equivocado contra el worktree.
// - Ambigüedad ⇒ NO se adopta nada. Un fork legítimo del propio spawn aparece
//   SOLO; dos candidatos significan que hay otro actor escribiendo en el mismo
//   proyecto (otra ventana resumiendo, un headless, un `claude` a mano en una
//   terminal) y no hay forma de saber cuál es el nuestro. Renunciar deja el id
//   como estaba, que es el statu quo, y el relay o el modo voz lo repararán por
//   prompt cuando haya turno.
//
//   groups: [{ rows: listClaudeSessionFilesWithMtime(cwd), before: snapshot }]
function pickForkedSessionId({ groups = [], excludeIds = [] } = {}) {
  const excluidos = new Set(excludeIds.filter(Boolean))
  const candidatos = []
  for (const grupo of groups) {
    const before = grupo && grupo.before
    // Sin snapshot previo TODOS los ficheros parecerían nuevos: no se adopta
    // nada, ni siquiera de los grupos que sí lo tienen.
    if (!before || typeof before.has !== 'function') return null
    for (const fila of grupo.rows || []) {
      if (!fila || !fila.file || !fila.sessionId) continue
      if (before.has(fila.file)) continue
      if (excluidos.has(fila.sessionId)) continue
      // El mismo sessionId puede estar en dos proyectos candidatos (worktree y
      // dir real): es un solo candidato, no dos.
      if (!candidatos.includes(fila.sessionId)) candidatos.push(fila.sessionId)
    }
  }
  return candidatos.length === 1 ? candidatos[0] : null
}

// El prompt acaba en `pty.write(prompt + '\r')`. Un salto de línea INTERNO es
// un ENTER a mitad de frase: el turno se enviaría partido y el resto quedaría
// escrito suelto en el prompt siguiente (o lo interpretaría el TUI como otra
// cosa). `trim()` solo pela los extremos, así que no cubre esto.
//
// El dictado no produce saltos, pero el texto llega de un proceso externo y de
// aquí sale una escritura ciega en un terminal: se normaliza en la puerta, no en
// cada uno de los dos caminos de envío. Además el marcador de detección de fork
// se saca del prompt, así que tiene que ser exactamente lo que se escribió.
function unaSolaLinea(text) {
  return String(text || '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim()
}

// Últimos `bytes` del fichero, con el offset absoluto desde el que se leyó.
// Síncrona a propósito (como el resto de lecturas de transcript del repo), pero
// acotada: nunca trae el fichero entero a memoria.
function leerCola(filePath, bytes) {
  const fs = require('fs')
  const st = fs.statSync(filePath)
  const from = Math.max(0, st.size - bytes)
  const len = st.size - from
  if (len <= 0) return { text: '', from: st.size }
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.allocUnsafe(len)
    const read = fs.readSync(fd, buf, 0, len, from)
    return { text: buf.toString('utf8', 0, read), from }
  } finally {
    try { fs.closeSync(fd) } catch {}
  }
}

function createVoiceSendTarget({
  getSession,
  subchat,
  relayCwdCandidates,
  findRelayTranscript,
  snapshotClaudeSessionMeta,
  detectForkedRelayTranscript,
  statFn,
  readFileFn,
  readTailFn,
  maxForkScanBytes,
  sleep,
  pollMs,
  enterDelayMs,
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
  if (typeof snapshotClaudeSessionMeta !== 'function') throw new Error('voice-send-target: snapshotClaudeSessionMeta requerido')
  if (typeof detectForkedRelayTranscript !== 'function') throw new Error('voice-send-target: detectForkedRelayTranscript requerido')

  const stat = typeof statFn === 'function' ? statFn : () => null
  const readFile = typeof readFileFn === 'function' ? readFileFn : (p) => require('fs').readFileSync(p, 'utf8')
  const readTail = typeof readTailFn === 'function' ? readTailFn : leerCola
  const MAX_SCAN = num(maxForkScanBytes, MAX_FORK_SCAN_BYTES)
  const wait = typeof sleep === 'function' ? sleep : (ms) => new Promise((r) => setTimeout(r, ms))
  const trace = typeof log === 'function' ? log : () => {}
  const POLL = num(pollMs, DEFAULT_POLL_MS)
  const ENTER_DELAY = num(enterDelayMs, DEFAULT_ENTER_DELAY_MS)
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

  // Un `baseOffset` de 0 sobre un fork significa "no sé por dónde empieza este
  // turno", y el vigía no sabe distinguir el historial copiado de la respuesta
  // nueva. Se recalcula: la última aparición del prompt marca el principio del
  // turno, así que el offset es el inicio de ESA línea. Si no se encuentra, se
  // devuelve null y el fork se descarta.
  function safeForkOffset(forked, prompt) {
    if (!forked) return null
    if (Number.isFinite(forked.baseOffset) && forked.baseOffset > 0) return forked.baseOffset

    const marker = String(prompt || '').split('\n')[0].trim().slice(0, 64)
    if (!marker) return null
    const escaped = JSON.stringify(marker).slice(1, -1)

    const st = stat(forked.filePath)
    const size = st && Number.isFinite(st.size) ? st.size : null

    // Por encima del tope se lee solo la COLA, no se descarta el fork: el
    // prompt de este turno es lo último que hay en el fichero, y rendirse aquí
    // devolvía "no se encontró el transcript del sub-chat" con la respuesta ya
    // escrita en disco. Los transcripts de una sesión larga pasan de 5 MB.
    let contenido = ''
    let desde = 0
    if (size !== null && size > MAX_SCAN) {
      let cola = null
      try { cola = readTail(forked.filePath, MAX_SCAN) } catch { return null }
      if (!cola || typeof cola.text !== 'string') return null
      contenido = cola.text
      desde = Number.isFinite(cola.from) ? cola.from : 0
      trace(`transcript forkeado de ${size} bytes: se busca el prompt en la cola desde ${desde}`)
    } else {
      try { contenido = String(readFile(forked.filePath) || '') } catch { return null }
    }

    // La ÚLTIMA aparición: si el usuario ya había dicho lo mismo antes, el
    // historial copiado lo lleva dentro y la buena es la de ahora.
    const idx = contenido.lastIndexOf(escaped)
    if (idx < 0) return null
    const nl = contenido.lastIndexOf('\n', idx)
    // Con recorte, la primera línea del trozo está partida: si el marcador cae
    // ahí no se sabe dónde empieza su línea de verdad. Descartar es correcto —
    // un offset a ojo haría que el vigía leyera basura como si fuera el turno.
    if (desde > 0 && nl < 0) {
      trace('el prompt cae en la línea partida por el recorte: fork descartado')
      return null
    }
    // Bytes, no caracteres: el transcript lleva acentos y el vigía lee con
    // offsets de fichero.
    return desde + Buffer.byteLength(contenido.slice(0, nl + 1), 'utf8')
  }

  function adoptFork(forked, prompt, cwds) {
    const baseOffset = safeForkOffset(forked, prompt)
    if (baseOffset === null) {
      trace(`fork descartado por no poder situar el turno dentro de ${forked?.filePath || 'el fichero'}`)
      return null
    }
    return { ok: true, sessionId: forked.sessionId, cwds, baseOffset }
  }

  // ── Encargo: al PTY de la sesión madre, con efectos reales en el proyecto ──
  async function sendToMother(session, prompt, cwds) {
    if (!session.pty) return { ok: false, reason: 'la sesión no tiene proceso vivo' }
    // `relayThroughPty` (Telegram) serializa sus turnos con este flag. El modo
    // voz lo RESPETA pero no marca nada mientras dura el suyo, así que el orden
    // contrario (Telegram entrando a mitad de un turno de voz) sigue sin cubrir
    // — y es el más probable, porque un turno de voz dura decenas de segundos.
    // Pendiente inmediato en CLAUDE.md: cerrojo con caducidad
    // (`session.voiceTurnUntil`), no un booleano que haya que soltar a mano.
    if (session.relayActive) return { ok: false, reason: 'la sesión está ocupada con otro turno' }

    const expectedId = session.claudeSessionId
    const baseOffset = transcriptSize(expectedId, cwds)
    const before = snapshotAll(cwds)

    try { session.pty.write(prompt) } catch (err) {
      return { ok: false, reason: `no se pudo escribir en la sesión: ${err?.message || err}` }
    }
    // El ENTER va APARTE y con una pausa. Pegado al texto (`prompt + '\r'`) el
    // TUI lo trata como parte del bloque pegado y lo mete como salto de línea
    // dentro del prompt: la frase se queda escrita y sin enviar, esperando a
    // que la mandes tú a mano. Visto en la primera prueba real (2026-08-05).
    await wait(ENTER_DELAY)
    try { session.pty.write('\r') } catch (err) {
      return { ok: false, reason: `no se pudo enviar el turno: ${err?.message || err}` }
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
      const adoptado = adoptFork(forked, prompt, cwds)
      if (!adoptado) break
      trace(`la sesión estaba forkeada: ${expectedId} → ${forked.sessionId}`)
      session.claudeSessionId = forked.sessionId
      return adoptado
    }

    // Ni creció ni se detectó fork: se devuelve lo esperado. El vigía tiene 180 s
    // y el offset es correcto, así que una respuesta lenta se sigue cazando.
    return { ok: true, sessionId: expectedId, cwds, baseOffset }
  }

  // ── Charla: al sub-chat desechable, sin tocar la sesión de trabajo ──
  async function sendToSubchat(session, prompt, cwds) {
    if (!subchat.has(session.wcId)) {
      // Sub-chat nuevo ⇒ el sessionId que hubiera guardado ya no vale.
      session.voiceSubchatSessionId = null
      const started = subchat.start(session, { cols: 100, rows: 30 })
      if (!started || !started.ok) {
        return { ok: false, reason: (started && started.error) || 'no se pudo abrir el sub-chat' }
      }
      // El TUI del fork no acepta texto nada más nacer: sin esta espera el
      // prompt se pierde y el turno no llega a existir.
      await wait(WARMUP)
    }

    const conocido = session.voiceSubchatSessionId || null
    const before = snapshotAll(cwds)
    const baseOffset = conocido ? transcriptSize(conocido, cwds) : 0

    // Dos comprobaciones y ninguna sobra: `has` cubre el sub-chat que ya se
    // cerró, y el booleano de `write` cubre el EPIPE (proceso muerto con la
    // entrada todavía marcada viva). Sin ellas, un sub-chat sordo daba {ok:true}
    // y 180 s de silencio.
    if (!subchat.has(session.wcId)) return { ok: false, reason: 'el sub-chat se cerró antes de poder escribir' }
    let escrito
    try { escrito = subchat.write(session.wcId, prompt) } catch (err) {
      return { ok: false, reason: `no se pudo escribir en el sub-chat: ${err?.message || err}` }
    }
    if (escrito === false) return { ok: false, reason: 'el sub-chat no aceptó el texto' }
    // Mismo motivo que en la sesión madre: el ENTER pegado al texto se queda
    // como salto de línea dentro del prompt y el turno no llega a enviarse.
    await wait(ENTER_DELAY)
    if (!subchat.has(session.wcId)) return { ok: false, reason: 'el sub-chat se cerró antes de enviar el turno' }
    try { escrito = subchat.write(session.wcId, '\r') } catch (err) {
      return { ok: false, reason: `no se pudo enviar el turno al sub-chat: ${err?.message || err}` }
    }
    if (escrito === false) return { ok: false, reason: 'el sub-chat no aceptó el envío' }

    if (conocido) return { ok: true, sessionId: conocido, cwds, baseOffset }

    // Sub-chat recién nacido (o abierto por el usuario desde la UI): su
    // sessionId se identifica SIEMPRE por el prompt. "El .jsonl más nuevo" no
    // vale: otra ventana, un PTY oculto de Telegram o una task-session pueden
    // crear sesión en el mismo proyecto justo ahora.
    let waited = 0
    while (waited < SUBCHAT_WAIT) {
      await wait(POLL)
      waited += POLL
      let forked = null
      try {
        forked = detectForkedRelayTranscript({ cwds, before, excludeSessionId: session.claudeSessionId, promptMarker: prompt })
      } catch { forked = null }
      if (!forked) continue
      const adoptado = adoptFork(forked, prompt, cwds)
      if (!adoptado) break
      session.voiceSubchatSessionId = forked.sessionId
      return adoptado
    }

    return { ok: false, reason: 'no se encontró el transcript del sub-chat' }
  }

  async function sendToTarget({ text, mode } = {}) {
    const prompt = unaSolaLinea(text)
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
  pickForkedSessionId,
  DEFAULT_POLL_MS,
  DEFAULT_SUBCHAT_WARMUP_MS,
  DEFAULT_SUBCHAT_FORK_WAIT_MS,
  DEFAULT_FORK_CHECK_AFTER_MS,
  DEFAULT_MOTHER_WAIT_MS,
  MAX_FORK_SCAN_BYTES
}
