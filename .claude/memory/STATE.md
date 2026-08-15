# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-15 noche, 2ª sesión (verificado contra git, filesystem y el asar en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`git status -sb` limpio; 2 commits `4736ec3` + `e613228` pusheados esta sesión). Working tree limpio salvo la memoria de este cierre.
- Último commit: `e613228 feat(lan): modo espejo — tu terminal vivo en el móvil, con botón 🌐 en sesión`.
- Tests: **1624 pass, 0 fail, 6 skipped** (1630 totales; +20 sobre la sesión anterior) — suite completa en el pre-commit hook de ambos commits, Node del sistema v24.13.0.
- Deploy: `/Applications/POWER-AGENT.app`, asar del **2026-08-15 22:57** = el código commiteado (verificado por contenido: `lan-mirror.html` con reconexión dentro) y app corriendo con ventana, sin dev viva.
- Túnel: apagado al cierre (se enciende por botón; nada persiste).

## Última sesión (2026-08-15 noche 2ª — túnel de un clic + modo espejo)

- **Salir a internet con un clic** (`4736ec3`): `main/lan-tunnel.js` levanta dos Quick Tunnels cloudflared (cliente 10000 + WS 9999), URLs efímeras que mandan por getter y JAMÁS se persisten; muere con el servidor, con "Cortar acceso" o al salir. 14 tests con spawn inyectable. Bug real: la app EMPAQUETADA no hereda el PATH del shell → `cloudflared` a pelo daba ENOENT; fix `FALLBACK_CLOUDFLARED_BIN` en `main/cli-resolver.js`.
- **Modo espejo** (`e613228`): el botón 🌐 de la topbar ofrece "🪞 Seguir yo (espejo)" vs "👥 Invitar a un cliente (copia)". El espejo engancha al PTY VIVO (`attachLanMirror` en main: registry mirrorId→wcId + ring de chunks O(1) para snapshot + watchers; `initializeMirrorSession` en ws-server con facade cuyo `kill()` DESENGANCHA — jamás mata el PTY del host, con test). Invitación espejo sin cwd/sessionId, 30 min / 10 aperturas.
- **Página dedicada `lan-mirror.html`** (spec de Luismi: "solo el espejo + audios, fotos y archivos, lo más claro posible"): xterm a pantalla completa con letra ajustada al ancho del host, teclas TUI, 🎤 (Whisper local, ENTER en escritura APARTE), 📷 con `capture="environment"`, 📎 → fichero a `/tmp/poweragent-espejo` + ruta al prompt SIN enter. Reconexión automática (6 reintentos + visibilitychange) y latido `ping`/`pong` cada 30 s. Chat semántico APAGADO en espejo (contestaría un headless aparte).
- Bugs cazados probando en real: "del espejo nada" = el cliente enterprise arranca en vista **Chat**, que no pinta stream crudo; 📷 abría galería sin `capture`; cortes por invitación corta sin reconexión.
- Mapa de producto acordado: 3 casos — operador/enterprise (config) · espejo (uso personal) · invitación a cliente (copia con `--resume` = fork). Verificado en código que la invitación clásica FORKEA, no espeja.
- Detalle técnico completo: `tech/tech_lan_tunel_espejo_2026_08_15.md`.

## Próximo paso

- **Prueba en vivo pendiente de la última tanda**: 📷 cámara directa, reconexión tras corte y latido (desplegado 22:57, Luismi no confirmó aún).
- **Caso "invitar a cliente" a medias como producto**: sigue siendo copia aislada SIN visibilidad para Luismi ("somos tres" — él quiere ver/participar en la conversación del cliente). Decidir y diseñar.
- Seguridad decidida-no-ejecutada: Cloudflare Access (túnel fijo con dominio + login por email) si POWER-AGENT se usa con clientes reales. Hoy: enlace espejo vivo = control del Mac (bypassPermissions); higiene = canal privado + "Cortar acceso".
- Arrastrados de la sesión anterior: Origin-check del WS, poda de exports, session-listing async, flake puerto 16849, picker/`kb-panel.js` sin cobertura, LAN/voz remota y worker del grafo empaquetado sin prueba en real.

## Notas operativas

- **Binario externo que la app spawnee → ruta absoluta vía `main/cli-resolver.js`**: la app empaquetada (Finder) no hereda `/usr/local/bin` y el ENOENT solo aparece en la empaquetada, nunca en dev.
- **El espejo escribe RAW al PTY** (es un terminal remoto del propio Luismi; sanear rompería las teclas de control). La puerta es la invitación temporal. Los transcripts de audio SÍ pasan `sanitizeChannelText`, y en espejo el ENTER va en escritura aparte.
- La vista Chat de `lan-client.html` NO pinta stream crudo del PTY: cualquier flujo que dependa de "ver el terminal" va a la vista terminal o a página propia (`lan-mirror.html`).
- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por asar DESDE el scratchpad **y por PROCESO con ventana** (dev viva retiene el SingletonLock y la empaquetada se suicida en silencio).
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0). "Comitea y despliega" **incluye push**.
- Campo de config nuevo del renderer → allowlist `SAFE_*`. Fichero nuevo en la RAÍZ → `build.files` (whitelist; `lan-mirror.html` ya está).
- **Ningún enlace público lleva credencial persistente; solo invites.** Enmascarar antes de imprimir.
- El grafo corre en worker (`computeProjectGraphAsync`); jamás el síncrono desde main. El clasificador bloquea escribir `claude-novak.config.json` (token lo rota Luismi con la app cerrada).
- "Copiar invitación de la sesión actual" exige sesión que ya haya hablado; el ESPEJO no lo exige (engancha, no resume). Si una copia falla, el portapapeles conserva lo anterior.
- El explorador rechaza rutas fuera de `allowedFsRoots()` (`main.js:511`). Conocimiento: `tech/runbook_kb_conocimiento.md`.
