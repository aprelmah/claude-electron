# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-05 (verificado contra git, los tests y el estado en disco — pendiente aún la comprobación contra la app desplegada, ver más abajo)._

---

# 🚦 EMPIEZA POR AQUÍ — modo voz: código y documentación cerrados, falta un humano

**Luismi dejó autorizado implementar el modo voz sin pedir permiso paso a paso (noche del 2026-08-04). Ese trabajo está prácticamente terminado.**

## Qué hay hecho

En la rama **`feat/modo-voz`** (28 commits sobre `main` @ `0a9c459`, árbol limpio, **sin push**):

- **Las 8 tareas de implementación, completas**, cada una con revisión limpia tras sus rondas de correcciones (detalle de cada ronda: `.superpowers/sdd/2026-08-04-voz-en-directo/progress.md`).
- **Tarea 9, pasos 1, 2 y 4 (documentación), completos**: sección "## Modo voz" en `CLAUDE.md`, nota técnica `.claude/memory/tech/tech_modo_voz.md`, y el checklist manual en `CHECKLIST-VOZ-MANUAL.md` (raíz del repo).
- **Tests: 943 (937 pass / 0 fail / 6 skip)**, verificado en el repo real (no en un worktree).

## Qué falta (y por qué no lo puede cerrar un agente)

1. **Review final de la rama completa** (paquete de diff generado en `.superpowers/sdd/2026-08-04-voz-en-directo/review-0a9c459..1fe7f07.diff`, 28 commits) — coherencia entre módulos, impacto fuera del modo voz (`startPty` y `main/subchat-pty.js` son ruta caliente de TODAS las sesiones claude, no solo voz), y triaje de los pendientes conocidos (ver `tech_modo_voz.md`).
2. **`npm run deploy`** después de ese review, no antes.
3. **El paso 3 de la Tarea 9: la prueba manual con micrófono.** No es pereza — el sistema operativo no lo permite de otra forma: el permiso de micrófono y reconocimiento lo concede un humano en un diálogo de macOS, y "se calla cuando le hablas encima" (barge-in) hay que oírlo. Checklist completo, en español llano, para Luismi: **`CHECKLIST-VOZ-MANUAL.md`**.

Cuando el review y el deploy estén hechos: pasarle a Luismi el checklist y esperar su validación antes de dar el modo voz por cerrado y mergeable a `main`.

## Reglas que no te puedes saltar si sigues tocando esta rama

- **Los tests, en el repo real, nunca en el worktree.** El worktree no tiene `node_modules` y fallan 12 por `Cannot find module 'node-pty'`. Y **jamás symlinkes `node_modules` dentro de un worktree**: ya provocó un commit de basura (CLAUDE.md § Limitaciones).
- **No "optimices" el reconocimiento a on-device.** Está medido: RTF 2,5–7,5 en este i7 de 2014, inservible. La decisión de usar los servidores de Apple la tomó Luismi con las cifras delante.
- Si un test falla por un detalle de formato, **arregla la implementación, no el test.** El test es el contrato.
- **No hagas `push`.** Luismi no lo ha pedido.
- **No hagas `npm run deploy` antes del review final de la rama** (punto 1 de arriba): está pendiente y es lo que decide si hace falta algo más antes de que Luismi lo pruebe.

---

## Estado de entrega (verificado)

- Rama `main`: sigue con los mismos **5 commits por delante de `origin`** de la sesión de planificación (sin push), working tree limpio si te sitúas ahí. Último commit: `0a9c459`.
- **Rama de trabajo activa ahora: `feat/modo-voz`** — 28 commits sobre ese `main` (implementación completa de las 8 tareas + documentación de la Tarea 9), árbol limpio, sin push, **sin mergear a `main` todavía**: pendiente el review final de la rama (bloque "EMPIEZA POR AQUÍ" de arriba).
- Tests: **943 (937 pass / 0 fail / 6 skip)**, verificado en `feat/modo-voz`, en el repo real. Sin regresiones sobre los 676 de partida.
- Deploy: `/Applications/POWER-AGENT.app` sigue en el build de **2026-08-04 18:59** — **anterior a toda la implementación del modo voz**. `npm run deploy` está pendiente, después del review final, no antes.
- **`autoReply` está en `false`**: el bot NO responde a nadie. Luismi lo encendió el 3-ago para aprobar el pipeline y lo volvió a apagar. La allowlist sigue vacía, así que **al encenderlo responde a cualquier número**.
- Las 3 fichas de Turbo Energy están **validadas por Luismi**. Dejan de ser un riesgo abierto.
- Bridge WhatsApp: **en git** (`whatsapp-bridge/` del repo). Runtime en `~/.claude/whatsapp-bridge/`, `/status` → `ready`. Se despliega con `scripts/deploy-wa-bridge.sh`.
- Servidor LAN: **encendido**, puertos 9999 (WS) y 10000 (HTTP), IP `192.168.1.14`. 43 tests LAN en verde.
- Electron 43.2.0, CLI codex 0.145.0 / claude 2.1.220.

## Última sesión (2026-08-04 noche) — modo voz: medido y planificado, sin implementar

Luismi preguntó si se podía hacer un modo voz tipo ChatGPT escritorio. **Nada está implementado**: la sesión produjo el diseño, el plan y las mediciones que lo sostienen.

**Las mediciones tumbaron la decisión inicial.** Luismi eligió "todo local, coste cero"; medirlo demostró que en este i7 de 2014 **ningún motor local transcribe tan rápido como se habla** (whisper base RTF 1,41; Apple on-device 2,5–7,5, desplomándose a 7,5 con audio largo). Con el dato delante cambió a los servidores de Apple: **617 ms** al primer texto, **1022 ms** desde que callas, 0 €, a cambio de que el audio salga del Mac. Tablas completas y hallazgos operativos: `tech/tech_modo_voz_mediciones.md`.

**El eco no es un problema**: `VoiceProcessingIO` de CoreAudio cancela el altavoz — verificado con el TTS sonando y el micro abierto. Era el riesgo que podía matar el manos libres.

- **`2adeee8`** — spec (162 líneas) con las cuatro decisiones de producto y las mediciones.
- **`c804b94`** — plan (2001 líneas, 9 tareas TDD, 50 pasos, sin huecos) + `voice-helper/VoiceHelper.swift` (319 líneas, compila y responde a su protocolo NDJSON).
- **`5c6824f`**, **`904da4f`** — STATE.md, AGENTS.md y CLAUDE.md apuntando al trabajo autorizado.

El repaso del plan cazó dos fallos propios antes de escribir producción: el sub-chat **forkea el sessionId** (vigilar el de la madre habría dejado el turno esperando para siempre), y dos firmas de `relay-transcript-helpers.js` que había supuesto mal.

⚠️ **Feedback de Luismi**: pidió "déjalo preparado" y tuvo que preguntar **dos veces** qué se había hecho, porque el `.swift` apareció sin anunciarlo. Regla nueva en `~/claude-shared/memory/02-feedback.md`: si me salgo del alcance literal, avisar antes en una línea.

## Sesión previa (2026-08-04 tarde) — tres bugs que los tests no podían ver

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

**El paso 0 es el bloque "🚦 EMPIEZA POR AQUÍ" del principio de este archivo: implementar el modo voz.** Está autorizado y no necesita preguntar. Lo de abajo es la cola heredada, que sigue viva.

0bis. **Resuelto por la vía de los hechos**: la pregunta de Luismi sobre si `voice-helper/VoiceHelper.swift` se quedaba en el repo quedó respondida al ejecutar la Tarea 1 — se usó tal cual estaba, sin tocarlo, y sigue ahí (`voice-helper/VoiceHelper.swift`). No se le llegó a preguntar explícitamente; si vuelve a salir el tema, decírselo así.

1. **Probar los tres fixes del 4-ago**, ninguno validado por Luismi todavía: (a) abrir sesión en la app y ver que NO sale el aviso amarillo de transcript; (b) `/proyecto` en Telegram + escribir → debe contestar en ese proyecto; (c) sesión nueva desde Telegram → el título debe ser el mensaje real, no `[Sistema:…`.
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
