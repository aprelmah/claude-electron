'use strict'

// Vigía de fork/rotación de sessionId para task-sessions (ventanas de tarea y
// pool oculto de Telegram). Un `--resume` FORKEA (regla dura, CLAUDE.md
// § Relay de Telegram): el id de los args se pudre y el fichero vivo es uno
// NUEVO. El vigía anterior (findUpdatedOrNewClaudeSessionId) adoptaba también
// ficheros que solo habían CRECIDO — es decir, la sesión interactiva del
// usuario en el mismo proyecto — y esa adopción se persistía en la tarea y en
// el relay: sesiones mezcladas. Este módulo aplica las mismas guardas que el
// detectFork de startPty:
//   - solo ficheros NUEVOS respecto a la foto pre-spawn (pickForkedSessionId);
//   - nada que ya tenga dueño (knownClaudeSessionIds);
//   - ambigüedad (2+ nuevos) ⇒ no se adopta nada;
//   - sub-chat vivo ⇒ no se adopta Y se refresca la foto (su .jsonl queda
//     absorbido y no se adoptará ni siquiera después de cerrarlo).
// Mira el cwd del task-session Y el proyecto original del id resumido
// (resolveResumeCwd): una sesión resumida escribe en su proyecto ORIGINAL
// aunque el proceso corra en otro sitio.
function createTaskSessionForkWatch({
  listClaudeSessionFilesWithMtime,
  snapshotClaudeSessions,
  pickForkedSessionId,
  knownClaudeSessionIds,
  hasLiveSubchat,
  resolveResumeCwd
} = {}) {
  if (typeof listClaudeSessionFilesWithMtime !== 'function') throw new Error('fork-watch: listClaudeSessionFilesWithMtime requerido')
  if (typeof snapshotClaudeSessions !== 'function') throw new Error('fork-watch: snapshotClaudeSessions requerido')
  if (typeof pickForkedSessionId !== 'function') throw new Error('fork-watch: pickForkedSessionId requerido')

  function begin({ cwd, resumedSessionId } = {}) {
    const cwds = []
    if (cwd) cwds.push(cwd)
    let origCwd = null
    try { origCwd = resolveResumeCwd ? resolveResumeCwd(resumedSessionId) : null } catch {}
    if (origCwd && !cwds.includes(origCwd)) cwds.push(origCwd)
    const before = new Map()
    for (const c of cwds) {
      try { before.set(c, snapshotClaudeSessions(c)) } catch { before.set(c, new Map()) }
    }
    return { cwds, before, resumedSessionId: resumedSessionId || '' }
  }

  function refresh(watch) {
    for (const c of watch.cwds) {
      try { watch.before.set(c, snapshotClaudeSessions(c)) } catch {}
    }
  }

  function tick(watch) {
    if (!watch) return null
    let subchatVivo = false
    try { subchatVivo = hasLiveSubchat ? Boolean(hasLiveSubchat()) : false } catch {}
    if (subchatVivo) {
      refresh(watch)
      return null
    }
    const groups = []
    for (const c of watch.cwds) {
      groups.push({ rows: listClaudeSessionFilesWithMtime(c), before: watch.before.get(c) })
    }
    let known = []
    try { known = knownClaudeSessionIds ? knownClaudeSessionIds() : [] } catch {}
    return pickForkedSessionId({
      groups,
      excludeIds: [watch.resumedSessionId, ...known]
    })
  }

  return { begin, tick }
}

module.exports = { createTaskSessionForkWatch }
