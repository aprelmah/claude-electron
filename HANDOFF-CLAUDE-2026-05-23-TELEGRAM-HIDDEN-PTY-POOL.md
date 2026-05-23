# HANDOFF — Telegram Hidden PTY Pool (C+)

**Fecha:** 2026-05-23 (noche)
**Rama:** main (sin commit, uncommitted para review de Luismi)
**Base:** `7c033de` (WIP cabos 1-3 headless)

## Motivación

Hasta ahora, cuando una tarea programada terminaba y el sink Telegram enviaba el mensaje:
- El bridge guardaba `lastRunByChat` con el sessionId.
- Si el usuario respondía en Telegram, `onRunQuery` arrancaba `runClaudeHeadless --resume <sessionId>`, **un proceso headless nuevo por cada turno** (caro en contexto y arranque).
- Solo había relay PTY directo si el usuario hacía `/abrir` o pulsaba el botón 📱 para enlazar.

**Objetivo C+:** que cualquier mensaje del Mac a un chat de Telegram (tarea, mensaje manual, lo que sea) deje automáticamente una PTY oculta viva enlazada al chat, de modo que la **siguiente** respuesta del usuario en Telegram vaya directa a esa PTY vía relay (sin headless).

## Arquitectura

```
┌──────────────────┐    onEnsureHiddenPty       ┌────────────────────────────┐
│ scheduler/sinks  │ ─────────────────────────► │ telegram-hidden-pty-pool   │
│  (telegram sink) │                            │  - ensureHiddenPtyForChat  │
└──────────────────┘                            │  - getHiddenPtyForChat     │
                                                │  - showHiddenPty           │
                                                │  - closeHiddenPty          │
                                                │  - sweep(TTL) / LRU        │
                                                └──────────┬─────────────────┘
                                                           │
                            openWindow(hidden:true)        │ bindRelay(chatId, wcId)
                            startPty(state)                ▼
                                            ┌──────────────────────────────┐
                                            │ taskSessionStateByWc (Map)   │
                                            │   { wcId, win, pty, cwd,     │
                                            │     activeCli, claudeSessionId│
                                            │     relayActive, hidden }    │
                                            └──────────────┬───────────────┘
                                                           │
                                       ┌───────────────────┴────────────────────┐
                                       │ telegramRelayByChat (chatId → wcId)    │
                                       └───────────────────┬────────────────────┘
                                                           │
                                 getRelayBindingForChat()  │  ← resuelve session
                                                           ▼
                              telegram-relay-bindings.js: ahora mira sessions
                              Y taskSessionStateByWc vía getTaskSessionByWcId
                                                           │
                                                           ▼
                              relayThroughPty(session, prompt)   ← directo, sin
                                                                   headless
```

## Decisiones de diseño

1. **Una sola lista de PTYs ocultos en `taskSessionStateByWc`**, no un Map paralelo. El pool solo añade un *flag* `hidden:true` al estado y delega en `openTaskSessionWindow` el ciclo de vida. Ventaja: cuando el usuario hace `/abrir`, simplemente cambiamos `hidden:false` y mostramos la ventana ya viva (no respawn).

2. **`taskSessionStateByWc` ahora se comporta como un session real** para `relayThroughPty`:
   - Añadidos `activeCli`, `claudeSessionId`, `codexSessionId`, `relayActive` al state al crear la ventana.
   - El bridings adapter (`telegram-relay-bindings.js`) recibe `getTaskSessionByWcId` y lo prueba si `sessions.get(wcId)` no encuentra nada.

3. **Pool solo spawnea para Claude.** Codex por Telegram sigue por headless porque su relay PTY no delimita bien el fin de turno (regla heredada del onRunQuery actual). El filtro está en `main.js` dentro del callback `onEnsureHiddenPty` del sink.

4. **Capacidad y TTL:**
   - Max 3 PTYs ocultos simultáneos (LRU al exceder).
   - TTL idle 15 min (sweep cada 60s).
   - Cleanup en `before-quit`.

5. **Resiliencia:**
   - Si `openTaskSessionWindow` falla → `{ok:false, error}` sin tirar la app.
   - Si `startTaskSessionPty` falla → cierra la ventana, devuelve error.
   - Si `onEnsureHiddenPty` lanza, el sink registra el error pero **NO** rompe el envío del mensaje a Telegram (probado en tests).

6. **`/abrir` reusa pool si coincide.** Si para el chatId existe entry con mismo sessionId+cli, simplemente `showHiddenPty(chatId)` y marca `hidden:false`. Si no, comportamiento previo (spawn nuevo, bind).

7. **Deps inyectables en el pool.** El módulo no toca Electron directamente. Recibe `openWindow`, `startPty`, `getTaskState`, `closeWindow`, `bindRelay`, `unbindRelay`, `getNow`, `setIntervalFn`, `clearIntervalFn`. Esto permite tests sin Electron real.

8. **Mensaje hint del sink cambiado** de "Responde /abrir para continuar esta sesión en el Mac." a "Responde directamente en este chat para continuar la sesión, o /abrir para verla en el Mac." (la primera respuesta ya va al relay PTY del pool, sin headless).

## Archivos creados

- `main/telegram-hidden-pty-pool.js` — pool puro, sin imports de Electron. Constantes `DEFAULT_TTL_MS=15min`, `DEFAULT_MAX_SIZE=3`, `DEFAULT_SWEEP_MS=60s`.
- `tests/telegram-hidden-pty-pool.test.js` — 14 tests (TTL, LRU, idempotencia, recreate, close, stats, destroy, validaciones, fallos de spawn).
- `tests/telegram-bridge-open-from-pool.test.js` — 8 tests (`/abrir` con `fromPool:true`, contrato `createSinks({ onEnsureHiddenPty })`, compat hacia atrás).
- `HANDOFF-CLAUDE-2026-05-23-TELEGRAM-HIDDEN-PTY-POOL.md` (este archivo).

## Archivos modificados

- `main.js`:
  - import `createTelegramHiddenPtyPool`.
  - `let telegramHiddenPtyPool = null` arriba.
  - `openTaskSessionWindow({...,hidden=false})`: nuevo parámetro. Si `hidden:true`, omite `win.show()` en `ready-to-show`. State arranca con `activeCli/claudeSessionId/codexSessionId/relayActive/hidden`. `closed` ahora hace `unbindRelaySessionsByWcId(wcId)` + `telegramHiddenPtyPool?.notifyWindowClosed(wcId)`.
  - `_relayBindings`: pasa `getTaskSessionByWcId: (wcId) => taskSessionStateByWc.get(wcId) || null`.
  - `app.whenReady`: tras `buildAppMenu`, inicializa `telegramHiddenPtyPool` con todas las deps wireadas a Electron real.
  - `onOpenTaskSession`: ahora recibe `chatId`. Si hay entry en pool coincidente, `showHiddenPty`. Si no, spawn normal + `telegramRelayByChat.set(key, wcId)`.
  - `createSinks(...)`: ahora le pasa `onEnsureHiddenPty` que filtra `cli !== 'claude'` y delega al pool.
  - `before-quit`: `telegramHiddenPtyPool?.destroy('app-quit')`.

- `main/telegram-relay-bindings.js`:
  - Constructor acepta `getTaskSessionByWcId`.
  - Helper `resolveSessionByWcId(wcId)` mira `sessions` primero, luego task-sessions.
  - `getRelayBindingForChat` usa el resolver compuesto.

- `scheduler/sinks.js`:
  - `createSinks({...,onEnsureHiddenPty})` nuevo parámetro opcional.
  - En el sink `telegram`, tras `rememberRunForChat`, si `run.status==='ok' && sessionId && typeof onEnsureHiddenPty === 'function'`, llama al callback en try/catch (errores logueados, no rompen el envío).
  - Hint del mensaje cambiado (ver sección decisiones).

- `CLAUDE.md`: nueva línea en "Latest Handoff" para este cambio.

## API del pool

```js
const pool = createTelegramHiddenPtyPool({
  openWindow, startPty, getTaskState, closeWindow,
  bindRelay, unbindRelay,
  getNow?, setIntervalFn?, clearIntervalFn?, log?,
  ttlMs?, maxSize?, sweepMs?
})

await pool.ensureHiddenPtyForChat({ chatId, sessionId, cli, cwd, taskName })
// → { ok, wcId, reused?, error? }
// - Si existe entry coincidente: toca ts y devuelve { ok, wcId, reused:true }
// - Si existe con sessionId distinto: cierra el viejo y spawna nuevo
// - Si no existe: spawna ventana oculta + PTY + binding al chat

pool.getHiddenPtyForChat(chatId)  // { wcId, sessionId, cli, ts, ttlMs } | null
pool.showHiddenPty(chatId)        // muestra ventana oculta, marca touch
pool.closeHiddenPty(chatId, reason?)
pool.touchHiddenPty(chatId)
pool.notifyWindowClosed(wcId)     // llamado desde win.on('closed')
pool.getStats()                   // { count, byChat[], oldestIdleMs, ttlMs, maxSize }
pool.sweep()                      // fuerza sweep manual
pool.destroy(reason?)             // app-quit cleanup
```

## Reglas técnicas nuevas — IMPORTANTE

- **2026-05-23 (noche):** `taskSessionStateByWc` ahora cumple el "duck type" de session de relay. Si añades campos nuevos a session (en `sessions`), valora si task-state también los necesita.
- **2026-05-23 (noche):** `openTaskSessionWindow({hidden:true})` NO muestra la ventana. Para revelarla, cambia `state.hidden=false` y llama `win.show()` (o `pool.showHiddenPty(chatId)`).
- **2026-05-23 (noche):** El pool solo entra para `cli==='claude'`. Si Codex Telegram cambia algún día a relay PTY directo, quitar el filtro en `onEnsureHiddenPty` y revisar `onRunQuery` (línea ~2100).
- **2026-05-23 (noche):** `telegramRelayByChat.set(...)` lo escribe tanto el botón 📱 (vía `bindRelaySessionToTelegramChat`) como el pool (vía `bindRelay`). Ambos comparten el mismo Map, así que `getRelayBindingForChat` ve cualquiera de los dos.
- **2026-05-23 (noche):** El pool NO toca Electron. Cualquier dep injection se hace en `main.js`. Los tests usan mocks puros, no spawn-ean PTYs reales.

## Tests

- `tests/telegram-hidden-pty-pool.test.js` — 14 tests
- `tests/telegram-bridge-open-from-pool.test.js` — 8 tests
- `tests/telegram-bridge-remember-run.test.js` — 10 tests (sin cambios, siguen pasando)

`npm test` → **213 pass / 0 fail / 6 skip** (antes 185 / 0 / 6).

## Cómo probarlo manualmente en la app dev

1. Asegúrate de tener Telegram bridge corriendo con `defaultChatId` configurado (o al menos un `allowedUser`).
2. Crea una tarea programada Claude con sink Telegram activo, output corto. Ejecuta `Run now`.
3. Espera mensaje en Telegram. En el Mac, abre la dev console y comprueba:
   ```
   POWERAGENT_TG_POOL_DEBUG=1 npm start
   ```
   Deberías ver `[tg-pool] spawn { chatId, wcId, sessionId, cli:'claude' }` en consola.
4. En Telegram, responde un mensaje normal (no `/comando`). Debería:
   - **NO** arrancar un proceso headless nuevo (verifica con `ps aux | grep claude`).
   - La respuesta llegar fluida desde la PTY ya viva.
   - El mensaje en Telegram NO debería ya mencionar "/abrir" como obligatorio (texto suavizado).
5. Manda `/abrir` para mostrar la ventana en el Mac: la ventana viva del pool se revela (no spawn nuevo, mismo PTY).
6. Espera 15 min sin actividad → la ventana oculta debería cerrarse sola.
7. Crea 4 tareas simultáneas a 4 chats distintos: solo deberían sobrevivir 3 (LRU).

## Casos edge no cubiertos (TODOs)

- **Múltiples chats al mismo sessionId**: si dos chats reciben mensajes de la misma tarea/sessionId, cada uno spawnea su propia ventana (porque la clave del pool es `chatId`, no `sessionId`). En `openTaskSessionWindow` el deduplicador `taskSessionWindowsBySessionId` devuelve la misma ventana, así que el segundo `ensureHiddenPtyForChat` reutilizaría la ventana del primero y bindearía 2 chats a 1 wcId. Resultado: la primera respuesta gana. Aceptable por ahora pero documentado.
- **Detección de `claudeSessionId` rotando**: `startTaskSessionPty` ya tiene poll de 2s que actualiza `state.sessionId` y `taskSessionWindowsBySessionId`, PERO el pool guarda `sessionId` en su entry como snapshot. Si el sessionId rota, el pool no se entera y `ensureHiddenPtyForChat` con el nuevo sessionId cerraría la ventana. Mitigación: la próxima sesión Mac→Telegram lo recreará. Mejor solución futura: hook desde `startTaskSessionPty` que avise al pool del rotate.
- **Crash de la PTY oculta sin que `win.on('closed')` dispare**: la PTY puede morir sin cerrar la ventana. El `onExit` del PTY ya nullifica `state.pty`. El pool no detectaría esto hasta que `ensureHiddenPtyForChat` se llame de nuevo (o sweep, pero sweep solo mira TTL, no salud). Si Luismi quiere paranoia extra, añadir health-check `state.pty?._alive` en el sweep.
- **Race con `before-quit`**: si una tarea termina justo cuando app quit, el sink puede llamar al pool ya destruido y obtener `{ok:false, error:'pool-destroyed'}`. El sink loguea y sigue. No crash.

## Cómo revertir si algo se rompe en prod

1. `git restore main.js main/telegram-relay-bindings.js scheduler/sinks.js CLAUDE.md`
2. `rm main/telegram-hidden-pty-pool.js tests/telegram-hidden-pty-pool.test.js tests/telegram-bridge-open-from-pool.test.js HANDOFF-CLAUDE-2026-05-23-TELEGRAM-HIDDEN-PTY-POOL.md`
3. `npm test` → debería volver a 185 tests.

El comportamiento previo (headless `--resume` por turno) sigue siendo el fallback dentro de `onRunQuery` cuando no hay binding, así que aunque el pool nunca funcione, las tareas Telegram siguen respondiendo (más lento, sin enlace).
