# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-03 (verificado contra git, los tests, la app desplegada y el estado en disco)._

## Estado de entrega (verificado)

- Rama activa: **`main`**, **sincronizada con `origin`**, working tree limpio (salvo esta memoria).
- Último commit: **`80a1ccd`** — perf del bot de WhatsApp. **10 commits hoy**, todos pusheados.
- Tests: **663 (657 pass / 0 fail / 6 skip pre-existentes)**. Eran 612 al empezar el día.
- Deploy: `/Applications/POWER-AGENT.app`, build de **2026-08-03 19:07**, corriendo con ventana.
- **`autoReply` está en `true` y la allowlist está VACÍA**: el bot responde a cualquier número. Lo encendió Luismi el 3-ago para aprobar el pipeline, y funciona.
- Las 3 fichas de Turbo Energy están **validadas por Luismi**. Dejan de ser un riesgo abierto.
- Bridge WhatsApp: **en git** (`whatsapp-bridge/` del repo). Runtime en `~/.claude/whatsapp-bridge/`, `/status` → `ready`. Se despliega con `scripts/deploy-wa-bridge.sh`.
- Servidor LAN: **encendido**, puertos 9999 (WS) y 10000 (HTTP), IP `192.168.1.14`. 43 tests LAN en verde.
- Electron 43.2.0, CLI codex 0.145.0 / claude 2.1.220.

## Última sesión (2026-08-03) — revisión multi-agente, bridge en git y caza de latencia

**15 defectos de la KB, todos cerrados.** Una `/code-review` en xhigh sobre los 4 commits sin pushear del día anterior encontró 15 defectos verificados en el pipeline de la KB. Cerrados en `4cd89eb`, `3a6a868`, `3c5466c`, `7145789`, `3913eca`. Detalle y reglas: `.claude/memory/audit_code_review_2026_08_03.md`.

**El QR no salía, y no era la app.** Tras un `loggedOut`, el bridge no borraba las credenciales muertas, las recargaba, WhatsApp las rechazaba y nunca emitía QR — *Reintentar* tampoco servía. Detalle: `.claude/memory/bugs/bug_wa_qr_loggedout_2026_08_03.md`.

**El bridge entra en git** (`9d4a110`), detonado por ese bug: llevaba meses editándose a mano en producción. Detalle: `.claude/memory/decisions/bridge_en_git_2026_08_03.md`.

**Caza de latencia (`80a1ccd`).** El bot heredaba en CADA turno los ~10 MCP de Luismi, su `CLAUDE.md`, settings y hooks: 3,6 s de arranque y ~9.000 tokens de entrada que no son ni la persona ni la ficha. Con `--strict-mcp-config --setting-sources ''`: 11,2 s → 6,9 s por turno, **~8,6 s menos por mensaje** (son dos turnos). Detalle y método de medición: `.claude/memory/tech/tech_latencia_cli_bot.md`.

**Burbuja del panel en dos fases** (`d4e4706`): "el bot se está haciendo cargo" mientras corre el pipeline (el cliente no ve nada), y "escribiendo…" cuando el bridge manda el `composing` de verdad. Sincronizado emitiendo el evento justo antes del `POST /send/text`, que es cuando el bridge lo lanza.

**Arreglado de paso:** `/security-review` no arrancaba por faltar `refs/remotes/origin/HEAD` en el clon (`git remote set-head origin -a`).

## Próximo paso

1. **Primer mensaje real con todo esto puesto.** Nada del pipeline se ha ejercitado de punta a punta: los arreglos de flujo están verificados por lectura y por tests de sus primitivas. Comparar contra la mediana registrada de 29 s.
2. **Decidir si la allowlist sigue vacía** ahora que el bot está encendido y responde a cualquiera.
3. **Latencia restante**: quedan ~6,2 s/turno que sí son el modelo. Las palancas son `kbAnswerModel` sonnet→haiku (peor ceñido a la ficha) o CLI→API con fast mode (**factura aparte del plan Max**). Decisión de negocio, pendiente.
4. **LAN fuera de la WiFi**: Luismi lo está pensando. Propuesta = Tailscale (sin abrir puertos, sin tocar código). ⚠️ Nunca por port forwarding a pelo: el server es `http.createServer` **sin TLS** escuchando en `0.0.0.0` con el token en el query string.
5. Probar el cliente LAN (URL con token en Configuración → LAN, o el QR).
6. Sincronizar las dos ventanas del panel al cambiar `autoReply` (hoy tardan hasta 15 s por el `setInterval`).
7. Heredado: detección de fork en el pool de PTYs ocultos y task-sessions de Telegram; elegir modelo de codex; macOS Monterey es el tope con Electron 43; certificado Apple/firma.

## Notas operativas

- ⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app.** Usar `osascript -e 'quit app "POWER-AGENT"'` (empaquetada) o `pkill -9 -f "claude-electron/node_modules/electron"` (dev).
- ⚠️ Al morir a lo bruto queda un **`SingletonLock` huérfano**: el siguiente arranque se suicida **en silencio**. Borrar `SingletonLock`/`SingletonSocket`/`SingletonCookie`.
- Dev y empaquetada comparten `userData` (`CLAUDE-NOVAK`) → **nunca pueden convivir**.
- **Editar el bridge en el repo y desplegar con `scripts/deploy-wa-bridge.sh`.** Editarlo directo en el runtime vuelve a divergir las copias.
- **Un `loggedOut` de WhatsApp no se arregla reiniciando**: hay que borrar `.baileys_auth/`. Desde el 3-ago lo hace solo.
- **Todo spawn del CLI que no sea sesión interactiva de Luismi va aislado** (`--strict-mcp-config --setting-sources ''`). Quitarlos duplica la latencia y reabre el camino del cliente hacia los MCP personales.
- **Tras cada `npm run deploy` se cortan las conexiones LAN** y las pestañas del operador quedan con JS viejo en caché: hay que **cerrar y reabrir la pestaña**, no solo recargar.
- El "escribiendo…" del panel es **para Luismi**; el que ve el cliente lo gobierna el bridge, solo segundos antes de enviar.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan en ambos).
- El ruido `EGL ... Bad attribute` es cosmético (8/s, medido).
