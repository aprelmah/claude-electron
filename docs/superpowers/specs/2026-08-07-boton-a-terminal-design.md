# Botón "Llevar a Terminal" — diseño

**Fecha**: 2026-08-07 · **Estado**: aprobado por Luismi (conversación, misma fecha)

## Objetivo

Un botón en la topbar que abre la sesión activa (claude o codex), con todo su historial, en Terminal.app — y la app la suelta por debajo. Equivalente a "cerrar la app y seguir por Telegram", pero hacia la CLI real.

## UX

- Botón nuevo en la topbar (icono de terminal), junto a los existentes.
- Siempre visible; al pulsar, main valida que la sesión tenga sessionId conocido (`claudeSessionId` / `codexSessionId`). Sin sessionId (aún sin primer turno) → error claro en el status y la sesión no se toca.
- Click → la ventana muestra el picker (flujo `pty-exit` existente) y se abre Terminal.app en el directorio real del proyecto con `claude --resume <id>` o `codex resume <id>`.
- Si el handoff falla, aviso en la UI y la sesión de la app no se toca (el kill solo ocurre si hay comando construible).

## Flujo (main)

IPC nuevo `session:handoff-to-terminal` (handle, por `event.sender`):

1. Resolver sesión y validar: PTY vivo, cli `claude`|`codex`, sessionId presente.
2. Capturar antes de tocar nada: `realCwd = session.gitWorkspace?.realCwd || session.cwd`, cli, sessionId.
3. `killPty(session)` — el renderer recibe `pty-exit` y enseña el picker (flujo existente).
4. **Esperar** el finalize del worktree: `finalizeWorkspaceForSession` pasa a devolver su promesa (refactor mínimo; los llamadores actuales la ignoran y nada cambia para ellos). El orden es de carga: `copySessionsHome` copia el `.jsonl` del proyecto-worktree al proyecto real — sin eso, `--resume <id>` en el cwd real da "No conversation found"; y el merge deja los cambios de archivos en el directorio real antes de que la Terminal los vea.
5. Abrir Terminal.app vía osascript: `cd '<realCwd>' && claude --resume '<id>'` (codex: `codex resume '<id>'`). Sin `--model` ni flags de la app: es la CLI interactiva normal del usuario.
6. Conflicto/dirty en el merge → `notifySessionGitIssue` existente avisa; la Terminal se abre igual (los cambios quedan en la rama `poweragent/session-*`, como hoy).

## Módulo nuevo

`main/terminal-handoff.js`:

- `buildHandoffCommand({ cli, cwd, sessionId })` → string shell, con escapado de comillas simples (paths con espacios/tildes).
- `buildAppleScript(shellCmd)` → script `tell application "Terminal" … do script …` con escapado de `\` y `"`.
- `openInTerminal({ cli, cwd, sessionId, execFile })` → ejecuta osascript; `execFile` inyectable para tests.

Lógica pura testeable sin Terminal ni PTY. `main/**` ya está en `build.files`.

## Casos borde y riesgos asumidos

- El `--resume` interactivo en Terminal **forkea** a un sessionId nuevo (comportamiento estándar de Claude Code). Es la misma ventana de adopción ya documentada en CLAUDE.md para "un `claude` lanzado a mano"; como la sesión de la app muere antes, no hay trabajo nuevo.
- Cwd remoto o sin git → no hay worktree, no hay finalize: se abre Terminal directo.
- Sesión codex nacida en worktree no sale en el historial del proyecto (limitación v1 ya documentada); `codex resume <id>` funciona igual.
- El finalize puede tardar (push si hay upstream): el botón queda deshabilitado mientras está en vuelo.

## Tests

- Unit de `buildHandoffCommand`/`buildAppleScript`: claude/codex, escapado de comillas y espacios.
- `openInTerminal` con `execFile` falso: argumentos correctos, error propagado.
- Handler: rechaza sin sessionId, rechaza cli desconocido (deps inyectadas si el patrón del repo lo permite; si no, cubierto por los builders).
