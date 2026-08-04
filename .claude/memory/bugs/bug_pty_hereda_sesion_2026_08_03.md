# Los PTYs de la app heredaban la identidad de la sesión que la lanzó

_2026-08-03. Detectado por Luismi mirando el fondo del TUI._

## Síntoma

Al fondo de una sesión abierta en la app:

```
⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker ·
  restart with CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 to keep future transcripts
```

Una línea amarilla, fácil de no ver nunca.

## Qué rompía

**Esa sesión no escribe `.jsonl`.** Y sin transcript se cae media app, en silencio:

- No se puede reanudar con `--resume`.
- No aparece en el historial ni en el picker de sesiones.
- **El relay de Telegram deja de funcionar**: lee ese fichero para saber qué contestó Claude.
- Igual el pool de PTYs ocultos y las task-sessions.

## Causa

La app se lanzó desde una sesión de Claude Code (un `npm run deploy`, un `open -a` desde un agente) y heredó su entorno:

```
CLAUDE_CODE_SESSION_ID=783226cd-…   ← la sesión del agente que desplegó
CLAUDE_CODE_CHILD_SESSION=1
CLAUDE_CODE_ENTRYPOINT=cli
```

El PTY que la app spawnea las hereda a su vez, se cree una sub-sesión de aquella y desactiva el guardado.

## Fix

`buildRuntimeEnv()` (`main/cli-resolver.js`) borra `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID` y `CLAUDE_CODE_ENTRYPOINT` antes de entregar el entorno. Los PTYs son siempre sesiones de primer nivel, se lance la app como se lance.

`CLAUDE_CODE_EXECPATH` **se conserva**: apunta al binario, no a una sesión.

Cubierto por `tests/cli-env-session-identity.test.js`. Las 12 llamadas a `buildRuntimeEnv` cubren todos los spawns; no queda ningún `env: process.env` directo.

## Cómo comprobarlo

```bash
PID=$(pgrep -f "MacOS/POWER-AGENT$" | head -1)
ps eww -p $PID | tr ' ' '\n' | grep '^CLAUDE_CODE'
```

Que la **app** las tenga es normal si la lanzó un agente. Lo que importa es que no lleguen al PTY — eso lo garantiza `buildRuntimeEnv`, y se ve en el TUI: sin línea amarilla, guardando.

## Regla

Lanzar la app desde una sesión de Claude Code le pega esa identidad. Está mitigado, pero **cualquier variable nueva de identidad de sesión que aparezca en el CLI hay que añadirla a `CLAUDE_SESSION_IDENTITY_VARS`**.
