# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-13 tarde (verificado contra git, filesystem y app real por CDP).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`git status -sb` sin ahead/behind tras el push). Working tree con los cambios de memoria de este wrap pendientes de commitear.
- Últimos commits: `6563cc2 fix(kb): el panel avisa cuando git no registra un cambio, en vez de callar` sobre `7da86fe fix(kb): el conocimiento retirado no puede resucitar en la sesión siguiente`, sobre `363ee7c` (wrap del picker de personalidad).
- Tests: **1475 pass, 0 fail, 6 skipped** — suite completa, pre-commit hook, Node del sistema v24.13.0. (+16 tests nuevos esta sesión.)
- Deploy: `/Applications/POWER-AGENT.app`, asar del 2026-08-13 10:17:20 verificado por CONTENIDO (`main/kb-git.js` con `ensureKbCommitted`/`hasPendingKbChanges`, `main/session-git.js` con la sincronización previa al worktree, `kb-panel.js` con `reportKbResult`). App abierta por el propio `deploy.sh`.
- `turbo e`: `fada081` (el borrado del 11-ago, por fin en HEAD), pusheado, working tree limpio.

## Última sesión (2026-08-13 tarde — bug crítico: el conocimiento borrado resucitaba)

- Síntoma reportado por Luismi: fichas y casos borrados desde el panel 📚 volvían a estar precargados en la sesión siguiente. En un asistente SAT para instaladores eléctricos = instrucciones erróneas sobre instalaciones reales.
- **Diagnóstico con evidencia** (transcript `58df801f` de turbo e): el borrado del 11-ago NO pasó por el panel — lo hizo un agente de sesión con `rm -f kb/fichas/*.md` (16:55:30) + `Edit` del CLAUDE.md (16:55:45), al segundo con los mtimes. El placeholder que quedó en el CLAUDE.md no existe en el código de la app.
- **Causa raíz**: el worktree de sesión nace de `HEAD`, así que un borrado sin commitear es inmortal.
- **Fix en el punto único**: `prepareSessionWorkspace` sincroniza `CLAUDE.md`+`kb/` antes del `worktree add`; si no puede, no aísla y avisa. Más `--no-verify` en `commitKbChanges` y `commitWarning` propagado en las 7 rutas del panel.
- Verificado en la app real por CDP con un repo que replica el caso: worktree sin la ficha zombi, `codigo.js` a medias intacto, degradación + avisos con `index.lock` puesto.
- Fichas: `bugs/bug_kb_conocimiento_zombi_2026_08_13.md` (completa), delta en `tech/runbook_kb_conocimiento.md` y `tech/runbook_git_por_sesion.md`, línea reescrita en `AGENTS.md`.

## Próximo paso

- Luismi no ha probado aún en la app desplegada; la verificación es mía (CDP en dev + asar por contenido).
- **Límite conocido, no arreglado**: una sesión YA abierta en worktree no ve un borrado posterior. El fix cubre la sesión siguiente, que es el síntoma reportado. Sincronizar el worktree en caliente es decisión pendiente.
- Renderer sin cobertura automática (`kb-panel.js` solo verificado por CDP; la suite es solo de `main/`).
- Arrastrados: commit `9bbb40f` en `turbo-e` con autor "ISABEL" en vez de "Luismi"; flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga; `scripts/kb-add-case.js` no construido (decisión documentada).

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Antes de `npm run deploy`, matar cualquier proceso dev con `--remote-debugging-port` abierto — si no, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir.
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0) sin necesitar `nvm use 20.18.0`.
- "Comitea y despliega" en este proyecto **incluye push** a `origin/main` (confirmado el 2026-08-11 y de nuevo el 2026-08-13; también para el repo del proyecto piloto cuando se toca).
- Verificar cambios de arranque de sesión por CDP exige **relanzar la app limpia**: `pty-start` es idempotente si la ventana ya tiene PTY y el A/B mide otra cosa.
- El explorador de archivos rechaza rutas fuera de `allowedFsRoots()` (`main.js:511`): `~/.claude`, `~/.codex`, `userData`, `/tmp/claude-electron` y los cwd de sesiones VIVAS. "Path not allowed" al pilotar por CDP suele ser eso, no un bug.
- Panel de Conocimiento: arquitectura y reglas duras completas en `.claude/memory/tech/runbook_kb_conocimiento.md` (última sección: 2026-08-13, el invariante).
