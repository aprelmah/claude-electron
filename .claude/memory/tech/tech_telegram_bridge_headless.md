---
name: tech-telegram-bridge-headless
description: Patrón para bridges CLI IA ↔ chat externo (Telegram/Discord) sin eco del PTY
metadata: 
  node_type: memory
  type: reference
  originSessionId: b1371455-b105-4349-890c-01f33c479faf
---

# Patrón: bridge CLI IA ↔ chat externo (sin PTY)

## Problema
Exponer un CLI interactivo de IA (Claude Code, Codex CLI, Aider, etc.) a un chat externo (Telegram, Discord, web). Si capturas la salida del PTY directamente, **te llega de vuelta el eco del input + el redibujado del prompt + secuencias ANSI**. Los filtros heurísticos sobre el PTY son frágiles.

## Solución correcta (lo que hacen los proyectos serios)
NO usar PTY para output. Dos enfoques limpios:

### A) Headless one-shot por mensaje (recomendado para el primer build)
Cada mensaje del chat lanza un proceso CLI nuevo en modo programático:

**Claude Code:**
```
claude -p "<prompt>" --output-format stream-json --verbose \
  --permission-mode bypassPermissions \
  [--model sonnet] [--effort medium] [--resume <sessionId>]
```
Parsear stdout línea a línea. Filtrar:
- `obj.type === 'assistant'` → iterar `obj.message.content[]`, extraer `block.text` (type=text) y `block.name` (type=tool_use).
- `obj.type === 'result'` → captura `obj.session_id` (raíz, persistible) y `obj.result` (texto final).
- Resto (system, hook_*, etc.): ignorar.

**Codex CLI:**
```
codex exec --skip-git-repo-check --json [-m <model>] \
  [-c model_reasoning_effort=<low|medium|high>] "<prompt>"
# Resume:
codex exec resume <SESSION_ID> --skip-git-repo-check --json "<prompt>"
```
Filtrar:
- `type:"thread.started"` → captura `thread_id` como session_id.
- `type:"item.completed", item.type:"agent_message"` → texto del modelo en `item.text`.

Persistir session_id por `chat_id` (o `user_id`) en JSON local. Reinyectar con `--resume` / `exec resume` en siguiente mensaje.

### B) PTY + lectura del transcript JSONL (compartir sesión Mac↔chat)
Como hace `six-ddc/ccbot`. Mantienes el PTY para inyectar input (compartido con UI local). Para output al chat NO lees el PTY: lees el JSONL oficial que Claude Code escribe en `~/.claude/projects/<cwd-encoded>/<sessionId>.jsonl` (tail-f / file watcher), filtras `type:"assistant"` y mandas eso. Más complejo, requiere detectar `session_id` activo (por --resume arg o watcher del directorio).

## Streaming al chat (editar mensaje progresivamente)
- Mandar un mensaje inicial "Procesando...", guardar `message_id`.
- Acumular chunks de texto, editar el mismo mensaje con `editMessageText`.
- **Throttle dual**: editar si han pasado ≥1500ms desde la última edición O si han llegado ≥80 chars nuevos. Es el patrón de terranc.
- Overflow: si pasa de ~3800 chars (límite Telegram 4096), cerrar mensaje actual y abrir uno nuevo.
- Manejar `RetryAfter` (429): sleep `e.retry_after + 0.2`.
- Ignorar "message is not modified" silenciosamente.

## Cola por chat
Un solo prompt en curso por `chat_id`. Cola serializada (Promise chain). Si llega nuevo prompt mientras hay otro, opciones: abortar el anterior (preferido si /cancel) o encolar.

## Cancelación
`AbortController` por query. SIGTERM al child; SIGKILL tras 2s.

## SDK Node oficial (`@anthropic-ai/claude-agent-sdk`)
Existe (`query()`, `Options`, tipos `SDKMessage`, `SDKAssistantMessage`, `SDKResultMessage`). Más limpio que subprocess. **Pero requiere Node ≥18.** Electron 20 trae Node 16 → INCOMPATIBLE. Para Electron 28+ con Node 20 sí sería opción. Mientras: subprocess directo (lo que el SDK hace internamente).

## Proyectos referencia
- `terranc/claude-telegram-bot-bridge` — Python + SDK + streaming progresivo profesional.
- `RichardAtCT/claude-code-telegram` — Python + SDK + SQLite session store.
- `six-ddc/ccbot` — tmux + transcript JSONL parser (enfoque B).
- `jsayubi/ccgram` — usa hooks oficiales de Claude Code.
- `MackDing/CodexClaw` — SDK-first con fallback PTY/exec.

## Por qué Anthropic Hermes NO sirve como referencia
Es agente propio (NousResearch), no envuelve `claude` o `codex`, los reemplaza con su runtime. No aplica.

## Implementación viva
Ver `/Users/isabel/Desktop/LUISMI/claude-electron/telegram-bridge.js` + helpers `runClaudeHeadless` y `runCodexHeadless` en `main.js`. Commit `6cae455`.
