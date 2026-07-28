// main/session-git.js
// Aislamiento git por sesión: cada PTY trabaja en su propio worktree con rama
// poweragent/session-<key>. Fail-open: cualquier error → null y la sesión
// arranca sin aislar. Todo git es async con timeout — nunca bloquear el main.
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')

const GIT_TIMEOUT_MS = 15000

function createSessionGit({
  worktreesRoot,
  looksRemotePath,
  isEnabled,
  execFileImpl = execFile,
  log = console,
  resolveClaudeProjectDir
} = {}) {
  function git(args, cwd, { timeout = GIT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      execFileImpl('git', args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          err.stderr = String(stderr || '')
          err.stdout = String(stdout || '')
          reject(err)
        } else resolve(String(stdout || '').trim())
      })
    })
  }

  async function isGitRepo(cwd) {
    try { return (await git(['rev-parse', '--is-inside-work-tree'], cwd)) === 'true' } catch { return false }
  }

  function slugFor(realCwd) {
    const base = path.basename(realCwd).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40) || 'repo'
    const hash = crypto.createHash('sha1').update(realCwd).digest('hex').slice(0, 6)
    return `${base}-${hash}`
  }

  async function prepareSessionWorkspace({ realCwd }) {
    try {
      if (!realCwd) return null
      if (typeof isEnabled === 'function' && !isEnabled()) return null
      if (looksRemotePath(realCwd)) return null
      if (!(await isGitRepo(realCwd))) return null
      try { await git(['rev-parse', '--verify', 'HEAD'], realCwd) } catch { return null }
      const key = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
      const branch = `poweragent/session-${key}`
      const worktreePath = path.join(worktreesRoot, `${slugFor(realCwd)}-${key}`)
      // Prefijo del subdirectorio respecto a la raíz del repo (vacío en la
      // raíz). Se calcula ANTES de crear el worktree: si falla, no queda nada
      // huérfano que limpiar.
      const prefix = (await git(['rev-parse', '--show-prefix'], realCwd)).replace(/\/+$/, '')
      fs.mkdirSync(worktreesRoot, { recursive: true })
      await git(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], realCwd, { timeout: 60000 })
      // Si la sesión nace en un subdirectorio del repo, el PTY debe arrancar
      // en el subdirectorio equivalente del worktree — no teletransportarse a
      // la raíz. worktreePath sigue siendo la raíz (es lo que gestiona git).
      let workCwd = worktreePath
      if (prefix) {
        const candidate = path.join(worktreePath, prefix)
        let isDir = false
        try { isDir = fs.statSync(candidate).isDirectory() } catch { isDir = false }
        if (!isDir) {
          // Fail-open: el subdirectorio no existe en HEAD → limpiar lo recién
          // creado y arrancar sin aislar.
          await removeWorktree({ worktreePath, realCwd })
          try { await git(['branch', '-D', branch], realCwd) } catch { /* mejor esfuerzo */ }
          return null
        }
        workCwd = candidate
      }
      return { key, realCwd, branch, worktreePath, workCwd }
    } catch (err) {
      log.warn?.(`[session-git] prepare falló (${realCwd}): ${err?.message || err}`)
      return null
    }
  }

  async function removeWorktree(ws) {
    try {
      await git(['worktree', 'remove', '--force', ws.worktreePath], ws.realCwd, { timeout: 60000 })
    } catch (err) {
      log.warn?.(`[session-git] no se pudo borrar worktree (${ws.worktreePath}): ${err?.message || err}`)
    }
  }

  // Devuelve 'committed' si dejó los cambios en un commit, 'nothing' si no
  // había nada que commitear. --no-verify SIEMPRE: los worktrees comparten
  // .git/hooks con el repo real y un pre-commit lento (ej. suite de tests)
  // reventaría el timeout perdiendo el commit de rescate de la sesión.
  async function commitSessionChanges(ws) {
    await git(['add', '-A'], ws.workCwd, { timeout: 60000 })
    const message = `poweragent: sesión ${ws.key} ${new Date().toISOString()}`
    try {
      await git(['commit', '--no-verify', '-m', message], ws.workCwd, { timeout: 60000 })
    } catch (err) {
      const output = String(err?.stdout || '') + String(err?.stderr || '') + String(err?.message || '')
      if (/nothing to commit/i.test(output)) return 'nothing'
      try {
        await git(
          ['-c', 'user.name=POWER-AGENT', '-c', 'user.email=poweragent@local', 'commit', '--no-verify', '-m', message],
          ws.workCwd,
          { timeout: 60000 }
        )
      } catch (err2) {
        const output2 = String(err2?.stdout || '') + String(err2?.stderr || '') + String(err2?.message || '')
        if (/nothing to commit/i.test(output2)) return 'nothing'
        throw err2
      }
    }
    return 'committed'
  }

  async function hasUpstream(cwd) {
    try {
      await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
      return true
    } catch {
      return false
    }
  }

  // Cola por repo: dos finalize simultáneos sobre el mismo realCwd (varias
  // ventanas, LAN + local, recovery al arrancar) se serializan para no
  // pisarse el index.lock ni producir falsos conflictos.
  const finalizeQueues = new Map()

  function finalizeSessionWorkspace(ws) {
    const queueKey = String(ws?.realCwd || '')
    const prev = finalizeQueues.get(queueKey) || Promise.resolve()
    const run = prev.then(() => doFinalizeSessionWorkspace(ws))
    const tracked = run.catch(() => { /* la cola nunca se rompe */ })
    finalizeQueues.set(queueKey, tracked)
    tracked.then(() => {
      if (finalizeQueues.get(queueKey) === tracked) finalizeQueues.delete(queueKey)
    })
    return run
  }

  async function doFinalizeSessionWorkspace(ws) {
    let branchExists = true
    let committed = false
    try {
      committed = (await commitSessionChanges(ws)) === 'committed'

      const branchRev = await git(['rev-parse', ws.branch], ws.workCwd)
      const targetHead = await git(['rev-parse', 'HEAD'], ws.realCwd)
      if (branchRev === targetHead) {
        await removeWorktree(ws)
        await git(['branch', '-D', ws.branch], ws.realCwd)
        branchExists = false
        return { outcome: 'clean', branch: ws.branch }
      }

      const targetStatus = await git(['status', '--porcelain'], ws.realCwd)
      const targetHeadRef = await git(['rev-parse', '--abbrev-ref', 'HEAD'], ws.realCwd)
      if (targetStatus !== '' || targetHeadRef === 'HEAD') {
        await removeWorktree(ws)
        return { outcome: 'dirty-target', branch: ws.branch }
      }

      try {
        await git(['merge', '--no-edit', ws.branch], ws.realCwd)
      } catch (err) {
        // Mismo fallback de identidad que el commit: un merge no fast-forward
        // crea commit propio y también exige user.name/user.email.
        const output = String(err?.stdout || '') + String(err?.stderr || '') + String(err?.message || '')
        let mergedWithIdentity = false
        if (/(tell me who you are|user\.name|user\.email|empty ident)/i.test(output)) {
          try { await git(['merge', '--abort'], ws.realCwd) } catch { /* nada que abortar */ }
          try {
            await git(
              ['-c', 'user.name=POWER-AGENT', '-c', 'user.email=poweragent@local', 'merge', '--no-edit', ws.branch],
              ws.realCwd
            )
            mergedWithIdentity = true
          } catch { /* cae al tratamiento de conflicto */ }
        }
        if (!mergedWithIdentity) {
          try { await git(['merge', '--abort'], ws.realCwd) } catch { /* nada que abortar */ }
          await removeWorktree(ws)
          return { outcome: 'conflict', branch: ws.branch, detail: String(err?.stderr || err?.message || err) }
        }
      }

      await removeWorktree(ws)
      await git(['branch', '-d', ws.branch], ws.realCwd)
      branchExists = false

      if (await hasUpstream(ws.realCwd)) {
        try {
          await git(['push'], ws.realCwd, { timeout: 30000 })
          return { outcome: 'merged-pushed', branch: ws.branch }
        } catch (err) {
          return { outcome: 'merged', branch: ws.branch, detail: String(err?.stderr || err?.message || err) }
        }
      }

      return { outcome: 'merged', branch: ws.branch }
    } catch (err) {
      const detail = String(err?.stderr || err?.message || err)
      if (!committed) {
        // El commit no llegó a puerto: si el worktree tiene cambios, es la
        // ÚNICA copia de ese trabajo → conservarlo en disco (rama incluida).
        let hasChanges = true
        try { hasChanges = (await git(['status', '--porcelain'], ws.workCwd)) !== '' } catch { /* asumir cambios */ }
        if (hasChanges) {
          return {
            outcome: 'error',
            branch: ws.branch,
            detail: `worktree conservado con cambios sin commitear en ${ws.worktreePath}: ${detail}`
          }
        }
      }
      if (branchExists) await removeWorktree(ws)
      return { outcome: 'error', branch: ws.branch, detail }
    }
  }

  // Barre huérfanos: worktrees borrados a mano (rm -rf, Finder, etc.) que git
  // aún referencia, y ramas poweragent/session-* que ya no sirven a ningún
  // worktree. Solo borra ramas totalmente mergeadas en HEAD — una rama con
  // commits propios sin mergear (caso 'conflict'/'dirty-target') sobrevive,
  // porque es la única copia de ese trabajo. Fail-open total: nunca lanza,
  // cualquier fallo por repo se loguea y se sigue con el siguiente.
  async function sweepOrphans({ realCwds } = {}) {
    const cwds = Array.isArray(realCwds) ? [...new Set(realCwds.filter(Boolean))] : []
    for (const realCwd of cwds) {
      try {
        if (looksRemotePath(realCwd)) continue
        if (!(await isGitRepo(realCwd))) continue

        try {
          await git(['worktree', 'prune'], realCwd, { timeout: 30000 })
        } catch (err) {
          log.warn?.(`[session-git] sweep: prune falló (${realCwd}): ${err?.message || err}`)
        }

        const worktreeListOut = await git(['worktree', 'list', '--porcelain'], realCwd)
        const busyBranches = new Set()
        for (const line of worktreeListOut.split('\n')) {
          const m = line.match(/^branch refs\/heads\/(.+)$/)
          if (m) busyBranches.add(m[1])
        }

        // for-each-ref no decora nombres (ni '*' de rama actual ni '+' de rama
        // ocupada por otro worktree, que sí añade `git branch --list`), así que
        // el nombre siempre coincide tal cual con el de `worktree list --porcelain`.
        const sessionBranchesOut = await git(
          ['for-each-ref', '--format=%(refname:short)', 'refs/heads/poweragent/session-*'],
          realCwd
        )
        const sessionBranches = sessionBranchesOut
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)

        if (sessionBranches.length === 0) continue

        const mergedOut = await git(
          ['for-each-ref', '--merged', 'HEAD', '--format=%(refname:short)', 'refs/heads/poweragent/session-*'],
          realCwd
        )
        const mergedBranches = new Set(
          mergedOut.split('\n').map((line) => line.trim()).filter(Boolean)
        )

        for (const branch of sessionBranches) {
          if (busyBranches.has(branch)) continue
          if (!mergedBranches.has(branch)) continue
          try {
            await git(['branch', '-d', branch], realCwd)
          } catch (err) {
            log.warn?.(`[session-git] sweep: no se pudo borrar rama ${branch} (${realCwd}): ${err?.message || err}`)
          }
        }
      } catch (err) {
        log.warn?.(`[session-git] sweep falló (${realCwd}): ${err?.message || err}`)
      }
    }
  }

  // Worktrees en disco que el registro nunca llegó a apuntar. recordActive()
  // solo se llama cuando el poll detecta un claudeSessionId, así que una
  // sesión que muere antes de generarlo (ventana abierta sin escribir nada,
  // pkill del protocolo de deploy) deja el worktree fuera del registro y el
  // sweep no puede verlo. Al arrancar no hay ningún PTY vivo y la app es
  // single-instance → todo worktree presente aquí es huérfano por definición.
  // Devuelve entradas con la forma que espera recoverOrphanedWorkspaces
  // (claudeSessionId vacío: no se conoce, y markFinalized lo ignora).
  // Fail-open total: nunca lanza; lo que no se puede resolver se deja en paz.
  async function discoverUnregisteredWorkspaces({ knownWorktreePaths } = {}) {
    const found = []
    try {
      const known = new Set(
        (Array.isArray(knownWorktreePaths) ? knownWorktreePaths : [])
          .filter(Boolean)
          .map((p) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } })
      )
      let entries = []
      try {
        entries = fs.readdirSync(worktreesRoot, { withFileTypes: true })
      } catch { return found }

      for (const dirent of entries) {
        if (!dirent.isDirectory()) continue
        const worktreePath = path.join(worktreesRoot, dirent.name)
        try {
          const resolved = fs.realpathSync(worktreePath)
          if (known.has(resolved)) continue
          // Un worktree de git tiene un fichero .git con 'gitdir: ...'; un
          // directorio cualquiera dentro de worktreesRoot no.
          if (!fs.existsSync(path.join(worktreePath, '.git'))) continue

          const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)
          if (!branch.startsWith('poweragent/session-')) continue

          // La raíz del repo principal es el primer 'worktree' del porcelain.
          const listOut = await git(['worktree', 'list', '--porcelain'], worktreePath)
          const mainLine = listOut.split('\n').find((line) => line.startsWith('worktree '))
          const realCwd = mainLine ? mainLine.slice('worktree '.length).trim() : ''
          if (!realCwd || !fs.existsSync(realCwd)) continue

          found.push({ claudeSessionId: '', realCwd, branch, worktreePath })
        } catch (err) {
          log.warn?.(`[session-git] discover: se ignora ${worktreePath}: ${err?.message || err}`)
        }
      }
    } catch (err) {
      log.warn?.(`[session-git] discover falló: ${err?.message || err}`)
    }
    return found
  }

  // Recuperación tras crash: al arrancar la app no hay ningún PTY vivo, así
  // que toda entrada activa del registro es huérfana por definición. Para
  // cada una: si su worktree sigue en disco → copiar transcripts a casa y
  // finalizar (commit → merge) como si la sesión hubiera cerrado bien; si el
  // dir ya no existe → 'gone'. Nunca lanza: cada entrada en su try/catch.
  async function recoverOrphanedWorkspaces({ entries } = {}) {
    const list = Array.isArray(entries) ? entries : []
    const results = []
    for (const entry of list) {
      const claudeSessionId = String(entry?.claudeSessionId || '')
      try {
        const realCwd = String(entry?.realCwd || '')
        const branch = String(entry?.branch || '')
        const worktreePath = String(entry?.worktreePath || '')
        if (!realCwd || !branch || !worktreePath || !fs.existsSync(worktreePath)) {
          results.push({ claudeSessionId, branch, outcome: 'gone' })
          continue
        }
        // Coherencia con prepare: si la sesión corría en un subdirectorio del
        // repo, reconstruir el workCwd equivalente dentro del worktree.
        let workCwd = worktreePath
        try {
          const prefix = (await git(['rev-parse', '--show-prefix'], realCwd)).replace(/\/+$/, '')
          if (prefix && fs.statSync(path.join(worktreePath, prefix)).isDirectory()) {
            workCwd = path.join(worktreePath, prefix)
          }
        } catch { /* raíz del worktree como fallback */ }
        const ws = {
          key: branch.replace('poweragent/session-', ''),
          realCwd,
          branch,
          worktreePath,
          workCwd
        }
        try { copySessionsHome({ realCwd: ws.realCwd, workCwd: ws.workCwd }) } catch { /* fail-open */ }
        const r = await finalizeSessionWorkspace(ws)
        results.push({ claudeSessionId, branch, outcome: r?.outcome || 'error', detail: r?.detail })
      } catch (err) {
        log.warn?.(`[session-git] recover falló (${claudeSessionId}): ${err?.message || err}`)
        results.push({ claudeSessionId, outcome: 'error', detail: String(err?.message || err) })
      }
    }
    return results
  }

  // Copia el transcript .jsonl de una sesión Claude Code del dir codificado
  // del proyecto real al del worktree (creándolo con mkdir -p). Se usa al
  // arrancar el PTY con --resume dentro del worktree: sin esto, Claude Code
  // no encuentra el historial de la sesión porque vive bajo el cwd real.
  // Fail-open: cualquier fallo (dep no inyectada, dir/fichero ausente) ->
  // false sin lanzar excepción.
  function copySessionToWorktree({ claudeSessionId, realCwd, workCwd }) {
    try {
      if (typeof resolveClaudeProjectDir !== 'function') return false
      if (!claudeSessionId || !realCwd || !workCwd) return false

      const sourceDir = resolveClaudeProjectDir(realCwd)
      if (!sourceDir) return false
      const sourceFile = path.join(sourceDir, `${claudeSessionId}.jsonl`)
      if (!fs.existsSync(sourceFile)) return false

      const targetDir = resolveClaudeProjectDir(workCwd)
      if (!targetDir) return false
      fs.mkdirSync(targetDir, { recursive: true })
      const targetFile = path.join(targetDir, `${claudeSessionId}.jsonl`)

      // Si el worktree ya tiene una copia igual o más reciente que el
      // proyecto real (doble resume, crash a mitad de sesión), no la
      // pisamos: perderíamos turnos que solo existen ahí.
      if (fs.existsSync(targetFile)) {
        const sourceMtime = fs.statSync(sourceFile).mtimeMs
        const targetMtime = fs.statSync(targetFile).mtimeMs
        if (targetMtime >= sourceMtime) return true
      }

      fs.copyFileSync(sourceFile, targetFile)
      return true
    } catch (err) {
      log.warn?.(`[session-git] copySessionToWorktree falló (${claudeSessionId}): ${err?.message || err}`)
      return false
    }
  }

  // Copia TODOS los .jsonl del dir codificado del worktree al del proyecto
  // real, sobrescribiendo (el worktree tiene los turnos más recientes tras
  // el trabajo de la sesión). Se usa al finalizar/mergear el worktree para
  // que el transcript de Claude Code quede sincronizado en el proyecto real.
  // Fail-open: dep no inyectada o dir origen ausente -> [] sin lanzar.
  // Cada fichero se copia en su propio try/catch: si uno falla (corrupto,
  // permisos, etc.) no aborta el resto — el array devuelto refleja
  // exactamente lo que se copió de verdad, nunca menos de lo que hay en disco.
  function copySessionsHome({ realCwd, workCwd }) {
    try {
      if (typeof resolveClaudeProjectDir !== 'function') return []
      if (!realCwd || !workCwd) return []

      const sourceDir = resolveClaudeProjectDir(workCwd)
      if (!sourceDir || !fs.existsSync(sourceDir)) return []

      const targetDir = resolveClaudeProjectDir(realCwd)
      if (!targetDir) return []
      fs.mkdirSync(targetDir, { recursive: true })

      // withFileTypes + isFile() para no intentar copiar directorios que por
      // lo que sea se llamen "*.jsonl" (EISDIR) — se descartan de raíz en el
      // listado en vez de reventar copyFileSync.
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter((entry) => entry.name.endsWith('.jsonl'))

      const copiedSessionIds = []
      for (const entry of entries) {
        const sessionId = entry.name.slice(0, -'.jsonl'.length)
        if (!entry.isFile()) {
          log.warn?.(`[session-git] copySessionsHome: '${entry.name}' no es un fichero regular, se omite (${workCwd})`)
          continue
        }
        try {
          fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name))
          copiedSessionIds.push(sessionId)
        } catch (err) {
          log.warn?.(`[session-git] copySessionsHome: fallo copiando '${entry.name}' (${err?.message || err}), se continúa con el resto`)
        }
      }
      return copiedSessionIds
    } catch (err) {
      log.warn?.(`[session-git] copySessionsHome falló (${realCwd}): ${err?.message || err}`)
      return []
    }
  }

  return {
    git,
    isGitRepo,
    prepareSessionWorkspace,
    finalizeSessionWorkspace,
    removeWorktree,
    sweepOrphans,
    discoverUnregisteredWorkspaces,
    recoverOrphanedWorkspaces,
    copySessionToWorktree,
    copySessionsHome
  }
}

module.exports = { createSessionGit }
