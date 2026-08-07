# Bug — Las sesiones de codex: id equivocado, picker congelado y resume roto (2026-08-07 noche)

Tres síntomas que parecían tres bugs y eran el mismo tema: **POWER-AGENT no sabía qué
conversación de codex pertenecía a cada sesión**. Todos reportados en vivo por Luismi
probando la app, uno detrás de otro.

Commits: `d9b1475` (sessionId), `f3538ed` (picker), `4b0bfe9` (resume). Reglas duras en
CLAUDE.md §"Sesiones de codex: cómo se identifican y cómo se listan".

## Síntoma 1 — "Llevar a Terminal" abría la conversación VIEJA

Sesión codex nueva → escribo "hola" → botón → se abre la conversación de otro día.
Con una sesión reabierta funcionaba (ahí el id viene del `resume` de los args).

Dos defectos encadenados, el mismo patrón que el bug de claude del mediodía (`6956fd5`):

1. `guessCodexSessionFromHistory` caía a `rows[rows.length - 1]` — "la última fila del
   historial" — cuando ninguna fila era posterior al arranque del PTY. En una sesión
   nueva, codex aún no ha escrito nada: devolvía la conversación anterior.
2. `buildCurrentSessionMeta` **PERSISTÍA** esa adivinanza en `session.codexSessionId`, y
   la tira de sesión refresca el meta a los milisegundos del spawn. El campo quedaba
   envenenado para siempre (línea 152: `session?.codexSessionId ||` ya no vuelve a mirar).

Era la deuda que el propio CLAUDE.md tenía anotada como consciente desde el mediodía.

## Síntoma 2 (destapado por el arreglo del 1) — "no hay conversación" tras un rato hablando

Al quitar el fallback ciego salió a la luz **el defecto que tapaba**:

```js
const sinceMs = Math.max(ptyStartedAt, lastLocalInputAt - 1500)
if (row.tsMs + 2000 < sinceMs) continue
```

`lastLocalInputAt` se actualiza en **CADA PULSACIÓN** que va al PTY (main.js, handler de
`pty-input`). O sea que el filtro no preguntaba "¿esta fila es de esta sesión?" sino
"¿hay una fila del historial de los últimos 3,5 segundos?". Tras unos minutos de
conversación, la propia conversación quedaba fuera.

**Lección de método**: arreglar en cadena destapa el defecto de debajo. Si un fix correcto
"revela" un fallo nuevo en el mismo sitio, suele ser la misma avería más abajo.

### El criterio bueno estaba en los datos

Los `session_id` de codex son **UUIDv7**: los primeros 48 bits son el instante de creación
de la sesión en ms. Verificado contra `~/.codex/history.jsonl` real:

```
019fdd2a-03c2  uuid_ts: 08-07 18:59:06   fila_ts: 08-07 18:59:46
019fdd2a-03c2  uuid_ts: 08-07 18:59:06   fila_ts: 08-07 19:02:05
```

La sesión de un PTY es **la primera nacida después de arrancarlo** — y eso descarta además
la conversación de una ventana abierta antes. Sin `ptyStartedAt` no se adivina nada.

## Síntoma 3 — el picker enseñaba sesiones de mayo y todos los títulos iguales

Tres cosas a la vez:

- **Las sesiones del worktree no salían.** El rollout graba el cwd donde corrió codex, que
  con aislamiento git es el worktree: `.../CLAUDE-NOVAK/worktrees/claude-electron-6fecee-msj6v2jt-5b94ec`.
  El índice bucketiza por ese cwd y el picker pide el real. Era la limitación v1
  documentada. Resuelto por el nombre determinista del worktree
  (`worktreeSlugFor` = `basename-sha1(realCwd)[0:6]`), aplicado al índice **y al walk de
  respaldo** — solo en uno de los dos, un arranque en frío las vuelve a esconder.
- **El título era el preámbulo inyectado.** Codex abre cada sesión metiendo AGENTS.md,
  `environment_context` y las instrucciones de skills con `role: user`. Todas las sesiones
  se llamaban "# AGENTS.md instructions for /Users/…".
- **El prompt real estaba en el byte 85.882**, fuera de los 64 KB que se leían: al saltar
  los preámbulos habría salido "(sin contenido)". Ahora lee por trozos hasta 1 MB.

Y la pista del bridge de Telegram (`[Sistema: …]`) se **recorta** en vez de descartar el
mensaje: `codex exec` no admite `--append-system-prompt`, así que va pegada delante del
prompt del usuario en el mismo mensaje.

**Los índices con datos derivados tienen que validar su versión al cargar.** `INDEX_VERSION`
existía pero `loadFromDisk` no la comprobaba: arreglar el extractor no arreglaba nada
porque los títulos malos seguían cacheados en disco para siempre. Ahora v2 y se descarta
lo que no coincida.

## Síntoma 4 — el menú de directorio, y lo que había debajo

Reanudar una sesión nacida en worktree suelta un menú del TUI ("Choose working directory
to resume this session"). Se implementó el auto-contestar… y **no disparó**. Tres
hipótesis por lectura de código, ninguna acertó.

Lo cerró una **sonda de 30 líneas** (`tech/tech_sondar_cli_en_pty.md`): lanzar el mismo
`codex resume` en un PTY controlado y volcar los bytes crudos. Dos hallazgos:

**a) El TUI pinta palabra a palabra**, con posicionamiento de cursor entre medias:

```
Choose\x1b[2;8Hworking\x1b[2;16Hdirectory\x1b[2;26Hto\x1b[2;29H\x1b[1mresume…
```

Al quitar los ANSI queda `Chooseworkingdirectorytoresumethissession` — **sin espacios**.
Buscar la frase con espacios no encuentra nada nunca. Y un chunk del PTY puede **cortar
una secuencia ANSI por la mitad** (`\x1b[9;1` + `0H`): normalizar cada mitad por separado
deja basura en medio del texto, así que hay que guardar la cola incompleta.

**b) La causa real de que "al pulsar 2 volviera al picker":**

```
thread 019fdd2a already has an active writer (code -32600)
```

La conversación estaba **abierta en Terminal.app** — el botón "Llevar a Terminal" de las
19:18 dejó `codex resume <id>` vivo (PID 53592, colgando de `-bash`, cwd del proyecto
real). Codex no admite dos escritores en un hilo y se cierra. El PTY moría y el renderer
abría el selector de proyecto sin explicar nada. Ahora sale un `pty-error` claro.

Diagnóstico rápido si vuelve: `ps aux | grep "[c]odex resume"`.

## Qué se toca si esto reaparece

- `main/codex-session-reader.js` — `guessCodexSessionFromHistory`, UUIDv7.
- `main/claude-session-cache.js` — la rama codex del meta NO persiste el id.
- `main/terminal-handoff.js` — `resolveCodexSessionId` en el clic.
- `main/session-git.js` — `worktreeSlugFor` / `worktreeCwdBelongsTo` (exportados).
- `main/codex-sessions-index.js` — `getForCwd`, `INDEX_VERSION`.
- `main/claude-session-listing.js` — `isInjectedCodexPreamble`, `stripAppSystemHint`.
- `main/codex-resume-watch.js` — menú de directorio + escritor activo.

Tests: `codex-session-guess`, `codex-sessions-worktree`, `codex-preview`,
`codex-resume-watch`, `current-session-meta`, `terminal-handoff`.
