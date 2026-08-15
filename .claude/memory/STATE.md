# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-16 madrugada (verificado contra git, filesystem y el asar en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (commit `b597617` pusheado esta sesión). Working tree limpio salvo la memoria de este cierre.
- Último commit: `b597617 feat(lan): espejo por QR — invite de 1 uso/90 s y renovación por el WS con techo de 4 h`.
- Tests: **1630 pass, 0 fail, 6 skipped** (1636 totales; +6 sobre la sesión anterior) — suite completa en el pre-commit hook, Node del sistema v24.13.0.
- Deploy: `/Applications/POWER-AGENT.app`, asar del **2026-08-16 00:13** = el código commiteado (verificado por contenido: `qr-svg.js`, `mirror-renewal` en `lan-mirror.html` y `MIRROR_RENEWAL_TTL_MS` en `ws-server.js`) y app corriendo con ventana. La dev sobrevivió al kill del deploy y hubo que matarla a mano — la regla "verificar por PROCESO" volvió a cazar el suicidio silencioso.
- Dependencia nueva: `qrcode-generator` (MIT, cero deps, local — va al asar por `node_modules/**/*`).

## Última sesión (2026-08-16 madrugada — el espejo se abre con QR, no con un enlace)

- Luismi rechazó el modelo "token viajando por canales + copia-pega". Para el espejo, **QR en pantalla**: el token va de la pantalla del Mac a la cámara del móvil, sin tocar portapapeles ni mensajería.
- **Invite espejo: 1 uso / 90 s** (antes 30 min / 10). Quemado al conectar; caducado ni abre el WS (401 en handshake).
- **Renewal por el propio WS**: al conectar, el servidor emite un token de renovación — techo absoluto **4 h / 60 usos**, **no encadenable** (un renewal jamás genera otro), solo espejo puede rebasar el techo de 30 min, y **solo el servidor lo crea** (la superficie pública `createSessionInvite` no puede). El móvil lo mete en su URL con `replaceState` → reconexiones y recargas sobreviven.
- QR generado en main (`main/qr-svg.js` → data URL SVG a un `<img>`, nunca innerHTML); enlace de texto sigue debajo como fallback y se copia al portapapeles.
- **Probado en vivo por Luismi en dev: funciona** (QR escaneado, conexión). +6 tests (renewal, constantes, QR determinista, ciclo QR quemado → reconexión por renewal en WS real).
- Diseño hablado NO implementado: **aprobación en el Mac tipo device-flow** (URL limpia sin secreto + código 6 dígitos + Aprobar/Rechazar en el Mac) para el caso cliente — a Luismi le convenció, "ya lo veremos".
- Detalle técnico: `tech/tech_lan_tunel_espejo_2026_08_15.md` (§ 2026-08-16).

## Próximo paso

- **Escanear un QR contra la EMPAQUETADA** (el dev funcionó; el asar está verificado por contenido, no por uso real del QR).
- **Caso "invitar a cliente" a medias como producto** ("somos tres"): el candidato de diseño es el device-flow con aprobación en el Mac. Decidir y diseñar.
- Techo de 4 h del renewal es fijo: si Luismi consolida el uso de jornada completa, hacerlo configurable.
- Seguridad decidida-no-ejecutada: Cloudflare Access (túnel fijo con dominio + login por email) si POWER-AGENT se usa con clientes reales.
- Arrastrados: Origin-check del WS, poda de exports, session-listing async, flake puerto 16849, picker/`kb-panel.js` sin cobertura, LAN/voz remota y worker del grafo empaquetado sin prueba en real.

## Notas operativas

- **QR espejo: 1 uso / 90 s; renewal solo lo emite el servidor, no encadenable, techo 4 h.** Constantes en `main/lan-session-invites.js` (`MIRROR_QR_*`, `MIRROR_RENEWAL_*`).
- Riesgo del uso diario del espejo explicado a Luismi: acotado por el techo de 4 h + "Cortar acceso"; el vector real es el dedazo (el espejo escribe RAW) con el móvil desbloqueado.
- `showShareInternetBar` acepta `qr` (data URL); toda llamada sin él lo oculta.
- **Binario externo que la app spawnee → ruta absoluta vía `main/cli-resolver.js`** (la empaquetada no hereda `/usr/local/bin`).
- La vista Chat de `lan-client.html` NO pinta stream crudo del PTY: "ver el terminal" = vista terminal o `lan-mirror.html`.
- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por asar DESDE el scratchpad **y por PROCESO con ventana** (dev viva retiene el SingletonLock y la empaquetada se suicida en silencio — pasó de nuevo 2026-08-16).
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0). "Comitea y despliega" **incluye push**.
- Campo de config nuevo del renderer → allowlist `SAFE_*`. Fichero nuevo en la RAÍZ → `build.files` (whitelist).
- **Ningún enlace público lleva credencial persistente; solo invites.** Enmascarar antes de imprimir.
- El grafo corre en worker (`computeProjectGraphAsync`); jamás el síncrono desde main. El clasificador bloquea escribir `claude-novak.config.json` (token lo rota Luismi con la app cerrada).
- "Copiar invitación de la sesión actual" exige sesión que ya haya hablado; el ESPEJO no lo exige (engancha, no resume). Si una copia falla, el portapapeles conserva lo anterior.
- El explorador rechaza rutas fuera de `allowedFsRoots()` (`main.js:511`). Conocimiento: `tech/runbook_kb_conocimiento.md`.
