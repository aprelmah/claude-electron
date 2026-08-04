# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-04 (verificado contra git, los tests, la app desplegada y el estado en disco)._

## Estado de entrega (verificado)

- Rama activa: **`main`**, **sincronizada con `origin`**, working tree limpio (salvo esta memoria).
- Último commit: **`8d55387`**. **13 commits** entre el 3 y el 4 de agosto, todos pusheados.
- Tests: **676 (670 pass / 0 fail / 6 skip pre-existentes)**. Eran 612 al empezar el 3-ago.
- Deploy: `/Applications/POWER-AGENT.app`, build de **2026-08-04 18:59**, corriendo con ventana.
- **`autoReply` está en `false`**: el bot NO responde a nadie. Luismi lo encendió el 3-ago para aprobar el pipeline y lo volvió a apagar. La allowlist sigue vacía, así que **al encenderlo responde a cualquier número**.
- Las 3 fichas de Turbo Energy están **validadas por Luismi**. Dejan de ser un riesgo abierto.
- Bridge WhatsApp: **en git** (`whatsapp-bridge/` del repo). Runtime en `~/.claude/whatsapp-bridge/`, `/status` → `ready`. Se despliega con `scripts/deploy-wa-bridge.sh`.
- Servidor LAN: **encendido**, puertos 9999 (WS) y 10000 (HTTP), IP `192.168.1.14`. 43 tests LAN en verde.
- Electron 43.2.0, CLI codex 0.145.0 / claude 2.1.220.

## Última sesión (2026-08-04) — tres bugs que los tests no podían ver

Los tres los cazó Luismi mirando la pantalla, no la suite. Vale la pena tenerlo presente: la cobertura estaba en verde en los tres casos.

- **`127f98a`** — la app **contaminaba a sus PTYs**. Lanzada desde una sesión de Claude Code (un `npm run deploy`), heredaba su identidad y los PTYs desactivaban el guardado del transcript: sin `.jsonl` no hay `--resume`, ni historial, ni relay de Telegram, ni pool de PTYs ocultos. El único aviso era una línea amarilla al fondo del TUI. Detalle: `bugs/bug_pty_hereda_sesion_2026_08_03.md`.
- **`74e09b5`** — **Telegram no respetaba el proyecto elegido**. `/proyecto` TURBO-ENERGY + escribir → contestaba la sesión de eatBook abierta en el Mac, con su cwd y `bypassPermissions`. Regla nueva y arqueología de por qué parecía funcionar a veces: `decisions/telegram_proyecto_manda_2026_08_04.md`.
- **`8d55387`** — la instrucción de la app **secuestraba el título** de las sesiones de Telegram: todas se llamaban `[Sistema: si el usuario pide un archivo…`. Detalle: `bugs/bug_telegram_titulo_sesion_2026_08_04.md`.

También se explicó por qué el cliente LAN no sale de la WiFi (IP privada + NAT; y `http.createServer` **sin TLS** en `0.0.0.0` con el token en el query string). Propuesta: Tailscale. Luismi lo está pensando.

## Sesión previa (2026-08-03) — revisión multi-agente, bridge en git y caza de latencia

**15 defectos de la KB, todos cerrados.** Una `/code-review` en xhigh sobre los 4 commits sin pushear del día anterior encontró 15 defectos verificados en el pipeline de la KB. Cerrados en `4cd89eb`, `3a6a868`, `3c5466c`, `7145789`, `3913eca`. Detalle y reglas: `.claude/memory/audit_code_review_2026_08_03.md`.

**El QR no salía, y no era la app.** Tras un `loggedOut`, el bridge no borraba las credenciales muertas, las recargaba, WhatsApp las rechazaba y nunca emitía QR — *Reintentar* tampoco servía. Detalle: `.claude/memory/bugs/bug_wa_qr_loggedout_2026_08_03.md`.

**El bridge entra en git** (`9d4a110`), detonado por ese bug: llevaba meses editándose a mano en producción. Detalle: `.claude/memory/decisions/bridge_en_git_2026_08_03.md`.

**Caza de latencia (`80a1ccd`).** El bot heredaba en CADA turno los ~10 MCP de Luismi, su `CLAUDE.md`, settings y hooks: 3,6 s de arranque y ~9.000 tokens de entrada que no son ni la persona ni la ficha. Con `--strict-mcp-config --setting-sources ''`: 11,2 s → 6,9 s por turno, **~8,6 s menos por mensaje** (son dos turnos). Detalle y método de medición: `.claude/memory/tech/tech_latencia_cli_bot.md`.

**Burbuja del panel en dos fases** (`d4e4706`): "el bot se está haciendo cargo" mientras corre el pipeline (el cliente no ve nada), y "escribiendo…" cuando el bridge manda el `composing` de verdad. Sincronizado emitiendo el evento justo antes del `POST /send/text`, que es cuando el bridge lo lanza.

**Arreglado de paso:** `/security-review` no arrancaba por faltar `refs/remotes/origin/HEAD` en el clon (`git remote set-head origin -a`).

## Próximo paso

0. **Probar los tres fixes del 4-ago**, ninguno validado por Luismi todavía: (a) abrir sesión en la app y ver que NO sale el aviso amarillo de transcript; (b) `/proyecto` en Telegram + escribir → debe contestar en ese proyecto; (c) sesión nueva desde Telegram → el título debe ser el mensaje real, no `[Sistema:…`.
1. **Primer mensaje real del bot con todo esto puesto.** Nada del pipeline de WhatsApp se ha ejercitado de punta a punta: los arreglos de flujo están verificados por lectura y por tests de sus primitivas. Comparar contra la mediana registrada de 29 s.
2. **Decidir la allowlist antes de volver a encender el bot**: está vacía, así que `autoReply: true` = responde a cualquier número.
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
- **Lanzar la app desde una sesión de Claude Code le pega su identidad.** Mitigado en `buildRuntimeEnv()` (los PTYs salen limpios), pero cualquier variable nueva de identidad que aparezca en el CLI hay que añadirla a `CLAUDE_SESSION_IDENTITY_VARS`.
- **Todo lo que la app añada a un turno va como system prompt**, nunca pegado al mensaje del usuario: además de secuestrar el título de la sesión, entra en el historial como si lo hubiera escrito él.
- **Con proyecto elegido desde Telegram no hay fallback a las sesiones del Mac.** Reactivarlo "para reaprovechar una sesión caliente" reabre el bug de contestar desde otro proyecto.
- **Todo spawn del CLI que no sea sesión interactiva de Luismi va aislado** (`--strict-mcp-config --setting-sources ''`). Quitarlos duplica la latencia y reabre el camino del cliente hacia los MCP personales.
- **Tras cada `npm run deploy` se cortan las conexiones LAN** y las pestañas del operador quedan con JS viejo en caché: hay que **cerrar y reabrir la pestaña**, no solo recargar.
- El "escribiendo…" del panel es **para Luismi**; el que ve el cliente lo gobierna el bridge, solo segundos antes de enviar.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan en ambos).
- El ruido `EGL ... Bad attribute` es cosmético (8/s, medido).
