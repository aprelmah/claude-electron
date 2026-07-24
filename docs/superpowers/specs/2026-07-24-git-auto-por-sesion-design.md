# Git automático por sesión — Diseño

Fecha: 2026-07-24. Aprobado por Luismi (worktrees siempre, commit+merge+push al cerrar, alcance local + LAN).

## Problema

Dos PTYs (dos ventanas de POWER-AGENT, o una ventana + un operador LAN) sobre el mismo cwd comparten los mismos ficheros físicos y se sobrescriben en silencio. Las ramas solas no aíslan: un checkout de una sesión cambiaría los ficheros de la otra.

## Decisión

Cada sesión con cwd dentro de un repo git trabaja en su propio **`git worktree`** con rama propia `poweragent/session-<id>`. Al terminar la sesión: commit automático, merge automático a la rama del directorio real, push si hay upstream, y limpieza. El usuario no ve git salvo cuando hay conflicto.

Consecuencias aceptadas explícitamente:
1. Mientras la sesión vive, la carpeta real no tiene sus cambios; probar en vivo se hace desde el terminal de la sesión (que corre en el worktree).
2. El worktree nace de HEAD: cambios sin commitear sueltos en la carpeta real no los ve la sesión nueva.
3. Excepción a la regla global "no push sin OK": este flujo SÍ pushea automáticamente tras merge limpio (decisión de Luismi 2026-05-26 reconfirmada 2026-07-24).

## Alcance

- **Sí**: ventana principal (`startPty`, main.js) y sesiones LAN (`createPtyForSession`, main/ws-server.js).
- **No (quedan como hoy)**: automation PTY (`startAgentPty`) y task-sessions / pool oculto de Telegram (`startTaskSessionPty`) — hacen `--resume` con cwd original; se integrarán cuando esto esté probado.
- cwd que no es repo git → flujo actual sin cambios.
- Escape hatch: campo de config `cli.gitSessionIsolation` (default `true`), editable desde Configuración, añadido a la allowlist `SAFE_CLI` de `save-app-config`.

## Arquitectura

### Módulo nuevo: `main/session-git.js`

Deps inyectables (execFile, fs, paths) para testear con repos git reales temporales. Todo git vía `execFile('git', ...)` **async con timeout** (default 15s por comando; nunca `execSync` — regla `looksRemotePath`/NAS sigue aplicando: si el cwd parece remoto, no aislar y devolver flujo normal).

API:

- `isGitRepo(cwd)` → boolean (`git -C cwd rev-parse --is-inside-work-tree`).
- `prepareSessionWorkspace({ realCwd, sessionKey })` → `{ workCwd, branch, worktreePath } | null`.
  - `null` (flujo normal) si: no repo, path remoto, config OFF, o cualquier error git (fail-open a comportamiento actual + log).
  - Crea rama `poweragent/session-<sessionKey>` desde HEAD y worktree en `userData/worktrees/<repoSlug>-<sessionKey>/`.
  - `sessionKey` = id corto único por spawn (no `chatId`, no cwd).
- `finalizeSessionWorkspace(workspace)` → `{ outcome: 'clean' | 'merged' | 'merged-pushed' | 'conflict' | 'dirty-target' | 'error', branch?, detail? }`.
  1. `git add -A && git commit` en el worktree (mensaje `poweragent: sesión <key> <fecha>`).
  2. Sin cambios → borrar worktree + rama → `clean`.
  3. Con cambios → merge en el directorio real (`git -C realCwd merge <branch>`) **solo si el dir real está limpio**; sucio → no merge, conservar rama, borrar worktree → `dirty-target` + aviso.
  4. Merge limpio → borrar rama + worktree; `git push` solo si la rama del dir real tiene upstream → `merged-pushed` (fallo de push = aviso, no fatal).
  5. Conflicto → `merge --abort`, conservar rama, borrar worktree → `conflict` + aviso.
- `copySessionHome(workspace)` / `copySessionToWorktree(...)`: ver "Sesiones de Claude".

Registro persistente `userData/session-git-map.json` (atomic writes): `{ claudeSessionId → { realCwd, branch, worktreePath, active } }`. Con `flush()` en `before-quit` como el resto de índices.

### Integración ventana principal (main.js)

- `startPty` (línea ~1265): antes de `pty.spawn`, `await prepareSessionWorkspace(...)`; si devuelve workspace → spawn con `cwd: workCwd`, guardar `session.gitWorkspace`. El poll de `claudeSessionId` (`snapshotClaudeSessions`) usa `workCwd`.
- Finalización en un único punto (`destroySession`), que ya recogen `proc.onExit`, `win.on('closed')` y `window-all-closed`. Finalize es async; notificación al usuario en `conflict`/`dirty-target`/`error` (Notification de Electron + toast si hay ventana).
- `before-quit`: esperar finalizes pendientes con tope 10s.

### Integración LAN (main/ws-server.js)

- El módulo se inyecta en `createWsServer`. El workspace se liga a la **sesión LAN** (no al PTY): las rotaciones/hot-switch de PTY dentro de la misma sesión reutilizan el mismo worktree. Finalize al cerrar la sesión LAN (disconnect definitivo / kill).

### Sesiones de Claude en worktree

Claude Code guarda transcripts por cwd (`~/.claude/projects/<cwd-codificado>/`). Con cwd = worktree, las sesiones nuevas caerían bajo el path del worktree. Solución "las sesiones vuelven a casa":

- **Al finalizar** una sesión worktree: copiar los `<sessionId>.jsonl` del dir codificado del worktree al dir codificado del `realCwd` (y marcar `active: false` en el registro). Así el historial queda siempre bajo el proyecto real y los resumes futuros funcionan.
- **Al resumir** una sesión existente dentro de un worktree nuevo: copiar su JSONL del dir del proyecto real al dir codificado del worktree antes del spawn.
- **Listado** (sidebar/picker): fusionar además las sesiones de worktrees ACTIVOS del proyecto (vía registro), dedupe por sessionId. Los índices persistentes existentes no cambian de formato.
- `resolveTaskSessionCwd`: si el cwd leído del JSONL es un worktree ya borrado, mapear al `realCwd` vía registro.

## Errores y bordes

- Cualquier fallo en `prepare` → fail-open al flujo actual (sin aislamiento) + log. Nunca bloquear el spawn.
- Repo con HEAD sin commits (repo recién `git init`) → fail-open (no hay base para worktree).
- Worktrees huérfanos (crash de la app): sweep al arrancar — `git worktree prune` + finalize de entradas `active: true` del registro cuyo PTY ya no existe.
- Paths remotos (NAS/SMB): `looksRemotePath` → fail-open.
- Submódulos / `.git` file: `rev-parse` los resuelve; sin trato especial en v1.

## Tests

- Unit `main/session-git.js` con repos git temporales reales: prepare (repo/no-repo/HEAD vacío/config OFF), finalize en los 4 caminos (clean / merged / conflict / dirty-target), push con y sin upstream (remote = repo bare temporal), sweep de huérfanos.
- Registro: escritura atómica, flush, mapeo resolveTaskSessionCwd.
- Copias de sesión: home ↔ worktree, dedupe en listado.
- Integración: `startPty` con repo git usa workCwd; con dir normal no cambia nada (regresión).

## Desviaciones en implementación

- **Finalize LAN en 3 teardown paths, no 1.** El diseño hablaba de "finalize al cerrar la sesión LAN" en singular; en la práctica `finalizeSessionGitWorkspace(session)` se llama desde `closeSession()`, `ws.on('close')` y `ws.on('error')` en `main/ws-server.js`. `closeSession()` sola no cubría la desconexión normal del cliente (que dispara `ws.on('close')` directamente sin pasar por `closeSession`). La función es idempotente (anula `session.gitWorkspace` al entrar), así que llamarla desde los tres sitios no duplica el finalize.
- **`before-quit` (Cmd+Q en macOS) recibió finalize + espera acotada, no estaba explícito en el diseño original.** macOS no dispara `window-all-closed` en Cmd+Q, así que sin este añadido las sesiones con workspace activo se perdían sin commit/merge. Se añadió: `finalizeWorkspaceForSession(s)` para cada sesión viva, y si quedan finalizes pendientes, `event.preventDefault()` + espera con `Promise.race` tope 10s antes de `app.quit()` real (guardado con bandera `quitFinalizeHandled` para no reentrar en el segundo disparo).
- **Sin `recordActive` en LAN.** El registro `sessionGitMap.recordActive(...)` solo se invoca desde `main.js` (sesión local), donde hay detección de `claudeSessionId` vía poll (`snapshotClaudeSessions`). En `main/ws-server.js` no existe ese mecanismo de detección de sessionId de Claude, así que las sesiones LAN con workspace no quedan registradas como `active` en `session-git-map.json` — el finalize LAN funciona igual (usa `session.gitWorkspace` directamente), pero el sweep de huérfanos al arrancar no las cubre si la app crashea a mitad de una sesión LAN. Aceptado como limitación conocida; revisar si en el futuro se quiere sweep también para LAN.
- **`resolveTaskSessionCwd` cubierto solo indirectamente en tests.** No hay test unitario directo de `resolveTaskSessionCwd` (main.js:2025) mapeando un worktree borrado a `realCwd`; la cobertura viene de `tests/session-git-listing.test.js`, que ejercita el listado fusionado y el dedupe por sessionId, y de ahí valida el mapeo de forma indirecta. Si se toca esa función, añadir un test unitario dedicado.
