# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-06 tarde (verificado contra git y los tests; probado en dev por Luismi)._

---

# 🚦 EMPIEZA POR AQUÍ — Telegram anti-mezcla + bot de avisos, TODO commiteado y pusheado

**Sesión 2026-08-06 tarde.** Queja de Luismi: "hablo en una sesión, salta una automatización, irrumpe y se queda en la que abre". Diagnóstico + 6 entregas, todas con TDD. **Tests: 1022 (1016 pass / 0 fail / 6 skip).** Detalle completo en CLAUDE.md (§ "Bot de avisos separado" y § "Relay de Telegram") y en la auto-memory (`update_2026_08_06_telegram_antimezcla.md`).

1. **Bot de avisos separado** (`main/telegram-notify-bot.js`, token `telegram.notifyBotToken`, bot real **@poweragent_avisos_bot** ya configurado): las tareas programadas avisan por él y NO tocan el binding del chat. Botón «▶️ Continuar esta sesión» = enganche explícito. Fail-open sin token.
2. **Chat de avisos conversacional tras «Continuar»** (30 min deslizantes): respondes al aviso ahí mismo y la respuesta vuelve ahí (`onUserReply` → `telegramBridge.onRunQuery`). Pedido por Luismi en la primera prueba: la UX de "sigue en el otro bot" no la entendía nadie.
3. **Causa raíz extra de la mezcla**: el vigía de task-sessions/pool oculto (`findUpdatedOrNewClaudeSessionId`) adoptaba el primer `.jsonl` nuevo O CRECIDO — la sesión VIVA del usuario en el mismo proyecto — y lo persistía en la tarea. Sustituido por `main/task-session-fork-watch.js` (guardas de `startPty`: solo nuevos, excludeIds, ambigüedad, sub-chat, y mira el proyecto original vía `resolveResumeCwd`).
4. **Cerrojo voz↔Telegram** (`session.voiceTurnUntil`, 180s, caduca solo) — cierra el PENDIENTE INMEDIATO de CLAUDE.md.
5. **`/vinculo`** (radiografía del enlace del chat), alias `/desvincular`, y **pie de contexto** `📁 proyecto · abc12345` en cada respuesta.
6. **`/menu`** (botonera inline) + **`/modelo`** (botones Default/Haiku/Sonnet/Opus, persiste sin reiniciar el bridge) + menú nativo de Telegram (`setMyCommands`).

**Pendiente de la tarde**: prueba end-to-end del ciclo completo por Luismi (tarea programada → aviso por @poweragent_avisos_bot → Continuar → responder en el chat de avisos). El envío directo por el notify bot y el long-poll están verificados; el ciclo con tarea real aún no. Después: `npm run deploy`.

---

# Sesión anterior (2026-08-06 mañana) — modo voz afinado y visor con lectura en voz alta

**El modo voz está mergeado en `main` (PR #6, `4303714`), afinado (`83bd999`) y desplegado.** La sesión de la mañana del 6-ago (la que la madrugada anterior llamaba "sesión paralela") terminó su trabajo: ya no hay dos sesiones sobre el repo.

Dos entregas de esa sesión:

1. **`83bd999` (en `main`, SIN PUSH)** — afinado de tiempos tras el primer día de uso real:
   - Pausa de silencio 1,1s → **1,8s por defecto y configurable** (`cli.voiceSilenceMs`, comando `silence` del helper, slider 0,8–3,0s en Configuración) — 1,1s cortaba a Luismi al respirar o pensar.
   - **Cierre en dos fases** en `VoiceHelper.swift`: al detectar silencio cierra el micro y manda `endAudio()`, pero la task de reconocimiento sigue viva hasta el `isFinal` (guardia 2,5s). Antes se cancelaba en el acto y la transcripción del último tramo (~1s de retraso del servidor) se tiraba: frases largas llegaban sin el final.
   - Un `isFinal` con el micro abierto también cierra el turno (tope ~1min por petición del reconocimiento en servidor): antes un monólogo largo se quedaba mudo y salía truncado.
2. **Botón 🔊 "Léemelo" en el visor de archivos** — **desplegado pero SIN COMMITEAR** (8 archivos, pendiente del OK de Luismi tras probarlo):
   - `main/viewer-speech.js` (nuevo): cola de trozos sobre el helper de voz, con gate si el modo voz está encendido (su micro se oiría a sí mismo), y ciclo de vida del helper (lo arranca sin permisos para sintetizar y lo para al acabar).
   - `main/voice-speakable.js` refactorizado: `proseFromMarkdown` (limpieza sin tope) + `chunkSpeakableFromMarkdown` (documento entero troceado en fin de frase, ~1400 chars/trozo). `speakableFromMarkdown` intacto (tests previos en verde).
   - IPC `viewer:speak` / `viewer:speak-stop`, botón en `viewer.html` (lee selección o documento, icono play/stop), cierre de ventana calla la lectura (`web-contents-created` → `destroyed`).

Camino hasta aquí, la noche del 5-ago: primera prueba real con micrófono, cinco bugs cazados y arreglados en vivo (ninguno lo vio la suite):

1. **Detector de forks solo miraba el primer MB** del transcript (`main/relay-transcript-helpers.js`, `main/voice-send-target.js`).
2. **`setVoiceProcessingEnabled(true)` pasa el micro a 4 canales** — el reconocedor solo digiere mono/estéreo (`kAFAssistantErrorDomain 1110`). Arreglado copiando el canal 0 a mono.
3. **El ENTER pegado al texto se leía como salto de línea** dentro del prompt: el turno se quedaba sin enviar. Ahora va aparte, 150 ms después.
4. **El micro se reabría al hablar (barge-in) y se oía a sí mismo**: se autointerrumpía siempre. Se cierra mientras habla — el barge-in por voz se pierde, para cortar está el botón.
5. **`setVoiceProcessingEnabled` mete el proceso en "modo comunicación"**: macOS aplica ducking a TODO el audio del sistema. Se quitó entera.

Y de paso: destino por defecto = sesión de trabajo (botón ⚡/💬), selector de voz y velocidad en Configuración, tope de lectura 700→2000 con corte en fin de frase, y `npm run deploy` automatizando la firma ad-hoc y el bundle `VoiceHelper.app`.

## Reglas técnicas nuevas del 6-ago (además de las de abajo)

- **El helper de voz solo maneja UNA frase a la vez**: su `speakingId` es único y cada `speak` lo pisa (los `speech-end` salen con el id equivocado si encolas en él). Para leer largo, encolar SIEMPRE desde Node: mandar un trozo, esperar su `speech-end`, mandar el siguiente. Así lo hace `main/viewer-speech.js`.
- **El helper se multiplexa entre consumidores por prefijo de id** (`viewer:` para el visor): `viewer-speech.handleHelperEvent` consume los suyos antes de que los vea `voice-session`; los `hello` los ven los dos (un `hello` a mitad de lectura = el helper se reinició y la frase en vuelo murió).
- **Un deploy lanzado antes de un merge empaqueta el estado viejo**: el 6-ago la app de las 07:11 no llevaba `83bd999` aunque era posterior al commit. Verificar el contenido del asar (`npx asar extract-file` **desde el scratchpad, nunca desde el repo** — extrae al cwd y pisa el archivo real; pasó y hubo que restaurar `main.js` con `git checkout`), no la fecha de la app.

## Lo que queda pendiente, consciente y sin cerrar

- **Commit del botón Léemelo** (8 archivos incluyendo este STATE.md) — esperando que Luismi pruebe la lectura y la nueva pausa de voz. Propuesto: `feat(visor): botón Léemelo` + push de todo (`main` va ahead 1 con `83bd999`).
- **Sin barge-in por voz.** Hablarle encima ya no le corta — precio asumido. Cortar es con el botón.
- **Sin música alta de fondo probado.** Sin VoiceProcessing, el reconocimiento pierde con ruido fuerte — no medido.
- **Salida de audio HDMI/externa**: el volumen del sistema no controla ese destino. No es bug de la app.
- **`coreaudiod` puede quedarse pegado en modo comunicación** (legado de VoiceProcessing en desarrollo): `sudo killall coreaudiod`.
- **Solo `claude`**, igual que antes. Codex no delimita fin de turno.
- Heredado del modo voz: exclusión mutua voz/Telegram (`voiceTurnUntil`, CLAUDE.md §Git automático), detección de fork en pool oculto y task-sessions.

## Reglas que no te puedes saltar si sigues tocando esto

- **Los tests, en el repo real, nunca en el worktree.** El worktree no tiene `node_modules` (12 fallos por `node-pty`); si no queda otra, `NODE_PATH=<repo-real>/node_modules node --test` funciona (verificado 6-ago). **Jamás symlinkes `node_modules` en un worktree.**
- **No "optimices" el reconocimiento a on-device.** Medido: RTF 2,5–7,5 en este i7. La decisión de servidores de Apple la tomó Luismi con las cifras delante.
- **No reintroduzcas `setVoiceProcessingEnabled(true)` sin releer el commit `bc6d5eb`.** Tres problemas a la vez, no una línea.
- Si un test falla por un detalle de formato, **arregla la implementación, no el test.**
- **No hagas `push` ni toques commits de otra sesión sin pedirlo explícitamente.**
- **Los `<script>` sueltos del renderer comparten ámbito con `renderer.js`.** Ver `bugs/bug_scripts_renderer_ambito_global.md`.

---

## Estado de entrega (verificado 2026-08-06 ~09:30)

- **`main` local: `83bd999`, ahead 1 de `origin/main`** (sin push — pendiente del OK de Luismi). En GitHub `main` = `4303714` (merge PR #6). `feat/modo-voz` sigue viva en remoto.
- **Working tree: 8 archivos sin commitear** — el botón Léemelo entero (`main/viewer-speech.js` y `tests/viewer-speech.test.js` nuevos; `main.js`, `main/voice-speakable.js`, `viewer.html`, `viewer-renderer.js`, `viewer-preload.js`, este STATE.md).
- Tests: **977 (971 pass / 0 fail / 6 skip)** en el repo real, incluyendo los cambios sin commitear. 19 nuevos de `viewer-speech`.
- Deploy: `/Applications/POWER-AGENT.app` **con TODO dentro** (83bd999 + botón Léemelo), verificado extrayendo `viewer-renderer.js` del asar instalado y con la app corriendo. Helper firmado con entitlement de micrófono (automático en `npm run deploy`).
- CI: compila el helper Swift antes de los tests (fix de la madrugada del 6-ago).
- **`autoReply` en `false`**: el bot de WhatsApp NO responde. Allowlist vacía — al encenderlo responde a cualquiera.
- Las 3 fichas de Turbo Energy: **validadas por Luismi**.
- Bridge WhatsApp en git, runtime `/status` → `ready`. LAN encendido (9999/10000, `192.168.1.14`). Electron 43.2.0.

## Última sesión (2026-08-06 mañana) — afinado de voz + botón Léemelo

- Luismi reportó los dos fallos del uso real: le cortaba al respirar y las frases largas llegaban incompletas. Diagnóstico: el 1,1s fijo de silencio + `task.cancel()` inmediato que tiraba la transcripción en vuelo. Fix = `83bd999` (detalle arriba), commiteado en el worktree de la sesión y mergeado a `main`.
- **El primer deploy (07:11) no llevaba el fix** — se construyó desde estado pre-merge. Detectado extrayendo el `main.js` del asar; redesplegado y verificado. De esa verificación salió la regla del `asar extract-file` de arriba (pisó el `main.js` del repo; restaurado con `git checkout` sin pérdida).
- Feature nueva pedida por Luismi sobre la marcha: **botón de lectura en voz alta en el visor de `.md`** (detalle arriba). Plan aprobado, implementado con TDD sobre el módulo nuevo, desplegado.
- Deploys lanzados con `nohup` desacoplado: si la sesión corre dentro de la app, el `quit` del deploy no se lleva el proceso por delante.

## Sesión previa (2026-08-06 madrugada) — push, CI roto, merge y deploy

- Push de `main` + `feat/modo-voz` (41 commits). PR #6: **primer CI rojo** — `resources/voice-helper` está gitignored y el workflow nunca lo compilaba (`ENOENT` en 5 tests). Arreglado añadiendo el paso Swift al workflow. Segundo CI verde, merge (`4303714`), deploy verificado.
- **Lección**: "pasa en mi máquina" ≠ "pasa en CI" cuando hay artefactos de build gitignored — el binario llevaba días compilado en disco y nunca se había corrido en limpio.

## Sesión previa (2026-08-05 noche) — la primera prueba real, y el modo voz quedó funcionando

**6 commits, 5 bugs de la primera prueba con micrófono real + 3 mejoras pedidas por Luismi con la voz ya oyéndose.** Detalle en "🚦 EMPIEZA POR AQUÍ". Método:

**Ninguno de los 5 bugs lo vio la suite.** Los cinco necesitaban micrófono, altavoz y un turno real. Se cazaron con logs del sistema (`log show`, `tccd`), el helper instrumentado a fichero y comparaciones de audio — no leyendo código.

**El síntoma engañaba.** Cuatro síntomas distintos eran consecuencias de la misma decisión (`setVoiceProcessingEnabled(true)`), pelados uno a uno según Luismi los reportaba en vivo.

## Sesión previa (2026-08-04 noche) — modo voz: medido y planificado, sin implementar

**Las mediciones tumbaron la decisión inicial.** Luismi eligió "todo local, coste cero"; ningún motor local transcribe al ritmo del habla en este i7 (whisper base RTF 1,41; Apple on-device 2,5–7,5). Con el dato cambió a servidores de Apple: 617 ms / 1022 ms, 0 €, el audio sale del Mac. Tablas: `tech/tech_modo_voz_mediciones.md`.

- `2adeee8` spec · `c804b94` plan 9 tareas TDD + helper Swift · `5c6824f`/`904da4f` memoria.
- ⚠️ **Feedback**: pidió "déjalo preparado" y tuvo que preguntar dos veces qué se había hecho (un `.swift` sin anunciar). Regla en `~/claude-shared/memory/02-feedback.md`: si me salgo del alcance literal, avisar antes en una línea.

## Sesión previa (2026-08-04 tarde) — tres bugs que los tests no podían ver

- **`127f98a`** — la app contaminaba a sus PTYs con la identidad de la sesión de Claude Code que la lanzó. `bugs/bug_pty_hereda_sesion_2026_08_03.md`.
- **`74e09b5`** — Telegram no respetaba el proyecto elegido. `decisions/telegram_proyecto_manda_2026_08_04.md`.
- **`8d55387`** — la instrucción de la app secuestraba el título de las sesiones de Telegram. `bugs/bug_telegram_titulo_sesion_2026_08_04.md`.
- LAN fuera de la WiFi: propuesta Tailscale, Luismi lo está pensando. Nunca port forwarding a pelo (sin TLS, token en query).

## Sesión previa (2026-08-03) — revisión multi-agente, bridge en git y caza de latencia

- 15 defectos de la KB cerrados (`audit_code_review_2026_08_03.md`).
- QR de WhatsApp: un `loggedOut` no se arregla reiniciando — borrar `.baileys_auth/` (desde el 3-ago lo hace solo). `bugs/bug_wa_qr_loggedout_2026_08_03.md`.
- **El bridge entra en git** (`9d4a110`). `decisions/bridge_en_git_2026_08_03.md`.
- Latencia del bot: `--strict-mcp-config --setting-sources ''` → 11,2 s → 6,9 s/turno. `tech/tech_latencia_cli_bot.md`.

## Próximo paso

0. **Luismi prueba**: (a) la pausa nueva al hablar (1,8s; slider si quiere más), (b) frases largas completas, (c) botón 🔊 en un `.md`. Si OK → commit `feat(visor): botón Léemelo` + push de los 2 commits (con su OK explícito).
1. **Probar los tres fixes del 4-ago (Telegram)**: sin aviso amarillo de transcript; `/proyecto` respetado; título de sesión real.
2. **Primer mensaje real del bot de WhatsApp** de punta a punta (mediana registrada: 29 s).
3. **Decidir la allowlist antes de encender `autoReply`** (vacía = responde a cualquiera).
4. Latencia restante del bot (~6,2 s/turno de modelo): `kbAnswerModel` haiku o CLI→API fast mode (factura aparte). Decisión de negocio.
5. LAN fuera de la WiFi (Tailscale) y prueba del cliente LAN.
6. Sincronizar las dos ventanas del panel al cambiar `autoReply` (hasta 15 s de retraso).
7. Heredado: fork en pool oculto/task-sessions; exclusión mutua voz/Telegram (`voiceTurnUntil`); modelo de codex; Monterey tope con Electron 43; certificado Apple.

## Notas operativas

- ⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app.** `osascript -e 'quit app "POWER-AGENT"'` (empaquetada) o `pkill -9 -f "claude-electron/node_modules/electron"` (dev).
- ⚠️ Muerte a lo bruto → **`SingletonLock` huérfano** → el siguiente arranque se suicida en silencio. Borrar `SingletonLock`/`SingletonSocket`/`SingletonCookie`.
- Dev y empaquetada comparten `userData` (`CLAUDE-NOVAK`) → nunca conviven.
- **`npx asar extract-file` extrae al cwd**: correrlo siempre desde el scratchpad, nunca desde el repo (ya pisó `main.js` una vez).
- **Editar el bridge en el repo y desplegar con `scripts/deploy-wa-bridge.sh`.**
- **Lanzar la app desde una sesión de Claude Code le pega su identidad** — mitigado en `buildRuntimeEnv()`; variables nuevas del CLI van a `CLAUDE_SESSION_IDENTITY_VARS`.
- **Todo lo que la app añada a un turno va como system prompt**, nunca pegado al mensaje del usuario.
- **Con proyecto elegido desde Telegram no hay fallback a las sesiones del Mac.**
- **Todo spawn del CLI que no sea sesión interactiva de Luismi va aislado** (`--strict-mcp-config --setting-sources ''`).
- **Tras cada `npm run deploy` se cortan las conexiones LAN** y las pestañas del operador necesitan cerrar y reabrir (no basta recargar).
- Dev/deploy vía `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan en ambos).
- El ruido `EGL ... Bad attribute` es cosmético (8/s, medido).
