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

## Qué NO tenía persona en v1 (SUPERADO por la v2 de abajo)

- Sub-chat desechable y sesiones headless/pool de Telegram no recibían el flag. Con la v2 (env heredada + hook) SÍ reciben la persona viva.

## Riesgo abierto

- Los MCPs marcados en el perfil gatean en LAN/enterprise (`allowedMcpServers`), pero **no está verificado que tengan efecto alguno en sesiones locales** (el spawn local no pasa `--mcp-config`). Ver STATE.md.

## v2 (mismo día): persona VIVA por hook — supera al flag en local

Luismi necesitaba cambiar de persona EN MITAD de una sesión abierta ("ahora senior, ahora experto en ventas") sin reiniciar. El flag del spawn no puede: el system prompt de una sesión arrancada es inmutable.

- **Mecánica**: la app escribe la persona del perfil activo en `userData/active-persona.md` (al arrancar y en cada create/update/delete/set-active de perfiles, vía wrapper del `profilesApi` en main.js). Todos los spawns heredan `POWERAGENT_PERSONA_FILE` por `process.env`. El hook `~/.claude/hooks/poweragent-persona.sh` (UserPromptSubmit en `~/.claude/settings.json`) lee el fichero en CADA mensaje y lo emite por stdout → claude lo recibe como contexto invisible.
- **Efecto**: cambiar el desplegable de perfil aplica en el SIGUIENTE mensaje, en sesiones ya abiertas. Sin env var (sesiones fuera de la app) el hook es un no-op silencioso — probado en ambos sentidos con `claude -p`.
- **Reparto de fuentes**: local/subchat/tareas/headless de la app → hook (fuente única; el flag se quitó de `buildClaudeLocalArgs`). LAN → sigue con `--append-system-prompt` (persona de operador) y `delete lanEnv.POWERAGENT_PERSONA_FILE` para no mezclar. WhatsApp → intacto (`--setting-sources ''` no carga hooks).
- **Regla**: para contexto que deba poder CAMBIAR durante la vida de una sesión, el canal es un hook UserPromptSubmit + fichero de estado; los flags del spawn son solo para lo inmutable.
- CLAUDE.md queda para lo invariable (normas, seguridad, idioma); la personalidad la gobierna el perfil.
