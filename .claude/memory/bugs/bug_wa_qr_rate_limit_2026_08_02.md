# Bug: modal QR "No hay QR activo" por rate limit del bridge (2026-08-02)

## Síntoma
Modal "Vincular WhatsApp" decía "No hay QR activo ahora. Pulsa STOP y START…" en bucle. WhatsApp deslogueado (log: `Sesión cerrada. Re-escanea QR.`) y no había forma de ver el QR.

## Causa raíz (doble)
1. **Rate limiter del bridge saturado por la propia app**: `/status` tenía el límite default 60/min, pero lo consultan a la vez el poll del cliente (12/min), el panel (4/min por ventana), el widget de salud y el modal QR (30/min con el modal abierto). Resultado: 429 en bucle → la app quedaba ciega → el modal no podía ni ver el estado. El `bridge.log` estaba lleno de `[bridge-rate] 429 on /status (60/60)`.
2. Tras logout el bridge queda `disconnected` y NO regenera QR solo: hace falta reiniciar el proceso.

## Fix
1. **Bridge** (`~/.claude/whatsapp-bridge/index.js`, FUERA de git, backup `index.js.bak.20260802-reset`): `rulesPerMinute` ahora incluye `'/status': 600, '/qr': 600`.
2. **Panel** (`whatsapp/whatsapp-panel.js`): el botón **Reintentar** del modal QR ahora reinicia el bridge de verdad (`retryQrModal()` → `wa.bridgeControl('restart')`) cuando el estado es `none`/`error`; si está `pending`/`connected` solo re-consulta. Nuevas vars `qrLastState` y `qrRestartBusy`; `refreshQrModal` trackea el estado y no pisa el texto durante el restart.

## Segundo bug encontrado al probar: el QR nunca fue escaneable en el modal
El modal pintaba el **string crudo** del QR (una línea de base64), no bloques. Causa triple, de origen (mayo):
1. El bridge solo renderizaba el ASCII hacia stdout/log (`qrcode.generate(qr, {small:true})` sin callback); `GET /qr` devolvía `lastQR` crudo. El comentario del panel ("el backend devuelve string ya en formato bloques") siempre fue falso.
2. Fix: el bridge cachea `lastQRAscii` (callback de qrcode-terminal, y lo sigue logueando a mano) y `/qr` devuelve `{status, qr, qrAscii}`; `getQr()` del cliente y el panel prefieren `qrAscii` (fallback honesto si bridge antiguo).
3. **CSS invertía los colores**: `.wa-qr-render` era fondo blanco/texto negro, pero qrcode-terminal pinta los módulos CLAROS como bloques (diseñado para terminal oscuro) → QR invertido, el móvil no lo lee. Ahora fondo `#000` + texto `#fff` (réplica del terminal), 7px.

## Reset a 0 pedido por Luismi (mismo día)
`state.json` (conversaciones), `media/` (669 MB), `.baileys_auth/` (credenciales → fuerza QR nuevo) y `bridge.log` movidos a `~/.claude/whatsapp-bridge/backup-reset-20260802/`. Borrar ese backup cuando Luismi confirme que todo va bien.

## Decisión de producto (2026-08-02, Luismi)
El fail-open de `authorizedNumbers` vacío (= auto-reply responde a cualquiera) queda **aceptado conscientemente "de momento"**. Cierra la ambigüedad que dejó la auditoría de junio: no es un olvido, es decisión. Revisar si el bot pasa a uso serio.

## Humanización anti-detección (2026-08-02, pedida por Luismi)
Antes: CERO medidas (respuesta instantánea tras la inferencia, sin typing, sin read receipts, dispositivo "en línea" 24/7 por `markOnlineOnConnect` default de Baileys).
Ahora, en el bridge (`index.js`, backup `index.js.bak.20260802-humanize`):
- `markOnlineOnConnect: false` en makeWASocket.
- `/send/text` acepta `humanize: true` → secuencia: retardo de lectura 0,8–2,5s + `readMessages` del último entrante (check azul) → `available` + `composing` durante ~35–70ms/carácter con jitter (mín 2s, tope 9s) → `paused` + 0,3–0,9s → send → `unavailable`.
- Solo las respuestas automáticas lo llevan (`whatsapp-client.js` `sendText`: `if (internal) payload.humanize = true`); los envíos manuales del panel son Luismi real y van sin humanizar.
Riesgo residual asumido: Baileys es cliente NO oficial (contra ToS de WhatsApp); esto reduce señales, no elimina el riesgo. Lo que más protege: el bot SOLO responde a entrantes, nunca hace outreach frío.

## Ventana de agrupación de mensajes (2026-08-02, OK de Luismi)
Antes cada mensaje entrante disparaba SU turno de claude → 4 líneas seguidas = 4 respuestas parciales (las primeras sin ver las líneas siguientes) + un off-by-one en el historial (`slice(0,-1)` quitaba el último del array, no el que se respondía).
Ahora (`whatsapp-client.js`): `AGGREGATE_SILENCE_MS = 11s` — los mensajes de un remitente se acumulan en `pendingByJid` y el timer se reinicia con cada uno; al callarse, `flushPending` encola UN turno con todo el bloque (cada mensaje una línea; audios transcritos en orden). El historial del prompt excluye el bloque por id, no por posición. El cap `MAX_QUEUE_PER_JID` vive ahora en `flushPending`. `stop()` limpia los timers pendientes.
Semántica conservada: epoch de invalidación, escalada por media (descarta el batch al pasar a manual vía `canAutoReplyNow`), serialización por JID y semáforo global.

## Reglas duras derivadas
- Cualquier endpoint del bridge consultado por polling multi-fuente necesita límite propio en `rulesPerMinute` — el default 60/min se queda corto en cuanto hay 2+ consumidores.
- El bridge externo NO está en git: todo cambio ahí va con backup `.bak.<fecha>` y hay que replicar la lógica compartida en `whatsapp/whatsapp-auth.js` si se toca auth (gemelos manuales).
- Tras logout de WhatsApp, el flujo de recuperación es: reiniciar bridge → estado `qr` → escanear. El botón Reintentar ya lo hace solo.

## Verificación
Tests 579 (573 pass / 0 fail / 6 skip). Bridge en estado `qr` con QR activo, 0 líneas `bridge-rate` en el log nuevo con la app desplegada corriendo. Deploy 2026-08-02 ~11:00.
