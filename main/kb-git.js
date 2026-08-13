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

const KB_PATHS = ['CLAUDE.md', 'kb']

// git add falla ENTERO si un pathspec no existe (p. ej. kb/ aún no creado):
// solo pasamos los que de verdad están en disco. Un fichero BORRADO cuenta:
// mientras siga en HEAD hay algo que commitear aunque no esté en disco.
function kbPathspecs(projectDir) {
  return KB_PATHS.filter((p) => fs.existsSync(path.join(projectDir, p)))
}

// Comitea SOLO CLAUDE.md y kb/ (nunca -A): cualquier otro cambio sin commitear
// en el mismo repo (código a medias, lo que sea) queda intacto y sin tocar.
// `--no-verify`: esto es conocimiento, no código; el pre-commit del proyecto
// destino (lint, tests) no tiene nada que decir y bloquearlo dejaría el borrado
// fuera de HEAD, que es justo el fallo que se quiere evitar.
async function commitKbChanges(projectDir, message) {
  try {
    if (!(await isGitRepo(projectDir))) return { ok: true, skipped: true }

    const paths = kbPathspecs(projectDir)
    if (!paths.length) return { ok: true, committed: false }

    const add = await run(['add', '--', ...paths], projectDir)
    if (add.error) return { ok: true, skipped: true, error: add.stderr || String(add.error.message) }

    const staged = await run(['diff', '--cached', '--name-only', '--', ...paths], projectDir)
    if (staged.error || !staged.stdout.trim()) return { ok: true, committed: false }

    const commit = await run(['commit', '-q', '--no-verify', '-m', message], projectDir)
    if (commit.error) return { ok: true, committed: false, error: commit.stderr || String(commit.error.message) }

    return { ok: true, committed: true }
  } catch (e) {
    return { ok: true, committed: false, error: String(e?.message || e) }
  }
}

// ¿Hay conocimiento (CLAUDE.md / kb/) que difiera de HEAD? Incluye ficheros sin
// trackear: una ficha nueva sin commitear es tan invisible para un worktree como
// una borrada es inmortal. `status` tolera pathspecs inexistentes, a diferencia
// de `add`, así que aquí se preguntan siempre los dos.
async function hasPendingKbChanges(projectDir) {
  try {
    if (!(await isGitRepo(projectDir))) return false
    const st = await run(['status', '--porcelain', '--', ...KB_PATHS], projectDir)
    if (st.error) return false
    return st.stdout.trim().length > 0
  } catch {
    return false
  }
}

// Garantiza el invariante antes de crear un worktree de sesión: lo que el
// usuario ve en disco es lo que HEAD sirve. A diferencia de commitKbChanges
// (best-effort de una operación del panel ya guardada en disco), aquí un fallo
// SÍ importa — devuelve ok:false para que quien llame degrade a no aislar en vez
// de arrancar una sesión con conocimiento retirado.
async function ensureKbCommitted(projectDir, message) {
  try {
    if (!(await hasPendingKbChanges(projectDir))) return { ok: true, committed: false }
    const r = await commitKbChanges(projectDir, message)
    if (r.committed) return { ok: true, committed: true }
    return { ok: false, committed: false, error: r.error || 'el conocimiento pendiente no llegó a HEAD' }
  } catch (e) {
    return { ok: false, committed: false, error: String(e?.message || e) }
  }
}

module.exports = { commitKbChanges, hasPendingKbChanges, ensureKbCommitted }
