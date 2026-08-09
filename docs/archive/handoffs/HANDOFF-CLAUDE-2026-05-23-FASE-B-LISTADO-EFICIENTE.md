# Handoff Claude — 2026-05-23 — Fase B: listado eficiente

> Sesión: Luismi + Claude Opus 4.7 (1M context) + 2 agentes general-purpose en paralelo. Worktrees aislados, mergeados a `main` con commits `e6caa1d` (agente A) + `4c506ed` (agente B) + `6600f97` (merge A) + `f6a570f` (merge B, resuelve conflictos) + `625a33d` (paginación) + `05f3dcc` (merge final). Pusheado a `origin/main`. Desplegado en `/Applications/POWER-AGENT.app`.

## TL;DR

Optimizadas las 5 cosas que olían mal del listado:
1. **Stream JSONL Claude** — antes `readFileSync` entero, ahora chunks 64 KB hasta primer turno user.
2. **Cache persistente Claude** — JSON en `userData` keyed por cwd+sessionId, invalidación por mtime+size.
3. **Índice persistente Codex** — JSON en `userData` keyed por cwd, watcher `fs.watch` incremental.
4. **Codex id sin abrir rollout** — gratis vía índice.
5. **Paginación 50+** — sidebar y picker con botón "Ver más".

Tests: **171 pass / 0 fail / 6 skipped** (baseline 138 → +33 nuevos).

LAN/WhatsApp/Telegram intactos.

## Arquitectura del cambio

### Nuevos módulos
- `main/claude-sessions-index.js` — CRUD JSON `userData/claude-sessions-index.json`. Estructura `{cwd: {sessionId: {preview, msgCount, mtime, size, updatedAt}}}`. Atomic writes. Métodos: `get`, `set`, `getForCwd`, `removeForCwd`, `removeSession`.
- `main/codex-sessions-index.js` — CRUD JSON `userData/codex-sessions-index.json`. Estructura `{version, lastFullScanAt, byCwd: {cwd: [entries]}}`. Watcher `fs.watch({recursive:true})` con debounce 500ms por path y fallback poll 60s. Métodos: `bootstrap`, `addOrUpdate`, `removeByPath`, `getForCwd`, `startWatcher`, `stopWatcher`, `isEmpty`.

### Modificados
- `main/claude-session-listing.js`:
  - `streamFirstUserPreview(filePath, extractTurnText, chunkSize=64KB, maxBytes=4MB)` — lee por chunks hasta primer user válido (skip "Caveat:"). Devuelve `''` si no encuentra.
  - `streamCountLines(filePath, chunkSize=64KB)` — cuenta `\n` por bytes sin acumular en RAM.
  - `listCodexSessionFiles(sessionsRoot?)` — ahora acepta root opcional para tests.
  - `createSessionListing({claudeIndex, codexIndex})` — ambos opcionales. `claudeIndex` puede ser objeto o getter (`() => idx`). `codexIndex` se lee con `opts.codexIndex` (puede ser getter del objeto). Late binding necesario porque main.js instancia los índices DESPUÉS de crear el listing.
  - `listClaudeSessionsForCwd` — primero consulta `claudeIndex.getForCwd(cwd)`. Si cached entry tiene `mtime+size` coincidente con stat actual, devuelve cached sin tocar el JSONL. Si no, stream + persiste. Sweep al final: huérfanas se limpian del cache.
  - `listCodexSessionsForCwd` — consulta `codexIndex.getForCwd(cwd)` directo O(1). Fallback al walk completo si el índice no está disponible (caso bootstrap en curso).

- `main.js`:
  - Singletons: `claudeSessionsIndex` y `codexSessionsIndex`.
  - Init en `app.whenReady` tras `recentCwds`/`lastContext`. Codex hace `bootstrap()` async si está vacío + `startWatcher()`.
  - `_sessionListing` recibe ambos con getters: `claudeIndex: () => claudeSessionsIndex` y `get codexIndex() { return codexSessionsIndex }`.
  - `app.on('before-quit')` añade `codexSessionsIndex?.stopWatcher()`.
  - `delete-session` IPC ahora llama `claudeSessionsIndex.removeSession(cwd, id)` para mantener cache coherente.

- `renderer.js` (`openSessions`):
  - Extraída render de cada row a closure `appendSessionRow(s)`.
  - `renderPage()` con `PAGE_SIZE=50`, renderiza siguiente bloque y añade `.session-load-more` button si quedan.

- `project-picker.js` (`refreshSessions`):
  - Mismo patrón: closure `appendRow(row)` + `renderNextPage()` + `.picker-load-more` li.

- `styles.css`: nuevos `.session-load-more` y `.picker-load-more` (botón dashed accent).

## Persistencia

```
~/Library/Application Support/CLAUDE-NOVAK/
├── recent-cwds.json                    # Fase A
├── last-context.json                   # Fase A
├── claude-sessions-index.json          # Fase B — Claude cache mtime+size
└── codex-sessions-index.json           # Fase B — Codex índice + lastFullScanAt
```

Migración: ninguna. Si los archivos no existen, se construyen al primer uso. Codex hace bootstrap async no bloqueante la primera vez (durante el bootstrap, listado cae al walk como fallback).

## Reglas validadas tras Fase B

- **El índice es la fuente de verdad para listar; el JSONL solo se relee si stat-key (mtime+size) cambió o si la entry no está en cache.** Aplica a Claude y Codex.
- **`createSessionListing` acepta índices opcionales** (`claudeIndex`, `codexIndex`) y siempre tiene fallback al patrón antiguo. No romper esto: muchos tests pasan instancias sin índice.
- **Late binding para módulos que main.js instancia después de top-level requires.** Los índices se crean en `app.whenReady`, pero `_sessionListing` se crea a nivel módulo. Solución: getters en opts (`() => idx` o `get propName()`).
- **`fs.watch` con `recursive:true` puede fallar en algunas plataformas/casos.** Hay fallback poll 60s en `codexSessionsIndex.startWatcher()`.
- **Debounce 500ms por path** en el watcher de Codex — evita procesar 20 eventos seguidos de un rollout que se escribe.
- **Sweep de huérfanas en listing Claude** — si el cache tiene IDs que ya no están en disco, se limpian al final del listing. Evita crecimiento infinito del JSON.
- **Paginación es frontend puro.** Backend sigue devolviendo `limit:1000` (handler `list-sessions`). El front recorta a 50 por página. Cambio futuro: si pasas las 1000, ampliar el limit.

## Decisiones no obvias

1. **`maxBytes:4MB` en `streamFirstUserPreview`**: si una sesión gigante no tiene un turno user válido en sus primeros 4 MB, devuelve preview vacío. Tradeoff: evitar leer 100 MB para sesiones raras. Caso real esperado: 0%.
2. **Fallback al walk en Codex** cuando el índice está vacío para un cwd: importante en primer arranque (bootstrap en curso) o si el watcher pierde eventos. Coste mínimo, no se hace por cwd ya indexado.
3. **No borrar entry si parseo del rollout Codex falla**: rollouts en escritura pueden tener línea incompleta. No purgar la entry previa, esperar al siguiente evento.
4. **Las invalidaciones de `delete-session` solo aplican a Claude** porque para Codex el watcher las detecta solo via `rename`/`change`. Si elimines un rollout codex, el watcher lo recoge.
5. **Paginación con closure en vez de extraer a top-level function**: el cuerpo del row usa muchas vars locales (cwd, sessionLinksCache, fmtRelative, etc). Mantenerlo dentro de `openSessions` evita pasar 5 argumentos.

## Tests nuevos (33)

- `tests/claude-session-listing.test.js` (11) — stream preview, count lines, listing con/sin cache, sweep huérfanas, EACCES gracefully.
- `tests/claude-sessions-index.test.js` (11) — get/set/remove, persistencia entre instancias, removeForCwd, JSON corrupto, atomic write, sweep cwd vacío.
- `tests/codex-sessions-index.test.js` (11) — bootstrap, addOrUpdate, removeByPath, getForCwd ordenado, persistencia, JSON corrupto, watcher debounce básico, fallback poll.

Comando: `npm test`. Esperable: `177 total / 171 pass / 0 fail / 6 skipped` (los 6 skipped son flakys conocidos pre-existentes).

## Comandos

```bash
# Tests
npm test

# Dev
unset ELECTRON_RUN_AS_NODE && npm start

# Build + deploy
npm run deploy

# Build full (ambas arch + dmg)
npm run dist

# Borrar cache si algo va raro
rm ~/Library/Application\ Support/CLAUDE-NOVAK/claude-sessions-index.json
rm ~/Library/Application\ Support/CLAUDE-NOVAK/codex-sessions-index.json
# La app reconstruye al siguiente arranque
```

## Rollback

```bash
# Volver al estado pre-Fase B (Fase A)
git reset --hard b679a50
npm run deploy
```

## Lo que NO se tocó

- `ws-server.js`, `lan-helpers.js`, `lan-audit.js`, `relay-transcript-helpers.js` — LAN intacto.
- WhatsApp, Telegram bridge.
- `claude-session-cache.js` (cache RAM legado para `buildCurrentSessionMeta` y `readClaudeSessionTitle`). Sigue funcionando como antes. El nuevo cache **persistente** convive con el RAM; el RAM gana para la sesión activa, el persistente cubre el listing del sidebar.
- `automation-pty.js`, scheduler, tareas.

## Pendientes / futuro

- **Migrar el cache RAM de `claude-session-cache.js` al persistente** — duplicidad innecesaria. Sub-tarea de cleanup, no urgente.
- **Subir `package.json` versión** — sigue en 1.3.0. Cuando Luismi quiera marcar hito → bump a 1.4.0.
- **Limpiar entries antiguas del cache Claude** si se queda enorme — sweep cwd vacío ya existe; falta sweep entries con `updatedAt` muy viejo. No urgente.

## Estado final

- ✅ Push `origin/main` (`05f3dcc`).
- ✅ Deploy `/Applications/POWER-AGENT.app` (asar incluye los 3 nuevos: `main/claude-sessions-index.js`, `main/codex-sessions-index.js`, `project-picker.js`).
- ✅ Tests 171/0.
- ✅ Validado manualmente por Luismi en empaquetado.
- ✅ Worktrees de agentes A y B pendientes de eliminar (rama mergeada, código en main).
