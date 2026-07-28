# Sub-chat desechable (hilo lateral) — Diseño

Fecha: 2026-07-24
Estado: aprobado en conversación, pendiente de plan de implementación.

## Problema

Durante una conversación con `claude` en la ventana de POWER-AGENT, una pregunta lateral ("¿qué significa eso?", "¿y si...?") se mezcla con el hilo principal. La explicación original queda arriba, el contexto se contamina y Luismi pierde el hilo.

## Solución

Un **sub-chat desechable**: un segundo panel de terminal, al lado del principal, que arranca como *fork* de la sesión activa (`claude --resume <sessionId> --fork-session`). Hereda todo el contexto hasta ese momento, sirve para resolver la duda, y al cerrarlo se descarta. La sesión principal no se toca: ni lock, ni turnos añadidos, ni contexto contaminado.

Mecanismo verificado en el CLI instalado: `--fork-session` — "When resuming, create a new session ID" — combinado con `--resume`. No bloquea la sesión original.

## Decisiones de producto (cerradas con Luismi)

1. Ámbito: ventana local del Mac (no Telegram/LAN en v1).
2. El contenido del sub-chat **se tira** al cerrarlo. No se inyecta resumen al principal.
3. UI: **panel al lado** (split horizontal principal | sub-chat), no pestaña ni ventana flotante.

## UX

- Botón "Sub-chat" en el titlebar + atajo de teclado.
- Al pulsarlo: `#terminal-wrap` se parte en dos columnas (principal izquierda, sub-chat derecha, 50/50 con divisor arrastrable). El sub-chat spawnea el fork y aparece el TUI de claude con el contexto heredado.
- Botón ✕ en el panel del sub-chat: mata el PTY del fork, pliega el panel, refit del terminal principal a ancho completo.
- Estados deshabilitados (botón con tooltip):
  - CLI activo es `codex` (no existe fork).
  - `session.claudeSessionId` aún no capturado (sesión nueva sin turnos): "aún no hay contexto que heredar".
  - Ya hay un sub-chat abierto (máximo 1 por ventana en v1).

## Arquitectura

### Main: `main/subchat-pty.js` (módulo nuevo)

Patrón calcado de `automation-pty` / `task-session`: canales IPC namespaced, estado propio, deps inyectables para tests.

- Canales: `subchat:start`, `subchat:write`, `subchat:resize`, `subchat:close` (invoke/send) y `subchat:data`, `subchat:exit` (push al renderer).
- Estado: `Map<wcId, { pty, startedAt }>` — un sub-chat por ventana. `subchat:start` con uno vivo → error claro.
- Spawn: mismo camino que el PTY principal (`resolveCli` + `buildFdLimitCommand` + batcher de datos existente en `main/pty-data-batcher.js` si aplica; si el batcher es 1:1 con el canal principal, el sub-chat usa su propio flush simple — decidir en el plan).
- Args: `['--model', getClaudeModel(), '--resume', session.claudeSessionId, '--fork-session']`. **Siempre `--model`** (regla del bug 1M credits).
- Cwd: `session.gitWorkspace?.workCwd || session.cwd` — el mismo directorio efectivo que la madre.
- Limpieza: al cerrar la ventana o hacer restart/switch de la sesión madre, se mata el sub-chat si sigue vivo.

### Aislamiento git

El sub-chat **NO pasa por `ensureSessionWorkspace`/`prepareSessionWorkspace`**: comparte el worktree de la sesión madre. Es un hilo de consulta, no de edición. Esta exclusión se documenta en el runbook (CLAUDE.md § "Regla para spawns nuevos") como exige la regla.

Consecuencia: si el sub-chat editara archivos, los cambios caen en el worktree/rama de la madre. Asumido en v1.

### Renderer

- Segunda instancia de xterm en un `#subchat-pane` dentro de `#terminal-wrap` (flexbox de dos columnas + divisor).
- Refactor mínimo del código de fit/resize: extraer el bloque global (`fitAddon`, `getSafeTerminalSize`, `fitAndSync`, `ResizeObserver`) a una fábrica por instancia `createTermFit(term, containerEl, resizeFn)`; el terminal principal la usa igual que hoy, el sub-chat con su propio canal.
- Preload: exponer los canales `subchat:*` en `preload.js`.

## Ciclo de vida

```
[botón Sub-chat] → subchat:start(wcId)
  → valida: cli=claude, claudeSessionId presente, sin sub-chat vivo
  → spawn fork → subchat:data fluye al xterm del panel
[✕ panel] → subchat:close → SIGTERM pty → panel plegado → refit principal
[cierre ventana / restart madre] → cleanup automático del sub-chat
```

## Limitaciones v1 (conscientes)

1. La sesión fork queda en `~/.claude/projects/` y aparece en el historial de sesiones como una más. No se borra el JSONL.
2. Si la madre está en mitad de una respuesta, el fork hereda hasta el último turno completado en disco.
3. Sub-chat comparte worktree con la madre (ver Aislamiento git).
4. Solo claude, solo ventana local, máximo 1 sub-chat por ventana.

## Errores

- Fork falla al spawnear (CLI ausente, sessionId inválido): mensaje en el panel + `subchat:exit` con el error; el panel se puede cerrar y reintentar. Nunca afecta al PTY principal.
- `subchat:start` sin sessionId o con codex: rechazo con mensaje claro (el renderer ya lo previene deshabilitando el botón; el main revalida).

## Tests

`tests/subchat-pty.test.js` con deps inyectables:

- Args exactos del spawn (incluye `--model` y `--fork-session`, cwd = workCwd de la madre).
- Rechazos: codex, sin sessionId, sub-chat ya vivo.
- Cleanup al cerrar ventana y al restart de la madre.
- No se invoca `ensureSessionWorkspace` (exclusión git).

## Checklist de reglas del repo afectadas

- `package.json build.files`: `main/*.js` ya entra por el patrón existente; verificar en el plan que no hace falta añadir nada (solo si hubiera `.js`/`.html` nuevos en raíz).
- Documentar exclusión git del spawn en CLAUDE.md.
- Batching IPC: solo en `main/pty-data-batcher.js` — si el sub-chat necesita batching, reutilizar ese módulo, no duplicarlo.
