# Runbook — Git automático por sesión

> Movido íntegro del CLAUDE.md raíz el 2026-08-09 (dieta del runbook, R6).

- **Qué hace**: cada sesión (ventana local o sesión LAN) con `cwd` dentro de un repo git local trabaja en su propio `git worktree` + rama `poweragent/session-<key>`, no en el directorio real. `session.cwd` sigue mostrando el path real (UI/recientes intactos). Al cerrar la sesión: commit automático → sin cambios se limpia en silencio → con cambios se intenta merge a la rama del dir real (solo si está limpio) → merge limpio borra rama/worktree y hace `push` si hay upstream.
- **Toggle**: `cli.gitSessionIsolation` (Configuración → "Aislamiento git por sesión"), default ON. Desde 2026-08-07 hay además **exclusión por carpeta**: `cli.gitIsolationExcludes` (Configuración → "Carpetas SIN aislamiento", una por línea, vale `~` y cubre subcarpetas; comparación por segmentos e insensible a mayúsculas — `cwdExcludedFromIsolation` en `main/session-git.js`). Y la sesión aislada se VE: badge «🌿 worktree» en la tira de sesión con rama y carpeta real en el tooltip (`meta.gitIsolation` en `get-current-session-meta`). Escape hatch total: en OFF, o si el cwd no es repo git, o es path remoto (NAS/SMB), o falla cualquier comando git → fail-open al flujo de siempre, sin bloquear el spawn.
- **Ramas de conflicto**: si el merge da conflicto o el dir real está sucio, la rama `poweragent/session-<key>` queda viva con los cambios (no se borra) y se avisa: `Notification` de macOS en ventana local, `console.warn` + frame `status` por WebSocket en LAN. Revisar y mergear a mano esas ramas.
- **Ubicaciones**: worktrees en `userData/worktrees/<repoSlug>-<sessionKey>/`; registro de sesiones en `userData/session-git-map.json` (mapea `claudeSessionId → { realCwd, branch, worktreePath, active }`, atomic writes, flush en `before-quit`). Sweep de huérfanos al arrancar (`git worktree prune` + finalize de entradas `active: true` sin PTY vivo). El registro **solo se escribe cuando la sesión llega a generar un `claudeSessionId`**, así que el arranque completa el barrido con `discoverUnregisteredWorkspaces()`: escanea `userData/worktrees/`, y todo worktree que no esté en el registro se trata como huérfano (al arrancar no hay ningún PTY vivo y la app es single-instance). Se recupera igual que los registrados: commit → merge → limpieza.
- **Qué NO está aislado**: automation PTY (`startAgentPty`) y task-sessions/pool oculto de Telegram (`startTaskSessionPty`) siguen con `--resume` sobre el cwd original. Pendiente integrarlos cuando esto esté validado en uso real. El sub-chat desechable (`main/subchat-pty.js`) tampoco pasa por `ensureSessionWorkspace`: hereda el `workCwd` del worktree de su sesión madre (mismo aislamiento que ella, sin worktree propio). Es un hilo de consulta; si edita archivos, los cambios caen en la rama de la madre.
- **Regla para spawns nuevos**: cualquier spawn de PTY nuevo debe decidir explícitamente si pasa por `ensureSessionWorkspace`/`prepareSessionWorkspace` (aislado) o queda excluido — y documentarlo aquí. No dejarlo implícito. `respawnAfterCliUpdate` (reinicio tras auto-update del CLI) **no** vuelve a llamar a `ensureSessionWorkspace`: reutiliza el `session.gitWorkspace` ya creado, así que sigue en el mismo worktree y la misma rama. El **modo voz** (`main/voice-send-target.js`) **no spawnea ningún PTY propio**: el modo "encargo" escribe en el PTY de la sesión madre (aislado como ella) y el modo "charla" reutiliza `subchat-pty` (excluido a propósito, hereda el `workCwd` de la madre). El helper Swift de voz no es un PTY y no toca el repo. El **botón "Llevar a Terminal"** (`main/terminal-handoff.js`, 2026-08-07) tampoco spawnea PTY: mata el de la sesión y, tras **esperar** el finalize del worktree (`copySessionsHome` incluido — sin eso el resume no encuentra la conversación en el cwd real), abre Terminal.app con `claude --resume`/`codex resume`. Guarda: sin `session.pty` no hay handoff (`claudeSessionId` sobrevive a la muerte del PTY y abriría una conversación vieja).
- **Limitaciones documentadas**: (0) el `add -A` del finalize commitea artefactos que el `.gitignore` NO matchea por usar patrón con barra final — caso real: un symlink `node_modules` creado en el worktree para correr tests acabó commiteado (`node_modules/` solo matchea directorios, no symlinks). Usar patrones sin barra para lo que pueda aparecer como symlink, y nunca symlinkar `node_modules` dentro de un worktree; (1) archivos gitignored creados durante la sesión se pierden al finalizar (`worktree remove --force`; `add -A` respeta el gitignore); (2) sesiones CODEX nacidas en worktree no aparecen en el historial del proyecto (el índice codex bucketiza por cwd del rollout) — mitigado 2026-08-07 con `worktreeSlugFor` (ver `runbook_codex_sesiones.md`); (3) el operador LAN no ve el aviso de conflicto si el socket ya cerró (el dueño del Mac conserva la rama y el `console.warn`).
- Módulos: `main/session-git.js` (lógica git + registro), `main/session-git-map.js` (persistencia). Detalle de diseño: `docs/superpowers/specs/2026-07-24-git-auto-por-sesion-design.md`.

## 2026-08-13 — El worktree nace de HEAD: sincronizar el conocimiento ANTES de crearlo

`prepareSessionWorkspace` gana un paso previo al `git worktree add`: si `CLAUDE.md` o
`kb/` tienen cambios sin commitear, los comitea (`ensureKbCommitted` de `main/kb-git.js`,
acotado a esos dos pathspecs, nunca `-A`, con `--no-verify`).

Motivo: el worktree se crea desde `HEAD`, así que un borrado de fichas que no llegó a un
commit revivía en la sesión siguiente y el agente respondía con conocimiento retirado
(`bugs/bug_kb_conocimiento_zombi_2026_08_13.md`). Es la cara letal de "worktree +
conocimiento sin commitear = experto invisible".

- **Si el commit no es posible → `return null`**: la sesión arranca SIN aislar, en el cwd
  real. Es el mismo fail-open del resto del módulo, pero aquí por una razón distinta y más
  fuerte: un worktree obsoleto sirve datos falsos, mientras que sin aislamiento el agente
  lee el disco tal cual. Se avisa al usuario vía el callback `onDegraded` inyectado en
  `createSessionGit` (main.js lo cablea a `notifyKbNotCommitted`, notificación nativa con
  fallback a diálogo, igual que `notifySessionGitIssue`).
- El resto del working tree (código a medias, ficheros sin trackear) NO se toca nunca.
- `main/ws-server.js` hereda el invariante: usa el mismo objeto `sessionGit` inyectado.
- **Cuidado al verificar esto por CDP**: `pty-start` es idempotente si la ventana ya tiene
  PTY (devuelve el cwd sin volver a pasar por prepare). Para probar el arranque de sesión
  hay que relanzar la app limpia; si no, el A/B mide otra cosa.
