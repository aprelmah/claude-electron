# Túnel de un clic + modo espejo LAN — mapa técnico (2026-08-15 noche, 2ª sesión)

Commits: `4736ec3` (túnel) + `e613228` (espejo). Tests 1604 → 1624/0/6.

## Los 3 casos de uso del acceso remoto (acordados con Luismi)

1. **Operador / enterprise** — config ⚙️, token Bearer, `lan-client.html` completo. Abrir sesiones nuevas en el Mac. Ya existía.
2. **Espejo** (uso personal diario) — TU terminal vivo en el móvil: mismo PTY, misma pantalla. Botón 🌐 → "🪞 Seguir yo". Página propia `lan-mirror.html`.
3. **Invitación a cliente** — copia aislada con contexto: fork con `--resume` en worktree (por eso "no coincide con lo que hablo": es OTRA conversación desde el fork). Botón 🌐 → "👥 Invitar a un cliente". **A medias como producto**: Luismi quiere verla ("somos tres").

## Piezas

- **`main/lan-tunnel.js`** — `createLanTunnelManager({spawnFn, getPorts, urlTimeoutMs, cloudflaredBin})`: dos Quick Tunnels (`cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<10000|9999>`), parseo del banner con rolling buffer (chunks partidos; `api.trycloudflare.com` excluida), `toWssUrl`. Estados stopped/starting/running/error; caída → URLs VACÍAS (jamás un enlace que miente). `tests/lan-tunnel.test.js` (14).
- **main.js** — instancia `lanTunnel` (URLs efímeras mandan sobre config por getter, JAMÁS persistidas); `stopLanServer` y `before-quit` matan el túnel; `getLanServerStatus().tunnel`. Espejo: `lanMirrorTargets` (mirrorId→wcId), `attachLanMirror(mirrorId, {onData,onExit})` → `{write, detach, snapshot, cols, rows, cli, cwd}`; ring de chunks `mirrorChunks` (cap 256 KB, O(1) amortizado) alimentado en el `onData` del PTY del terminal; el `onExit` avisa a los watchers y limpia.
- **`main/ws-server.js`** — opción `attachLocalMirror`; `initializeMirrorSession` (sin resolver config, sin git, sin spawn): facade en `session.ptyProcess` cuyo **`kill()` DESENGANCHA** (`killSessionPty` corre al cerrar el WS y no debe tocar el PTY del host — test lo garantiza con un fake SIN kill). `connected` lleva `mirror:{cols,rows}` y `capabilities.chat.ask:false` (el chat semántico contestaría un headless APARTE del PTY visible). Sirve `/lan-mirror.html` (junto a `lan-client.html`, invite-gated), `buildClientUrl({mirror:true})` cambia el pathname. Mensajes nuevos: `ping`→`pong` (latido) y `mirror:attach` (fichero → `/tmp/poweragent-espejo`, nombre saneado, cap `maxUploadBytes`, ruta al prompt SIN enter). Audio en espejo: transcript saneado + **ENTER en escritura aparte** (150 ms).
- **`main/lan-session-invites.js`** — modo `mirror`: exige `mirrorId` seguro, NO exige cwd/sessionId (no resume nada). Espejo: 30 min / 10 usos (cada reconexión gasta uno). `claim` devuelve `mode`/`mirrorId`.
- **`lan-mirror.html`** — página minimal: xterm a pantalla completa (letra = ancho contenedor / cols del HOST, mín 8; el host manda el tamaño, `resize` del cliente no se envía), teclas TUI (Esc/Tab/⇧Tab/flechas/Ctrl-C), 🎤📷📎. Reconexión: 6 reintentos con backoff + `visibilitychange`; `term.reset()` al reconectar (el server reenvía el snapshot entero); guarda `event.target !== socket` contra sockets viejos; 4403 = invitación caducada. `capture="environment"` en 📷 (sin eso el móvil abre galería); 📎 con `accept="*/*"`.
- **`main/cli-resolver.js`** — `FALLBACK_CLOUDFLARED_BIN` (patrón `resolveCommand`).
- **UI** (`index.html`/`renderer.js`/`styles.css`) — 🌐 en topbar → banda `share-internet-bar` con las dos opciones; `shareSessionViaInternet(mode)` hace TODO (servidor si falta → túnel si falta → invitación → copia + enlace visible); "Cortar acceso"; el grupo LAN de ⚙️ conserva su botón (modo copia).

## Bugs cazados probando en real (el orden importa)

1. **`cloudflared no está instalado` solo en la empaquetada** — Finder no hereda el PATH del shell; en dev (npm start) funcionaba. Regla: binarios externos SIEMPRE por cli-resolver con candidatos absolutos.
2. **"Del espejo nada"** — el espejo conectaba y streameaba, pero `lan-client.html` arranca en vista **Chat**, que no pinta stream crudo (con chat semántico disponible ni captura). Media solución: forzar vista terminal; solución real: página dedicada. Lección: si la vista no enseña lo que el usuario espera, para él "no funciona".
3. **Cortes** — invitación de 10 min/3 usos + sin reconexión + túneles que matan WS ociosos. Fix: 30 min/10 usos + reintentos + ping/pong 30 s.

## Seguridad (explicada a Luismi, aceptada)

- Transporte cifrado (WSS por Cloudflare; Cloudflare VE el tráfico — TLS termina en su borde).
- El enlace espejo vivo = control del terminal (bypassPermissions) → higiene: canal privado + "Cortar acceso" al terminar. Sin vínculo a dispositivo.
- Paso serio futuro (decidido, no ejecutado): Cloudflare Access — túnel fijo con dominio propio + login por email delante de todo.
- El espejo NO consume Claude extra (misma sesión); la copia de cliente SÍ (sesión propia). Whisper local = audio gratis.
