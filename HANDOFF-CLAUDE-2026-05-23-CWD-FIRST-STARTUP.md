# Handoff Claude — 2026-05-23 — Arranque cwd-first

> Sesión: Luismi + Claude Opus 4.7 (1M context). Worktree `worktree-flow-cwd-first-startup`, mergeado a `main` con commits `889c613` + `ef1c470` + `581cefd`. Pusheado a `origin/main`. App desplegada en `/Applications/POWER-AGENT.app`.

## TL;DR

POWER-AGENT **ya no arranca con una PTY default huérfana**. Al abrir, muestra un overlay fullscreen **"Elige proyecto"**: el usuario elige carpeta → elige CLI (claude|codex) → elige sesión (nueva o reutilizar). El PTY se spawnea **solo después** de esa decisión. Multi-PTY desde botón "+" del topbar (cada ventana = su propio picker = su propia PTY).

LAN/WhatsApp/Telegram intactos.

## Por qué este cambio

Estado anterior:
- `renderer.js:4249` → `await window.api.startPty(cols, rows, initialRoot)` en arranque.
- CLI por defecto `claude` (hardcoded `appConfig.cli.defaultCli`).
- cwd por defecto `profileCwd || os.homedir()`.

Problemas:
1. PTY huérfana arrancada con decisiones por defecto que el usuario no eligió.
2. Si quería codex en otro cwd → matar y reiniciar.
3. Confuso: "¿qué sesión es esta? ¿de dónde sale?".

Nuevo flujo (luismi-aprobado):
```
Abrir app → overlay "Elige proyecto"
         ↓ (click carpeta, recientes, drag&drop o ⌘O)
         vista "Elige sesión" (cwd elegido)
         ↓ (toggle Claude|Codex + lista sesiones reutilizables)
         click sesión existente | "Nueva sesión"
         ↓
         spawn PTY → overlay desaparece → terminal visible
```

## Auditoría previa (LAN safe)

Antes de tocar nada despaché agente Explore para auditar parte LAN:
- `ws-server.js` arranca **antes** que cualquier PTY (init en `app.whenReady`, no asume PTY viva).
- Locks LAN ya keyean por `cwd::sessionId`, son in-memory, agnósticos de PTY.
- Multi-PTY ya soportado: `wcId` se usa como clave en `sessionLocks` y heartbeats. Tests `ws-server-session-lock.test.js`, `ws-server-hot-switch.test.js` lo validan.
- Telegram `relayThroughPty` solo se usa con PTY activa — sin PTY al boot no rompe nada.
- `lanSessionMode=select` (hardcoded `lan-client.html:2572`): cliente LAN siempre llama `session:list` antes de `session:start`. No asume PTY default.

Conclusión: cambio compatible sin tocar ws-server, lan-helpers, whatsapp, telegram.

## Archivos tocados

### Nuevos
- `main/recent-cwds.js` — CRUD JSON `userData/recent-cwds.json` (cap 10, dedupe LIFO, prune missing). Atomic writes. **9 tests** unitarios.
- `main/last-context.js` — CRUD JSON `userData/last-context.json` keyed por `wcId`. Persiste `{cwd, cli, sessionId, updatedAt}`. Atomic writes. **10 tests** unitarios.
- `project-picker.js` — módulo renderer del overlay. IIFE expuesta como `window.ProjectPicker.start({onSpawn})`. Vista 1 (elegir carpeta + recientes + drag&drop + ⌘O). Vista 2 (toggle Claude|Codex + lista sesiones + Nueva sesión).
- `tests/recent-cwds.test.js`, `tests/last-context.test.js`.

### Modificados
- `main.js` — IPC handlers `recent-cwds:*`, `last-context:*`, `fs:is-dir`. Amplía `pty-start` con `{cli, sessionId}`. Fix `resume-session` para codex (antes solo claude). `list-sessions(cwd, cli)` ahora devuelve claude o codex según `cli`.
- `main/session-helpers.js` — añade `buildResumeArgs(cli, sessionId)` que devuelve `['--resume', uid]` para claude y `['resume', uid]` para codex.
- `preload.js` — expone `recentCwds`, `lastContext`, `isDir`. `startPty(cols, rows, cwd, opts)`. `listSessions(cwd, cli)`.
- `renderer.js` — elimina `await window.api.startPty(...)` automático en arranque. Cablea `ProjectPicker.start({onSpawn: spawnFromPicker})`. Vuelve al picker al `pty-exit`.
- `index.html` — añade `<script src="project-picker.js">` antes de renderer. Overlay `#project-picker-overlay` ahora a body-level (no dentro de `#terminal-wrap`).
- `styles.css` — bloque "Project picker" al final: card minimalista, toggle CLI estilo segmented, recientes con remove on hover, drop-target con borde violeta.
- `package.json` — añade `project-picker.js` a `build.files` (electron-builder whitelist).

## Persistencia (paths)

```
~/Library/Application Support/CLAUDE-NOVAK/
├── recent-cwds.json       # cap 10, ordenado LIFO, dedupe
└── last-context.json      # keyed por wcId, {cwd, cli, sessionId, updatedAt}
```

Migración: ninguna. Si los archivos no existen, todo arranca vacío (estado válido).

## Regla de oro tras este cambio

**El renderer JAMÁS spawnea PTY sin que el usuario haya confirmado cwd + CLI + sesión.** El flujo `ProjectPicker.start({onSpawn})` es el único punto de entrada. Cualquier nuevo feature que arranque PTY debe pasar por aquí o por el handler `resume-session`.

## Bugs encontrados y arreglados durante la sesión

1. **`resume-session` solo soportaba claude.** Pasaba `['--resume', sid]` siempre. Codex necesita `['resume', sid]`. → Fix: usa `buildResumeArgs(cli, sid)`. Commit `889c613`.

2. **`pruneMissing` purgaba recientes en app empaquetada.** En macOS firmado, `fs.statSync('/Users/isabel/Desktop/...')` da `EACCES`/`EPERM` hasta que el usuario concede Full Disk Access. Mi código lo trataba como "no existe" → vaciaba la lista. → Fix: si error code es EACCES/EPERM, asumir que la carpeta existe (lo confirmará el spawn). Commit `ef1c470`.

3. **`project-picker.js` no estaba en el asar.** `package.json` tiene `build.files` como **whitelist explícita**, no glob recursivo. Los archivos nuevos a nivel raíz del renderer hay que añadirlos a mano. → Fix: añadido. Commit `581cefd`. **REGLA CRÍTICA**: si añades un nuevo `.js`/`.html`/`.css` que vive en raíz y se carga desde un HTML, **DEBES** añadirlo a `package.json` `build.files`. `main/*.js` sí entra automáticamente porque son require()s de main.js.

4. **El handler global de drag&drop del renderer.js (L2571-2594) capturaba todos los drops** e inyectaba `@path` al PTY. → Fix: mis listeners en project-picker.js usan capture phase (`addEventListener(..., true)`) + `e.stopImmediatePropagation()` cuando el overlay está visible, así ganan la carrera al handler global.

## Decisión UX: arrancar siempre en vista "Elegir directorio"

Inicialmente probé "si hay `last-context.mostRecent()` válido, saltar directo a vista session-picker". Luismi pidió cambiarlo: siempre vista 1 al arrancar. **Más predecible**. El `last-context` queda solo para info interna (ordenar recientes + recordar último CLI usado por cwd).

## Multi-PTY

Botón `#btn-new-window` ya existía y llama a `window.api.newWindow()` → `createWindow()` en main. Cada ventana es `BrowserWindow` independiente con su propio `wcId` y `session`. El renderer.js es el mismo para todas → cada ventana arranca su propio `ProjectPicker.start(...)`. Locks LAN se separan por `cwd::sessionId` (ya estaba), así que dos ventanas en el mismo cwd con sesiones distintas no colisionan.

## Tests

Baseline 119 pass. Post-cambio: **138 pass / 0 fail / 6 skipped** (los 6 skipped son flakys conocidos de fs:watch).

```bash
npm test
```

Tests nuevos (19):
- `tests/recent-cwds.test.js`: 9 casos (lista vacía, push LIFO, dedupe, cap 10, remove, pruneMissing, strings vacíos, JSON corrupto, clear).
- `tests/last-context.test.js`: 10 casos (get null, set+get, sessionId null/inválido, cli inválido, multi-wcId, set fusiona, remove, mostRecent, JSON corrupto).

## Comandos importantes

```bash
# Dev (desde repo principal)
unset ELECTRON_RUN_AS_NODE && npm start

# Dev en sesión gráfica (cuando lo lanza Claude Code)
osascript /tmp/launch_poweragent_dev.scpt

# Tests
npm test

# Build + deploy a /Applications
npm run deploy

# Build completo (ambas arquitecturas + dmg)
npm run dist

# Solo zip
npm run build:zip
```

## Rollback

Si algo se rompe en producción:
```bash
git revert 581cefd ef1c470 0f97dd8
npm run deploy
```

(Revertir los 3 commits posteriores al merge feature; el merge `0f97dd8` se revierte con `-m 1`).

O reset duro al estado pre-Fase A:
```bash
git reset --hard 8146bf2
npm run deploy
```

## Pendientes (Fase B — no atacada todavía)

Las "5 cosas que huelen mal" del análisis inicial siguen pendientes:

1. **Listado Claude relee JSONL entero.** `claude-session-listing.js` hace `fs.readFileSync(file, 'utf-8')` por cada sesión → caro en sesiones grandes. Fase B: stream por chunks hasta primer turno user. Cache stat-key ya existe en `claude-session-cache.js`.
2. **Listado Codex barre `~/.codex/sessions/YYYY/MM/DD/` entero.** Sin índice por cwd. Fase B: crear `main/codex-sessions-index.js` con JSON en `userData/codex-sessions-index.json` keyed por cwd. Watcher con `fs.watch`. Bootstrap completo al primer arranque, incremental después.
3. **Paginación.** Hoy sirve 300 sesiones y corta. Si tienes 800, no ves las 500 más antiguas. Fase B: infinite scroll en sidebar (50 + "ver más").
4. **Cache persistente.** El cache actual es en memoria, muere al reiniciar. Fase B: el índice del punto 2 también para Claude (`claude-sessions-index.json` keyed por cwd).
5. **Codex id sin abrir rollout.** Hoy hay que leer 64KB de cada rollout para sacar el id. Fase B: vía índice.

Cuando Luismi pida Fase B, partir de aquí.

## Cosas que aprendí en esta sesión

- **electron-builder `files` es whitelist.** Globs implícitos no recogen scripts del renderer en raíz. Cada nuevo `.js` del renderer va a mano. Cualquier futuro `feature-x.js` que cargue `index.html` necesita su línea en `package.json`.
- **TCC permissions afectan `statSync`** en app firmada. Carpetas en Desktop/Documents/Downloads dan EACCES si la app no tiene Full Disk Access, aunque existan. No tratar EACCES como "no existe".
- **Listeners globales en `window` capturan por bubble**, y para ganar la carrera hay que usar capture phase + `stopImmediatePropagation`. Útil para overlays que tienen que interceptar interacciones por encima de un handler global preexistente.

## Versión

App version: `1.3.0` (no la subí, sigue siendo la del release 22-may). Si quieres marcar este hito subir a `1.3.1` o `1.4.0`. Decisión de Luismi.

## Estado final

- ✅ Push a `origin/main` (`581cefd`).
- ✅ Deploy a `/Applications/POWER-AGENT.app` (app.asar 14.4 MB, mtime 2026-05-23 09:33).
- ✅ Tests 138/0.
- ✅ Validado manualmente por Luismi en empaquetado.
- ⏳ `npm run dist` completo (build ambas arch + dmg) — corriendo en background al cerrar esta sesión, log en `/tmp/dist-2026-05-23.log`.
