# BUG — el relay de Telegram mandaba la pantalla en vez de la respuesta

**Fecha:** 2026-07-28 (noche) · **Cerrado en:** PR #5 (`4d56eb2`) · **Estado:** resuelto y desplegado

## Síntoma

Por Telegram llegaban respuestas así:

```
✻ ✶ ✳ Percolating…
※recap: Luismi está explorando conceptos técnicos de energía solar…
❯ Hola
⏺ HolaLuismi.Dime.
   Welcome back LUIS!   Run /init to create a CLAUDE.md file …
```

Spinners, el banner de bienvenida, el recap, el historial repetido dos veces y palabras sin espacios. Y ~45 s de retraso. **En la ventana de la app la misma respuesta salía bien y al instante.**

## Causa raíz

El relay localizaba el transcript **adivinando el directorio a partir del cwd**. Claude Code decide dónde escribe según **cómo nació la sesión**:

| Cómo nació | Dónde escribe el JSONL |
|---|---|
| Sesión **nueva** dentro del worktree | proyecto del **worktree** |
| Sesión **resumida** (`--resume <id>`) | proyecto **ORIGINAL**, aunque el proceso corra en el worktree |

Adivinar por cwd falla **siempre en una de las dos direcciones**. Sin encontrar el turno, `sawEndTurn` nunca era cierto, se agotaba `FORCE_END_RELAY_MS` (45 s) y se caía a `cleanRelayFallbackText(capture)` — el raspado del TUI.

## Lo importante: el camino de diagnóstico

Se descartaron **tres causas plausibles** antes de dar con la buena. Todas parecían correctas leyendo el código; las tres cayeron con datos:

1. **"El PTY mata al hijo, por eso no termina"** — medido con un `pty.fork()` de Python: un hijo lanzado por el proceso del PTY efectivamente muere al salir el padre. **Cierto pero irrelevante aquí.**
2. **"Claude Code cambió el formato del transcript"** — se contó sobre el JSONL vivo: `type=assistant` + `message.stop_reason==='end_turn'` seguía existiendo (14 casos). **Falso.**
3. **"Se cuela el bloque `thinking` como respuesta"** — `extractTurnText` solo coge bloques `type==='text'`. **Falso.**
4. **"Es el cwd del worktree"** — se arregló… y siguió fallando, porque el caso real era el **contrario** (sesión resumida).

Lo que lo resolvió fue **instrumentar**: un `console.log` en `buildRelayResult` con la app lanzada en dev vía `osascript` y `tee` a un log. La primera traza real lo dijo todo:

```json
{"relayCwd":"…/worktrees/turbo-e-01caf6-ms501nyd-2d27ac","dir":null,
 "textLen":0,"sawAssistant":false,"sawEndTurn":false,"elapsedMs":4493}
```

`dir: null` → no había **ningún** transcript en ese directorio. El turno estaba en `-Users-isabel-Desktop-turbo-e`, con sus 6 `end_turn` y el texto limpio.

**Lección:** con este relay, leer código produce hipótesis bonitas y equivocadas. Una traza en el punto exacto resolvió en un intento lo que tres rondas de análisis no resolvieron. Instrumentar primero.

## Arreglo

- **`findRelayTranscript({sessionId, cwds})`** (`main/relay-transcript-helpers.js`) — busca `<sessionId>.jsonl` en los cwds candidatos (`relayCwdCandidates(session)` = worktree + cwd real) y, si no aparece, barre todo `~/.claude/projects`. Deja de importar dónde decida escribir Claude Code.
- **`turnComplete` en vez de `sawEndTurn`** — el turno solo está cerrado si el **ÚLTIMO** evento `assistant` tiene `stop_reason: 'end_turn'`. Con `tool_use` por medio, `sawEndTurn` es cierto mientras el turno sigue vivo. Los eventos `isSidechain: true` (sub-agentes Task) se ignoran: escriben su propio `end_turn` y cortarían el turno a mitad.
- **Polling del JSONL cada 300 ms** (`TRANSCRIPT_POLL_MS`) en vez de esperar 2,2 s de silencio del PTY. En turnos con herramientas se midieron silencios de **~9 s**, que empujaban a los topes de 15 s / 45 s. Los timers de silencio quedan como red de seguridad.
- **Eliminado el scraping del TUI** en la rama claude: sin texto en el transcript se devuelve `RelayEmpty` con mensaje claro. `cleanRelayFallbackText` solo sigue vivo para codex.

## Dos bugs de fondo que salieron por el camino

1. **Lectura completa del fichero en cada poll.** `extractAssistantTextFromTranscript` hacía `readFileSync` del transcript entero. Con el poll a 300 ms y transcripts de 14 MB (los hay en este Mac) son ~42 MB/s para leer dos líneas. Ahora lee **solo desde el offset** con `openSync`+`readSync`, y el poll hace `stat` antes de parsear.
2. **El offset alineado a `\n` se comía la primera línea nueva.** El código descartaba siempre "hasta el siguiente `\n`" para evitar líneas partidas. Pero cuando el offset cae **justo tras** un salto de línea, la primera línea del slice está completa — y era, típicamente, **la respuesta**. Ahora se lee 1 byte en `start-1` para saber si hay que descartar. Lo cazó un test, no una lectura del código.

## Verificación

- Reproducido con traza en la app real antes del fix (`dir: null`).
- Tras el fix, probado por Telegram sobre la sesión real de Luismi: respuesta correcta e inmediata ("funciona de puta madre y rápido").
- 17 tests nuevos en `tests/relay-transcript-locate.test.js` y `tests/relay-cwd-worktree.test.js`, incluidos los dos casos de offset y el de sub-agentes.

## Pendiente relacionado

La ruta **headless** (`runClaudeHeadless`, `main.js:2444`) sigue recibiendo el cwd de `getCwdSync()` → cwd real. Un `--resume` de sesión aislada no encontrará su transcript. No se tocó porque `getCwdSync()` alimenta también la UI y el `/cwd` del bridge: hace falta separar "cwd que ve el usuario" de "cwd donde vive la sesión".

Reglas derivadas, en `CLAUDE.md` §*Relay de Telegram (claude): el JSONL manda, la pantalla no*.
