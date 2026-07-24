// main/session-git.js
// Aislamiento git por sesión: cada PTY trabaja en su propio worktree con rama
// poweragent/session-<key>. Fail-open: cualquier error → null y la sesión
// arranca sin aislar. Todo git es async con timeout — nunca bloquear el main.
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')

const GIT_TIMEOUT_MS = 15000

function createSessionGit({ worktreesRoot, looksRemotePath, isEnabled, execFileImpl = execFile, log = console } = {}) {
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
      fs.mkdirSync(worktreesRoot, { recursive: true })
      await git(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], realCwd, { timeout: 60000 })
      return { key, realCwd, branch, worktreePath, workCwd: worktreePath }
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

  async function commitSessionChanges(ws) {
    await git(['add', '-A'], ws.workCwd)
    const message = `poweragent: sesión ${ws.key} ${new Date().toISOString()}`
    try {
      await git(['commit', '-m', message], ws.workCwd)
    } catch (err) {
      const output = String(err?.stdout || '') + String(err?.stderr || '') + String(err?.message || '')
      if (/nothing to commit/i.test(output)) return
      try {
        await git(
          ['-c', 'user.name=POWER-AGENT', '-c', 'user.email=poweragent@local', 'commit', '-m', message],
          ws.workCwd
        )
      } catch (err2) {
        const output2 = String(err2?.stdout || '') + String(err2?.stderr || '') + String(err2?.message || '')
        if (/nothing to commit/i.test(output2)) return
        throw err2
      }
    }
  }

  async function hasUpstream(cwd) {
    try {
      await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd)
      return true
    } catch {
      return false
    }
  }

  async function finalizeSessionWorkspace(ws) {
    let branchExists = true
    try {
      await commitSessionChanges(ws)

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
        try { await git(['merge', '--abort'], ws.realCwd) } catch { /* nada que abortar */ }
        await removeWorktree(ws)
        return { outcome: 'conflict', branch: ws.branch, detail: String(err?.stderr || err?.message || err) }
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
      if (branchExists) await removeWorktree(ws)
      return { outcome: 'error', branch: ws.branch, detail: String(err?.stderr || err?.message || err) }
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

        const branchListOut = await git(['branch', '--list', 'poweragent/session-*'], realCwd)
        const sessionBranches = branchListOut
          .split('\n')
          .map((line) => line.replace(/^\*?\s+/, '').trim())
          .filter(Boolean)

        if (sessionBranches.length === 0) continue

        const mergedOut = await git(['branch', '--merged', 'HEAD'], realCwd)
        const mergedBranches = new Set(
          mergedOut.split('\n').map((line) => line.replace(/^\*?\s+/, '').trim()).filter(Boolean)
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

  return { git, isGitRepo, prepareSessionWorkspace, finalizeSessionWorkspace, removeWorktree, sweepOrphans }
}

module.exports = { createSessionGit }
