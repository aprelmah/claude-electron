# Perfiles de encargo: persona invisible por sesión (2026-08-09)

## Objetivo (palabras de Luismi)

"Que según elija el perfil, la sesión se comporte de una forma u otra, sin depender de la instrucción de CLAUDE.md" — y sin que el texto de la persona se vea en ningún sitio. Como ya hacía WhatsApp.

## Diseño final

- Un perfil = **nombre + persona (texto libre) + MCPs** (checkboxes). Los campos "Ruta a CLAUDE.md" y "Directorio de trabajo" se eliminaron: duplicaban el project picker.
- La persona del perfil activo se añade como `--append-system-prompt <texto>` a los args del spawn de claude:
  - `buildClaudeLocalArgs` (main.js) — cubre el PTY principal, work-here, resume y el spawn de tareas (unificado en `0495d47`).
  - Spawn LAN — usa `personaResolved` (persona del operador si existe, si no la del perfil), mismo flag.
- Propiedades: **invisible** (no aparece en el terminal), **aditiva** (el CLAUDE.md del proyecto sigue mandando), **fijada al spawn** (cambiar de perfil aplica en la siguiente sesión o reinicio, jamás en caliente).
- Solo claude. Codex no admite el flag (ni en exec ni en TUI).
- `sanitizePersonaPrompt` capa el texto a 12.000 caracteres. El quoting es seguro: los args pasan por `shellQuote` en `buildFdLimitCommand`.

## Reglas duras aprendidas

- **PROHIBIDO escribir la persona como mensaje en el PTY.** La v1 (Haiku) la tecleaba como primer mensaje visible → Luismi la vio plantada en el prompt del terminal. Todo texto de configuración que deba influir en claude va por flags del spawn, nunca por `write()` al terminal.
- **`--append-system-prompt` SÍ funciona en modo interactivo** en claude 2.1.226 — verificado contra `claude --help` del binario instalado. El agente `claude-code-guide` afirmó lo contrario (dedujo del código del proyecto, no de la doc): ante afirmaciones sobre flags, la verdad es el `--help` del binario, no la memoria ni un agente.
- La UI no promete lo que no hace: la nota del modal dice que la persona aplica "al abrir o reiniciar una sesión".

## WhatsApp es OTRO sistema (no confundir)

| | WhatsApp | Perfiles de la app |
|---|---|---|
| Dónde vive | fichero `~/.claude/whatsapp-bridge/persona.md` | config del perfil |
| Cómo aplica | `--system-prompt` (REEMPLAZA todo el prompt) | `--append-system-prompt` (suma al CLAUDE.md) |
| Cuándo | siguiente mensaje (watcher + hot-reload) | al arrancar sesión |
| Aislamiento | total: `--tools ""`, `--strict-mcp-config`, `--setting-sources ""` | ninguno (sesión completa) |

- La persona de WhatsApp se edita en **Configuración WhatsApp → General** (textarea bajo la ruta; guarda solo si cambió, y después de la config por si cambió `personaPath`). El botón 👤 de la cabecera y su modal se eliminaron (`147a829`) — un solo sitio de edición.

## Qué NO tiene persona hoy (decisión pendiente)

- Sub-chat desechable (spawn propio en `subchat-pty`, no pasa por `buildClaudeLocalArgs`).
- Sesiones headless / pool de Telegram.

## Riesgo abierto

- Los MCPs marcados en el perfil gatean en LAN/enterprise (`allowedMcpServers`), pero **no está verificado que tengan efecto alguno en sesiones locales** (el spawn local no pasa `--mcp-config`). Ver STATE.md.
