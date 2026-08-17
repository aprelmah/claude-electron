# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-17 tarde (verificado contra git, filesystem y el asar en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`git status -sb` sin ahead/behind; `git ls-remote` contra el remoto real, no el ref cacheado). Working tree limpio salvo la memoria de este cierre.
- Últimos commits: `169bdee docs(memory): ficha del ciclo de vida del bridge de WhatsApp`, `7ea7eb4 merge: fix del arranque persistente del bridge de WhatsApp`, `8b544b9 fix(whatsapp): parar el bridge es de verdad — disable persistente y enable al arrancar`.
- Tests: **1635 pass, 0 fail, 6 skipped** — suite completa en el pre-commit hook de `169bdee`, Node del sistema v24.13.0.
- Deploy: `/Applications/POWER-AGENT.app`, asar del **2026-08-17 17:38** = el código commiteado (verificado por CONTENIDO: `persistDisable` y `exec(['disable'/'enable', serviceTarget])` en `main/whatsapp-bridge-control.js` extraído del asar) y app corriendo con ventana (`--type=renderer`), sin dev viva.
- **Bridge de WhatsApp: APAGADO y deshabilitado** (`launchctl print-disabled` → `com.luismi.whatsapp-bridge => true`, sin proceso). Es el estado que Luismi quiere por defecto.
- Disco: 15 GB libres (49% usado) — holgado, mejor que el apuro del 2026-08-16.

## Última sesión (2026-08-17 tarde — el bridge de WhatsApp ya no arranca solo)

- **El susto**: Luismi llegó y el bridge estaba conectado sin haberlo arrancado. Causa raíz: `~/Library/LaunchAgents/com.luismi.whatsapp-bridge.plist` con `RunAtLoad`+`KeepAlive` (instalado 2026-05-18) + reboot a las 23:45. Ni bug ni la app. **Nunca respondió a nadie**: `autoReply: false`.
- **Decisión de producto de Luismi**: "SIEMPRE PARADO SALVO QUE YO LO PULSE". STOP ahora hace `disable` (persistente, sobrevive al login) y START hace `enable` incondicional; el restart nunca deshabilita.
- Fallo propio corregido a mitad: predije que el fallo con servicio disabled saldría en `bootstrap-failed`. **Medido con un plist dummy**: el `Input/output error` del bootstrap ya se trataba como benigno y el que reventaba era el kickstart. Cambió el diseño — se habilita antes en vez de parsear mensajes de launchd.
- Probado en real por Luismi: START levantó el bridge (17:31, `API en 127.0.0.1:3031`) y STOP lo dejó `disabled`.
- Detalle técnico: `tech/runbook_whatsapp_bridge_ciclo_vida.md` (ficha nueva, en `INDEX.md`; regla resumida en `AGENTS.md` § Regla crítica WhatsApp).

## Próximo paso

- **Escanear un QR contra la EMPAQUETADA** (el dev funcionó; el asar está verificado por contenido, no por uso real del QR).
- **Caso "invitar a cliente" a medias como producto** ("somos tres"): el candidato de diseño es el device-flow con aprobación en el Mac. Decidir y diseñar.
- Opcional, si molesta el ruido: `tryStartWhatsapp` (`main.js`) reintenta el ping a `127.0.0.1:3031` **cada 10 s sin tope** mientras el bridge esté apagado. Inofensivo (localhost), pero con el bridge ahora apagado por defecto es permanente.
- Techo de 4 h del renewal del espejo es fijo: si Luismi consolida el uso de jornada completa, hacerlo configurable.
- Seguridad decidida-no-ejecutada: Cloudflare Access (túnel fijo con dominio + login por email) si POWER-AGENT se usa con clientes reales.
- Arrastrados: Origin-check del WS, poda de exports, session-listing async, flake puerto 16849, **picker/`kb-panel.js` sin cobertura**, LAN/voz remota y worker del grafo empaquetado sin prueba en real.

## Notas operativas

- **El bridge de WhatsApp lo arranca launchd, no la app.** Tres estados INDEPENDIENTES: override store de launchd (¿puede arrancar?), servicio cargado (¿vive ahora?), `autoReply` (¿responde?). Estar vivo ≠ estar respondiendo. `launchctl print-disabled` se lee al revés: **`=> true` es DESHABILITADO**. `bridge.log` no tiene timestamps (usar mtime + `last reboot`).
- **Conocimiento default OFF** (`main/kb-prefs.js`); la barra PERSONALIDAD+CONOCIMIENTO del picker solo en el paso de proyecto. `KB_DEFAULT` en `project-picker.js` espeja `KB_PREFS_DEFAULT` (el picker no puede hacer require).
- **QR espejo: 1 uso / 90 s; renewal solo lo emite el servidor, no encadenable, techo 4 h.** Constantes en `main/lan-session-invites.js` (`MIRROR_QR_*`, `MIRROR_RENEWAL_*`).
- `showShareInternetBar` acepta `qr` (data URL); toda llamada sin él lo oculta.
- **Binario externo que la app spawnee → ruta absoluta vía `main/cli-resolver.js`** (la empaquetada no hereda `/usr/local/bin`).
- La vista Chat de `lan-client.html` NO pinta stream crudo del PTY: "ver el terminal" = vista terminal o `lan-mirror.html`.
- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por asar DESDE el scratchpad **y por PROCESO con ventana** (dev viva retiene el SingletonLock y la empaquetada se suicida en silencio). **Matar la dev a mano antes del deploy**: el script no siempre la mata.
- Un worktree de sesión NO tiene `node_modules`: correr `npm test` ahí da decenas de `MODULE_NOT_FOUND` que no son regresiones. Para una cifra real, `NODE_PATH=<repo real>/node_modules` o correr la suite tras mergear.
