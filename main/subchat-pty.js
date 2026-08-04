'use strict'

// Sub-chat desechable: fork (`--fork-session`) de la sesión claude de una
// ventana local, en un PTY propio, para preguntas laterales sin contaminar el
// hilo principal. Un sub-chat por ventana. Excluido del aislamiento git por
// sesión: hereda el workCwd de la madre (ver CLAUDE.md § spawns nuevos).

const { createPtyDataBatcher } = require('./pty-data-batcher')

// Cada cuánto y cuántas veces se busca el .jsonl que el fork acaba de crear.
// 1s × 20 = 20s: el fichero aparece al arrancar, así que en la práctica cae en
// la primera o segunda vuelta.
const SID_POLL_MS = 1000
const SID_POLL_TRIES = 20

function createSubchatManager({
  ptySpawn,
  ensureCliAvailable,
  buildFdLimitCommand,
  getClaudeModel,
  createBatcher,
  // Opcionales: sin ellos el sub-chat sigue funcionando igual, solo que no
  // llega a saber su propio sessionId (y `sessionIds()` sale vacío).
  snapshotSessions,
  detectNewSessionId,
  setIntervalFn,
  clearIntervalFn,
  log
} = {}) {
  if (typeof ptySpawn !== 'function') throw new Error('subchat: ptySpawn requerido')
  if (typeof ensureCliAvailable !== 'function') throw new Error('subchat: ensureCliAvailable requerido')
  if (typeof buildFdLimitCommand !== 'function') throw new Error('subchat: buildFdLimitCommand requerido')
  if (typeof getClaudeModel !== 'function') throw new Error('subchat: getClaudeModel requerido')

  const trace = typeof log === 'function' ? log : () => {}
  const makeBatcher = typeof createBatcher === 'function' ? createBatcher : createPtyDataBatcher
  const setIv = typeof setIntervalFn === 'function' ? setIntervalFn : setInterval
  const clearIv = typeof clearIntervalFn === 'function' ? clearIntervalFn : clearInterval

  // wcId → { pty, alive, win, wcId, _ptyBuf, claudeSessionId, _sidPoll }
  const byWc = new Map()

  const batcher = makeBatcher({
    sendFn: (entry, payload) => {
      try {
        if (entry.alive && entry.win && !entry.win.isDestroyed?.()) {
          entry.win.webContents.send('subchat:data', payload)
        }
      } catch {}
    }
  })

  function sendToRenderer(entry, channel, payload) {
    try {
      if (entry.win && !entry.win.isDestroyed?.()) {
        entry.win.webContents.send(channel, payload)
      }
    } catch {}
  }

  function stopSessionIdPoll(entry) {
    if (!entry || entry._sidPoll === null || entry._sidPoll === undefined) return
    try { clearIv(entry._sidPoll) } catch {}
    entry._sidPoll = null
  }

  function startSessionIdPoll(entry, cwd, before, motherSessionId) {
    if (!before || typeof detectNewSessionId !== 'function') return
    let intentos = 0
    const handle = setIv(() => {
      if (!entry.alive || intentos >= SID_POLL_TRIES) { stopSessionIdPoll(entry); return }
      intentos += 1
      let sid = null
      // La madre se excluye siempre: su .jsonl puede crecer o forkearse a la vez
      // y adoptarlo aquí sería el mismo error, en espejo.
      try { sid = detectNewSessionId(cwd, before, [motherSessionId]) } catch (err) {
        trace(`fallo buscando el sessionId del sub-chat: ${err?.message || err}`)
      }
      if (!sid) return
      entry.claudeSessionId = sid
      trace(`subchat wc=${entry.wcId} forkeó a ${sid}`)
      stopSessionIdPoll(entry)
    }, SID_POLL_MS)
    entry._sidPoll = handle
  }

  function canStart(session) {
    if (!session) return { ok: false, reason: 'Sesión no disponible' }
    if (session.activeCli !== 'claude') return { ok: false, reason: 'El sub-chat solo funciona con claude' }
    if (!session.claudeSessionId) return { ok: false, reason: 'Aún no hay contexto que heredar (sesión sin ID)' }
    if (byWc.has(session.wcId)) return { ok: false, reason: 'Ya hay un sub-chat abierto en esta ventana' }
    return { ok: true }
  }

  function start(session, { cols, rows } = {}) {
    const check = canStart(session)
    if (!check.ok) return { ok: false, error: check.reason }
    const cliCheck = ensureCliAvailable('claude')
    if (!cliCheck.ok) return { ok: false, error: cliCheck.error }
    const args = ['--model', getClaudeModel(), '--resume', session.claudeSessionId, '--fork-session']
    const cwd = session.gitWorkspace?.workCwd || session.cwd
    // Snapshot ANTES del spawn: es la única forma de reconocer después cuál de
    // los .jsonl del proyecto es el que ha creado este fork.
    let antesDelFork = null
    if (typeof snapshotSessions === 'function') {
      try { antesDelFork = snapshotSessions(cwd) } catch (err) { trace(`no se pudo fotografiar el proyecto antes del fork: ${err?.message || err}`) }
    }
    let proc
    try {
      proc = ptySpawn('/bin/bash', ['-c', buildFdLimitCommand(cliCheck.bin, args)], {
        name: 'xterm-256color',
        cols: cols || 100,
        rows: rows || 30,
        cwd,
        env: cliCheck.env
      })
    } catch (err) {
      return { ok: false, error: `No se pudo iniciar el sub-chat: ${err?.message || err}` }
    }
    const entry = { pty: proc, alive: true, win: session.win, wcId: session.wcId, _ptyBuf: null, claudeSessionId: null, _sidPoll: null }
    byWc.set(session.wcId, entry)
    trace(`subchat start wc=${session.wcId} sid=${session.claudeSessionId}`)
    // `--fork-session` estrena sessionId y NADIE lo sabía: ni este módulo ni
    // main.js. Un id sin dueño es un id que otro detector puede adoptar por
    // error — el de la sesión madre resumida lo hacía, y acababa forkeando de
    // su propio sub-chat. Se aprende aquí, en cuanto el fichero aparece.
    startSessionIdPoll(entry, cwd, antesDelFork, session.claudeSessionId)
    proc.onData((data) => {
      if (!entry.alive) return
      batcher.enqueue(entry, data)
    })
    proc.onExit(({ exitCode } = {}) => {
      if (!byWc.has(session.wcId) || byWc.get(session.wcId) !== entry) return
      entry.alive = false
      stopSessionIdPoll(entry)
      byWc.delete(session.wcId)
      try { batcher.flush(entry) } catch {}
      sendToRenderer(entry, 'subchat:exit', { code: exitCode ?? null, reason: 'exit' })
      trace(`subchat exit wc=${session.wcId} code=${exitCode}`)
    })
    return { ok: true }
  }

  // Devuelve si el texto llegó de verdad al PTY. Antes se tragaba el error y no
  // devolvía nada, así que un EPIPE (helper muerto con `alive` todavía a true)
  // era indistinguible de una escritura buena: quien esperaba respuesta —el
  // modo voz— daba el turno por enviado y se quedaba 180 s en silencio.
  function write(wcId, data) {
    const entry = byWc.get(wcId)
    if (!entry || !entry.alive) return false
    try { entry.pty.write(data); return true } catch (err) {
      trace(`no se pudo escribir en el sub-chat wc=${wcId}: ${err?.message || err}`)
      return false
    }
  }

  function resize(wcId, cols, rows) {
    const entry = byWc.get(wcId)
    if (!entry || !entry.alive || !cols || !rows) return
    try { entry.pty.resize(cols, rows) } catch {}
  }

  function close(wcId, reason = 'manual') {
    const entry = byWc.get(wcId)
    if (!entry) return false
    byWc.delete(wcId)
    // Flush ANTES de marcar alive=false: el sendFn del batcher exige
    // entry.alive para despachar, así que si lo apagamos antes el último
    // chunk pendiente se perdería en silencio.
    try { batcher.flush(entry) } catch {}
    entry.alive = false
    stopSessionIdPoll(entry)
    try { entry.pty.kill() } catch {}
    // El pty.onExit real usa un guard de identidad (byWc ya no tiene esta
    // entry) y no emitirá 'subchat:exit' — lo hacemos aquí para que el
    // renderer se entere también cuando el cierre lo inicia el main
    // (madre cerrada, app-quit, etc). 'renderer' ya lo sabe: no hace falta.
    if (reason !== 'renderer') {
      sendToRenderer(entry, 'subchat:exit', { code: null, reason })
    }
    trace(`subchat close wc=${wcId} reason=${reason}`)
    return true
  }

  function has(wcId) {
    return byWc.has(wcId)
  }

  // ¿Hay ALGÚN sub-chat vivo, sea de la ventana que sea? Lo consulta la
  // detección del fork del `--resume` en main.js: mientras haya uno abierto, su
  // .jsonl es un fichero nuevo más en el proyecto y no hay forma de distinguirlo
  // del fork propio, así que no se adopta nada.
  function hasAny() {
    return byWc.size > 0
  }

  // Los sessionIds forkeados que ya conocemos, para que nadie los adopte.
  function sessionIds() {
    const ids = []
    for (const entry of byWc.values()) {
      if (entry.claudeSessionId) ids.push(entry.claudeSessionId)
    }
    return ids
  }

  function closeAll() {
    for (const wcId of [...byWc.keys()]) close(wcId, 'close-all')
  }

  return { canStart, start, write, resize, close, has, hasAny, sessionIds, closeAll }
}

module.exports = { createSubchatManager }
