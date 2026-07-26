# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-07-26 (verificado contra git y tests en el cierre)._

## Estado de entrega (verificado)

- Rama activa: **`feat/git-auto-por-sesion`**, HEAD `31fcfe6`, **SIN PUSH** (sin upstream). Lleva DOS features: git automático por sesión + sub-chat desechable.
- Sub-chat desechable COMPLETO: 6 commits (`598db26`..`d8ffbdd`), integrados al dir real por el propio git-por-sesión (`31fcfe6`).
- Tests: **499 (493 pass / 0 fail / 6 skip pre-existentes)**. Módulo sub-chat: 17/17. `node --check` limpio en `main.js`, `renderer.js`, `preload.js`, `main/subchat-pty.js`.
- Deploy: `/Applications/POWER-AGENT.app` NO lleva ninguna de las dos features.
- ⚠️ **Working tree del dir real SUCIO**: `D node_modules`, `M package-lock.json` (ver "Riesgo abierto"). Mientras siga sucio, el finalize de cualquier sesión no podrá mergear y dejará rama de conflicto.

## Riesgo abierto — symlink `node_modules` commiteado

El commit `31fcfe6` metió en el repo un **symlink `node_modules`** (`mode 120000`) apuntando a la ruta absoluta `/Users/isabel/Desktop/LUISMI/claude-electron/node_modules`.

- **Causa raíz**: `.gitignore` línea 3 es `node_modules/` **con barra final** → solo matchea directorios. Un subagente creó un symlink (que git ve como fichero) para poder correr tests en el worktree, y el `git add -A` del finalize de git-por-sesión lo commiteó.
- **Impacto**: rompería cualquier clon en otra máquina; el dir real aparece sucio porque ahí `node_modules` es un directorio real.
- **Fix pendiente (requiere OK de Luismi, toca git)**: `git rm --cached node_modules` + cambiar el patrón a `node_modules` sin barra + restaurar `package-lock.json`.

## Última sesión (2026-07-25/26)

- Feature sub-chat desechable: spec `docs/superpowers/specs/2026-07-24-subchat-desechable-design.md`, plan `docs/superpowers/plans/2026-07-24-subchat-desechable.md`, 4 tasks con subagentes + revisión por task + revisión final de rama + 2 fix waves. Ledger: `.superpowers/sdd/2026-07-24-subchat-desechable/progress.md`.
- Decisiones de producto (Luismi): contenido del sub-chat **se tira** al cerrar (sin resumen al principal); UI = **panel al lado** (no pestaña ni ventana); ámbito ventana local del Mac.
- Módulo nuevo: `main/subchat-pty.js`. Canales IPC `subchat:*`. Renderer: `#terminal-row` + segundo xterm + fábrica `createTermFit` por instancia (los wrappers antiguos siguen vivos).
- 5 bugs cazados por las revisiones, uno **crítico**: el fork sobrevivía al exit natural de la madre (`/exit`) → proceso huérfano tras cerrar la app + `canStart` bloqueado para esa ventana de por vida. Arreglado con guard split en `killPty` + hook en `proc.onExit` + backstop `closeAll()` en `before-quit`.
- Luismi confirmó que ve el botón en la app en modo dev. **Prueba funcional aún no ejecutada.**

## Próximo paso

1. **Prueba manual de Luismi (sub-chat)**: abrir con 2+ turnos → responde con contexto heredado → ✕ → principal intacto. Clave: `/exit` en la madre con sub-chat abierto → sin `claude` huérfano en `ps`. Con codex o sesión sin turnos → botón deshabilitado.
2. **Limpiar el symlink** (ver Riesgo abierto) ANTES de cerrar sesiones, o los merges seguirán fallando.
3. Prueba manual pendiente de git-por-sesión (2 ventanas sobre el mismo repo, conflicto provocado).
4. Con su OK: push de `feat/git-auto-por-sesion` + PR a main → merge → `npm run deploy`.
5. SEC-C3 (upgrade Electron) sigue pendiente, sesión humana.

## Notas operativas

- **Sub-chat**: excluido de `ensureSessionWorkspace` — hereda el `workCwd` del worktree de la madre (documentado en `CLAUDE.md` §"Qué NO está aislado"). Solo claude (codex no tiene `--fork-session`). Máximo 1 por ventana. Atajo Cmd+Shift+S.
- Limitación v1 del sub-chat: cada fork deja su JSONL en `~/.claude/projects/` y aparecerá en el picker de sesiones.
- **Los worktrees no tienen `node_modules`**: cualquier subagente que corra tests ahí lo necesita. NO symlinkarlo (ver Riesgo abierto); mejor correr los tests desde el dir real o instalar dentro del worktree con node_modules ignorado correctamente.
- Reglas de git-por-sesión en `CLAUDE.md`: spawns nuevos DEBEN decidir si pasan por `ensureSessionWorkspace`; `session.cwd` siempre path real; finalize `--no-verify`, serializado por realCwd.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan igual).
