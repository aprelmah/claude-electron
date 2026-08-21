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

## § 2026-08-16 — El espejo se abre con QR (commit b597617)

- Luismi rechazó "token viajando + copia-pega": el 🪞 pinta un **QR** (main/qr-svg.js, qrcode-generator local → data URL SVG a un `<img>` — nunca innerHTML). Pantalla → cámara; el token no toca canales. Enlace de texto como fallback.
- **Invite espejo: 1 uso / 90 s** (`MIRROR_QR_*` en lan-session-invites.js). Quemado al conectar; caducado = 401 en el handshake, ni abre el WS.
- **Renewal**: al conectar, initializeMirrorSession emite un invite de renovación POR EL WS (`mirror-renewal`). Invariantes: solo el servidor lo crea (createSessionInvite público no puede pasar `renewal`), **no encadenable** (un renewal no genera otro), techo absoluto 4 h / 60 usos (`MIRROR_RENEWAL_*`), y solo en modo mirror se rebasa el techo normal de 30 min. lan-mirror.html lo mete en su URL con `replaceState` (reconexiones Y recargas de página sobreviven; el token de 4 h vive solo en el móvil).
- Riesgo de uso diario (explicado, aceptado): robo de móvil desbloqueado = control del Mac hasta el techo de 4 h o "Cortar acceso"; el vector cotidiano es el dedazo (espejo RAW) con el móvil desbloqueado.
- Diseño futuro hablado para el caso CLIENTE: device-flow con aprobación en el Mac (URL limpia + código 6 dígitos + Aprobar/Rechazar). No implementado.

---

## § 2026-08-21 — El techo de 4 h, y el espejo que aprende a decir por qué falla

**Commits:** `a4446f9` (diagnóstico) · `925af4f` (QR que se renueva)

### El incidente que lo destapó

Luismi tuvo el espejo funcionando **unas horas** y se cayó. No pudo reactivarlo: *"aunque leyera el QR o cortara el acceso y volviera a darle a espejo, ya no conectaba"*. El móvil se quedaba **en blanco**, con algo en el chip de estado arriba a la derecha. Su lectura fue "el token no vale si no es sesión nueva".

### El techo de 4 h: cómo funciona de verdad

- El invite **solo se valida en el handshake** del WebSocket. Mientras el WS siga abierto, nadie lo vuelve a mirar: puedes estar 10 horas conectado.
- El renewal caduca **4 h después de escanear el QR** (`MIRROR_RENEWAL_TTL_MS`), no 4 h desde la última actividad. **No es deslizante.**
- **No se re-emite nunca** (`ws-server.js:3253`: `if (session.sessionInvite.renewal !== true)`). Es deliberado: sin cadena, el acceso tiene un techo absoluto.
- Consecuencia operativa, que no estaba escrita: pasadas esas 4 h, **el primer corte es definitivo**. Y en un móvil un corte es cuestión de tiempo (bloqueo de pantalla, cambio de WiFi a datos, Safari suspendiendo la pestaña).

El techo se deja **intacto a propósito**: rebajarlo o hacerlo deslizante es decisión de producto de Luismi, no técnica.

### Lo que se descartó con evidencia (no repetir la búsqueda)

- El `GET` de la página **no** quema el invite: `hasValidSessionInvite` usa `has()`, no `claim()`.
- No hay límite de sesiones concurrentes ni lock aplicable al espejo (el lock es por `(cwd, sessionId)` y el espejo no tiene ninguno de los dos).
- `MIRROR_TARGET_GONE` tiene mensaje y código propios: nunca se disfrazó de "invitación caducada".
- Las URLs públicas persistidas en config estaban **vacías** — el fallback de `main.js:798` no era el culpable.
- `lan-mirror.html` sí está en la whitelist de `build.files`.

**Sigue sin cerrarse** por qué un QR NUEVO tampoco conectaba. Dos sospechosos vivos: (a) los 90 s de ventana del QR, que caducaba en pantalla sin avisar; (b) el túnel — el botón 🪞 exige túnel vivo, y si `lanTunnelStart` responde `ok` un instante antes de que `state === 'running'`, `getPublicClientUrl()` devuelve `''` y el QR sale con **IP LAN** en vez de la pública (inalcanzable desde 4G).

### Diagnóstico en el móvil (`main/mirror-connection-status.js`)

Antes, el cliente pintaba "Invitación caducada" ante cualquier 4403 y "Sin conexión" ante todo lo demás: **tres averías distintas se veían igual**, una pantalla en blanco. Ahora distingue:

| Situación | Qué dice |
|---|---|
| `SESSION_INVITE_INVALID` / 4403 | Invitación caducada, con el porqué: 90 s, 1 uso, techo de 4 h |
| `MIRROR_TARGET_GONE` | El terminal se cerró en el Mac |
| WS nunca abrió + host no responde | **No alcanzo el Mac** — nombra `host:puerto` |
| WS nunca abrió + host responde | **El Mac responde, pero el terminal no** — es el WS, no el token |

Dos decisiones que importan:
- **El código del servidor manda** sobre cualquier heurística: el cliente guarda el `status/error` que llega ANTES del cierre en vez de pisarlo con un mensaje fijo. La inferencia por alcance solo actúa cuando el servidor no llegó a decir nada.
- **Cualquier respuesta HTTP vale como prueba de vida**, incluido un `401` de `/status`. Separa "no llego al host" de "llego pero el WS no pasa" sin necesitar credencial.

### Patrón: un módulo compartido con una página remota, sin abrir superficie

La lógica tenía que ser testeable (la suite corre sin navegador) pero la página remota no puede hacer `require` ni pedir un endpoint nuevo sin auth. Solución: **inyección al servir**. `lan-mirror.html` lleva el marcador `/*__MIRROR_STATUS_MODULE__*/` y `injectMirrorStatusModule()` lo sustituye por el fichero al responder el `GET`. Una sola copia de la lógica, cero rutas nuevas, y si el fichero faltara la página se sirve igual con su fallback (perder el detalle del error no vale una pantalla en blanco).

El módulo lleva guardas en las dos salidas (`module.exports` y `window.X`) para valer en Node y en navegador. **Ojo**: eso lo convierte en un script de ámbito global compartido — ver `bugs/bug_scripts_renderer_ambito_global.md` § 2026-08-21, que es exactamente el fallo que provocó al cablearlo.

### El QR dejaba morir la sesión en pantalla

El QR caduca a los 90 s **sin cambiar de aspecto**: quien lo tenía delante no distinguía uno vivo de uno muerto y escaneaba un código quemado una y otra vez. Ahora se renueva solo con 75 s de margen mientras la banda siga abierta, con cuenta atrás visible, y **se para** al cerrar la banda o cortar el acceso (nunca se generan invitaciones a espaldas de nadie). El cálculo vive en el módulo testeado, no en el renderer.
