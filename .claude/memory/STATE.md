# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-03 (verificado contra git, los tests, la app desplegada y el estado en disco)._

## Estado de entrega (verificado)

- Rama activa: **`main`**, **sincronizada con `origin`**. Todo pusheado.
- Tests: **657 (651 pass / 0 fail / 6 skip pre-existentes)**.
- Deploy: `/Applications/POWER-AGENT.app` con los 15 arreglos, corriendo.
- **`autoReply` está en `true`**: el bot RESPONDE. Lo encendió Luismi el 3-ago para aprobar el pipeline, y funciona. Allowlist vacía = responde a cualquiera.
- Las 3 fichas de Turbo Energy están **validadas por Luismi** (3-ago). Dejan de ser un riesgo.
- Bridge WhatsApp: **ya está en git**, en `whatsapp-bridge/` del repo. El runtime sigue en `~/.claude/whatsapp-bridge/` (estado y secretos), y se despliega con `scripts/deploy-wa-bridge.sh`. `/status` → `ready`.
- Electron 43.2.0, CLI codex 0.145.0 / claude 2.1.220.

## Última sesión (2026-08-03) — revisión multi-agente: 15 defectos de la KB, todos cerrados

Una `/code-review` en xhigh sobre los 4 commits sin pushear encontró **15 defectos verificados** en el pipeline de la KB recién escrito. Están **los 15 arreglados**, en 5 commits pusheados, +45 tests (612 → 657).

Los cuatro que llegaban al cliente o destruían datos:
- **`4cd89eb`** — el marcador `[KB:id]` se filtraba al cliente (solo se quitaba el último, y el modelo cita la ficha también inline); un alta de ficha podía **borrar otra** (dos títulos que slugifican igual); el reintento de `/send/text` **duplicaba mensajes** (endpoint no idempotente: el 500 sale del catch que envuelve al propio `sendMessage`, y Baileys lanza `Timed Out` con el mensaje ya enviado); **guardar el modal de Configuración resucitaba el bot** apagado por el kill switch de auth (`saveConfig` mergeaba desde DISCO, no desde memoria).
- **`3a6a868`** — `kbMode: strict` fallaba **abierto**: con la KB ilegible caía a la persona libre e inventaba. Ahora se distingue "nunca hubo KB" (kb/ no existe → persona libre) de "la KB se rompió" (kb/ existe sin fichas → escalar). El `catch` del pipeline enviaba **sin mirar el kill switch**. `sanitizeAutoReplyText` aplastaba los saltos y los pasos numerados llegaban como parrafada.
- **`3c5466c`** — un fallo interno (timeout del selector, spawn caído) dejaba el chat en manual **para siempre**: nuevo `escalationReason: 'error'` con TTL de 10 min que el sweep revierte; `'user'` sigue intocable. `loadState` tiraba `kbActive`/`kbClarify` al arrancar aunque `persistState` sí los escribía.
- **`7145789`** — el editor borraba al guardar toda sección que no modela; la regex JSON perezosa del selector se rompía con un objeto anidado; fichas con nombre de fichero ≠ id eran inabribles e imborrables; el contador de aclaración se gastaba sin enviar; `kb-audit.jsonl` sin rotación y en 0644 con PII (ahora rota a 5 MB y es 0600, verificado en disco).
- **`3913eca`** — ventana de agrupación 4-8s → **7-12s**: con 4s de suelo una ráfaga con pausa normal de redacción se partía en dos turnos y el cliente recibía dos mensajes por una idea. Sigue sin valor fijo.

**Bug del QR (bridge, mismo día).** El modal no mostraba QR y *Reintentar* no servía. No era la app: tras un `loggedOut`, el bridge no borraba las credenciales muertas, así que `useMultiFileAuthState` las recargaba, WhatsApp las rechazaba otra vez y **nunca se emitía QR nuevo**. Arreglado (borra + relanza, con guard anti-bucle; `AUTH_DIR` absoluto). Ese arreglo fue el detonante de meter el bridge en git.

**Cobertura, con precisión:** lo de flujo (strict fail-closed, kill switch en el catch, TTL de error, contador de aclaración) está verificado por lectura y por tests de sus primitivas, **no** por un turno real de punta a punta. Cuatro arreglos sí se verificaron conduciendo la app por CDP.

## Sesión previa (2026-08-02, noche) — kill switch del bot a un clic

Detalle: `.claude/memory/decisions/kill_switch_whatsapp_2026_08_02.md`.

Arrancó preguntando si `AUTO TODO` debía desactivar además de activar. No: es one-way a propósito, porque el apagado real es `config.autoReply`. Pero ese apagado estaba enterrado en el modal de Configuración (4 clics + Guardar) para algo que se usa en una urgencia.

- **`63c695a`** — toggle `BOT ON`/`BOT OFF` en la cabecera del panel (`#wa-btn-autoreply`), verde/rojo, un clic. Sale del modal por completo, **incluido el partial de Guardar**: `saveConfig` hace merge, así que guardar Configuración ya no puede pisar el estado del bot. Volver a meter `autoReply` en ese partial reintroduce el bug.
- Mismo commit: `updateStatusUI` **respeta un aviso vivo** del subtítulo. El `refreshStatus()` del toggle borraba el `showHeaderNotice` antes de que se leyera (medido: 0 de 25 muestras a 120 ms). Afectaba también a los avisos de AUTO TODO y del bridge. Si alguien "limpia" esa línea, todos vuelven a ser invisibles.
- **`e68e095`** — `.claude/skills/verify/SKILL.md`: cómo conducir la app por CDP (arranque con `--remote-debugging-port` por Terminal, el MCP chrome-devtools NO sirve, el `ws` de node_modules revienta bajo Bun, los dos targets del panel). Evita el cold start la próxima vez.
- El bug del aviso lo encontró **conducir la app**, no los 612 tests en verde.

## Sesión previa (2026-08-02, tarde) — WhatsApp: KB con edición en la app, anti-detección

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

0. **Sincronizar las dos ventanas del panel al cambiar `autoReply`**: hoy solo se enteran por el `setInterval` de 15 s, así que tras togglear en una la otra miente 12-15 s. En un botón de emergencia es feo. Arreglo: broadcast por IPC al cambiar config.
1. **Con el bot ya encendido y respondiendo a cualquiera**, decidir si la allowlist debe dejar de estar vacía.
2. **Decisión de producto pendiente**: ¿el bot debe reconocer un cierre de conversación ("gracias", "ok") y callar, en vez de disparar el pipeline completo cada vez?
4. **Reforzar la regla de prefijo internacional** en el camino IPC de la app (`numberToJid`) — hoy solo vive en `scripts/whatsapp-send-safe.sh`, detectado pero no tocado.
5. **Responder a mano** el mensaje de Noa ("tengo un problema con mi bateria") que quedó sin respuesta real en el historial del incidente de reconexión.
6. Borrar `~/.claude/whatsapp-bridge/backup-reset-20260802/` cuando Luismi confirme que todo va bien unos días.
7. Heredado de la mañana, sin tocar hoy: detección de fork en pool de PTYs ocultos y task-sessions de Telegram; elegir modelo de codex (`gpt-5.6-sol`); probar picker de sesiones con codex; actualizar macOS (Monterey tope con Electron 43); certificado Apple/firma.

## Notas operativas

- ⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app.** Usar `osascript -e 'quit app "POWER-AGENT"'` (empaquetada) o `pkill -9 -f "claude-electron/node_modules/electron"` (dev).
- ⚠️ Al morir a lo bruto queda un **`SingletonLock` huérfano** en `userData`: el siguiente arranque se suicida **en silencio**. Borrar `SingletonLock`/`SingletonSocket`/`SingletonCookie` si "no arranca".
- Dev y empaquetada comparten `userData` (`CLAUDE-NOVAK`) → **nunca pueden convivir**.
- **El bridge de WhatsApp YA está en git** (3-ago) en `whatsapp-bridge/` del repo, que es la fuente de verdad. El runtime vive en `~/.claude/whatsapp-bridge/` (ahí y solo ahí: `.auth-token`, `.baileys_auth/`, `config.json`, `state.json`, `kb/`, `persona.md`, `media/`). Editar en el repo y desplegar con `scripts/deploy-wa-bridge.sh`; editar directo en el runtime vuelve a divergir.
- **Un `loggedOut` de WhatsApp no se arregla reiniciando el bridge**: hay que borrar `.baileys_auth/` o no se emite QR nuevo nunca. Desde 3-ago lo hace solo.
- El "escribiendo…" del panel de la app es **solo cosmético para Luismi** — no lo ve el cliente real (su indicador lo gobierna el bridge, aparte, solo segundos antes de enviar). Fuente de confusión real hoy, ya aclarada.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan en ambos).
- El ruido `EGL ... Bad attribute` es cosmético (8/s, medido). Sin arreglo desde nuestro código.
