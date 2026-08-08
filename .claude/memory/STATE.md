# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre.

_Última actualización: 2026-08-08 noche, 2º tramo (verificado contra git y filesystem en el mismo turno)._

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (0 ahead / 0 behind) y working tree **limpio**.
- Último commit: `77833cb feat(telegram): el botón ➕ arma el siguiente mensaje como nombre de proyecto` (pusheado).
- Tests: `1398` totales, `1392` pass, `0` fail, `6` skip.
- Deploy: `/Applications/POWER-AGENT.app` **redeployado el 2026-08-08 a las 22:21**, verificado por CONTENIDO del asar (`PROJECT_NAME_ARM_TTL_MS` dentro). La app está abierta.
- Acceso exterior LAN: sin cambios desde el 2026-08-07. No activo, `cloudflared` sin instalar.

## Sesión 2026-08-08 noche — Telegram al mando y badge de modelo

Cinco commits (`21911e3..77833cb`), en dos tramos:

- **Tramo 1 (`21911e3`) — PROBADO EN VIVO por Luismi, OK:**
  - **Fuera la compactación de 20 turnos** (Telegram/LAN): tiraba el sessionId con >30 turnos y huérfanaba la conversación real — la CLI solo enseñaba 20 turnos. El headless resume SIEMPRE la sesión real. No reintroducir.
  - **Badge de modelo en la tira de sesión** (`main/session-model-reader.js`): claude del transcript, codex del rollout (localizado por la fecha del UUIDv7 ±1 día). Cola de 64KB + caché por stat. Se pinta, jamás se persiste.
  - **`/tareas` y `/autos`** en Telegram (+ botones en `/menu`): lanzar YA tareas programadas y automatizaciones. Pre-chequeo antes de confirmar; resultado por los sinks de siempre.
- **Tramo 2 (`8fa6b5c` + `77833cb`) — desplegado 22:21, SIN probar por Luismi:**
  - El badge lee también el **`/model` del TUI** (no genera turno; se quedaba con el modelo viejo — pantallazo de Luismi). Gana la señal más reciente: turno assistant o `<local-command-stdout>Set model to X`.
  - **`/nuevoproyecto <nombre>`**: carpeta bajo `~/Desktop/LUISMI/`, elegida para el chat. Nombre por allowlist estricta (`sanitizeNewProjectName` en `main/session-helpers.js`).
  - **El botón ➕ del picker ARMA el chat**: el siguiente mensaje de texto es el nombre (bug de UX cazado por Luismi: el nombre a secas viajaba como prompt al CLI). TTL 5 min, cualquier comando desarma, caducado sigue camino normal.
- Además: **CLAUDE.md GLOBAL (`~/claude-shared/CLAUDE.md`, symlink desde `~/.claude/`) recortado de 61.9k a 14.2k chars** — lo de POWER-AGENT vive SOLO en el runbook de este repo.

## Próximo paso

- **Probar el tramo 2**: `/model` en la CLI → badge cambia sin escribir; `/proyecto` → ➕ → nombre a secas → carpeta creada y elegida.
- Heredados: probar acceso LAN + Cloudflare Tunnel; umbrales del endpointer (razonados, no medidos); `resolveSessionIdForRelay` aún adivina para Telegram (deuda consciente).

## Notas operativas

- **Patrón nuevo del bridge**: estado "armado" en `pendingPickers` (type `project-name`) para pedir texto libre tras un botón inline — TTL + desarme por comando. Reutilizable para cualquier flujo botón→texto.
- Badge de modelo en codex: depende de que el rollout esté en el día UUIDv7 ±1 (zona horaria). Si el badge sale vacío con sesión codex vieja, empezar por ahí.
- Verificar deploys por CONTENIDO del asar (extraer desde scratchpad — `npx asar extract-file` escribe al cwd y una vez pisó `main.js` del repo).
- La pausa de voz (4,5 s) y los umbrales del endpointer viven en config/`voice-endpointer.js` — sin cambios este tramo.
- Reglas duras heredadas: WhatsApp siempre con `X-Auth-Token` y prefijo internacional; state crítico mediante `main/atomic-writes.js`; `package.json` `build.files` es whitelist para `.js` nuevos en raíz.
