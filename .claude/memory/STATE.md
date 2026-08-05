# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-05 noche (verificado contra git, los tests y la app desplegada; ciclo completo probado en vivo por Luismi)._

---

# 🚦 EMPIEZA POR AQUÍ — modo voz: FUNCIONA de punta a punta, commiteado, sin mergear ni pushear

**Primera prueba real con micrófono hecha esta tarde/noche. Escucha, envía, responde y lo lee en voz alta.** Cinco bugs cazados y arreglados en vivo con logs del sistema y el helper instrumentado — ninguno lo vio la suite de 950+ tests, todos salieron al primer uso real:

1. **Detector de forks solo miraba el primer MB** del transcript — el sub-chat respondía pero la app no lo encontraba (`main/relay-transcript-helpers.js`, `main/voice-send-target.js`).
2. **`setVoiceProcessingEnabled(true)` pasa el micro a 4 canales** — el reconocedor de Apple solo digiere mono/estéreo, daba `kAFAssistantErrorDomain 1110` con audio de sobra (esto era el bloqueo de esta mañana). Arreglado copiando el canal 0 a mono antes de pasarlo al reconocedor.
3. **El ENTER pegado al texto se leía como salto de línea** dentro del prompt: transcribía perfecto pero el turno se quedaba sin enviar. Ahora va en una escritura aparte, 150 ms después.
4. **El micro se reabría al hablar (para el barge-in) y se oía a sí mismo**: se autointerrumpía al segundo, siempre. Se cierra mientras habla y punto — se pierde el barge-in por voz, para cortar está el botón.
5. **`setVoiceProcessingEnabled` mete el proceso en "modo comunicación"** y macOS aplica ducking a TODO el audio del sistema mientras el micro está abierto (música incluida) — se quitó entera, ya no hacía falta sin el barge-in.

Y de paso, a petición de Luismi con la voz ya funcionando:
- **Destino por defecto = sesión de trabajo**, no sub-chat. Botón nuevo ⚡/💬 para elegir. Se borró el detector de intención por patrones (~200 líneas, vive en el historial de git).
- **Selector de voz y velocidad** en Configuración.
- **El tope de lectura cortaba a media frase** (935 caracteres con tope en 700) — subido a 2000 y corta en fin de frase si hace falta recortar.
- **`npm run deploy` automatiza la firma ad-hoc y el bundle `VoiceHelper.app`** — antes se perdían en cada deploy y había que rehacerlos a mano.

## Qué hay hecho

Rama **`feat/modo-voz`** (39 commits sobre `main` @ `0a9c459`, árbol limpio, **sin push, sin merge a `main`**):

- Las 9 tareas del plan original + review final + los 6 commits de hoy (5 fixes de la prueba real + selector de voz + deploy automatizado).
- **Tests: 953 (947 pass / 0 fail / 6 skip)**, verificado en el repo real.
- **Desplegado y probado en vivo** en `/Applications/POWER-AGENT.app`: ciclo completo (escucha → transcribe → envía → responde → lee) confirmado por Luismi.

## Lo que queda pendiente, consciente y sin cerrar

- **Sin barge-in por voz.** Hablarle encima ya no le corta — precio asumido al cerrar el micro mientras habla. Cortar es con el botón de voz.
- **Sin música alta de fondo probado.** Sin VoiceProcessing, el reconocimiento pierde precisión si hay ruido/música fuerte por encima de la voz — no medido con datos, solo advertido en el commit.
- **Salida de audio HDMI/externa**: si el Mac tiene el sonido enrutado a una pantalla o dispositivo externo, el volumen del sistema no controla ese destino. No es bug de la app — se vivió en esta misma sesión (confundía con el modo voz).
- **`coreaudiod` puede quedarse pegado en modo comunicación** tras muchos ciclos de activar/desactivar VoiceProcessing durante desarrollo — un `sudo killall coreaudiod` lo resetea. No debería volver a pasar ahora que se quitó VoiceProcessing, pero si algún día vuelve, tenerlo en cuenta.
- **Solo `claude`**, igual que antes. Codex no delimita fin de turno.
- Falta decidir **push + merge a `main`** — Luismi no lo ha pedido todavía.

## Reglas que no te puedes saltar si sigues tocando esta rama

- **Los tests, en el repo real, nunca en el worktree.** El worktree no tiene `node_modules` y fallan 12 por `Cannot find module 'node-pty'`. Y **jamás symlinkes `node_modules` dentro de un worktree**: ya provocó un commit de basura (CLAUDE.md § Limitaciones).
- **No "optimices" el reconocimiento a on-device.** Está medido: RTF 2,5–7,5 en este i7 de 2014, inservible. La decisión de usar los servidores de Apple la tomó Luismi con las cifras delante.
- **No reintroduzcas `setVoiceProcessingEnabled(true)` sin releer el commit `bc6d5eb`.** Rompe el reconocimiento (4 canales), corta la voz sola (se oye a sí misma) y baja el volumen de todo el sistema. Si algún día hace falta el barge-in por voz de vuelta, hay que resolver los tres problemas a la vez, no solo reactivar la línea.
- Si un test falla por un detalle de formato, **arregla la implementación, no el test.** El test es el contrato.
- **No hagas `push`.** Luismi no lo ha pedido.
- **Los `<script>` sueltos del renderer comparten ámbito con `renderer.js`.** Ningún `const`/`let` con nombre genérico en el nivel superior de `voice-ui-state.js`, `project-picker.js` o `graph-renderer.js`: una colisión mata la página entera y **los tests no lo ven** (en node se cargan con `require`). Ver `bugs/bug_scripts_renderer_ambito_global.md`.

---

## Estado de entrega (verificado)

- Rama `main`: sigue con los mismos **5 commits por delante de `origin`** de la sesión de planificación (sin push), working tree limpio si te sitúas ahí. Último commit: `0a9c459`.
- **Rama de trabajo activa ahora: `feat/modo-voz`** — **39 commits** sobre ese `main` (9 tareas + review final + los arreglos de la prueba en vivo de hoy), árbol limpio, sin push, **sin mergear a `main` todavía**. El modo voz **SÍ funciona de punta a punta**, probado en vivo por Luismi.
- Tests: **953 (947 pass / 0 fail / 6 skip)**, verificado en `feat/modo-voz`, en el repo real.
- Deploy: `/Applications/POWER-AGENT.app` **redesplegado hoy** con todo el modo voz dentro, incluida la primera build con la firma y el bundle del helper **automatizados** por `npm run deploy` (antes había que rehacerlos a mano tras cada deploy).
- **`autoReply` está en `false`**: el bot NO responde a nadie. Luismi lo encendió el 3-ago para aprobar el pipeline y lo volvió a apagar. La allowlist sigue vacía, así que **al encenderlo responde a cualquier número**.
- Las 3 fichas de Turbo Energy están **validadas por Luismi**. Dejan de ser un riesgo abierto.
- Bridge WhatsApp: **en git** (`whatsapp-bridge/` del repo). Runtime en `~/.claude/whatsapp-bridge/`, `/status` → `ready`. Se despliega con `scripts/deploy-wa-bridge.sh`.
- Servidor LAN: **encendido**, puertos 9999 (WS) y 10000 (HTTP), IP `192.168.1.14`. 43 tests LAN en verde.
- Electron 43.2.0, CLI codex 0.145.0 / claude 2.1.220.

## Última sesión (2026-08-05 noche) — la primera prueba real, y el modo voz quedó funcionando

**6 commits, 5 bugs de la primera prueba con micrófono real + 3 mejoras pedidas por Luismi con la voz ya oyéndose.** Detalle técnico completo arriba, en "🚦 EMPIEZA POR AQUÍ". Lo que enseñó de método:

**Ninguno de los 5 bugs lo vio la suite.** Los cinco necesitaban un micrófono real, un altavoz real y un turno completo de ida y vuelta — exactamente lo que 953 tests no pueden simular. Se cazaron con logs del sistema (`log show`, `tccd`), un helper Swift instrumentado a fichero (`dlog` a `/tmp/voice-diag.log`) y comparaciones directas de audio (`say` del sistema contra el helper). Ninguno salió de "leer el código y razonar".

**El síntoma engañaba.** "No transcribe" (canales del micro) y "se queda ahí sin hacer nada" (ENTER sin enviar) y "se corta en seco" (auto-interrupción) y "se oye bajísimo" (ducking de CoreAudio, ni siquiera del audio del propio modo voz — de TODO el sistema, música incluida) parecían cuatro fallos del modo voz. Eran cuatro consecuencias de la misma decisión (`setVoiceProcessingEnabled(true)`), y se fueron pelando una por una según Luismi las reportaba en vivo.

**La sesión anterior (2026-08-05 tarde) dejó una sospecha correcta sin verificar**: que `setVoiceProcessingEnabled(true)` cambiaba el formato del nodo de audio. Era la causa exacta del 1110 de esta mañana. La variante de prueba que se dejó compilada sin ejecutar (`VoiceHelper-noVP`) apuntaba a la solución que acabó aplicándose horas después: quitar VoiceProcessing.

## Sesión previa (2026-08-04 noche) — modo voz: medido y planificado, sin implementar

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

**El paso 0 es el bloque "🚦 EMPIEZA POR AQUÍ" del principio de este archivo: desatascar el reconocimiento de voz (error 1110).** La variante de prueba ya está compilada; falta ejecutarla.

0. **Decidir push + merge de `feat/modo-voz` a `main`.** Funciona, está probado en vivo, 39 commits limpios. Pendiente solo porque Luismi no lo ha pedido todavía — preguntarlo, no darlo por hecho.

1. **Probar los tres fixes del 4-ago (Telegram)**, ninguno validado por Luismi todavía: (a) abrir sesión en la app y ver que NO sale el aviso amarillo de transcript; (b) `/proyecto` en Telegram + escribir → debe contestar en ese proyecto; (c) sesión nueva desde Telegram → el título debe ser el mensaje real, no `[Sistema:…`.
2. **Primer mensaje real del bot de WhatsApp con todo esto puesto.** Nada del pipeline se ha ejercitado de punta a punta: los arreglos de flujo están verificados por lectura y por tests de sus primitivas. Comparar contra la mediana registrada de 29 s.
3. **Decidir la allowlist antes de volver a encender el bot**: está vacía, así que `autoReply: true` = responde a cualquier número.
4. **Latencia restante del bot**: quedan ~6,2 s/turno que sí son el modelo. Las palancas son `kbAnswerModel` sonnet→haiku (peor ceñido a la ficha) o CLI→API con fast mode (**factura aparte del plan Max**). Decisión de negocio, pendiente.
5. **LAN fuera de la WiFi**: Luismi lo está pensando. Propuesta = Tailscale (sin abrir puertos, sin tocar código). ⚠️ Nunca por port forwarding a pelo: el server es `http.createServer` **sin TLS** escuchando en `0.0.0.0` con el token en el query string.
6. Probar el cliente LAN (URL con token en Configuración → LAN, o el QR).
7. Sincronizar las dos ventanas del panel al cambiar `autoReply` (hoy tardan hasta 15 s por el `setInterval`).
8. Heredado: detección de fork en el pool de PTYs ocultos y task-sessions de Telegram; elegir modelo de codex; macOS Monterey es el tope con Electron 43; certificado Apple/firma.

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
