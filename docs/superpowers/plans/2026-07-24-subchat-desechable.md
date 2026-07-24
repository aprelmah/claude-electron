# Sub-chat desechable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel lateral en la ventana local con un fork desechable (`--fork-session`) de la sesión claude activa, para preguntas laterales sin contaminar el hilo principal.

**Architecture:** Nuevo módulo `main/subchat-pty.js` (factory con deps inyectables, patrón `telegram-hidden-pty-pool`) que gestiona un PTY fork por ventana, con canales IPC namespaced `subchat:*`. En el renderer, un segundo xterm en un panel derecho dentro de un nuevo `#terminal-row`, con el código de fit/resize refactorizado a una fábrica por instancia.

**Tech Stack:** Electron 32, node-pty, xterm.js (vendored), node:test.

**Spec:** `docs/superpowers/specs/2026-07-24-subchat-desechable-design.md`

## Global Constraints

- Todo spawn de claude lleva SIEMPRE `--model <getClaudeModel()>` (regla bug 1M credits).
- El sub-chat NO pasa por `ensureSessionWorkspace` / `prepareSessionWorkspace`: hereda `session.gitWorkspace?.workCwd || session.cwd`. Documentar en CLAUDE.md (Task 4).
- Batching IPC solo vía `main/pty-data-batcher.js` (ya soporta `sendFn` custom — no duplicar lógica de batching).
- `package.json build.files` es whitelist: no se crean `.js`/`.html` nuevos en RAÍZ (el módulo va en `main/`, ya cubierto; verificar en Task 4).
- Textos de UI en español.
- Tests: `node --test tests/*.test.js` debe quedar en 0 fail. Node del sistema es 24 (vale para correr tests).
- Máximo 1 sub-chat por ventana. Solo `claude` (codex no tiene fork).

---

### Task 1: Módulo `main/subchat-pty.js` con tests

**Files:**
- Create: `main/subchat-pty.js`
- Test: `tests/subchat-pty.test.js`

**Interfaces:**
- Consumes: `createPtyDataBatcher` de `main/pty-data-batcher.js` (ya existe: `createPtyDataBatcher({ sendFn })` → `{ enqueue(sessionLike, data), flush(sessionLike) }`; el estado vive en `sessionLike._ptyBuf`).
- Produces: `createSubchatManager(deps)` → objeto con:
  - `canStart(session)` → `{ ok: boolean, reason?: string }`
  - `start(session, { cols, rows })` → `{ ok: true }` | `{ ok: false, error: string }`
  - `write(wcId, data)` → void
  - `resize(wcId, cols, rows)` → void
  - `close(wcId, reason?)` → boolean (true si había sub-chat vivo)
  - `has(wcId)` → boolean
  - `closeAll()` → void
  - Push al renderer por `session.win.webContents.send`: `'subchat:data'` (string batcheado) y `'subchat:exit'` (`{ code, reason }`).

- [ ] **Step 1: Escribir los tests (fallan)**

Crear `tests/subchat-pty.test.js`:

```js
'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { createSubchatManager } = require('../main/subchat-pty')

function makeFakePty() {
  const state = { written: [], resized: null, killed: false, onDataCb: null, onExitCb: null }
  const proc = {
    write: (d) => state.written.push(d),
    resize: (c, r) => { state.resized = { cols: c, rows: r } },
    kill: () => { state.killed = true },
    onData: (cb) => { state.onDataCb = cb },
    onExit: (cb) => { state.onExitCb = cb }
  }
  return { proc, state }
}

function makeSession({ cli = 'claude', sid = 'abc-123', workCwd = '/wt', wcId = 7 } = {}) {
  const sends = []
  return {
    sends,
    session: {
      wcId,
      activeCli: cli,
      claudeSessionId: sid,
      cwd: '/real',
      gitWorkspace: workCwd ? { workCwd, realCwd: '/real', branch: 'b', worktreePath: workCwd } : null,
      win: { isDestroyed: () => false, webContents: { send: (ch, p) => sends.push({ ch, p }) } }
    }
  }
}

function makeManager(overrides = {}) {
  const spawns = []
  const fake = makeFakePty()
  const mgr = createSubchatManager({
    ptySpawn: (file, argv, opts) => { spawns.push({ file, argv, opts }); return fake.proc },
    ensureCliAvailable: () => ({ ok: true, bin: '/usr/local/bin/claude', env: { PATH: '/x' }, name: 'Claude' }),
    buildFdLimitCommand: (bin, args) => `${bin} ${args.join(' ')}`,
    getClaudeModel: () => 'opus',
    ...overrides
  })
  return { mgr, spawns, fake }
}

describe('subchat-pty: validaciones canStart', () => {
  test('rechaza codex', () => {
    const { mgr } = makeManager()
    const { session } = makeSession({ cli: 'codex' })
    const r = mgr.canStart(session)
    assert.equal(r.ok, false)
    assert.match(r.reason, /claude/i)
  })

  test('rechaza sin claudeSessionId', () => {
    const { mgr } = makeManager()
    const { session } = makeSession({ sid: null })
    const r = mgr.canStart(session)
    assert.equal(r.ok, false)
    assert.match(r.reason, /contexto/i)
  })

  test('rechaza si ya hay sub-chat vivo en la ventana', () => {
    const { mgr } = makeManager()
    const { session } = makeSession()
    assert.equal(mgr.start(session, { cols: 80, rows: 24 }).ok, true)
    const r = mgr.canStart(session)
    assert.equal(r.ok, false)
    assert.match(r.reason, /abierto/i)
  })

  test('acepta claude con sessionId y sin sub-chat previo', () => {
    const { mgr } = makeManager()
    const { session } = makeSession()
    assert.deepEqual(mgr.canStart(session), { ok: true })
  })
})

describe('subchat-pty: spawn del fork', () => {
  test('args exactos: --model, --resume <sid>, --fork-session; cwd = workCwd', () => {
    const { mgr, spawns } = makeManager()
    const { session } = makeSession()
    const r = mgr.start(session, { cols: 100, rows: 30 })
    assert.equal(r.ok, true)
    assert.equal(spawns.length, 1)
    const { file, argv, opts } = spawns[0]
    assert.equal(file, '/bin/bash')
    assert.equal(argv[0], '-c')
    assert.equal(argv[1], '/usr/local/bin/claude --model opus --resume abc-123 --fork-session')
    assert.equal(opts.cwd, '/wt')
    assert.equal(opts.cols, 100)
    assert.equal(opts.rows, 30)
  })

  test('sin gitWorkspace usa session.cwd', () => {
    const { mgr, spawns } = makeManager()
    const { session } = makeSession({ workCwd: null })
    mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(spawns[0].opts.cwd, '/real')
  })

  test('CLI no disponible → { ok:false, error }, sin spawn', () => {
    const { mgr, spawns } = makeManager({
      ensureCliAvailable: () => ({ ok: false, error: 'claude no encontrado' })
    })
    const { session } = makeSession()
    const r = mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(r.ok, false)
    assert.match(r.error, /no encontrado/)
    assert.equal(spawns.length, 0)
  })

  test('ptySpawn lanza → { ok:false, error } y no queda registrado', () => {
    const { mgr } = makeManager({ ptySpawn: () => { throw new Error('boom') } })
    const { session } = makeSession()
    const r = mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(r.ok, false)
    assert.equal(mgr.has(7), false)
  })
})

describe('subchat-pty: write / resize / data / exit / close', () => {
  test('write y resize llegan al pty del sub-chat', () => {
    const { mgr, fake } = makeManager()
    const { session } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    mgr.write(7, 'hola')
    mgr.resize(7, 90, 40)
    assert.deepEqual(fake.state.written, ['hola'])
    assert.deepEqual(fake.state.resized, { cols: 90, rows: 40 })
  })

  test('onData del pty → subchat:data al webContents (flush por bytes)', () => {
    const { mgr, fake } = makeManager()
    const { session, sends } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    fake.state.onDataCb('x'.repeat(9000)) // > 8KB → flush inmediato del batcher
    const dataMsgs = sends.filter((m) => m.ch === 'subchat:data')
    assert.equal(dataMsgs.length, 1)
    assert.equal(dataMsgs[0].p, 'x'.repeat(9000))
  })

  test('exit del pty → subchat:exit y limpieza del registro', () => {
    const { mgr, fake } = makeManager()
    const { session, sends } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    fake.state.onExitCb({ exitCode: 0 })
    const exits = sends.filter((m) => m.ch === 'subchat:exit')
    assert.equal(exits.length, 1)
    assert.equal(exits[0].p.code, 0)
    assert.equal(mgr.has(7), false)
  })

  test('close mata el pty, limpia y devuelve true; segundo close devuelve false', () => {
    const { mgr, fake } = makeManager()
    const { session } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    assert.equal(mgr.close(7, 'test'), true)
    assert.equal(fake.state.killed, true)
    assert.equal(mgr.has(7), false)
    assert.equal(mgr.close(7), false)
  })

  test('data después de close no se envía', () => {
    const { mgr, fake } = makeManager()
    const { session, sends } = makeSession()
    mgr.start(session, { cols: 80, rows: 24 })
    mgr.close(7)
    const before = sends.length
    fake.state.onDataCb('tarde')
    assert.equal(sends.length, before)
  })

  test('closeAll cierra todos los sub-chats vivos', () => {
    const { mgr } = makeManager()
    const a = makeSession({ wcId: 1 })
    const b = makeSession({ wcId: 2 })
    mgr.start(a.session, { cols: 80, rows: 24 })
    mgr.start(b.session, { cols: 80, rows: 24 })
    mgr.closeAll()
    assert.equal(mgr.has(1), false)
    assert.equal(mgr.has(2), false)
  })
})

describe('subchat-pty: deps obligatorias', () => {
  test('lanza si falta ptySpawn o ensureCliAvailable', () => {
    assert.throws(() => createSubchatManager({}))
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `node --test tests/subchat-pty.test.js`
Expected: FAIL — `Cannot find module '../main/subchat-pty'`.

- [ ] **Step 3: Implementar `main/subchat-pty.js`**

```js
'use strict'

// Sub-chat desechable: fork (`--fork-session`) de la sesión claude de una
// ventana local, en un PTY propio, para preguntas laterales sin contaminar el
// hilo principal. Un sub-chat por ventana. Excluido del aislamiento git por
// sesión: hereda el workCwd de la madre (ver CLAUDE.md § spawns nuevos).

const { createPtyDataBatcher } = require('./pty-data-batcher')

function createSubchatManager({
  ptySpawn,
  ensureCliAvailable,
  buildFdLimitCommand,
  getClaudeModel,
  createBatcher,
  log
} = {}) {
  if (typeof ptySpawn !== 'function') throw new Error('subchat: ptySpawn requerido')
  if (typeof ensureCliAvailable !== 'function') throw new Error('subchat: ensureCliAvailable requerido')
  if (typeof buildFdLimitCommand !== 'function') throw new Error('subchat: buildFdLimitCommand requerido')
  if (typeof getClaudeModel !== 'function') throw new Error('subchat: getClaudeModel requerido')

  const trace = typeof log === 'function' ? log : () => {}
  const makeBatcher = typeof createBatcher === 'function' ? createBatcher : createPtyDataBatcher

  // wcId → { pty, alive, win, wcId, _ptyBuf }
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
    const entry = { pty: proc, alive: true, win: session.win, wcId: session.wcId, _ptyBuf: null }
    byWc.set(session.wcId, entry)
    trace(`subchat start wc=${session.wcId} sid=${session.claudeSessionId}`)
    proc.onData((data) => {
      if (!entry.alive) return
      batcher.enqueue(entry, data)
    })
    proc.onExit(({ exitCode } = {}) => {
      if (!byWc.has(session.wcId) || byWc.get(session.wcId) !== entry) return
      entry.alive = false
      byWc.delete(session.wcId)
      try { batcher.flush(entry) } catch {}
      sendToRenderer(entry, 'subchat:exit', { code: exitCode ?? null, reason: 'exit' })
      trace(`subchat exit wc=${session.wcId} code=${exitCode}`)
    })
    return { ok: true }
  }

  function write(wcId, data) {
    const entry = byWc.get(wcId)
    if (!entry || !entry.alive) return
    try { entry.pty.write(data) } catch {}
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
    entry.alive = false
    try { entry.pty.kill() } catch {}
    trace(`subchat close wc=${wcId} reason=${reason}`)
    return true
  }

  function has(wcId) {
    return byWc.has(wcId)
  }

  function closeAll() {
    for (const wcId of [...byWc.keys()]) close(wcId, 'close-all')
  }

  return { canStart, start, write, resize, close, has, closeAll }
}

module.exports = { createSubchatManager }
```

- [ ] **Step 4: Verificar que pasan**

Run: `node --test tests/subchat-pty.test.js`
Expected: PASS todos.

- [ ] **Step 5: Suite completa + commit**

Run: `node --test tests/*.test.js` → 0 fail.

```bash
git add main/subchat-pty.js tests/subchat-pty.test.js
git commit -m "feat(subchat): módulo de PTY fork desechable con deps inyectables"
```

---

### Task 2: Wiring en main.js + preload.js

**Files:**
- Modify: `main.js` (require + instancia + handlers IPC + cleanup en `killPty`)
- Modify: `preload.js` (namespace `window.api.subchat`)

**Interfaces:**
- Consumes (Task 1): `createSubchatManager({ ptySpawn, ensureCliAvailable, buildFdLimitCommand, getClaudeModel, log })` y sus métodos `canStart/start/write/resize/close/has/closeAll`.
- Produces (para Task 3): canales IPC:
  - invoke `subchat:can-start` → `{ ok, reason? }`
  - invoke `subchat:start` `{ cols, rows }` → `{ ok, error? }`
  - send `subchat:write` (string), `subchat:resize` `{ cols, rows }`
  - invoke `subchat:close` → boolean
  - push `subchat:data` (string), `subchat:exit` (`{ code, reason }`)
  - API renderer: `window.api.subchat.{canStart, start, write, resize, close, onData, onExit}` — `onData`/`onExit` devuelven función de desuscripción.

- [ ] **Step 1: Instanciar el manager en main.js**

Junto al resto de requires de `main/*` (cabecera de main.js), añadir:

```js
const { createSubchatManager } = require('./main/subchat-pty')
```

Después de la definición de `getClaudeModel()` (main.js ~línea 1263; necesita `pty`, `ensureCliAvailable`, `buildFdLimitCommand` y `getClaudeModel` ya definidos — todos son function declarations o requires de cabecera, así que cualquier punto del top-level tras `getClaudeModel` vale):

```js
const subchatManager = createSubchatManager({
  ptySpawn: (file, argv, opts) => pty.spawn(file, argv, opts),
  ensureCliAvailable,
  buildFdLimitCommand,
  getClaudeModel,
  log: (m) => console.log('[subchat]', m)
})
```

- [ ] **Step 2: Handlers IPC**

Añadir junto al bloque `// ── PTY IPC ──` (tras el handler `pty-cwd`, main.js ~línea 3155):

```js
// ── Sub-chat IPC (fork desechable de la sesión activa) ──
ipcMain.handle('subchat:can-start', (event) => {
  const s = getSessionByEvent(event)
  return subchatManager.canStart(s)
})

ipcMain.handle('subchat:start', (event, { cols, rows } = {}) => {
  const s = getSessionByEvent(event)
  if (!s) return { ok: false, error: 'Sesión no disponible' }
  return subchatManager.start(s, { cols, rows })
})

ipcMain.on('subchat:write', (event, data) => {
  const s = getSessionByEvent(event)
  if (s) subchatManager.write(s.wcId, data)
})

ipcMain.on('subchat:resize', (event, { cols, rows } = {}) => {
  const s = getSessionByEvent(event)
  if (s) subchatManager.resize(s.wcId, cols, rows)
})

ipcMain.handle('subchat:close', (event) => {
  const s = getSessionByEvent(event)
  return s ? subchatManager.close(s.wcId, 'renderer') : false
})
```

- [ ] **Step 3: Cleanup ligado al ciclo de vida de la madre**

En `killPty(session)` (main.js:1445), añadir al principio del cuerpo, tras el guard `if (!session || !session.pty) return`:

```js
  try { subchatManager.close(session.wcId, 'parent-pty-closed') } catch {}
```

Esto cubre: restart de la madre, hot-switch de CLI, cierre de ventana (`destroySession` → `killPty`) y transferencia a Telegram. El sub-chat nunca sobrevive a su PTY madre.

Nota de orden: `killPty` es function declaration y `subchatManager` es `const` top-level — `killPty` solo se ejecuta en runtime tras la inicialización, no hay TDZ.

- [ ] **Step 4: Exponer en preload.js**

Añadir dentro del objeto de `contextBridge.exposeInMainWorld('api', {...})`, tras el bloque `taskSession` (preload.js ~línea 135):

```js
  subchat: {
    canStart: () => ipcRenderer.invoke('subchat:can-start'),
    start: (cols, rows) => ipcRenderer.invoke('subchat:start', { cols, rows }),
    write: (data) => ipcRenderer.send('subchat:write', data),
    resize: (cols, rows) => ipcRenderer.send('subchat:resize', { cols, rows }),
    close: () => ipcRenderer.invoke('subchat:close'),
    onData: (cb) => {
      const h = (_e, d) => cb(d)
      ipcRenderer.on('subchat:data', h)
      return () => ipcRenderer.removeListener('subchat:data', h)
    },
    onExit: (cb) => {
      const h = (_e, p) => cb(p)
      ipcRenderer.on('subchat:exit', h)
      return () => ipcRenderer.removeListener('subchat:exit', h)
    }
  },
```

- [ ] **Step 5: Verificar sintaxis y suite**

Run: `node --check main.js && node --check preload.js && node --test tests/*.test.js`
Expected: sin errores, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add main.js preload.js
git commit -m "feat(subchat): wiring IPC subchat:* en main y preload"
```

---

### Task 3: Renderer — panel dividido, segundo xterm y fábrica de fit

**Files:**
- Modify: `index.html` (botón titlebar + `#terminal-row` + panel sub-chat)
- Modify: `styles.css` (layout split + divisor + cabecera del panel)
- Modify: `renderer.js` (fábrica `createTermFit`, instancia sub-chat, wiring)

**Interfaces:**
- Consumes (Task 2): `window.api.subchat.*`.
- Produces: función interna `closeSubchatPane()` y `openSubchatPane()`; sin API pública nueva.

- [ ] **Step 1: index.html — botón y estructura del panel**

1a. Botón en el titlebar, inmediatamente después del botón `#btn-layout-split` (index.html:233-235):

```html
      <button id="btn-subchat" class="icon-btn" title="Sub-chat (pregunta lateral sin tocar el hilo) — Cmd+Shift+S" aria-label="Abrir sub-chat lateral">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11a8 8 0 0 1-8 8H4l3-3a8 8 0 1 1 14-5z"/><path d="M8 21h8a5 5 0 0 0 5-5" opacity="0.5"/></svg>
      </button>
```

1b. Reestructurar `#terminal-wrap` (index.html:372-391): envolver `#terminal` y `#drop-overlay` en un nuevo `#terminal-row`, y añadir el panel. Queda así (el toolbar y el status-bar no se mueven):

```html
    <div id="terminal-wrap">
    <div id="terminal-toolbar">
      <!-- ... botones mic/imagen/archivo sin cambios ... -->
    </div>
    <div id="terminal-row">
      <div id="terminal"></div>
      <div id="subchat-divider" class="hidden"></div>
      <div id="subchat-pane" class="hidden">
        <div id="subchat-header">
          <span>Sub-chat (desechable)</span>
          <button id="btn-subchat-close" class="icon-btn small" title="Cerrar y descartar sub-chat" aria-label="Cerrar sub-chat">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        </div>
        <div id="subchat-terminal"></div>
      </div>
    </div>
    <div id="drop-overlay" class="hidden">
      <div class="drop-msg">Suelta para adjuntar</div>
    </div>
    <div id="status-bar" class="hidden" role="status" aria-live="polite">
      <span id="status-text"></span>
    </div>
  </div>
```

(`#drop-overlay` es `position:absolute` sobre `#terminal-wrap` — queda fuera de `#terminal-row` y no cambia.)

- [ ] **Step 2: styles.css — layout del split**

Añadir tras el bloque de `#terminal` (styles.css ~línea 961):

```css
#terminal-row {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  min-width: 0;
}

#subchat-divider {
  flex: 0 0 4px;
  cursor: col-resize;
  background: var(--border);
}

#subchat-pane {
  flex: 0 0 45%;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg);
}

#subchat-pane.hidden, #subchat-divider.hidden { display: none; }

#subchat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--fg-dim, #888);
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  flex-shrink: 0;
}

#subchat-terminal {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 8px 10px 4px 10px;
}
```

Nota: `#terminal` ya tiene `flex: 1; min-height: 0` (styles.css:954) y funciona igual dentro del row. Si `--fg-dim` no existe en el tema, usar `var(--fg)` con `opacity: .7`.

- [ ] **Step 3: renderer.js — fábrica `createTermFit`**

Sustituir el bloque global de fit (renderer.js:277-356) por una fábrica + instancia principal. Mantener los nombres `fitAndSync`, `fitAndSyncDebounced` y `scheduleTerminalRefit` como wrappers para no tocar los demás call sites:

```js
const DEFAULT_TERM_COLS = 120
const DEFAULT_TERM_ROWS = 35

// Fit/resize por instancia de terminal. observeEl: contenedor cuyo tamaño
// dispara refits. sendResize(cols, rows): sincroniza el PTY correspondiente.
function createTermFit({ term, fitAddon, observeEl, sendResize }) {
  const pendingTimers = []
  let debounceId = null
  let observer = null

  function clearPending() {
    while (pendingTimers.length) {
      const id = pendingTimers.pop()
      try { clearTimeout(id) } catch {}
    }
  }

  function getSafeSize({ forceFit = true } = {}) {
    if (forceFit) {
      try { fitAddon.fit() } catch {}
    }
    let cols = Number(term.cols || 0)
    let rows = Number(term.rows || 0)
    if (!Number.isFinite(cols) || cols < 40) cols = DEFAULT_TERM_COLS
    if (!Number.isFinite(rows) || rows < 10) rows = DEFAULT_TERM_ROWS
    cols = Math.max(40, Math.min(260, Math.floor(cols)))
    rows = Math.max(10, Math.min(120, Math.floor(rows)))
    return { cols, rows }
  }

  function fitAndSync(options = {}) {
    const { cols, rows } = getSafeSize(options)
    try { sendResize(cols, rows) } catch {}
    return { cols, rows }
  }

  function fitDebounced() {
    if (debounceId) clearTimeout(debounceId)
    debounceId = setTimeout(() => {
      fitAndSync({ forceFit: true })
      debounceId = null
    }, 140)
  }

  function scheduleRefit(options = {}) {
    clearPending()
    const delays = [0, 80, 180, 360, 720, 1200]
    for (const delay of delays) {
      const id = setTimeout(() => {
        fitAndSync({ forceFit: options.forceFit !== false })
      }, delay)
      pendingTimers.push(id)
    }
  }

  if (window.ResizeObserver && observeEl) {
    try {
      observer = new ResizeObserver(() => scheduleRefit({ forceFit: true }))
      observer.observe(observeEl)
    } catch {}
  }

  function dispose() {
    if (debounceId) { clearTimeout(debounceId); debounceId = null }
    clearPending()
    if (observer) {
      try { observer.disconnect() } catch {}
      observer = null
    }
  }

  return { fitAndSync, fitDebounced, scheduleRefit, dispose, getSafeSize }
}

const mainTermFit = createTermFit({
  term,
  fitAddon,
  observeEl: termEl, // antes se observaba termWrap; observar #terminal reacciona también al split
  sendResize: (cols, rows) => window.api.resizePty(cols, rows)
})

// Wrappers de compatibilidad: el resto del archivo llama a estos nombres.
function getSafeTerminalSize(options = {}) { return mainTermFit.getSafeSize(options) }
function fitAndSync(options = {}) { return mainTermFit.fitAndSync(options) }
function fitAndSyncDebounced() { mainTermFit.fitDebounced() }
function scheduleTerminalRefit(options = {}) { mainTermFit.scheduleRefit(options) }

window.addEventListener('resize', () => {
  mainTermFit.fitDebounced()
  if (subchatFit) subchatFit.fitDebounced()
})
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    mainTermFit.scheduleRefit({ forceFit: true })
    if (subchatFit) subchatFit.scheduleRefit({ forceFit: true })
  })
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  mainTermFit.scheduleRefit({ forceFit: true })
  if (subchatFit) subchatFit.scheduleRefit({ forceFit: true })
})
window.addEventListener('beforeunload', () => {
  mainTermFit.dispose()
  if (subchatFit) subchatFit.dispose()
})
```

Borrar del archivo: `pendingTermRefitTimers`, `resizeDebounceId`, `terminalResizeObserver`, `clearPendingTermRefitTimers` y las versiones globales antiguas de `getSafeTerminalSize`/`fitAndSync`/`fitAndSyncDebounced`/`scheduleTerminalRefit` (renderer.js:277-356). `subchatFit` se declara en el Step 4 — declararlo con `let subchatFit = null` ANTES de este bloque de listeners.

- [ ] **Step 4: renderer.js — panel sub-chat**

Añadir tras el bloque anterior:

```js
// ── Sub-chat desechable ──
let subchatTerm = null
let subchatFit = null
let subchatOffData = null
let subchatOffExit = null
const subchatPane = document.getElementById('subchat-pane')
const subchatDividerEl = document.getElementById('subchat-divider')
const subchatTermEl = document.getElementById('subchat-terminal')
const btnSubchat = document.getElementById('btn-subchat')
const btnSubchatClose = document.getElementById('btn-subchat-close')

async function openSubchatPane() {
  if (subchatTerm) return
  const can = await window.api.subchat.canStart()
  if (!can?.ok) {
    if (btnSubchat) btnSubchat.title = `Sub-chat: ${can?.reason || 'no disponible'}`
    return
  }
  subchatPane.classList.remove('hidden')
  subchatDividerEl.classList.remove('hidden')
  subchatTerm = new Terminal({
    fontFamily: 'Menlo, Monaco, "SF Mono", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowTransparency: false,
    scrollback: 5000,
    theme: term.options.theme
  })
  const subchatFitAddon = new FitAddon.FitAddon()
  subchatTerm.loadAddon(subchatFitAddon)
  subchatTerm.open(subchatTermEl)
  subchatFit = createTermFit({
    term: subchatTerm,
    fitAddon: subchatFitAddon,
    observeEl: subchatTermEl,
    sendResize: (cols, rows) => window.api.subchat.resize(cols, rows)
  })
  subchatTerm.onData((d) => window.api.subchat.write(d))
  subchatOffData = window.api.subchat.onData((d) => subchatTerm?.write(d))
  subchatOffExit = window.api.subchat.onExit(() => closeSubchatPane({ notifyMain: false }))
  const size = subchatFit.getSafeSize({ forceFit: true })
  const r = await window.api.subchat.start(size.cols, size.rows)
  if (!r?.ok) {
    subchatTerm.write(`\r\n\x1b[31m${r?.error || 'No se pudo abrir el sub-chat'}\x1b[0m\r\n`)
    setTimeout(() => closeSubchatPane({ notifyMain: false }), 2500)
    return
  }
  subchatFit.scheduleRefit({ forceFit: true })
  mainTermFit.scheduleRefit({ forceFit: true })
  subchatTerm.focus()
}

function closeSubchatPane({ notifyMain = true } = {}) {
  if (notifyMain) { try { window.api.subchat.close() } catch {} }
  if (subchatOffData) { try { subchatOffData() } catch {} subchatOffData = null }
  if (subchatOffExit) { try { subchatOffExit() } catch {} subchatOffExit = null }
  if (subchatFit) { try { subchatFit.dispose() } catch {} subchatFit = null }
  if (subchatTerm) { try { subchatTerm.dispose() } catch {} subchatTerm = null }
  subchatPane.classList.add('hidden')
  subchatDividerEl.classList.add('hidden')
  subchatPane.style.flexBasis = ''
  mainTermFit.scheduleRefit({ forceFit: true })
  term.focus()
}

if (btnSubchat) btnSubchat.addEventListener('click', () => { openSubchatPane() })
if (btnSubchatClose) btnSubchatClose.addEventListener('click', () => closeSubchatPane())

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyS') {
    e.preventDefault()
    if (subchatTerm) closeSubchatPane()
    else openSubchatPane()
  }
})

// Divisor arrastrable: ajusta flex-basis del panel en % del row.
;(function initSubchatDivider() {
  let dragging = false
  subchatDividerEl.addEventListener('mousedown', (e) => {
    dragging = true
    e.preventDefault()
  })
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return
    const row = document.getElementById('terminal-row')
    const rect = row.getBoundingClientRect()
    const pct = Math.max(20, Math.min(70, ((rect.right - e.clientX) / rect.width) * 100))
    subchatPane.style.flexBasis = `${pct}%`
  })
  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    if (subchatFit) subchatFit.scheduleRefit({ forceFit: true })
    mainTermFit.scheduleRefit({ forceFit: true })
  })
})()
```

Colocación: este bloque necesita `term`, `createTermFit` y `mainTermFit` ya definidos — va justo después del bloque del Step 3 (y la declaración `let subchatFit = null` debe preceder a los listeners de resize del Step 3; ordenar: declaraciones sub-chat → listeners globales, o mover los 4 listeners globales debajo de este bloque).

- [ ] **Step 5: Estado del botón en el ciclo de refresh**

En `refreshSessionStrip()` (renderer.js:1837), añadir al final del cuerpo:

```js
  try {
    const can = await window.api.subchat.canStart()
    if (btnSubchat) {
      btnSubchat.disabled = !can?.ok && !subchatTerm
      btnSubchat.title = can?.ok || subchatTerm
        ? 'Sub-chat (pregunta lateral sin tocar el hilo) — Cmd+Shift+S'
        : `Sub-chat: ${can?.reason || 'no disponible'}`
    }
  } catch {}
```

(Si `refreshSessionStrip` no es `async`, marcarla `async` — se llama sin esperar su resultado en todos los call sites, es seguro.)

- [ ] **Step 6: Sintaxis + suite**

Run: `node --check renderer.js && node --check main.js && node --check preload.js && node --test tests/*.test.js`
Expected: sin errores, 0 fail.

- [ ] **Step 7: Prueba manual en modo dev (protocolo del runbook)**

```bash
pkill -f "POWER-AGENT.app" 2>/dev/null; pkill -f "electron \." 2>/dev/null; sleep 1
osascript /tmp/launch_poweragent.scpt   # crearlo antes si no existe (ver CLAUDE.md)
ps aux | grep electron | grep -v grep | head -2   # debe ser el dev, no /Applications
```

Checklist manual (lo valida Luismi):
1. Abrir proyecto + sesión claude, escribir un par de turnos.
2. Botón sub-chat (o Cmd+Shift+S) → panel derecho con TUI de claude que conoce la conversación.
3. Preguntar algo en el sub-chat → responde con contexto heredado.
4. El hilo principal sigue operativo a la vez (escribir en él mientras el sub-chat existe).
5. ✕ → panel se cierra, principal recupera todo el ancho y su historia intacta.
6. Reabrir sub-chat → nuevo fork actualizado.
7. Con codex activo o sesión recién abierta sin turnos → botón deshabilitado con tooltip.
8. Restart de la sesión madre con sub-chat abierto → el panel se cierra solo.
9. Arrastrar el divisor → ambos terminales refitean.

- [ ] **Step 8: Commit**

```bash
git add index.html styles.css renderer.js
git commit -m "feat(subchat): panel lateral con fork desechable de la sesión activa"
```

---

### Task 4: Documentación + verificación final

**Files:**
- Modify: `CLAUDE.md` (regla de spawns del aislamiento git)
- Verify: `package.json` (`build.files`)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: runbook actualizado.

- [ ] **Step 1: Documentar la exclusión git del sub-chat**

En `CLAUDE.md`, sección "Git automático por sesión" → bullet "Qué NO está aislado", añadir:

```markdown
  El sub-chat desechable (`main/subchat-pty.js`) tampoco pasa por `ensureSessionWorkspace`: hereda el `workCwd` del worktree de su sesión madre (mismo aislamiento que ella, sin worktree propio). Es un hilo de consulta; si edita archivos, los cambios caen en la rama de la madre.
```

- [ ] **Step 2: Verificar whitelist de build**

Run: `node -e "const b=require('./package.json').build.files; console.log(JSON.stringify(b,null,2))"`
Expected: `main/**` (o patrón equivalente que cubra `main/subchat-pty.js`) ya presente; `index.html`, `renderer.js`, `preload.js`, `styles.css` ya presentes. Si `main/` NO estuviera cubierto, añadir `"main/**/*.js"` a la lista.

- [ ] **Step 3: Verificación completa**

Run: `node --check main.js && node --check renderer.js && node --check preload.js && node --check main/subchat-pty.js && node --test tests/*.test.js`
Expected: todo limpio, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md package.json
git commit -m "docs(subchat): exclusión git del sub-chat en runbook"
```
