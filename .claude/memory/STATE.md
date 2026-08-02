# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-02, tarde/noche (verificado contra git, los tests y la app desplegada)._

## Estado de entrega (verificado)

- Rama activa: **`main`**. HEAD **`5194944`** — **ahead 1 de `origin/main`, sin push todavía** (Luismi no lo ha pedido para este último commit).
- Working tree limpio (STATE.md aparte, en curso de este cierre).
- Tests: **612 (606 pass / 0 fail / 6 skip pre-existentes)**. 2 suites nuevas de la tarde: `whatsapp-kb.test.js`, `whatsapp-bridge-retry.test.js`.
- Deploy: `/Applications/POWER-AGENT.app` build de **2026-08-02 22:04**, corriendo (ventana principal + ventana WhatsApp, bridge Baileys activo). 9 despliegues a lo largo de la sesión, todos con tests en verde.
- Bridge WhatsApp (`~/.claude/whatsapp-bridge/`, **fuera de git**): sano, `com.luismi.whatsapp-bridge` corriendo por launchd. Backups de hoy: `index.js.bak.20260802-{reset,qr-ascii,humanize,speedup}`.
- Electron 43.2.0, CLI codex 0.145.0 / claude 2.1.220 (sin cambios hoy).

## Última sesión (2026-08-02, tarde/noche) — WhatsApp: QR, KB con edición en la app, anti-detección

Arrancó con mapeo completo del subsistema WhatsApp (4 agentes en paralelo). Detalle completo en:
`.claude/memory/bugs/bug_wa_qr_rate_limit_2026_08_02.md`, `.claude/memory/bugs/bug_wa_sendtext_reconexion_2026_08_02.md`, `.claude/memory/decisions/kb_whatsapp_2026_08_02.md`, `.claude/memory/decisions/kb_fichas_ejemplo_turbo_2026_08_02.md`.

### Bugs cerrados
- **QR nunca fue escaneable** (desde mayo): `/qr` devolvía el payload crudo, no el ASCII. Fix + rate limit de `/status` subido (60→600/min, saturaba la app en bucle) + botón Reintentar del modal ahora reinicia el bridge de verdad.
- **Reset a 0** pedido por Luismi: conversaciones/media/credenciales a `backup-reset-20260802/` (sin borrar, backup vivo, pendiente confirmación para eliminarlo).
- **Envío automático perdido en ventana de reconexión del bridge**: un mensaje real (Noa) cayó justo cuando el bridge reconectaba solo, `/send/text` dio 503 sin reintento → cliente sin respuesta. Fix: `bridgeFetchWithRetry`, solo para envíos automáticos del bot (los manuales de Luismi no reintentan, para feedback inmediato).
- **Panel de conversación**: horas mal leídas (epoch en segundos tratado como ms → "21/1/1970"), colisión de clases CSS burbuja/contenido (huecos gigantes en citas, stickers cortados). Rediseño completo con colores por participante en grupos.

### Feature nueva — Base de Conocimiento (KB) de WhatsApp
Pipeline: selector (haiku) sobre el índice de fichas → respuesta anclada SOLO a las fichas elegidas (sonnet) → verificación por código del marcador `[KB:id]` → sin marcador válido, se descarta y escala al humano (mensaje honesto + chat a MANUAL). Fichas con varias soluciones numeradas, guiadas una a una usando el historial (nunca repite una ya descartada). "Ficha activa" por chat (TTL 30 min) evita re-clasificar cada turno.

Tipo de selector `vago` añadido en caliente (feedback de Luismi con caso real de Noa: "tengo un problema con mi batería" es vago pero será el caso MÁS común): una pregunta de aclaración antes de escalar, tope 1 intento (TTL 30 min), con historial de contexto en el selector.

Editor completo en la app: Configuración WhatsApp → pestaña **Fichas** (listar/crear/editar/borrar), IPC validado siempre en main (`whatsapp:kb-list/get/save/delete`). 3 fichas de ejemplo sembradas con contenido técnico real (baterías/inversores Turbo Energy, de `~/Desktop/turbo e/`) — **son de prueba, sin validar por Luismi como texto definitivo**.

### Anti-detección (pedido explícito por Luismi)
Humanización en el bridge (fuera de git): read receipt + "escribiendo" con jitter antes de enviar, `markOnlineOnConnect:false` (no queda en línea 24/7). Ajustado dos veces por velocidad (recortado a la mitad) y una vez por naturalidad: la ventana de agrupación de mensajes en ráfaga era un valor FIJO — el único patrón sin jitter de todo el pipeline — ahora sortea 4-8s en cada ráfaga.

## Próximo paso

1. **Decidir push** de `5194944` a origin — Luismi no lo ha pedido aún para este commit.
2. **Decidir las 3 fichas de ejemplo de Turbo Energy**: revisarlas/validarlas o borrarlas antes de que un cliente real las reciba (auto-reply sigue activo, allowlist vacía = responde a cualquiera).
3. **Decisión de producto pendiente**: ¿el bot debe reconocer un cierre de conversación ("gracias", "ok") y callar, en vez de disparar el pipeline completo cada vez?
4. **Reforzar la regla de prefijo internacional** en el camino IPC de la app (`numberToJid`) — hoy solo vive en `scripts/whatsapp-send-safe.sh`, detectado pero no tocado.
5. **Responder a mano** el mensaje de Noa ("tengo un problema con mi bateria") que quedó sin respuesta real en el historial del incidente de reconexión.
6. Borrar `~/.claude/whatsapp-bridge/backup-reset-20260802/` cuando Luismi confirme que todo va bien unos días.
7. Heredado de la mañana, sin tocar hoy: detección de fork en pool de PTYs ocultos y task-sessions de Telegram; elegir modelo de codex (`gpt-5.6-sol`); probar picker de sesiones con codex; actualizar macOS (Monterey tope con Electron 43); certificado Apple/firma.

## Notas operativas

- ⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app.** Usar `osascript -e 'quit app "POWER-AGENT"'` (empaquetada) o `pkill -9 -f "claude-electron/node_modules/electron"` (dev).
- ⚠️ Al morir a lo bruto queda un **`SingletonLock` huérfano** en `userData`: el siguiente arranque se suicida **en silencio**. Borrar `SingletonLock`/`SingletonSocket`/`SingletonCookie` si "no arranca".
- Dev y empaquetada comparten `userData` (`CLAUDE-NOVAK`) → **nunca pueden convivir**.
- **El bridge de WhatsApp está fuera de git** (`~/.claude/whatsapp-bridge/index.js`): cambios ahí van con backup `.bak.<fecha>` a mano, se pierden si se reinstala sin restaurar.
- El "escribiendo…" del panel de la app es **solo cosmético para Luismi** — no lo ve el cliente real (su indicador lo gobierna el bridge, aparte, solo segundos antes de enviar). Fuente de confusión real hoy, ya aclarada.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan en ambos).
- El ruido `EGL ... Bad attribute` es cosmético (8/s, medido). Sin arreglo desde nuestro código.
