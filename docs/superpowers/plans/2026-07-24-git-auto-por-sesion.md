# Git automático por sesión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aislar cada sesión PTY (ventana local y LAN) en su propio `git worktree` + rama `poweragent/session-<id>`, con commit+merge+push automático al cerrar, para que dos sesiones en el mismo cwd no se sobrescriban archivos.

**Architecture:** Módulo nuevo `main/session-git.js` (git vía `execFile` async, deps inyectables, fail-open) + registro persistente `main/session-git-map.js`. Integración en `main.js` (startPty/destroySession/before-quit) y `main/ws-server.js` (createPtyForSession/closeSession). `session.cwd` SIEMPRE conserva el path real del proyecto; el worktree solo se usa como cwd de spawn (`session.gitWorkspace.workCwd`).

**Tech Stack:** Node 20 (`node:child_process` execFile, `node:test`), git CLI, Electron 32.

**Spec:** `docs/superpowers/specs/2026-07-24-git-auto-por-sesion-design.md` — leerlo entero antes de empezar.

## Global Constraints

- Node `>=20.18.0 <23`. Tests: `node --test tests/*.test.js` (deben quedar TODOS en verde, hoy 427/0 fail).
- PROHIBIDO `execSync`/`statSync` sobre paths de usuario sin gate `looksRemotePath` (`main/dir-helpers.js`). Todo git es `execFile` async con `timeout` explícito (15000ms default).
- Escrituras de estado con `main/atomic-writes.js` (`atomicWriteJsonSync`), nunca `fs.writeFileSync` directo.
- Campos nuevos de config editables desde renderer DEBEN añadirse a la allowlist (`SAFE_CLI` en `main.js:3353`).
- `package.json` `build.files` es whitelist: los `.js` nuevos van bajo `main/` (ya incluido); NO crear `.js` nuevos en la raíz.
- Fail-open SIEMPRE: cualquier error de git → la sesión arranca sin aislamiento (flujo actual) + `console.warn`. Nunca bloquear un spawn.
- Comentarios y strings de UI en español de España. Sin emojis.
- Commits: uno por task, mensaje `feat(session-git): ...` / `test(...)`. NO push a origin (Luismi pushea).
- `main.js` es 3.9k líneas: editar con Edit quirúrgico, no reescrituras.

---

### Task 1: Núcleo `main/session-git.js` — isGitRepo + prepareSessionWorkspace

**Files:**
- Create: `main/session-git.js`
- Test: `tests/session-git-prepare.test.js`

**Interfaces:**
- Produces: `createSessionGit({ worktreesRoot, looksRemotePath, isEnabled, execFileImpl?, log? })` → objeto con:
  - `isGitRepo(cwd) → Promise<boolean>`
  - `prepareSessionWorkspace({ realCwd }) → Promise<{ key, realCwd, branch, worktreePath, workCwd } | null>` (`workCwd === worktreePath`)
  - `git(args, cwd) → Promise<string>` (interno, exportado para tests/tareas siguientes)

- [ ] **Step 1: Test que falla**

```js
// tests/session-git-prepare.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createSessionGit } = require('../main/session-git')

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }
function initRepo() {
  const dir = mkTmp('sg-repo-')
  const g = (args) => execFileSync('git', args, { cwd: dir })
  g(['init', '-q', '-b', 'main'])
  g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'base', '-q'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hola\n')
  g(['add', '-A'])
  g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'a', '-q'])
  return dir
}
function makeSg(overrides = {}) {
  return createSessionGit({
    worktreesRoot: mkTmp('sg-wt-'),
    looksRemotePath: () => false,
    isEnabled: () => true,
    ...overrides
  })
}

test('isGitRepo true en repo, false en dir normal', async () => {
  const sg = makeSg()
  assert.equal(await sg.isGitRepo(initRepo()), true)
  assert.equal(await sg.isGitRepo(mkTmp('sg-plain-')), false)
})

test('prepare crea worktree + rama poweragent/session-*', async () => {
  const repo = initRepo()
  const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.ok(ws)
  assert.match(ws.branch, /^poweragent\/session-/)
  assert.equal(ws.workCwd, ws.worktreePath)
  assert.ok(fs.existsSync(path.join(ws.workCwd, 'a.txt')))
  const branches = execFileSync('git', ['branch', '--list', ws.branch], { cwd: repo }).toString()
  assert.ok(branches.includes(ws.branch))
})

test('prepare devuelve null: no repo, remoto, disabled, repo sin HEAD', async () => {
  assert.equal(await makeSg().prepareSessionWorkspace({ realCwd: mkTmp('sg-plain-') }), null)
  assert.equal(await makeSg({ looksRemotePath: () => true }).prepareSessionWorkspace({ realCwd: initRepo() }), null)
  assert.equal(await makeSg({ isEnabled: () => false }).prepareSessionWorkspace({ realCwd: initRepo() }), null)
  const empty = mkTmp('sg-empty-')
  execFileSync('git', ['init', '-q'], { cwd: empty })
  assert.equal(await makeSg().prepareSessionWorkspace({ realCwd: empty }), null)
})

test('dos prepare sobre el mismo repo dan worktrees y ramas distintos', async () => {
  const repo = initRepo()
  const sg = makeSg()
  const w1 = await sg.prepareSessionWorkspace({ realCwd: repo })
  const w2 = await sg.prepareSessionWorkspace({ realCwd: repo })
  assert.notEqual(w1.branch, w2.branch)
  assert.notEqual(w1.worktreePath, w2.worktreePath)
})
```

- [ ] **Step 2: Verificar que falla** — `node --test tests/session-git-prepare.test.js` → FAIL (`Cannot find module '../main/session-git'`).

- [ ] **Step 3: Implementación**

```js
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
```

- [ ] **Step 4: Verificar** — `node --test tests/session-git-prepare.test.js` → PASS (4 tests).
- [ ] **Step 5: Commit** — `git add main/session-git.js tests/session-git-prepare.test.js && git commit -m "feat(session-git): prepareSessionWorkspace con worktree y rama por sesión"`

---

### Task 2: `finalizeSessionWorkspace` — los 4 desenlaces + push

**Files:**
- Modify: `main/session-git.js`
- Test: `tests/session-git-finalize.test.js`

**Interfaces:**
- Produces (añadido al objeto de `createSessionGit`):
  - `finalizeSessionWorkspace(ws) → Promise<{ outcome: 'clean'|'merged'|'merged-pushed'|'conflict'|'dirty-target'|'error', branch, detail? }>` — `ws` es el objeto devuelto por `prepareSessionWorkspace`.

**Reglas exactas (del spec):**
1. `git add -A` + commit en el worktree (si el commit falla por identidad, reintentar con `-c user.name=POWER-AGENT -c user.email=poweragent@local`). Mensaje: `poweragent: sesión <key> <ISO date>`.
2. Sin cambios (status --porcelain vacío Y sin commits nuevos sobre la base) → borrar worktree (`git worktree remove --force`) + `git branch -D` → `clean`.
3. Con cambios: si `git status --porcelain` del dir real NO está vacío, o su HEAD está detached (`rev-parse --abbrev-ref HEAD` → `HEAD`) → conservar rama, borrar worktree → `dirty-target`.
4. Dir real limpio → `git merge --no-edit <branch>` en el dir real. Conflicto → `git merge --abort` + conservar rama + borrar worktree → `conflict`.
5. Merge OK → borrar worktree + `git branch -d`. Si la rama del dir real tiene upstream (`git rev-parse --abbrev-ref --symbolic-full-name @{u}` no falla) → `git push` (timeout 30000). Push OK → `merged-pushed`; push falla → `merged` con `detail` del error (no fatal).
6. Cualquier excepción no prevista → `error` con `detail`, conservar rama si existe, intentar borrar worktree.

- [ ] **Step 1: Test que falla** — `tests/session-git-finalize.test.js` con el mismo harness `initRepo()`/`makeSg()` de Task 1 (duplicar los helpers en el archivo; no compartir fixtures entre archivos de test). Casos:

```js
test('clean: sin cambios → borra rama y worktree', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'clean')
  assert.ok(!fs.existsSync(ws.worktreePath))
  assert.equal(execFileSync('git', ['branch', '--list', ws.branch], { cwd: repo }).toString().trim(), '')
})

test('merged: cambios en worktree llegan al dir real', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'nuevo.txt'), 'x\n')
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'merged')
  assert.ok(fs.existsSync(path.join(repo, 'nuevo.txt')))
  assert.ok(!fs.existsSync(ws.worktreePath))
})

test('merged-pushed: con upstream hace push', async () => {
  const repo = initRepo()
  const bare = mkTmp('sg-bare-')
  execFileSync('git', ['init', '-q', '--bare'], { cwd: bare })
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo })
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo })
  const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'p.txt'), 'x\n')
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'merged-pushed')
  const remoteLog = execFileSync('git', ['log', '--oneline', 'main'], { cwd: bare }).toString()
  assert.ok(remoteLog.includes('poweragent'))
})

test('conflict: rama sobrevive, worktree no, dir real sin merge a medias', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'a.txt'), 'version-sesion\n')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'version-real\n')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'real', '-q'], { cwd: repo })
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'conflict')
  assert.ok(execFileSync('git', ['branch', '--list', ws.branch], { cwd: repo }).toString().includes(ws.branch))
  assert.ok(!fs.existsSync(ws.worktreePath))
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString().trim(), '')
})

test('dirty-target: dir real sucio → no merge, rama queda', async () => {
  const repo = initRepo(); const sg = makeSg()
  const ws = await sg.prepareSessionWorkspace({ realCwd: repo })
  fs.writeFileSync(path.join(ws.workCwd, 'n.txt'), 'x\n')
  fs.writeFileSync(path.join(repo, 'sucio.txt'), 'sin commitear\n')
  const r = await sg.finalizeSessionWorkspace(ws)
  assert.equal(r.outcome, 'dirty-target')
  assert.ok(!fs.existsSync(path.join(repo, 'n.txt')))
  assert.ok(execFileSync('git', ['branch', '--list', ws.branch], { cwd: repo }).toString().includes(ws.branch))
})
```

- [ ] **Step 2: Verificar que falla** — `node --test tests/session-git-finalize.test.js` → FAIL (`finalizeSessionWorkspace is not a function`).
- [ ] **Step 3: Implementar `finalizeSessionWorkspace`** en `main/session-git.js` siguiendo las 6 reglas de arriba. Detalle de "sin commits nuevos": comparar `git rev-parse <branch>` con `git merge-base <branch> HEAD`-base guardada no hace falta — basta: tras el commit-si-hay-cambios, si `git rev-parse <branch>` == `git rev-parse HEAD` del dir real → `clean`. Borrado: `git worktree remove --force <path>` desde `realCwd` y luego `git branch -D/-d`. Exportar también `removeWorktree(ws)` interno reutilizable.
- [ ] **Step 4: Verificar** — `node --test tests/session-git-prepare.test.js tests/session-git-finalize.test.js` → PASS (9 tests).
- [ ] **Step 5: Commit** — `feat(session-git): finalize con commit+merge+push y 4 desenlaces`

---

### Task 3: Registro persistente `main/session-git-map.js` + sweep de huérfanos

**Files:**
- Create: `main/session-git-map.js`
- Modify: `main/session-git.js` (añadir `sweepOrphans`)
- Test: `tests/session-git-map.test.js`

**Interfaces:**
- Produces: `createSessionGitMap({ filePath, atomicWriteJsonSync })` →
  - `recordActive({ claudeSessionId, realCwd, branch, worktreePath })`
  - `markFinalized(claudeSessionId)` (pone `active: false`, conserva `realCwd`/`branch`)
  - `lookupBySessionId(claudeSessionId) → entry | null`
  - `lookupByWorktreePath(worktreePath) → entry | null` (para mapear cwd de worktree borrado → realCwd)
  - `listActiveForCwd(realCwd) → entry[]`
  - `all() → { [claudeSessionId]: entry }` (objeto interno completo; lo usa el sweep de Task 6)
  - `flush()` (escritura inmediata; el resto debounce 250ms como los índices existentes — copiar el patrón de `main/claude-sessions-index.js`)
- Produces en `session-git`: `sweepOrphans({ realCwds }) → Promise<void>` — para cada repo conocido: `git worktree prune` + borrar ramas `poweragent/session-*` sin worktree Y totalmente mergeadas en HEAD (`git branch --merged` ∩ `poweragent/session-*` → `branch -d`); las no mergeadas se conservan (son las de conflicto).

- [ ] **Step 1: Tests que fallan** — record/lookup/list/markFinalized + persistencia (recrear el map desde el mismo filePath y ver los datos) + `sweepOrphans` (crear worktree, borrar su dir a mano, sweep → `git worktree list` ya no lo lista y la rama mergeada desaparece; una rama con commit no mergeado sobrevive).
- [ ] **Step 2: Verificar que fallan.**
- [ ] **Step 3: Implementar.** Debounce 250ms + `flush()`, mismo patrón que `main/claude-sessions-index.js`. Formato del JSON: `{ version: 1, sessions: { [claudeSessionId]: { realCwd, branch, worktreePath, active, updatedAt } } }`.
- [ ] **Step 4: Verificar** — suite completa de session-git en verde.
- [ ] **Step 5: Commit** — `feat(session-git): registro persistente sessionId→worktree y sweep de huérfanos`

---

### Task 4: Copias de sesión Claude worktree ↔ proyecto real

**Files:**
- Modify: `main/session-git.js`
- Test: `tests/session-git-jsonl.test.js`

**Interfaces:**
- Consumes: `resolveClaudeProjectDir(cwd)` de `main.js:852` — NO importarlo (main.js no es requerible en tests); `createSessionGit` recibe un nuevo dep inyectable `resolveClaudeProjectDir` (función `cwd → dir|null`).
- Produces:
  - `copySessionToWorktree({ claudeSessionId, realCwd, workCwd }) → boolean` — copia `<sid>.jsonl` del dir codificado del proyecto real al dir codificado del worktree (creándolo con mkdir -p). Para el flujo resume.
  - `copySessionsHome({ realCwd, workCwd }) → string[]` — copia TODOS los `*.jsonl` del dir codificado del worktree al del proyecto real (sobrescribe: el worktree tiene los turnos más nuevos), devuelve los sessionIds copiados. Para el finalize.

- [ ] **Step 1: Tests que fallan** — con dirs temporales simulando `~/.claude/projects/<encoded>/` y un `resolveClaudeProjectDir` fake inyectado (mapa path→dir). Casos: copia a worktree existente, copia home con sobrescritura, dir origen inexistente → no-op sin excepción.
- [ ] **Step 2: Verificar que fallan.**
- [ ] **Step 3: Implementar** (fs.copyFileSync sobre paths locales ya validados; los dirs codificados viven bajo `~/.claude`, local siempre).
- [ ] **Step 4: Verificar.**
- [ ] **Step 5: Commit** — `feat(session-git): copiar transcripts claude entre worktree y proyecto real`

---

### Task 5: Config `cli.gitSessionIsolation` + UI

**Files:**
- Modify: `main/config-store.js` (default `gitSessionIsolation: true` en la sección `cli` del config por defecto — seguir el patrón exacto de `claudeModel` añadido en commit `ee38f08`)
- Modify: `main.js:3353` (`SAFE_CLI` → añadir `'gitSessionIsolation'`)
- Modify: `index.html` (checkbox en la sección CLI de Configuración, debajo de "Modelo Claude": `<label class="settings-field"><span>Aislamiento git por sesión</span><input id="cfg-git-isolation" type="checkbox" /></label>`)
- Modify: `renderer.js` (leer/escribir el campo en `refreshSettings` y en el click de `btnSaveSettings`, patrón idéntico a `cfgClaudeModel` en `renderer.js:65,2085,2501`; checkbox → boolean)
- Test: `tests/session-git-config.test.js`

- [ ] **Step 1: Test que falla** — copiar el patrón de `tests/claude-model-default.test.js`: el default del config-store trae `cli.gitSessionIsolation === true`; un config guardado sin el campo lo normaliza a `true`; `false` guardado se respeta.
- [ ] **Step 2: Verificar que falla.**
- [ ] **Step 3: Implementar** los 4 archivos.
- [ ] **Step 4: Verificar** — test nuevo + `node --check main.js renderer.js` + suite completa.
- [ ] **Step 5: Commit** — `feat(session-git): toggle cli.gitSessionIsolation en config y ajustes`

---

### Task 6: Integración `main.js` — ventanas locales

**Files:**
- Modify: `main.js`
- Test: regresión (`node --test tests/*.test.js` completo) + `node --check main.js`. La lógica testeable vive en Tasks 1-4; aquí es cableado.

**Cambios concretos:**

1. **Instanciación** (en `onReady`, junto a `recentCwds`/`lastContext`, `main.js:~2645`):

```js
const { createSessionGit } = require('./main/session-git')          // arriba, con los demás requires
const { createSessionGitMap } = require('./main/session-git-map')
// en onReady:
sessionGitMap = createSessionGitMap({
  filePath: path.join(app.getPath('userData'), 'session-git-map.json'),
  atomicWriteJsonSync
})
sessionGit = createSessionGit({
  worktreesRoot: path.join(app.getPath('userData'), 'worktrees'),
  looksRemotePath,
  isEnabled: () => appConfig?.cli?.gitSessionIsolation !== false,
  resolveClaudeProjectDir
})
```

2. **`ensureSessionWorkspace(session, cwd)`** — función async nueva junto a `startPty`:

```js
async function ensureSessionWorkspace(session, cwd) {
  if (!sessionGit) return
  const realCwd = resolveExistingDir(cwd) || resolveExistingDir(session.cwd)
  if (!realCwd) return
  if (session.gitWorkspace) {
    if (session.gitWorkspace.realCwd === realCwd) return       // restart/hot-switch: reusar worktree
    finalizeWorkspaceForSession(session)                        // cambio de proyecto en la misma ventana
  }
  session.gitWorkspace = await sessionGit.prepareSessionWorkspace({ realCwd })
}
```

3. **`finalizeWorkspaceForSession(session)`** — async, fire-and-forget con notificación:

```js
const pendingFinalizes = new Set()
function finalizeWorkspaceForSession(session) {
  const ws = session?.gitWorkspace
  if (!ws) return
  session.gitWorkspace = null
  const p = (async () => {
    const copied = sessionGit.copySessionsHome({ realCwd: ws.realCwd, workCwd: ws.workCwd })
    const r = await sessionGit.finalizeSessionWorkspace(ws)
    for (const sid of copied) sessionGitMap.markFinalized(sid)
    if (r.outcome === 'conflict' || r.outcome === 'dirty-target' || r.outcome === 'error') {
      notifySessionGitIssue(ws, r)
    }
  })().catch((err) => console.warn('[session-git] finalize:', err?.message)).finally(() => pendingFinalizes.delete(p))
  pendingFinalizes.add(p)
}

function notifySessionGitIssue(ws, r) {
  const msg = r.outcome === 'conflict'
    ? `Conflicto al integrar la sesión. Sus cambios quedaron en la rama ${r.branch} de ${ws.realCwd}.`
    : r.outcome === 'dirty-target'
      ? `El proyecto ${ws.realCwd} tenía cambios sin commitear. Los cambios de la sesión quedaron en la rama ${r.branch}.`
      : `Error integrando la sesión (${r.detail || 'desconocido'}). Rama: ${r.branch}.`
  try { new Notification({ title: 'POWER-AGENT · git por sesión', body: msg }).show() } catch {}
  console.warn('[session-git]', msg)
}
```

(`Notification` viene de `require('electron')` — comprobar que ya está en el destructuring de la línea 1; si no, añadirlo.)

4. **`startPty`**: sin cambiar la firma. Sustituir `cwd: session.cwd` (línea 1301) por `cwd: session.gitWorkspace?.workCwd || session.cwd`, y en el snapshot/poll de claude (líneas 1286-1287 y 1326) usar la misma expresión en vez de `session.cwd`/`s.cwd`. En el poll, al detectar `sid` (línea 1328), añadir:

```js
if (s.gitWorkspace) sessionGitMap.recordActive({
  claudeSessionId: sid,
  realCwd: s.gitWorkspace.realCwd,
  branch: s.gitWorkspace.branch,
  worktreePath: s.gitWorkspace.worktreePath
})
```

5. **Call-sites async** — anteponer `await ensureSessionWorkspace(s, cwd)` justo antes de `startPty(...)` en:
   - `pty-start` (`main.js:2909`) → el handler pasa a `async`.
   - `pty-restart` (`main.js:3006`) → convertir el cuerpo del setTimeout: `setTimeout(() => { ensureSessionWorkspace(s, cwd).then(() => { ... startPty ... resolve(s.cwd) }).catch(reject) }, 200)`.
   - `resume-session` (`main.js:3280`) → igual que pty-restart. ADEMÁS: si `sessionId` y `s.gitWorkspace`, llamar antes del startPty a `sessionGit.copySessionToWorktree({ claudeSessionId: sessionId, realCwd: s.gitWorkspace.realCwd, workCwd: s.gitWorkspace.workCwd })`.
   - El binding de `createTelegramRelayBindings` (`main.js:1207`) se queda COMO ESTÁ (reinicia PTYs de sesiones ya existentes; `session.gitWorkspace` ya estará puesto y `startPty` lo usa solo).

6. **`destroySession` (`main.js:1423`)**: tras `killPty(s)`, añadir `finalizeWorkspaceForSession(s)`.

7. **Cierre de app**: en el handler `before-quit` existente (donde se hace flush de índices) añadir `sessionGitMap.flush()`. En `window-all-closed` (`main.js:2871`), tras el bucle de `killPty`, las sesiones pasan por `destroySession`/finalize; añadir espera acotada antes de `app.quit()`:

```js
if (pendingFinalizes.size) {
  await Promise.race([
    Promise.allSettled([...pendingFinalizes]),
    new Promise((r) => setTimeout(r, 10000))
  ])
}
```

(convertir el listener a async; comprobar cómo termina hoy — si llama `app.quit()` directo, envolver.)

8. **Sweep al arrancar** (en `onReady`, tras crear `sessionGit`): fire-and-forget

```js
sessionGit.sweepOrphans({ realCwds: [...new Set(Object.values(sessionGitMap.all()).map(e => e.realCwd))] })
  .catch((err) => console.warn('[session-git] sweep:', err?.message))
```

(añadir `all()` al map si no existe de Task 3 — devolver el objeto `sessions` interno.)

- [ ] **Step 1: Aplicar los 8 cambios** con Edit quirúrgico.
- [ ] **Step 2: `node --check main.js`** → sin errores.
- [ ] **Step 3: Suite completa** `node --test tests/*.test.js` → todo verde (ningún test existente puede romper).
- [ ] **Step 4: Prueba manual en dev** — protocolo osascript del CLAUDE.md: abrir la app, proyecto en repo git, comprobar con `git -C <repo> worktree list` que aparece el worktree; escribir un archivo desde la sesión; cerrar la ventana; comprobar que el cambio llegó a la rama del repo y el worktree desapareció. Repetir con dos ventanas en el mismo cwd.
- [ ] **Step 5: Commit** — `feat(session-git): aislamiento por worktree en ventanas locales`

---

### Task 7: Integración LAN (`main/ws-server.js`)

**Files:**
- Modify: `main/ws-server.js`, `main.js` (pasar `sessionGit`/`sessionGitMap` en las opciones de `createWsServer`)
- Test: `tests/ws-server-session-git.test.js`

**Cambios:**
- `createWsServer({ ..., sessionGit = null, sessionGitMap = null })`.
- En el flujo de conexión nueva (antes de `createPtyForSession`, `ws-server.js:2804`) y solo si la sesión LAN no tiene ya workspace: `session.gitWorkspace = await sessionGit?.prepareSessionWorkspace({ realCwd: session.cwd }) || null`. La rotación/hot-switch (`ws-server.js:2461`) REUTILIZA `session.gitWorkspace` (no crear otro).
- `createPtyForSession` (`ws-server.js:2697`): `cwd: session.gitWorkspace?.workCwd || session.cwd`. Si hay detección de sessionId claude equivalente en LAN, registrar en `sessionGitMap` igual que Task 6.4.
- `closeSession` (`ws-server.js:1306`): finalize fire-and-forget idéntico al de main.js (extraer la lógica común NO hace falta en v1: duplicar las ~15 líneas con un comentario; la notificación en LAN es `console.warn` + mensaje `status` por WS si el socket sigue abierto).
- Test: instanciar `createWsServer` como hacen `tests/ws-server-auth-token.test.js` (copiar su setup), con un `sessionGit` fake que registre llamadas; verificar que (a) una sesión con cwd repo-git spawnea el PTY con el workCwd del fake, (b) `closeSession` dispara finalize exactamente una vez, (c) sin `sessionGit` todo funciona como hoy (null-safe).

- [ ] **Step 1: Test que falla.**
- [ ] **Step 2: Verificar que falla.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Suite completa en verde + `node --check main/ws-server.js`.**
- [ ] **Step 5: Commit** — `feat(session-git): aislamiento por worktree en sesiones LAN`

---

### Task 8: Listado de sesiones con worktrees activos + resume mapping

**Files:**
- Modify: `main/session-helpers.js` (o donde viva `createSessionListing` — localizar con `grep -n "createSessionListing" main/*.js main.js`)
- Modify: `main.js` (`resolveTaskSessionCwd`, línea 1961)
- Test: `tests/session-git-listing.test.js`

**Cambios:**
- `createSessionListing` recibe un getter opcional `getActiveWorktreeSessions(cwd)` (late binding, como los índices — regla del proyecto). Al listar sesiones claude de un cwd, añadir las de los worktrees ACTIVOS de ese cwd (`sessionGitMap.listActiveForCwd(cwd)` → escanear `resolveClaudeProjectDir(worktreePath)`), dedupe por sessionId (gana la del worktree, es más nueva). Mantener el fallback actual si el getter no está.
- `resolveTaskSessionCwd` (`main.js:1961`): tras leer `obj.cwd` del JSONL, si ese cwd no existe en disco Y `sessionGitMap.lookupByWorktreePath(obj.cwd)` da entry → devolver `entry.realCwd`.
- Test: fixtures con dirs temporales (mismo patrón fake que Task 4): listado fusiona y dedupe; mapeo de worktree borrado → realCwd.

- [ ] **Step 1: Test que falla.** — [ ] **Step 2: Verificar.** — [ ] **Step 3: Implementar.** — [ ] **Step 4: Suite completa en verde.** — [ ] **Step 5: Commit** — `feat(session-git): listado fusiona sesiones de worktrees activos y resume mapea a cwd real`

---

### Task 9: Cierre — docs, suite estable y verificación final

**Files:**
- Modify: `CLAUDE.md` (sección nueva "Git automático por sesión": qué hace, toggle `cli.gitSessionIsolation`, dónde quedan las ramas de conflicto, regla: los spawns locales/LAN pasan por `ensureSessionWorkspace`; automation/task-sessions NO se aíslan aún)
- Modify: `docs/superpowers/specs/2026-07-24-git-auto-por-sesion-design.md` (marcar desviaciones si las hubo)

- [ ] **Step 1: Docs.**
- [ ] **Step 2: Suite 3 veces seguidas** — `for i in 1 2 3; do node --test tests/*.test.js || break; done` → 3/3 verde (caza flakiness de los tests con repos git temporales).
- [ ] **Step 3: `node --check` de todos los archivos tocados.**
- [ ] **Step 4: Prueba manual integral en dev** (osascript): dos ventanas mismo repo editando el mismo archivo → cerrar ambas → una mergea limpia, la otra da conflicto con notificación y rama viva. Verificar `userData/worktrees/` vacío al final.
- [ ] **Step 5: Commit** — `docs(session-git): runbook y spec final`

**NO hacer:** push a origin, deploy a /Applications, ni tocar `package.json` build.files (main/ ya está whitelisted). Eso lo decide Luismi al final.
