# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre.

_Última actualización: 2026-08-09 mediodía (verificado contra git y filesystem en el mismo turno)._

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (0 ahead / 0 behind), working tree **limpio** (salvo este STATE al momento de escribirlo; se commitea en el cierre).
- Último commit: `704da2c feat(runbook): dieta 65KB→12KB — AGENTS.md fuente única, CLAUDE.md symlink` (pusheado).
- Tests: suite en verde en el pre-commit de hoy (0 fail; sin cambios de código en la sesión — referencia 1398/1392/0/6 de anoche).
- Deploy: `/Applications/POWER-AGENT.app` sigue siendo el del **2026-08-08 22:21** (verificado por asar). Hoy no se tocó código de la app.

## Última sesión (2026-08-09 — auditoría mundial del sistema de memoria, 3 niveles ejecutados)

- **El runbook cambió de forma**: `AGENTS.md` es ahora la fuente única (11,6 KB) y `CLAUDE.md` un **symlink** a él; el detalle vive íntegro en `.claude/memory/tech/runbook_*.md` (7 fichas) con mapa en `.claude/memory/INDEX.md`; los 27 handoffs de mayo están en `docs/archive/handoffs/`. Commits `cfe4c2a` + `735797d` + `704da2c`, pusheados.
- **Fuera del repo**: memoria auto respaldada en `aprelmah/claude-auto-memory` con sync horario; registry del bootstrap arreglado (inyecta 00-soul/02-feedback/01-infra); backup NAS reparado (bug `set -e` + pipeline grep; snapshot 2026-08-09 OK, 123 GB); `~/.codex/AGENTS.md` global nuevo; `/wrap` y `wrap-codex` con bucle de aprendizaje y poda; **doctor de memoria** semanal instalado y probado. Detalle: ficha `update_2026_08_09_auditoria_memoria_mundial.md` (memoria auto) e informe en `~/Documents/Memoria_Agentes_Research_20260809/`.

## Próximo paso

- **Probar el arranque nuevo en sesión fresca**: Claude (¿carga bien el symlink CLAUDE.md→AGENTS.md? ¿arranque ~13-15k tokens?) y Codex (¿lee `~/.codex/AGENTS.md` global + runbook del proyecto?).
- Decidir sobre el `trust_level = "trusted"` de Codex en `/` y `/Users/isabel` (hallazgo de seguridad de la auditoría, sin tocar).
- Candidatos a la misma dieta: AGENTS.md de eatBook/vetBook/CATERING; y archivar `ESTADO_TELEGRAM_Y_APP_2026-05-14.md` + `TELEGRAM_SETUP.md` de la raíz.
- Heredados: probar tramo 2 de Telegram del día 8 en vivo; LAN + Cloudflare Tunnel.

## Notas operativas

- **Todo agente nuevo**: leer este STATE → `AGENTS.md` (runbook) → fichas vía `.claude/memory/INDEX.md`. Los handoffs de `docs/archive/` son arqueología: no leerlos por defecto.
- Contrato de capas (en el runbook): STATE se sobrescribe; runbook se poda; fichas se añaden o archivan (jamás resumir); toda ficha nueva se registra en INDEX.md.
- Regla bash con dos víctimas el 2026-08-09: con `set -e`, jamás `[[ cond ]] && acción` como sentencia (mata el script en silencio) — siempre `if/fi`, y `set -Eeuo pipefail` para que el trap ERR loguee en funciones.
- Doctor de memoria: lunes 08:30 (`com.luismi.poweragent.memoria-doctor`) o a mano `bash ~/Library/PowerAgent/automations/memoria-doctor.sh`; avisa por el notify bot solo si algo falla.
