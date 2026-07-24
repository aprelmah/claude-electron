# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-07-24 (verificado contra git y tests)._

## Estado de entrega (verificado)

- Rama de trabajo `audit-fixes-2026-05-24` mergeada a `main` vía **PR #1** (auditoría 2026-05-24 + LAN client + fix modelo Claude).
- Último fix relevante: `cli.claudeModel` configurable (default `opus` 200k) en los 5 spawns claude + headless — evita el gate "Usage credits required" del default 1M.
- App: **v1.3.0**, Electron 32.3.3 LTS, desplegada en `/Applications/POWER-AGENT.app` (deploy 2026-05-29 con el fix del modelo).
- Tests: 427 (421 pass / 0 fail / 6 skip). CI verde en GitHub Actions.
- Working tree limpio tras el merge.

## Próximo paso

- **Git automático por sesión** (decisión 2026-05-26, sin implementar): al spawnear PTY en repo git, crear rama `poweragent/session-<id>`, commit+push al terminar, merge auto sin conflictos. Mayor riesgo real hoy: dos ventanas en el mismo cwd se sobrescriben en silencio.
- **SEC-C3: upgrade de Electron** (breaking, requiere sesión humana). Único CRITICAL de la auditoría sin cerrar.
- UX Telegram: "Hazlo"/"Sí" regenera análisis en vez de ejecutar — falta directiva en el system prompt del run de tareas.
- Firma/notarización Apple (certs expirados) si se distribuye a clientes.

## Notas operativas

- **Node**: CI usa 20.18.0; el Mac tiene Node 24 de sistema (nvm no tiene la 20.18.0 instalada). Los tests pasan con 24, pero `npm install` de deps nativas hacerlo con 20.x si da guerra.
- **Dev/deploy** requieren `osascript` (Claude Code no tiene WindowServer). Ver `CLAUDE.md` → "Protocolo de despliegue".
- **Mac Intel** → usar `dist/mac/POWER-AGENT.app` (x64).
- Reglas duras (WhatsApp, bridge token, Electron 32 APIs, atomic-writes, allowlist `save-app-config`, `--model` obligatorio en spawns claude) en `AGENTS.md`, `CLAUDE.md` y MEMORY.md. No saltárselas.
- Ruta real del proyecto: `~/Desktop/LUISMI/claude-electron`.
