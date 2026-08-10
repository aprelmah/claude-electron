'use strict'
// Auto-commit acotado del panel 📚 Conocimiento. Un worktree de sesión es una
// copia congelada del último commit: si el conocimiento destilado/activado
// desde el panel no se comitea, esa sesión no lo ve nunca (experto invisible).
// Best-effort: si git falla por lo que sea, la operación del panel que lo llamó
// ya se guardó en disco igual — esto es una capa extra, nunca una condición.

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

function run(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

async function isGitRepo(projectDir) {
  const { error, stdout } = await run(['rev-parse', '--is-inside-work-tree'], projectDir)
  return !error && stdout.trim() === 'true'
}

// Comitea SOLO CLAUDE.md y kb/ (nunca -A): cualquier otro cambio sin commitear
// en el mismo repo (código a medias, lo que sea) queda intacto y sin tocar.
async function commitKbChanges(projectDir, message) {
  try {
    if (!(await isGitRepo(projectDir))) return { ok: true, skipped: true }

    // git add falla ENTERO si un pathspec no existe (p. ej. kb/ aún no creado):
    // solo pasamos los que de verdad están en disco.
    const paths = ['CLAUDE.md', 'kb'].filter((p) => fs.existsSync(path.join(projectDir, p)))
    if (!paths.length) return { ok: true, committed: false }

    const add = await run(['add', '--', ...paths], projectDir)
    if (add.error) return { ok: true, skipped: true, error: add.stderr || String(add.error.message) }

    const staged = await run(['diff', '--cached', '--name-only', '--', ...paths], projectDir)
    if (staged.error || !staged.stdout.trim()) return { ok: true, committed: false }

    const commit = await run(['commit', '-q', '-m', message], projectDir)
    if (commit.error) return { ok: true, committed: false, error: commit.stderr || String(commit.error.message) }

    return { ok: true, committed: true }
  } catch (e) {
    return { ok: true, committed: false, error: String(e?.message || e) }
  }
}

module.exports = { commitKbChanges }
