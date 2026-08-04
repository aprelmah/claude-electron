# La instrucción de la app secuestraba el título de las sesiones de Telegram

_2026-08-04. Detectado por Luismi en la barra de título tras abrir una sesión desde el bot._

## Síntoma

Toda sesión abierta desde Telegram se llamaba igual:

```
Sesión: [Sistema: si el usuario pide un archivo, búscalo con `find ~ -name "*palabra…
```

Indistinguibles en el picker, y el título no decía nada de la conversación.

## Causa

El bridge concatenaba su instrucción **delante** del mensaje:

```js
const fileHint = '[Sistema: si el usuario pide un archivo, búscalo con `find ~ …]\n\n'
onRunQuery({ prompt: fileHint + prompt, userPrompt: prompt, … })
```

Ese texto pasaba a ser el primer turno de la conversación, y **Claude Code titula la sesión con el primer prompt**.

Solo afectaba a la ruta **headless** (sesiones nuevas desde Telegram): el relay PTY ya usaba `opts.userPrompt`, que iba limpio.

## Fix

La instrucción es de la app, no del usuario, así que va por `--append-system-prompt`:

- `telegram-bridge.js` — constante `TELEGRAM_FILE_HINT`, y manda `prompt` limpio + `appendSystemPrompt` aparte.
- `headless-runners.js` — `runClaudeHeadless` acepta `appendSystemPrompt` y lo pasa como flag.

**codex** (`runCodexHeadless`): `codex exec` no tiene equivalente, así que ahí se sigue anteponiendo al prompt, con el mismo coste de antes. No molesta porque el picker no expone esos títulos. Anotado en el código por si algún día lo hace.

Test: `tests/telegram-system-hint-not-in-prompt.test.js`. Captura los argv del spawn interceptando `buildFdLimitCommand`, sin ejecutar ningún CLI — patrón reutilizable para testear cómo se invoca un CLI.

## Regla

**Todo lo que la app añada a un turno va como system prompt, nunca pegado al mensaje del usuario.** Además del título, un texto pegado al prompt entra en el historial de la conversación como si lo hubiera escrito el usuario.

## Nota

Las sesiones creadas antes del fix conservan su título viejo — eso no se reescribe.
