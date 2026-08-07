# Botón "Llevar a Terminal" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botón en la topbar que abre la sesión activa (claude o codex) con todo su historial en Terminal.app, soltándola de la app por debajo.

**Architecture:** Módulo puro nuevo `main/terminal-handoff.js` (construcción y escapado de comandos + osascript con exec inyectable), un IPC `session:handoff-to-terminal` en `main.js` que reutiliza `killPty` + `finalizeWorkspaceForSession` (refactor mínimo: devolver su promesa), y un botón en la topbar cableado por `preload.js`/`renderer.js`.

**Tech Stack:** Electron main/renderer, node:test, osascript → Terminal.app.

**Spec:** `docs/superpowers/specs/2026-08-07-boton-a-terminal-design.md`

## Global Constraints

- Node 20.18.0 para tests (`nvm use 20.18.0`); suite: `node --test tests/*.test.js`.
- **NO commitear en ningún paso**: Luismi commitea tras probar (regla del repo). Un único commit al final con su OK, incluyendo spec + plan.
- `main/**` ya está en `build.files`; NO se crean `.js`/`.html` nuevos en la raíz.
- Tras `killPty()` el onExit NO emite `pty-exit` (guard `_alive=false`, main.js:1867): el handler debe mandarlo explícito con `session.win.webContents.send('pty-exit')`.
- El orden capturar → killPty → **await finalize** → abrir Terminal es de carga: `copySessionsHome` (dentro del finalize) copia el `.jsonl` al proyecto real; sin eso `claude --resume <id>` en el cwd real da "No conversation found".
- Comando sin `--model` ni flags de la app: CLI interactiva normal.
- `renderer.js` no se testea en este repo: la lógica con miga vive en `main/terminal-handoff.js`.

---

### Task 1: Módulo `main/terminal-handoff.js`

**Files:**
- Create: `main/terminal-handoff.js`
- Test: `tests/terminal-handoff.test.js`

**Interfaces:**
- Produces: `buildHandoffCommand({cli, cwd, sessionId}) → string` (throws en input inválido); `buildAppleScript(shellCmd) → string`; `captureHandoffTarget(session) → {cli, cwd, sessionId} | {error}`; `openInTerminal({cli, cwd, sessionId, execFileImpl?}) → Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```js
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const {
  buildHandoffCommand,
  buildAppleScript,
  captureHandoffTarget,
  openInTerminal
} = require('../main/terminal-handoff')

test('buildHandoffCommand: claude con cd al cwd y resume', () => {
  const cmd = buildHandoffCommand({ cli: 'claude', cwd: '/Users/isabel/Desktop/LUISMI/proyecto', sessionId: 'abc-123' })
  assert.strictEqual(cmd, "cd '/Users/isabel/Desktop/LUISMI/proyecto' && claude --resume 'abc-123'")
})

test('buildHandoffCommand: codex usa "resume" sin --', () => {
  const cmd = buildHandoffCommand({ cli: 'codex', cwd: '/tmp/p', sessionId: 'xyz' })
  assert.strictEqual(cmd, "cd '/tmp/p' && codex resume 'xyz'")
})

test('buildHandoffCommand: escapa comillas simples del path', () => {
  const cmd = buildHandoffCommand({ cli: 'claude', cwd: "/tmp/o'brien", sessionId: 'id' })
  assert.ok(cmd.includes("'/tmp/o'\\''brien'"))
})

test('buildHandoffCommand: rechaza cli desconocido y campos vacíos', () => {
  assert.throws(() => buildHandoffCommand({ cli: 'bash', cwd: '/tmp', sessionId: 'x' }))
  assert.throws(() => buildHandoffCommand({ cli: 'claude', cwd: '', sessionId: 'x' }))
  assert.throws(() => buildHandoffCommand({ cli: 'claude', cwd: '/tmp', sessionId: '' }))
})

test('buildAppleScript: envuelve en tell Terminal y escapa backslash y comillas dobles', () => {
  const script = buildAppleScript('echo "a\\b"')
  assert.ok(script.startsWith('tell application "Terminal"'))
  assert.ok(script.includes('activate'))
  assert.ok(script.includes('do script "echo \\"a\\\\b\\""'))
  assert.ok(script.trimEnd().endsWith('end tell'))
})

test('captureHandoffTarget: claude con worktree usa realCwd y claudeSessionId', () => {
  const session = {
    activeCli: 'claude',
    claudeSessionId: 'sid-1',
    cwd: '/real/proyecto',
    gitWorkspace: { realCwd: '/real/proyecto', workCwd: '/worktrees/x' }
  }
  assert.deepStrictEqual(captureHandoffTarget(session), { cli: 'claude', cwd: '/real/proyecto', sessionId: 'sid-1' })
})

test('captureHandoffTarget: codex sin worktree usa session.cwd y codexSessionId', () => {
  const session = { activeCli: 'codex', codexSessionId: 'rollout-9', cwd: '/tmp/p', gitWorkspace: null }
  assert.deepStrictEqual(captureHandoffTarget(session), { cli: 'codex', cwd: '/tmp/p', sessionId: 'rollout-9' })
})

test('captureHandoffTarget: sin sesión o sin sessionId devuelve error', () => {
  assert.ok(captureHandoffTarget(null).error)
  assert.ok(captureHandoffTarget({ activeCli: 'claude', claudeSessionId: '', cwd: '/tmp' }).error)
  assert.ok(captureHandoffTarget({ activeCli: 'codex', codexSessionId: null, cwd: '/tmp' }).error)
})

test('openInTerminal: llama osascript -e con el script y resuelve', async () => {
  const calls = []
  const fakeExec = (bin, args, cb) => { calls.push({ bin, args }); cb(null) }
  await openInTerminal({ cli: 'claude', cwd: '/tmp/p', sessionId: 'sid', execFileImpl: fakeExec })
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(calls[0].bin, 'osascript')
  assert.strictEqual(calls[0].args[0], '-e')
  assert.ok(calls[0].args[1].includes("claude --resume 'sid'"))
})

test('openInTerminal: propaga el error de osascript', async () => {
  const fakeExec = (_b, _a, cb) => cb(new Error('boom'))
  await assert.rejects(
    () => openInTerminal({ cli: 'claude', cwd: '/tmp/p', sessionId: 'sid', execFileImpl: fakeExec }),
    /boom/
  )
})

test('openInTerminal: input inválido rechaza sin llamar a exec', async () => {
  let called = false
  const fakeExec = (_b, _a, cb) => { called = true; cb(null) }
  await assert.rejects(() => openInTerminal({ cli: 'nope', cwd: '/tmp', sessionId: 'x', execFileImpl: fakeExec }))
  assert.strictEqual(called, false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/terminal-handoff.test.js`
Expected: FAIL — `Cannot find module '../main/terminal-handoff'`

- [ ] **Step 3: Write the implementation**

```js
'use strict'

const { execFile } = require('child_process')

function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function buildHandoffCommand({ cli, cwd, sessionId } = {}) {
  const c = String(cli || '').trim()
  const dir = String(cwd || '').trim()
  const sid = String(sessionId || '').trim()
  if (!dir) throw new Error('cwd vacío')
  if (!sid) throw new Error('sessionId vacío')
  if (c === 'claude') return `cd ${shq(dir)} && claude --resume ${shq(sid)}`
  if (c === 'codex') return `cd ${shq(dir)} && codex resume ${shq(sid)}`
  throw new Error(`cli no soportado: ${c || '(vacío)'}`)
}

function buildAppleScript(shellCmd) {
  const esc = String(shellCmd).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `tell application "Terminal"\n  activate\n  do script "${esc}"\nend tell`
}

function captureHandoffTarget(session) {
  if (!session) return { error: 'Sin sesión activa' }
  const cli = session.activeCli === 'codex' ? 'codex' : 'claude'
  const rawId = cli === 'codex' ? session.codexSessionId : session.claudeSessionId
  const sessionId = String(rawId || '').trim()
  if (!sessionId) return { error: 'La sesión aún no tiene conversación que reanudar' }
  const cwd = String(session.gitWorkspace?.realCwd || session.cwd || '').trim()
  if (!cwd) return { error: 'La sesión no tiene directorio de trabajo' }
  return { cli, cwd, sessionId }
}

function openInTerminal({ cli, cwd, sessionId, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    let script
    try {
      script = buildAppleScript(buildHandoffCommand({ cli, cwd, sessionId }))
    } catch (err) {
      reject(err)
      return
    }
    execFileImpl('osascript', ['-e', script], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

module.exports = { buildHandoffCommand, buildAppleScript, captureHandoffTarget, openInTerminal }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/terminal-handoff.test.js`
Expected: PASS (11 tests)

---

### Task 2: Cableado en `main.js` y `preload.js`

**Files:**
- Modify: `main.js` (require junto al resto de `./main/*`; `finalizeWorkspaceForSession` ~línea 1623; nuevo `ipcMain.handle` junto a `get-current-session-meta` ~línea 4224)
- Modify: `preload.js` (dentro del objeto de `exposeInMainWorld('api', …)`)

**Interfaces:**
- Consumes: `captureHandoffTarget` y `openInTerminal` de Task 1; `getSessionByEvent`, `killPty`, `finalizeWorkspaceForSession` existentes.
- Produces: IPC `session:handoff-to-terminal` → `{ ok: true } | { ok: false, error: string }`; `window.api.handoffToTerminal()`.

- [ ] **Step 1: `finalizeWorkspaceForSession` devuelve su promesa**

En `main.js` (~1636), añadir `return p` al final de la función:

```js
  })().catch((err) => console.warn('[session-git] finalize:', err?.message)).finally(() => pendingFinalizes.delete(p))
  pendingFinalizes.add(p)
  return p
```

(Los tres llamadores actuales — líneas ~1613, ~1941, ~3615 — ignoran el retorno; nada cambia para ellos. La promesa nunca rechaza: ya lleva `.catch`.)

- [ ] **Step 2: require + handler IPC en `main.js`**

Junto a los demás requires de `./main/`:

```js
const terminalHandoff = require('./main/terminal-handoff')
```

Junto a `get-current-session-meta`:

```js
ipcMain.handle('session:handoff-to-terminal', async (event) => {
  const session = getSessionByEvent(event)
  const target = terminalHandoff.captureHandoffTarget(session)
  if (target.error) return { ok: false, error: target.error }
  killPty(session)
  if (session.win && !session.win.isDestroyed()) session.win.webContents.send('pty-exit')
  await finalizeWorkspaceForSession(session)
  try {
    await terminalHandoff.openInTerminal(target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `No se pudo abrir Terminal: ${err?.message || err}` }
  }
})
```

- [ ] **Step 3: método en `preload.js`**

Dentro del objeto `api`, junto a `getCurrentSessionMeta`:

```js
  handoffToTerminal: () => ipcRenderer.invoke('session:handoff-to-terminal'),
```

- [ ] **Step 4: Syntax check + suite completa**

Run: `node --check main.js && node --check preload.js && node --test tests/*.test.js`
Expected: sin errores de sintaxis; suite en verde (1075+ tests, 0 fail).

---

### Task 3: Botón en la topbar

**Files:**
- Modify: `index.html` (topbar, entre `#btn-subchat` y `#btn-voice`)
- Modify: `renderer.js` (junto a los handlers de botones de la topbar)

**Interfaces:**
- Consumes: `window.api.handoffToTerminal()` de Task 2; `showStatus(msg, kind, ms)` existente en renderer.

- [ ] **Step 1: botón en `index.html`**

```html
      <button id="btn-handoff-terminal" class="icon-btn" title="Llevar esta sesión a Terminal" aria-label="Abrir esta sesión en Terminal">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l4 3-4 3M12 15h6"/></svg>
      </button>
```

- [ ] **Step 2: handler en `renderer.js`**

Junto al resto de listeners de botones de la topbar (mismo estilo que los vecinos):

```js
const btnHandoffTerminal = document.getElementById('btn-handoff-terminal')
if (btnHandoffTerminal) {
  btnHandoffTerminal.addEventListener('click', async () => {
    if (btnHandoffTerminal.disabled) return
    btnHandoffTerminal.disabled = true
    try {
      const res = await window.api.handoffToTerminal()
      if (!res?.ok) showStatus(res?.error || 'No se pudo llevar la sesión a Terminal', 'error', 7000)
    } catch (err) {
      showStatus(String(err?.message || err), 'error', 7000)
    } finally {
      btnHandoffTerminal.disabled = false
    }
  })
}
```

Nota: sin `const` de nombre genérico que pueda chocar con otros `<script>` de la página (regla del bug 2026-08-05: los scripts sueltos comparten ámbito global — usar nombres únicos como aquí).

- [ ] **Step 3: Syntax check**

Run: `node --check renderer.js`
Expected: sin errores.

---

### Task 4: Verificación end-to-end en modo dev

- [ ] **Step 1: suite completa**

Run: `node --test tests/*.test.js`
Expected: 0 fail.

- [ ] **Step 2: lanzar modo dev** (protocolo del CLAUDE.md: matar instancias previas, limpiar SingletonLock huérfano si toca, `osascript /tmp/launch_poweragent.scpt`, verificar `--type=renderer` presente).

- [ ] **Step 3: prueba manual** (la hace Luismi o se pilota por CDP con el skill `verify`):
  1. Abrir sesión claude, escribir un turno (para que exista `claudeSessionId`).
  2. Pulsar el botón → la app vuelve al picker y Terminal.app abre con la conversación cargada (historial visible).
  3. Repetir con codex.
  4. Pulsar el botón en una sesión recién abierta sin turnos → error claro en el status, sin matar la sesión.

- [ ] **Step 4: con OK de Luismi** — un único commit (spec + plan + código + tests) y `npm run deploy`.
