---
name: tech-codex-cli-quirks
description: Gotchas del CLI codex (OpenAI Codex) en modo no-interactivo
metadata: 
  node_type: memory
  type: reference
  originSessionId: b1371455-b105-4349-890c-01f33c479faf
---

# CLI `codex` (OpenAI Codex) — gotchas no-interactivos

Versión validada: codex-cli 0.130.0 (mayo 2026).

## Stdin DEBE estar cerrado
Si lanzas `codex exec ...` con stdin abierto, **se cuelga** esperando input (header del log: "Reading additional input from stdin..."). En `child_process.spawn` de Node:
```js
spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd, env })
```

## `--skip-git-repo-check`
Por defecto codex exige estar en un git repo o aborta. Pasar este flag para correr en cualquier cwd.

## `--json` da JSONL parseable
Sin `--json`, la salida es texto humano con headers (modelo, sandbox, etc.). Con `--json`:
```
{"type":"thread.started","thread_id":"<uuid>"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{...}}
```

## Resume de sesión
Subcomando dedicado:
```
codex exec resume <SESSION_ID> [--skip-git-repo-check --json] "<prompt>"
```
Las opciones van **después** de `resume <SESSION_ID>`. El SESSION_ID es el `thread_id` capturado de la salida JSONL previa.

## Modelo
- `-m <model>` o `--model <model>`.
- Modelos típicos: gpt-5.4-mini (default), gpt-5.4, o3, o3-mini.

## Reasoning effort
NO hay flag dedicado. Se pasa por config dotted key:
```
-c model_reasoning_effort=low
-c model_reasoning_effort=medium
-c model_reasoning_effort=high
```

## Latencia
Codex tarda **~13s** incluso para respuestas triviales ("responde solo: ok"). Es el modelo, no el bridge. Avisar al usuario si vas a poner timeouts.

## Config persistente
`~/.codex/config.toml` con `model`, `model_reasoning_effort`, etc. Los flags CLI sobreescriben esto.

## Comparación con `claude -p`
Codex y Claude exponen patrones similares en JSONL (init / message / final). Diferencia clave:
- Claude: `type:"assistant"` con `message.content[].text` para texto.
- Codex: `type:"item.completed"` con `item.text` para texto.

Ambos: capturar `session_id` (Claude) o `thread_id` (Codex) del primer mensaje o del final, persistir, reanudar.
