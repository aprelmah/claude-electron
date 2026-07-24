# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-07-24 (verificado contra git y tests en el cierre)._

## Estado de entrega (verificado)

- `main` al día: PR #1 (auditoría + LAN + fix modelo Claude) mergeado (`b18019b`), CI verde, rama de auditoría borrada.
- Rama activa: **`feat/git-auto-por-sesion`** — 16 commits sobre main, HEAD `d27585e`, working tree limpio, **SIN PUSH** (sin upstream; Luismi debe dar OK).
- Feature "git automático por sesión" COMPLETA en esa rama: review final multi-agente → **Ready to merge** (2 críticos cazados y arreglados: finalize con hooks destruía trabajo; resume LAN roto).
- Tests: **482 (476 pass / 0 fail / 6 skip pre-existentes)**, 3 pasadas estables.
- Deploy: `/Applications/POWER-AGENT.app` NO lleva la feature (deploy pendiente tras merge).

## Última sesión (2026-07-24)

- Cierre de pendientes de mayo: commit fix 1M credits (`ee38f08`), merge PR #1, rama auditoría borrada.
- Feature git-por-sesión: spec `docs/superpowers/specs/2026-07-24-git-auto-por-sesion-design.md`, plan `docs/superpowers/plans/2026-07-24-git-auto-por-sesion.md`, 9 tasks con subagentes + revisiones + fix waves. Ledger: `.superpowers/sdd/progress.md` (incluye follow-ups no bloqueantes).
- Decisiones de producto (Luismi): worktree SIEMPRE; commit+merge+PUSH al cerrar (excepción reconfirmada a la regla global de no-push); alcance local+LAN.
- Módulos nuevos: `main/session-git.js`, `main/session-git-map.js`. Config: `cli.gitSessionIsolation` (default ON).

## Próximo paso

1. **Prueba manual de Luismi**: modo dev, 2 ventanas sobre este mismo repo, editar el mismo archivo, cerrar ambas → una mergea limpia, la otra deja rama `poweragent/session-*` + notificación. Verificar `git worktree list` y `userData/worktrees/` vacío al final.
2. Con su OK: **push de `feat/git-auto-por-sesion` + PR a main** → merge → `npm run deploy`.
3. Decisión producto v2: sesiones Codex en worktree (hoy no salen del historial del proyecto — limitación documentada; ¿remapear índice codex o excluir codex del aislamiento?).
4. SEC-C3 (upgrade Electron) sigue pendiente, sesión humana.

## Notas operativas

- Reglas nuevas de la feature: en `CLAUDE.md` del repo, sección "Git automático por sesión" (spawns nuevos DEBEN decidir si pasan por `ensureSessionWorkspace`; `session.cwd` siempre path real; finalize `--no-verify`, serializado por realCwd, nunca borra worktree sin commit constatado).
- Limitaciones v1 documentadas (CLAUDE.md + spec): gitignored de sesión se pierden; historial Codex de worktrees; aviso de conflicto no visible para operador LAN.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan igual).
