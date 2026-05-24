---
name: tech-telegram-pty-pool
description: POWER-AGENT C+ pool de PTYs ocultos para enlazar Mac→Telegram chat→sesión sin headless. TTL, LRU, liveness JSONL, regla no-fallback.
metadata:
  type: project
---

# C+ — Pool de PTYs ocultos para Telegram

## Qué es

Cuando una tarea programada termina con `sessionId` (claude) y tiene sink Telegram, el sink llama a `ensureHiddenPtyForChat(chatId, runInfo)` del pool. El pool spawnea una ventana task-session con `show:false` + arranca PTY con `claude --resume <sid>` + registra `telegramRelayByChat[chatId]=wcId`. Cuando el usuario responde en Telegram, `onRunQuery` detecta `binding.bound=true` y enruta vía `relayThroughPty` directo. NO headless. NO `--resume` por turno.

## Archivos clave

- `main/telegram-hidden-pty-pool.js` — pool puro, deps inyectables, sin Electron.
- `main.js openTaskSessionWindow` — acepta `hidden:true`. Task state ahora tiene `activeCli`, `claudeSessionId`, `relayActive`, `relayListener`, `relayCancel` (drop-in para `relayThroughPty`).
- `main.js startTaskSessionPty.onData` — invoca `st.relayListener(text)` antes del espejo a ventana.
- `main/telegram-relay-bindings.js getRelayBindingForChat` — mira ahora también `taskSessionStateByWc` vía `getTaskSessionByWcId`.
- `scheduler/sinks.js createSinks({onEnsureHiddenPty})` — el sink lo invoca tras run OK con sessionId.

## Configuración por defecto

- **TTL idle**: 15 min sin tráfico → close.
- **LRU max**: 3 PTYs ocultos globales simultáneos.
- **Sweep**: setInterval 60s revisa idle.
- **Cleanup**: `before-quit` cierra todo (`main.js:2716`).

## Solo Claude

El pool solo se activa para `cli=claude`. Codex sigue por headless (regla heredada: el relay PTY Codex no delimita bien fin de turno, provoca latencia/doble respuesta).

## Cuelgue bajo carga — qué hizo el fix de liveness

`main.js relayThroughPty`:
- `WAIT_FIRST_OUTPUT_MS`: **25s → 90s**.
- `MAX_WAIT_MS`: **120s → 180s**.
- **Liveness check del JSONL cada 2s**: si algún `.jsonl` del proyecto crece en bytes, resetea `firstOutputTimer`. Cuando hay primer chunk al PTY, liveness se desactiva.

Esto cubre el caso "claude razonando (extended thinking) o MCP lento". El modelo escribe al transcript JSONL antes de redibujar el TUI → el PTY está mudo aunque el modelo trabaje. Sin liveness, `RelayNoOutput` disparaba erróneamente.

## Desfase de turnos — qué hizo el fix de transcript

`main/relay-transcript-helpers.js extractAssistantTextFromTranscript`:
- Filtro por `minTimestampMs = startedAt - tolerancia 500ms` (clock drift).
- Eliminado "rescate desde offset 0" (causaba que respuesta del turno N saliera como turno N+1).
- `main.js relayThroughPty` pre-drain 250ms con listener noop antes del write (saca residuo del PTY del turno previo).
- Refresh `beforeMeta` y `startedAt` JUSTO antes del prompt.

## Race `_flush`/`finalize` — qué hizo el fix de TelegramStream

`telegram-bridge.js TelegramStream`:
- Trackea `editingPromise` + `flushTimer`.
- `finalize()` cancela pending flush con `_cancelPendingFlush()` y awaita `editingPromise` antes de decidir si manda o edita.
- Sin esto, race condition entre `_flush` (con `messageId=null`) y `finalize` provocaba doble `_sendMessage` y duplicado en Telegram.

## REGLA INNEGOCIABLE — NO fallback a headless

Cuando `binding.bound === true` y `relayThroughPty` falla, lanzar error claro al usuario incluyendo `err.name`. **PROHIBIDO** `runClaudeHeadless` como red de seguridad. Si el PTY se cuelga, arreglar la causa real (timeouts, liveness, cleanup `relayActive`). Excepción única: cuando NO hay binding Y hay `opts.sessionId` heredado — ese camino es legítimo headless `--resume`.

Esta regla viene del handoff 2026-05-17 y se reforzó el 2026-05-23 tras un fallback erróneo introducido por un agente. **Cualquier agente que toque `onRunQuery` o sinks de Telegram DEBE recibir esta regla en su prompt** — la memoria no basta, los agentes parten sin contexto.

## Pendiente (no resuelto en sesión 2026-05-23)

- **Bug UX modelo no avanza con "Hazlo"/"Si"**: cuando el bot propone algo y Luismi dice "hazlo" o "si", el modelo regenera el análisis en vez de ejecutar. No es bug de stream — falta directiva en system prompt del run de tareas.
- **Decidir TTL definitivo**: 15min idle puede ser corto si Luismi tarda en responder.

## Tests relevantes

- `tests/telegram-hidden-pty-pool.test.js` — 14 tests del pool.
- `tests/telegram-bridge-open-from-pool.test.js` — 8 tests `/abrir` con pool.
- `tests/task-session-relay-feed.test.js` — feed `onData → relayListener`.
- `tests/telegram-relay-liveness.test.js` — liveness JSONL.
- `tests/relay-transcript-helpers.test.js` — extractor con timestamp + tolerancia.
- `tests/telegram-bridge-double-reply-bug.test.js` — race `_flush`/`finalize`.
- `tests/telegram-relay-concurrent-turns.test.js` — busy-wait `relayActive`.
- `tests/telegram-pool-persists-sid-in-bridge.test.js` — sid en bridge.sessions desde el sink.

Referencias: [[tech-telegram-bridge-headless]] (la regla no-fallback original venía del flujo headless).
