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

  return { git, isGitRepo, prepareSessionWorkspace }
}

module.exports = { createSessionGit }
