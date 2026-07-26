# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-07-26 (verificado contra git y tests en el cierre)._

## Estado de entrega (verificado)

- Rama activa: **`feat/git-auto-por-sesion`**, HEAD `86de38f`, working tree **limpio**, **SIN PUSH** (sin upstream). Lleva DOS features: git automático por sesión + sub-chat desechable.
- Sub-chat desechable COMPLETO: 6 commits (`598db26`..`d8ffbdd`), integrados al dir real por el propio git-por-sesión (`31fcfe6`).
- Tests: **499 (493 pass / 0 fail / 6 skip pre-existentes)**. Módulo sub-chat: 17/17. `node --check` limpio en `main.js`, `renderer.js`, `preload.js`, `main/subchat-pty.js`.
- Deploy: `/Applications/POWER-AGENT.app` **SÍ lleva ambas features** (build del 2026-07-25 09:34; `session-git.js`, `session-git-map.js`, `subchat-pty.js` están dentro del `app.asar`). Lo que falta es el push + PR, no el deploy.
- Symlink `node_modules`: **RESUELTO** el 2026-07-26 (`6b06600`). `.gitignore` ahora usa patrones sin barra (`dist`, `node_modules`, `.claude/worktrees`) y `package-lock.json` quedó sincronizado con la 1.3.0.
- Ramas/worktrees huérfanos de sesión: limpiados (2 worktrees vacíos + 3 ramas `poweragent/session-*`; el commit útil `9f558f2` se recuperó por cherry-pick → `86de38f`).
- Pre-commit hook: instalado (`.git/hooks/pre-commit` → `scripts/pre-commit.sh`); no lo estaba.

## Worktrees huérfanos no registrados — ARREGLADO (pendiente de prueba en app)

`sessionGitMap.recordActive()` (main.js:1389) solo se llama **dentro del poll que detecta un `claudeSessionId` nuevo**: si la sesión muere antes de generarlo (ventana abierta sin escribir nada, `pkill` del protocolo de deploy) el worktree se crea pero no queda registrado, y el sweep del arranque no podía verlo. Por eso no existía `userData/session-git-map.json` pese a haber worktrees, y por eso se acumularon los 2 worktrees vacíos limpiados a mano hoy.

- **Fix (`main/session-git.js` → `discoverUnregisteredWorkspaces`)**: el arranque escanea `userData/worktrees/`, descarta los que ya están en el registro y trata el resto como huérfanos (al arrancar no hay PTY vivo y la app es single-instance). Se recuperan por el mismo camino que los registrados (`recoverOrphanedWorkspaces`) y sus `realCwd` se añaden al `sweepOrphans`. Fail-open: basura, worktrees de repos borrados o ramas que no son `poweragent/session-*` se ignoran sin tocarlas.
- 6 tests nuevos en `tests/session-git-discover.test.js`. Suite: **505 (499 pass / 0 fail / 6 skip)**.
- **Pendiente**: verificarlo en la app (crear worktree huérfano → matar app → arrancar → debe desaparecer). No se probó porque había una sesión viva de otro proyecto en la app empaquetada.
- No hubo nunca pérdida de datos: el cierre normal del PTY finaliza bien porque usa `session.gitWorkspace` en memoria, no el registro.

## Última sesión (2026-07-25/26)

- Feature sub-chat desechable: spec `docs/superpowers/specs/2026-07-24-subchat-desechable-design.md`, plan `docs/superpowers/plans/2026-07-24-subchat-desechable.md`, 4 tasks con subagentes + revisión por task + revisión final de rama + 2 fix waves. Ledger: `.superpowers/sdd/2026-07-24-subchat-desechable/progress.md`.
- Decisiones de producto (Luismi): contenido del sub-chat **se tira** al cerrar (sin resumen al principal); UI = **panel al lado** (no pestaña ni ventana); ámbito ventana local del Mac.
- Módulo nuevo: `main/subchat-pty.js`. Canales IPC `subchat:*`. Renderer: `#terminal-row` + segundo xterm + fábrica `createTermFit` por instancia (los wrappers antiguos siguen vivos).
- 5 bugs cazados por las revisiones, uno **crítico**: el fork sobrevivía al exit natural de la madre (`/exit`) → proceso huérfano tras cerrar la app + `canStart` bloqueado para esa ventana de por vida. Arreglado con guard split en `killPty` + hook en `proc.onExit` + backstop `closeAll()` en `before-quit`.
- Luismi confirmó que ve el botón en la app en modo dev. **Prueba funcional aún no ejecutada.**

## Próximo paso

1. **Prueba manual de Luismi (sub-chat)**: abrir con 2+ turnos → responde con contexto heredado → ✕ → principal intacto. Clave: `/exit` en la madre con sub-chat abierto → sin `claude` huérfano en `ps`. Con codex o sesión sin turnos → botón deshabilitado.
2. Prueba manual pendiente de git-por-sesión (2 ventanas sobre el mismo repo, conflicto provocado).
3. Verificar en la app el barrido de worktrees no registrados (ver sección arriba).
4. Con su OK: push de `feat/git-auto-por-sesion` + PR a main → merge → `npm run deploy`.
5. SEC-C3 (upgrade Electron) sigue pendiente, sesión humana.

## Notas operativas

- **Sub-chat**: excluido de `ensureSessionWorkspace` — hereda el `workCwd` del worktree de la madre (documentado en `CLAUDE.md` §"Qué NO está aislado"). Solo claude (codex no tiene `--fork-session`). Máximo 1 por ventana. Atajo Cmd+Shift+S.
- Limitación v1 del sub-chat: cada fork deja su JSONL en `~/.claude/projects/` y aparecerá en el picker de sesiones.
- **Los worktrees no tienen `node_modules`**: cualquier subagente que corra tests ahí lo necesita. NO symlinkarlo (ver Riesgo abierto); mejor correr los tests desde el dir real o instalar dentro del worktree con node_modules ignorado correctamente.
- Reglas de git-por-sesión en `CLAUDE.md`: spawns nuevos DEBEN decidir si pasan por `ensureSessionWorkspace`; `session.cwd` siempre path real; finalize `--no-verify`, serializado por realCwd.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan igual).
