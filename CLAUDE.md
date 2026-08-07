# POWER-AGENT Runbook

## 🚦 MODO VOZ — funciona de punta a punta, probado en vivo por Luismi (2026-08-05 noche)

Rama `feat/modo-voz` (40 commits sobre `main`), árbol limpio, **sin push, sin merge a `main`**. **953 tests (947 pass / 0 fail / 6 skip)**.

- Plan y spec originales: `docs/superpowers/plans/2026-08-04-voz-en-directo.md`, `docs/superpowers/specs/2026-08-04-voz-en-directo-design.md` (el porqué, con las latencias **medidas** en este Mac). Ambos describen el diseño de partida — la sección **"## Modo voz"** más abajo es la que manda hoy: recoge lo que cambió tras la primera prueba real.
- Estado vivo, pendientes y riesgos abiertos: `.claude/memory/STATE.md`.
- La primera prueba con micrófono real tumbó 5 cosas que ningún test veía (canales del micro, ENTER sin enviar, auto-corte al hablar, ducking de todo el audio del sistema, detector de forks con historial largo) — todas arregladas, detalle en la sección de abajo y en los commits `fix(voz):` del 2026-08-05.

## Latest Handoff
- **UPGRADE ELECTRON 2026-07-28 (rama `chore/electron-43`)** — Electron **32.3.3 → 43.2.0** (Chromium 128 → 150, Node interno 24.18.0, ABI 148), electron-builder 24 → 26.15.3, @electron/rebuild 3 → 4.2.0. Cierra **SEC-C3**, pendiente desde mayo: la 32 llevaba EOL desde ~marzo 2025. Tests 525 (519 pass / 0 fail / 6 skip). `npm audit --omit=dev`: 0 vulnerabilidades. Notas y trampas: `ELECTRON-43-UPGRADE-NOTES.md`. **Techo: Electron 43 es la última que soporta macOS 12 Monterey; la 44 exige Ventura.**
- **AUDITORÍA 2026-05-24 (commit `9f7f06a`, PR #1, rama `audit-fixes-2026-05-24`)** — 27 hallazgos cerrados (5 CRITICAL + 18 HIGH + 4 mejoras). Tests **254 → 418, 0 fail, 10 runs estables**. Detalle: `.claude/memory/audit_2026_05_24.md` + informes en `/tmp/audit-poweragent-2026-05-24/`. Nuevos módulos: `main/dir-helpers.js`, `main/pty-data-batcher.js`, `main/telegram-open-task-session.js`, `automations/security.js`, `vendor/xterm/*`. CI/CD añadido (`.github/workflows/test.yml`). Deployado a `/Applications/POWER-AGENT.app` 21:56. **SEC-C3 upgrade Electron sigue pendiente** (breaking, sesión humana). Reglas técnicas nuevas en MEMORY.md (LAN Bearer, `looksRemotePath`, `atomic-writes` 0o600, allowlist `save-app-config`, pool `notifyPtyExit`/`touchHiddenPty`/`chatId`, headless `origin`, índices con `flush()`, `vendor/`, batcher único).
- **`HANDOFF-CLAUDE-2026-05-23-TELEGRAM-HIDDEN-PTY-POOL.md`** — sesión 23 may (noche): C+ pool de PTYs ocultos para enlace universal Mac→Telegram. Nuevo `main/telegram-hidden-pty-pool.js` (TTL 15min, LRU max 3, sweep 60s, deps inyectables). Sink Telegram spawnea PTY oculto cuando run.status=ok+claude+sessionId → binding queda en `telegramRelayByChat` → onRunQuery enruta directo a relay PTY sin headless. Adaptaciones: `openTaskSessionWindow` acepta `hidden:true`, taskState ahora tiene `activeCli/claudeSessionId/relayActive` (drop-in para `relayThroughPty`), `getRelayBindingForChat` mira también `taskSessionStateByWc` vía `getTaskSessionByWcId`. `/abrir` desde Telegram consulta primero el pool: si la ventana ya estaba oculta, la muestra; si no, spawna normal. Codex sigue por headless (relay PTY no delimita bien fin de turno). 22 tests nuevos (213 pass / 0 fail). Sin commit.
- **`HANDOFF-CLAUDE-2026-05-23-FASE-B-LISTADO-EFICIENTE.md`** — sesión 23 may (tarde): Fase B listado eficiente. Stream JSONL Claude + cache persistente keyed por mtime+size (`userData/claude-sessions-index.json`). Índice persistente Codex por cwd con watcher fs incremental (`userData/codex-sessions-index.json`). Paginación 50+ en sidebar y picker. 2 agentes general-purpose en paralelo + integración + paginación. 33 tests nuevos. Commits e6caa1d+4c506ed+6600f97+f6a570f+625a33d+05f3dcc. Tests 171/0. **REGLA NUEVA:** `createSessionListing` usa late binding (getter) para índices porque main.js los crea después de top-level; siempre mantener fallback al walk si índice vacío.
- `HANDOFF-CLAUDE-2026-05-23-CWD-FIRST-STARTUP.md` — sesión 23 may (mañana): arranque cwd-first. App no spawn-ea PTY auto al boot. Overlay "Elige proyecto" → vista "Elige sesión" (toggle Claude|Codex) → spawn. Multi-PTY (+ topbar). `main/recent-cwds.js`, `main/last-context.js`, `project-picker.js`. Bugs arreglados: resume-session codex, TCC EACCES en recientes, asar whitelist en package.json. Commits 889c613+0f97dd8+ef1c470+581cefd. Tests 138/0. **REGLA CRÍTICA NUEVA:** `package.json` `build.files` es whitelist — todo `.js`/`.html` nuevo en raíz debe añadirse a mano.
- `HANDOFF-CLAUDE-2026-05-22-NIGHT-TASKS-AGENT-FIRST-ROLLBACK.md` — sesión tarde/noche 22 may: refactor Tareas a agente-first → revertido a form clásico + botón 📌 "Programar este prompt" en topbar + auto WaitForMcpServers en scheduler. Fix Telegram sink (Set/Array). Fix cwd default a $HOME. Bandeja 🔔, popup PTY task-session, vista detalle + RUNS sidebar. Borrados: task-agent-pty.\*, task-chat.\* (burbujas), botón "+ Asistente", `#session-info-block`. Empezar por aquí si tocas Tareas/scheduler.
- **`HANDOFF-CODEX-2026-05-22-WHATSAPP-GRUPOS-AUTO-GLOBAL.md`** — cierre de continuidad: grupos forzados a MANUAL (backend+UI) y botón `AUTO TODO` para forzar AUTO masivo en chats individuales.
- **`HANDOFF-CODEX-2026-05-22-WHATSAPP-PANEL-CONTINUIDAD-FINAL.md`** — continuidad final WhatsApp (STOP/START bridge estable sin refresh manual, QR modal con polling+reintento, descarga de media desde visor y fix de race: auto-reply global OFF invalida colas pendientes + apaga typing UI).
- **`HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md`** — RELEASE ACTUAL (1.3.0). Ola 1 + Ola 2 + post-fixes: Electron 32 LTS, main.js modularizado a 34 módulos en `main/`, WhatsApp bridge con auth token, sesiones Codex en LAN, hot session switch, drag&drop con webUtils. Tag `release-1.3.0-2026-05-22`. Empezar SIEMPRE por este archivo.
- `HANDOFF-CODEX-2026-05-21-REMOTE-SESSION-CONTINUIDAD-CHAT-FIRST.md` (continuidad final de sesión remota LAN: flujo cámara/archivo chat-first, fixes de ACL read-only, despliegue y pendientes de rediseño/refactor UX).
- `HANDOFF-CODEX-2026-05-21-CONTINUIDAD-POST-PRUEBAS.md` (continuidad exacta tras modo empresa: estado, commits, incidencias reales de Luis, backlog móvil/visor/upload y prompt para nuevo Codex).
- `HANDOFF-CODEX-2026-05-21-ENTERPRISE-MULTIOPERADOR.md` (modo empresa multioperador: modelo, ACL FS, persona por sesión, MCP policy básica y auditoría).
- `HANDOFF-CLAUDE-2026-05-18.md` (estado final Telegram relay PTY, sesiones, lupa y grafo cerebro).
- `HANDOFF-CLAUDE-2026-05-18-FINAL-REACTOR.md` (estado final actual: root reactor x3, despliegue limpio de una sola app).

## Para CUALQUIER agente nuevo (Claude o Codex)
1. Leer **`HANDOFF-CODEX-2026-05-22-WHATSAPP-PANEL-CONTINUIDAD-FINAL.md` ENTERO** antes de tocar WhatsApp/panel bridge.
2. Leer **`HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md` ENTERO** antes de tocar arquitectura general.
3. Leer también `HARDENING-WA-AUTH.md` si vas a tocar WhatsApp.
4. Leer `ELECTRON-32-UPGRADE-NOTES.md` si vas a tocar APIs de Electron o `protocol.*`.
5. Leer `SIGNING-NOTARIZE-SETUP.md` solo si tocas firma/distribución.
6. Versión actual: **1.3.0**. Electron **43.2.0** (Chromium 150). Node de desarrollo `>=20.18.0`. `main.js` ya modularizado en 34 archivos `main/*.js`.
7. Rollback de emergencia: `git reset --hard pre-ola2-2026-05-22` (vuelve a 1.2.0/Electron 20).

## Scope
- Project path: `/Users/isabel/Desktop/LUISMI/claude-electron`
- App type: Electron desktop app with `node-pty` terminal + Whisper dictation.
- Client install checklist: `INSTALACION_CLIENTE.md`

## Regla critica WhatsApp (OBLIGATORIA)
- Nunca enviar mensajes a numeros locales ambiguos (ej. `653765305`) sin prefijo internacional confirmado.
- Si el usuario no indica pais/codigo, preguntar siempre antes de enviar: `¿Que pais/codigo uso para este numero?`.
- Solo se permite enviar cuando:
  - el numero llega en formato internacional (`+...` o `00...`), o
  - el usuario confirma explicitamente el codigo de pais (ej. `--cc 34`).
- Queda prohibido asumir `+34` (o cualquier otro pais) por defecto.
- Ante duda de formato/destino: bloquear envio y pedir confirmacion.

## Git automático por sesión

- **Qué hace**: cada sesión (ventana local o sesión LAN) con `cwd` dentro de un repo git local trabaja en su propio `git worktree` + rama `poweragent/session-<key>`, no en el directorio real. `session.cwd` sigue mostrando el path real (UI/recientes intactos). Al cerrar la sesión: commit automático → sin cambios se limpia en silencio → con cambios se intenta merge a la rama del dir real (solo si está limpio) → merge limpio borra rama/worktree y hace `push` si hay upstream.
- **Toggle**: `cli.gitSessionIsolation` (Configuración → "Aislamiento git por sesión"), default ON. Escape hatch total: en OFF, o si el cwd no es repo git, o es path remoto (NAS/SMB), o falla cualquier comando git → fail-open al flujo de siempre, sin bloquear el spawn.
- **Ramas de conflicto**: si el merge da conflicto o el dir real está sucio, la rama `poweragent/session-<key>` queda viva con los cambios (no se borra) y se avisa: `Notification` de macOS en ventana local, `console.warn` + frame `status` por WebSocket en LAN. Revisar y mergear a mano esas ramas.
- **Ubicaciones**: worktrees en `userData/worktrees/<repoSlug>-<sessionKey>/`; registro de sesiones en `userData/session-git-map.json` (mapea `claudeSessionId → { realCwd, branch, worktreePath, active }`, atomic writes, flush en `before-quit`). Sweep de huérfanos al arrancar (`git worktree prune` + finalize de entradas `active: true` sin PTY vivo). El registro **solo se escribe cuando la sesión llega a generar un `claudeSessionId`**, así que el arranque completa el barrido con `discoverUnregisteredWorkspaces()`: escanea `userData/worktrees/`, y todo worktree que no esté en el registro se trata como huérfano (al arrancar no hay ningún PTY vivo y la app es single-instance). Se recupera igual que los registrados: commit → merge → limpieza.
- **Qué NO está aislado**: automation PTY (`startAgentPty`) y task-sessions/pool oculto de Telegram (`startTaskSessionPty`) siguen con `--resume` sobre el cwd original. Pendiente integrarlos cuando esto esté validado en uso real. El sub-chat desechable (`main/subchat-pty.js`) tampoco pasa por `ensureSessionWorkspace`: hereda el `workCwd` del worktree de su sesión madre (mismo aislamiento que ella, sin worktree propio). Es un hilo de consulta; si edita archivos, los cambios caen en la rama de la madre.
- **Regla para spawns nuevos**: cualquier spawn de PTY nuevo debe decidir explícitamente si pasa por `ensureSessionWorkspace`/`prepareSessionWorkspace` (aislado) o queda excluido — y documentarlo aquí. No dejarlo implícito. `respawnAfterCliUpdate` (reinicio tras auto-update del CLI) **no** vuelve a llamar a `ensureSessionWorkspace`: reutiliza el `session.gitWorkspace` ya creado, así que sigue en el mismo worktree y la misma rama. El **modo voz** (`main/voice-send-target.js`) **no spawnea ningún PTY propio**: el modo "encargo" escribe en el PTY de la sesión madre (aislado como ella) y el modo "charla" reutiliza `subchat-pty` (excluido a propósito, hereda el `workCwd` de la madre). El helper Swift de voz no es un PTY y no toca el repo. El **botón "Llevar a Terminal"** (`main/terminal-handoff.js`, 2026-08-07) tampoco spawnea PTY: mata el de la sesión y, tras **esperar** el finalize del worktree (`copySessionsHome` incluido — sin eso el resume no encuentra la conversación en el cwd real), abre Terminal.app con `claude --resume`/`codex resume`. Guarda: sin `session.pty` no hay handoff (`claudeSessionId` sobrevive a la muerte del PTY y abriría una conversación vieja).
- **CERRADO 2026-08-06 — exclusión mutua entre el modo voz y Telegram sobre el mismo PTY.** El encargo por voz marca `session.voiceTurnUntil = Date.now() + 180000` justo antes de escribir en el PTY (`sendToMother`, `main/voice-send-target.js`; se limpia solo si la propia escritura falla), y `relayThroughPty` lo respeta igual que `relayActive`: espera hasta 30s a que se libere y, si no, devuelve null (chat enlazado → error claro, no fallback headless). El cerrojo se suelta en el **onDone del vigía** (turno completado = claude terminó de escribir; sin esto el chat enlazado daba "sesión no disponible" hasta 3 min tras cada turno de voz — bug real 2026-08-06, test en `voice-session.test.js`) y además **caduca solo** (180s, mismo techo que MAX_WAIT_MS del relay y que el vigía) como red para vigía muerto — el timeout del vigía NO lo suelta a propósito (el turno puede seguir corriendo). Helper puro `voiceTurnLockActive(session, now)` exportado de `voice-send-target.js`. Tests: `tests/voice-telegram-lock.test.js`. La charla (sub-chat) NO toca el cerrojo: no comparte PTY con Telegram.
- **Dónde vive el transcript: NO se adivina por cwd.** Claude Code decide según cómo nació la sesión — una sesión **nueva** dentro del worktree escribe en `~/.claude/projects/<worktree-codificado>/`, pero una **resumida** (`--resume <id>`) sigue escribiendo en el proyecto ORIGINAL aunque el proceso corra en el worktree. Adivinar por cwd falla siempre en una de las dos direcciones. Usar `findRelayTranscript({ sessionId, cwds })` (`main/relay-transcript-helpers.js`), que busca el fichero `<sessionId>.jsonl` en los cwds candidatos (`relayCwdCandidates(session)`) y, si no aparece, barre todo `~/.claude/projects`. Regresión real 2026-07-28: el relay no encontraba el turno, nunca veía `end_turn` y a los 45s mandaba el TUI raspado (spinners, banner de bienvenida, historial repetido). Cubierto por `tests/relay-transcript-locate.test.js`.
- **CERRADO 2026-08-02** (antes "pendiente conocido"): la ruta **headless** de Telegram ya NO depende de `getCwdSync()`. `onRunQuery` resuelve el cwd con `resolveResumeCwd(sessionId)` (`main/relay-transcript-helpers.js`): barre `~/.claude/projects` por `<sessionId>.jsonl` y saca de las líneas del JSONL el cwd que codifica al directorio contenedor Y existe (no vale "el primero que aparezca": una sesión nacida en worktree mezcla cwds muertos). Si la sesión es huérfana (`No conversation found`), reintenta con conversación nueva. Cubierto por `tests/telegram-headless-resume-cwd.test.js`.
- **Limitaciones documentadas**: (0) el `add -A` del finalize commitea artefactos que el `.gitignore` NO matchea por usar patrón con barra final — caso real: un symlink `node_modules` creado en el worktree para correr tests acabó commiteado (`node_modules/` solo matchea directorios, no symlinks). Usar patrones sin barra para lo que pueda aparecer como symlink, y nunca symlinkar `node_modules` dentro de un worktree; (1) archivos gitignored creados durante la sesión se pierden al finalizar (`worktree remove --force`; `add -A` respeta el gitignore); (2) sesiones CODEX nacidas en worktree no aparecen en el historial del proyecto (el índice codex bucketiza por cwd del rollout) — limitación v1 consciente; (3) el operador LAN no ve el aviso de conflicto si el socket ya cerró (el dueño del Mac conserva la rama y el `console.warn`).
- Módulos: `main/session-git.js` (lógica git + registro), `main/session-git-map.js` (persistencia). Detalle de diseño: `docs/superpowers/specs/2026-07-24-git-auto-por-sesion-design.md`.

## Relay de Telegram (claude): el JSONL manda, la pantalla no

- **Fuente de verdad = transcript**, nunca el TUI. `cleanRelayFallbackText` ya NO se usa en la rama claude: sin texto en el transcript se devuelve error (`RelayEmpty`) en vez de mandar la pantalla raspada. Solo queda vivo para codex.
- **Fin de turno = `turnComplete`**, o sea: el ÚLTIMO evento `assistant` del turno tiene `stop_reason: 'end_turn'`. `sawEndTurn` a secas no vale — con `tool_use` por medio puede ser cierto mientras el turno sigue vivo. Los eventos con `isSidechain: true` (sub-agentes Task) se ignoran: escriben su propio `end_turn` y cortarían el turno a mitad.
- **El relay escribe el ENTER APARTE del texto** (2026-08-06, `main/pty-prompt-write.js`): `relayThroughPty` mandaba `message + '\r'` en un solo write y el TUI lo trataba como pegado — el `\r` acababa como salto de línea DENTRO del prompt y el turno se quedaba escrito sin enviar (misma regla dura que el modo voz descubrió el 2026-08-05). Con textos cortos colaba; una transcripción de voz larga lo destapó. Todo write de prompt a un PTY de claude debe pasar por `writePromptThenEnter`.
- **Disparo por polling del JSONL** (`TRANSCRIPT_POLL_MS = 300`), no por silencio del PTY. Antes había que esperar 2,2s de silencio y, en turnos con herramientas (silencios de ~9s medidos), se acababa en los topes de 15s/45s. Los timers de silencio siguen como red de seguridad.
- **Lectura parcial obligatoria**: `extractAssistantTextFromTranscript` lee solo desde el offset con `openSync`+`readSync`, y el poll hace `stat` antes de parsear. Con `readFileSync` entero, un transcript de 14MB se releía 3 veces por segundo.
- **Trampa del offset**: si el offset cae justo tras un `\n`, la primera línea del slice está completa y **no** hay que descartarla. Descartarla siempre (bug hasta 2026-07-28) se comía la primera línea nueva, que suele ser la respuesta.
- **El `--resume` interactivo FORKEA el sessionId** (regla dura, bug real 2026-08-02): al resumir una sesión en el TUI, Claude Code crea un sessionId NUEVO con el historial copiado y escribe ahí los turnos; el `.jsonl` viejo no crece jamás. Un relay enganchado al sessionId del spawn espera 45s y muere en RelayEmpty. `relayThroughPty` lo cubre: snapshot de los `.jsonl` candidatos pre-write y, si el transcript esperado no crece en ~2s, `detectForkedRelayTranscript` adopta el fichero nuevo/crecido **que contenga el prompt del turno** (exigido — sin esa coincidencia no se adopta nada, para no secuestrar la sesión concurrente de otra ventana) y actualiza el sessionId en sesión y chat. Cubierto por `tests/relay-fork-detection.test.js`. **CERRADO 2026-08-06 para pool oculto y task-sessions**: `startTaskSessionPty` usa `main/task-session-fork-watch.js` (mismas guardas que el detectFork de `startPty`: solo ficheros NUEVOS, exclusión de ids con dueño, ambigüedad ⇒ no adoptar, sub-chat vivo ⇒ refrescar foto; mira el cwd Y el proyecto original del id resumido vía `resolveResumeCwd`). El vigía anterior (`findUpdatedOrNewClaudeSessionId`) adoptaba también ficheros que solo habían CRECIDO — es decir, la sesión interactiva del usuario en el mismo proyecto — y esa adopción se persistía en la tarea (`persistTaskSessionIdRotation`) y en el relay: era una causa raíz de "se mezclan las sesiones". Tests: `tests/task-session-fork-watch.test.js`.
- **El spawn con `--resume` también forkea, y el id de los args se pudre en el sitio** (2026-08-05): `startPty` fijaba `session.claudeSessionId = extractClaudeResumeId(args)` y el poll de detección salía antes de tiempo por venir el campo ya relleno, así que una sesión abierta desde el picker "elige sesión" se quedaba **para siempre** con el id muerto. Consecuencia silenciosa: el sub-chat (`--fork-session` sobre `session.claudeSessionId`, `main/subchat-pty.js`) heredaba un contexto congelado en el instante del resume. Ahora hay un segundo poll (60 s de ventana) que adopta el `.jsonl` que no existía antes del spawn y no es el resumido — `pickForkedSessionId` en `main/voice-send-target.js`, cubierto por tests. Sin prompt con el que verificar no hay otra señal; donde SÍ hay prompt manda siempre `detectForkedRelayTranscript`. **Tres guardas, y las tres hacen falta**: (a) no se adopta un id que ya tiene dueño — `knownClaudeSessionIds()` junta sesiones vivas, `voiceSubchatSessionId`, `taskSessionStateByWc` (que cubre también los PTYs ocultos del pool de Telegram) y los ids de los sub-chats **vivos y también de los ya cerrados** (`subchatManager` los retiene: un sub-chat muerto deja su `.jsonl` en disco y su id sigue siendo adoptable); (b) si aparece **más de un** `.jsonl` nuevo entre todos los proyectos, no se adopta ninguno (un fork del propio spawn aparece solo; dos significan otro actor); (c) **mientras haya un sub-chat vivo (`subchatManager.hasAny()`) no se adopta nada y además se refresca `forkScanBefore`** con lo que hay en disco, porque `--fork-session` escribe en los mismos proyectos y, si la madre aún no ha escrito, es el ÚNICO fichero nuevo — la guarda (b) no lo tapa y la madre acababa adoptando el id de su propio sub-chat, incluso después de cerrarlo. El refresco tiene un precio consciente: si el fork propio de la madre nace mientras hay un sub-chat abierto, se absorbe en la foto y ya no se adopta por esta vía. Renunciar deja el id como estaba, que es el statu quo, y el relay o el modo voz lo reparan por prompt en el primer turno.
- **Todo fork con sessionId propio tiene que registrarse en algún sitio, o alguien lo adoptará.** `main/subchat-pty.js` fotografía el proyecto antes del spawn y polea (1 s × 20) hasta saber su propio id forkeado, que expone por `sessionIds()`. Antes ese id no existía para nadie: ni el módulo ni `main.js` lo conocían, y era el vector del bug de arriba. **Si añades otro spawn que forkee (`--fork-session`, `--resume`), regístralo igual.** Fuentes que hoy siguen cubiertas SOLO por la guarda de ambigüedad, y por tanto adoptables si aparecen solas: el **headless de `onRunQuery`** de Telegram (hace `--resume` en el cwd resuelto y no está ni en `sessions` ni en `taskSessionStateByWc`) y un **`claude` lanzado a mano** en una terminal dentro del mismo proyecto. Riesgo real pero acotado a **dos ventanas**: los 60 s del `detectFork` posteriores a resumir una sesión, y los 20 s del poll con el que cada sub-chat aprende su propio id (`SID_POLL_MS` × `SID_POLL_TRIES` en `main/subchat-pty.js`), donde el sub-chat podría quedarse con un `.jsonl` ajeno.
- **Un `baseOffset` de 0 sobre un transcript forkeado es una bomba.** Un fork nace con TODO el historial copiado, y ese historial acaba en `end_turn`: quien lea desde 0 cierra el turno en el primer poll y se queda con la respuesta ANTERIOR. `detectForkedRelayTranscript` devuelve exactamente 0 cuando el fichero no estaba en el snapshot previo. El modo voz nunca propaga ese 0 (`safeForkOffset` recalcula el offset en la línea del propio prompt y, si no la encuentra, descarta el fork). Ojo si se reutiliza `detectForkedRelayTranscript` en sitios nuevos: `relayThroughPty` se salva porque además pasa `startedAt` como `minTimestampMs`, y el vigía del modo voz (`main/voice-turn-watcher.js`) pasa 0.
- **Elección de proyecto/sesión desde el bot** (2026-08-02): `/proyecto` y `/sesiones` con botones inline (`callback_query` en el `getUpdates`, responder siempre con `answerCallbackQuery`). El cwd elegido se persiste por chat en `telegram-sessions.json` y viaja como `chatCwd` al enrutado. Orden de enrutado con 2+ sesiones: binding PTY > sessionId persistida del chat (headless en su cwd real) > sesión primaria > headless nuevo en `chatCwd`.

## Auto-update de los CLI dentro del PTY

- **PATH del PTY**: en `main/cli-resolver.js` `buildRuntimeEnv()`, el bin de nvm va **antes** de `/usr/local/bin`. Si gana el node de `/usr/local`, su prefix global es `/usr/local/lib/node_modules` (no escribible) y el `npm install -g @openai/codex` del auto-update de codex ("1. Update now") muere con **EACCES**. Cubierto por `tests/cli-env-path.test.js`. No reordenar sin leer ese test.
- **Reinicio**: codex se cierra tras actualizarse ("Please restart Codex"). `main/cli-update-watch.js` detecta `Update ran successfully` en la salida del PTY (tolera el marcador partido entre chunks) y `main.js` relanza la sesión con los mismos args (`session.lastPtyArgs`) en vez de emitir `pty-exit` — sin eso, el renderer daba la sesión por terminada y abría el picker. Máx. 1 reinicio automático por ventana de 10 min.
- El renderer recibe `pty-restarting` (no `pty-exit`): escribe el aviso, mantiene `has-pty` y no toca el picker.

## Modo voz

- **Motor: Apple Speech en modo SERVIDOR**, no on-device. Medido en este Mac (i7-4770HQ de 2014): los tres motores locales probados (whisper.cpp base/small, Apple on-device) tienen RTF > 1 — tardan más en transcribir que lo que dura el audio — y el on-device de Apple encima se desploma con audio largo (RTF 7,5 a los 15s). Servidor: **617 ms** al primer texto, **1022 ms** desde que callas, 0 €. **No "optimizar" esto a on-device: está medido y no funciona en este hardware.** Consecuencia asumida por Luismi con el dato delante: el audio de las frases sale del Mac hacia los servidores de Apple, igual que el dictado nativo de macOS. Tablas completas: `.claude/memory/tech/tech_modo_voz_mediciones.md`.
- **NO se usa `setVoiceProcessingEnabled` (cancelación de eco).** Se probó, funcionaba para el eco, y se quitó igual: activa VoiceProcessingIO, que (a) cambia el nodo de entrada de 2 a 4 canales — `SFSpeechAudioBufferRecognitionRequest` no los digiere y devuelve `kAFAssistantErrorDomain 1110` ("no speech detected") con audio de sobra; y (b) mete el proceso en "modo comunicación" de CoreAudio, con macOS aplicando ducking a **todo el audio del sistema** (música incluida) mientras el micro está abierto. Ninguno de los dos se vio hasta la primera prueba real. Como el micro ya se cierra mientras habla (ver más abajo), la cancelación de eco no compraba nada que no se perdiera ya al cerrar el micro — se quitó entera. Precio: sin música/ruido alto de fondo mientras escucha, el reconocimiento pierde precisión (no medido con datos).
- **`voice-helper` (`voice-helper/VoiceHelper.swift`, compilado a `resources/voice-helper` vía `extraResources`, fuera del asar) es el primer proceso hijo persistente del repo que no es un PTY.** Protocolo NDJSON por stdin/stdout, envuelto en Node por `main/voice-helper-process.js` (reensamblado de líneas partidas + freno de reintentos, patrón de `main/native-notify.js`). Tres trampas ya resueltas dentro del `.swift` (detalle en `tech_modo_voz_mediciones.md`): `emit` asíncrono (se llama desde el hilo de CoreAudio; bloquearlo con E/S corta el audio), la cola de salida se drena antes de morir (si no, el último evento se pierde y Node espera una respuesta que no llega), y permisos en perezoso (pedirlos al arrancar mata el proceso fuera de un bundle — ver punto siguiente).
- **`SFSpeechRecognizer.requestAuthorization` solo responde dentro de una app con bundle lanzada por LaunchServices.** Un binario suelto no consigue el permiso ni con firma ad-hoc — el callback no llega nunca y el proceso muere en silencio. Por eso el helper vive siempre como hijo de la app empaquetada, y su parte de audio **no se puede testear desde CI ni desde un shell suelto**.
- **La app no está firmada con certificado de Apple** (firma ad-hoc): el permiso de micrófono/reconocimiento se ancla a esa firma, así que **es probable que macOS lo vuelva a pedir tras algunos `npm run deploy`** (la firma cambia en cada build). Mismo patrón que las notificaciones nativas en Electron 43. **Desde 2026-08-05 `scripts/deploy.sh` empaqueta y firma el helper solo**: envuelve `resources/voice-helper` en `VoiceHelper.app` (bundle propio con `Info.plist` — macOS no enseña el diálogo de micrófono a un binario suelto), firma helper y app, y verifica que el entitlement de audio sobrevivió. Antes esto se hacía a mano y **cada deploy lo borraba**, dejando el modo voz sin micrófono. Detalle: `.claude/memory/tech/tech_modo_voz_permisos_macos.md`.
- **Seis módulos en `main/`, cada uno con un trabajo**: `voice-helper-process.js` (proceso hijo + protocolo), `voice-session.js` (máquina de estados `idle→listening→thinking→speaking`, dueña del helper), `voice-router.js` (decide encargo/charla — ver punto siguiente), `voice-send-target.js` (dónde escribe cada turno y qué transcript vigilar — aquí viven las trampas del fork del sessionId, ver abajo), `voice-speakable.js` (markdown → prosa hablable: fuera código, diffs, tablas, URLs; tope de 2000 caracteres con corte en fin de frase si hay que recortar — si no queda nada que decir, no se habla), `voice-turn-watcher.js` (vigila el `.jsonl` hasta `turnComplete` reutilizando `main/relay-transcript-helpers.js`). UI: `voice-ui-state.js` en la raíz (lógica pura evento→acción, sin DOM ni IPC — `renderer.js` no se testea en ningún sitio del repo, así que la lógica que importa se extrae siempre a un módulo aparte).
- **Destino por defecto = sesión de trabajo, no sub-chat** (decisión de producto, 2026-08-05, tomada con la voz ya funcionando). `voice-router.js` ya NO clasifica por patrones — se retiró entero un detector de intención de ~200 líneas (verbos de ejecución al inicio, cortesías, retractaciones, preguntas; vive en el historial de git si algún día vuelve un modo mixto). Hoy todo lo que dices va a la sesión de trabajo salvo que actives el toggle. Botón **⚡/💬** junto al de voz (topbar, solo visible con el modo voz encendido) alterna el destino del turno siguiente — es la ÚNICA forma de mandar algo al sub-chat. Cada encendido del modo voz arranca en ⚡ explícitamente.
- **El ENTER va SIEMPRE en su propia escritura al PTY, nunca pegado al texto** (`prompt` y `'\r'` por separado, con 150 ms entre medias — `main/voice-send-target.js`). El TUI de Claude Code trata lo que llega pegado como un pegado: un `'\r'` al final del mismo `write` se leía como salto de línea DENTRO del prompt, y el turno se quedaba escrito sin enviar. Bug real, primera prueba 2026-08-05.
- **El modo voz no reutiliza `relayThroughPty`** (~375 líneas inline en `main.js`, acopladas a Telegram y codex, sin exportar): usa `main/voice-turn-watcher.js` sobre los helpers genéricos y ya testeados de `main/relay-transcript-helpers.js`.
- **El sub-chat de voz forkea el sessionId igual que cualquier `--fork-session`** — el mecanismo, las tres guardas y las dos ventanas de riesgo (60s del `detectFork` en `startPty`, 20s del poll de `main/subchat-pty.js`) ya están detallados en "§Relay de Telegram" y "§Git automático por sesión" más arriba en este fichero. Lo específico de voz: `session.voiceSubchatSessionId` es el caché que usa el vigía para saber a qué `.jsonl` mirar, y se limpia al cerrar el sub-chat (`subchat:close` en `main.js` — un sub-chat cerrado deja su `.jsonl` de crecer para siempre).
- **El micro se cierra mientras habla Y mientras piensa** (`main/voice-session.js`, cambiado 2026-08-05 tras la primera prueba real — el diseño original decía esto mismo, una desviación posterior lo abrió mientras hablaba para el barge-in por voz, y esa desviación se revirtió). Medido en la app: con el micro abierto mientras hablaba, el helper captaba su propia voz por el altavoz (rms 0,03 contra un umbral de 0,012) y se auto-interrumpía al segundo, dos de dos. **Se pierde el barge-in por voz** (hablarle encima ya no le corta) — para cortar, el botón del modo voz. El micro vuelve a abrirse solo en `speech-end`; el guardia de tiempo (`SPEAK_GUARD_*`) cubre que ese evento no llegue nunca.
- **`#btn-mic`** (dictado Whisper, barra del terminal) **y `#btn-voice`** (modo voz, topbar, icono de ondas — no de micrófono) **son cosas distintas**: el primero escribe en el prompt y funciona sin red; el segundo conversa y necesita red.
- **Solo `claude`.** Codex no delimita bien el fin de turno (mismo motivo por el que el relay de Telegram tampoco lo soporta por PTY). Se revalida en cada turno dentro de `voice-session.js` (apaga el modo si la sesión deja de servir) y además en el renderer (gate del botón: deshabilitado con codex, se apaga solo si cambias de CLI con la voz encendida — cubre las tres vías: selector de CLI de la topbar, Ajustes → CLI por defecto, y reanudar una sesión de codex desde el modal de sesiones anteriores).
- **Un dueño a la vez**: el micro es del sistema, no de la ventana (`voiceOwnerWcId` en `main.js`). Otra ventana que intente encenderlo ve "el modo voz ya está activo en otra ventana"; no hay sincronización en vivo entre ventanas — una ventana no dueña se entera al intentar encenderlo ella misma o al recargar.
- **`cli.voiceId` y `cli.voiceRate` se persisten** (Configuración, whitelist `SAFE_CLI`) **y ya tienen selector en la UI** (desplegable de voces con calidad premium/mejorada/básica + slider de velocidad, sección CLI de Configuración). `voice:voices` (IPC) arranca el helper si hace falta para listar voces (permisos perezosos: listar no toca el micrófono) y lo para si no se estaba usando ya. `applyVoicePrefsToHelper()` en `main.js` empuja el cambio al helper vivo tras `enable()` y al guardar Configuración — se oye en la frase siguiente, sin apagar y encender el modo voz. Las voces es-ES instaladas de fábrica son todas `default` (suenan a robot); mejora descargando *Mónica (Mejorada)* o *Jorge (Premium)* desde Ajustes del sistema → Accesibilidad → Contenido hablado → Gestionar voces.
- **El helper solo maneja UNA frase a la vez**: su `speakingId` es único y cada `speak` lo pisa (los `speech-end` salen con id equivocado si encolas en él). Lecturas largas se encolan desde Node — trozo, esperar su `speech-end`, siguiente. Así lo hace `main/viewer-speech.js` (botón 🔊 "Léemelo" del visor de archivos), que además multiplexa el helper con voice-session por prefijo de id (`viewer:`): consume sus eventos antes de que los vea la máquina de estados, los `hello` los ven los dos (un `hello` a mitad de lectura = helper reiniciado = la frase en vuelo murió). Con el modo voz encendido el visor no lee (el micro abierto se oiría a sí mismo).
- **`{cmd:'vocab'}` (para nombres de módulos del proyecto vía `contextualStrings`) existe en el protocolo del helper, pero nadie lo manda todavía.** Si el checklist manual detecta que transcribe mal la jerga del repo, ese es el enganche que falta — no un fallo del reconocimiento en sí.
- **Verificado con `npm run deploy` real** (el camino que usa Luismi): el helper llega con el bit de ejecución, se empaqueta y se firma solo, y el ciclo completo (escucha → transcribe → envía → responde → lee) funciona en la app instalada. **Sin verificar todavía**: `npm run dist`/`build:zip` a secas, que no pasan por `scripts/deploy.sh` — si alguna vez se usan para distribuir, revisar que el bit de ejecución y la firma del helper sobrevivan igual. Y solo se ha compilado `x86_64` (este Mac es Intel); un build `arm64` empaquetaría el binario equivocado sin avisar.

## Incident history
- Date: **2026-05-14**
- Symptom 1: app crash on startup (`SIGABRT`, stack in `_RegisterApplication` / `NSApplication`).
- Symptom 2: packaged app crash with secure-restorable-state warning behavior.
- Symptom 3: `.dmg` build failure from constrained environments.

## Root cause summary
- Startup crash was tied to macOS saved application state + missing explicit secure restorable-state opt-in.
- DMG build failure was environment-level: `hdiutil` cannot run in sandboxed sessions (`Cannot start hdiejectd because app is sandboxed`).

## Permanent fixes applied
1. `package.json` now includes:
   - `build.mac.extendInfo.NSApplicationSupportsSecureRestorableState = true`
2. New recovery script:
   - `npm run reset:state`
   - Backs up these folders if present:
     - `~/Library/Saved Application State/com.github.Electron.savedState`
     - `~/Library/Saved Application State/com.luismi.claude-electron.savedState`
     - `~/Library/Saved Application State/com.luismi.claude-novak.savedState`
3. New diagnostics script:
   - `npm run doctor`
4. More robust CLI resolution in `main.js`:
   - Uses env vars / `~/.local/bin` / PATH fallback for `claude`, `codex`, `whisper`.
5. PTY hardening in main/renderer:
   - Validates active CLI before spawn.
   - Emits `pty-error` to UI with explicit message instead of silent failure.
   - Restart/session resume paths now reject properly on spawn errors.
   - CLI switch includes rollback to previous CLI if restart fails.

## Protocolo de despliegue y prueba

### Regla de oro
Después de cualquier cambio de código, probar SIEMPRE en **modo dev** antes de empaquetar.

### Cómo lanzar en modo dev (desde Claude Code / agente)

⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app** (verificado 2026-07-28: la instancia sobrevive y sigue creando helpers). Usar el cierre ordenado de macOS para la empaquetada y `pkill -9` para la de dev.

```bash
# 1. Matar cualquier instancia previa (dev Y empaquetada)
osascript -e 'quit app "POWER-AGENT"' 2>/dev/null          # empaquetada: cierre ordenado (dispara before-quit)
pkill -9 -f "claude-electron/node_modules/electron" 2>/dev/null   # dev
sleep 3

# 2. Si la app murió a lo bruto, limpiar el lock huérfano (si no, el siguiente
#    arranque se suicida EN SILENCIO, sin ningún mensaje de error)
UD="$HOME/Library/Application Support/CLAUDE-NOVAK"
[ -e "$UD/SingletonLock" ] && ! pgrep -f "claude-electron/node_modules/electron" >/dev/null \
  && rm -f "$UD/SingletonLock" "$UD/SingletonSocket" "$UD/SingletonCookie"

# 3. Lanzar en la sesión gráfica del usuario vía osascript
osascript /tmp/launch_poweragent.scpt
# Si el script no existe, créalo primero:
cat > /tmp/launch_poweragent.scpt << 'EOF'
set projectPath to "/Users/isabel/Desktop/LUISMI/claude-electron"
set cmd to "cd " & quoted form of projectPath & " && npm start"
tell application "Terminal"
    activate
    do script cmd
end tell
EOF
osascript /tmp/launch_poweragent.scpt
```

### Por qué osascript y no Bash directo
Claude Code corre en un subprocess sin acceso al WindowServer de macOS. Electron necesita el WindowServer para abrir ventanas. `osascript` delega el lanzamiento a la sesión gráfica del usuario, donde sí tiene acceso.

### Verificar que está corriendo el modo dev (no el empaquetado)
```bash
ps aux | grep electron | grep -v grep | head -2
# Debe mostrar: node_modules/electron/dist/Electron.app ... --app-path=/Users/isabel/Desktop/LUISMI/claude-electron
# NO debe mostrar: dist/mac/POWER-AGENT.app
```

### Verificar que además tiene VENTANA
```bash
ps aux | grep "claude-electron/node_modules/electron" | grep -v grep | grep -o "\-\-type=[a-z-]*" | sort | uniq -c
# Debe aparecer --type=renderer. Si solo hay gpu-process + utility, la app
# arrancó sin ventana (típico del lock huérfano: el main nuevo se suicidó y
# quedaron helpers sueltos de la instancia vieja).
```

**Dev y empaquetada nunca conviven**: ambas usan el mismo `userData` (`app.setPath('userData', .../CLAUDE-NOVAK)` en `main.js`), luego comparten `SingletonLock`. Si una está viva, la otra arranca y se cierra sola sin avisar.

### Cómo empaquetar (solo cuando el modo dev funciona)
```bash
npm run build:zip   # ZIP para distribución rápida
npm run dist        # DMG + ZIP ambas arquitecturas
```

### Desplegar en /Applications para abrir con doble clic
```bash
npm run deploy
```
Hace todo en secuencia:
1. Mata instancias activas
2. Compila build x64 (`dist/mac/POWER-AGENT.app`)
3. Copia a `/Applications/POWER-AGENT.app` y quita cuarentena (`xattr -cr`)
4. Abre la app via Finder (necesario porque Claude Code no tiene WindowServer)

**IMPORTANTE — Mac Intel (x86_64):** usar `dist/mac/POWER-AGENT.app`  
**Mac Apple Silicon (arm64):** usar `dist/mac-arm64/POWER-AGENT.app`  
Este Mac es Intel → el script usa x64.

**Por qué `xattr -cr`:** macOS bloquea apps descargadas/compiladas localmente sin firma. `xattr -cr` elimina el flag de cuarentena. Sin esto aparece el icono de "no compatible" aunque la arquitectura sea correcta.

**Por qué no `open` directo:** Claude Code corre en subprocess sin WindowServer. Hay que abrir vía `osascript` o Finder.

### Checklist post-cambio
1. `node --check main.js` → sin errores
2. `node --check renderer.js` → sin errores
3. Matar instancias previas
4. Lanzar modo dev con osascript
5. Verificar con `ps aux` que corre el dev, no el empaquetado
6. Si todo OK → `npm run deploy` para instalar en /Applications
6. Probar la feature en la app
7. Solo si OK → empaquetar

## Standard commands
- Dev run: `npm run start`
- Full build: `npm run dist`
- ZIP only: `npm run build:zip`
- DMG only: `npm run build:dmg`
- Diagnostics: `npm run doctor`
- Reset saved state: `npm run reset:state`

## Configuracion (desde la app)
- Boton `Configuracion` (icono engranaje en barra superior).
- Seccion CLI:
  - `CLI por defecto` (`claude` o `codex`).
  - `CLAUDE_BIN`, `CODEX_BIN`, `WHISPER_BIN` (opcional, override local).
- Seccion Telegram:
  - `Activar puente Telegram`.
  - `Bot token`.
  - `Allowed users` (IDs numericos de Telegram separados por coma).
- Al guardar:
  - Persiste en `~/Library/Application Support/CLAUDE-NOVAK/claude-novak.config.json` (ruta `userData` de Electron).
  - Reaplica CLI y reinicia terminal.
  - Reinicia bridge Telegram si esta activado.

## Telegram bridge (movil -> Mac)
- Arquitectura: gateway local (long polling) Telegram -> PTY local -> respuesta Telegram.
- Seguridad:
  - Acceso solo para `allowed users`.
  - Si usuario no autorizado escribe, recibe rechazo.
- Comandos soportados:
  - `/help`
  - `/status`
  - `/proyecto` (elegir proyecto del chat, botones inline)
  - `/sesiones` (elegir conversación previa del proyecto, botones inline)
  - `/cwd`
  - `/restart` (alias `/reset` — conserva el proyecto elegido)
  - `/cli claude|codex`
  - `/vinculo` (a qué proyecto/sesión está enganchado el chat: binding PTY vía `onGetLinkStatus` + sesión persistida)
  - `/menu` (botonera inline: cada botón despacha su comando vía callback `mnu:*`)
  - `/modelo` (modelo de Telegram: botones Default/Haiku/Sonnet/Opus para claude vía `mod:*`; codex por argumento; persiste en `telegram.claudeModel`/`codexModel` sin reiniciar el bridge — `onRunQuery` lee la config viva)
  - `/salir` (alias `/desvincular`, `/unlink`), `/cancel`, `/abrir`
- Al arrancar, el bridge registra los comandos con `setMyCommands` (`_registerCommandMenu`) → botón "Menú" nativo de Telegram junto al campo de texto.
- Cada respuesta de turno lleva pie de contexto «📁 proyecto · abc12345» (`_contextFooter`): un cruce de sesiones se ve al instante en vez de "qué raro responde". Solo con respuesta real, nunca sobre "(sin respuesta)".

## Bot de avisos separado (automatizaciones → Telegram) — 2026-08-06

- **Por qué existe**: el sink `telegram` del scheduler reclamaba el slot de sesión del chat (`rememberRunForChat` + pool oculto) al terminar cada tarea programada, pisando la conversación en curso — la "mezcla de sesiones" que sufría Luismi. Con el bot de avisos, las notificaciones salen por un **bot distinto** (token propio, BotFather) y el estado del bridge principal queda intacto.
- **Módulo**: `main/telegram-notify-bot.js` (`createTelegramNotifyBot`). Long-poll `getUpdates` propio con offset persistido en `userData/telegram-notify-state.json`. Solo hace dos cosas: mandar avisos y atender el botón inline «▶️ Continuar esta sesión».
- **Binding explícito, nunca implícito**: el aviso de un run OK con sessionId lleva el botón; pulsarlo (callback `cont:<clave>`, clave en memoria — tras reiniciar la app el botón responde "aviso antiguo") ejecuta `onContinueSession` en main.js: `rememberRunForChat` + `ensureHiddenPtyForTaskRun` (compartido con la ruta legacy del sink). En chats privados el chat.id es el mismo user id en ambos bots, así que el bind aplica directo al chat del bot principal.
- **Chat conversacional tras «Continuar» (pedido por Luismi en la primera prueba, 2026-08-06)**: pulsar el botón abre una ventana de **30 min deslizantes** (`HOT_WINDOW_MS`, en memoria) en la que puedes responder EN EL PROPIO chat de avisos: el texto viaja por `onUserReply` (main.js) al mismo enrutado de siempre (`telegramBridge.onRunQuery`: binding → PTY oculto > headless `--resume`) y la respuesta vuelve por el bot de avisos. Turnos serializados por chat, typing mientras corre. Sin «Continuar» previo (o caducada la ventana), el bot sigue mudo salvo cortesía — la separación anti-mezcla se mantiene.
- **Config**: `telegram.notifyBotToken` y `telegram.notifyChatId` (opcional; si falta, usa defaultChatId/primer allowed user del bridge). Campos en Configuración → Telegram, whitelisted en `SAFE_TELEGRAM`. **Fail-open**: sin token, el sink usa la ruta legacy de siempre (aviso por el bot principal + auto-bind).
- **Regla**: cualquier sink/automatización nueva que notifique por Telegram debe salir por el notify bot si está configurado, y NO tocar `rememberRunForChat`/pool como efecto colateral — el enganche lo pide el usuario con el botón.
- **Scripts bash generados también** (2026-08-07): las automatizaciones de launchd hacen `curl` directo leyendo el config en runtime — el patrón (en `patterns.md` del skill automation-builder y en `automations/system-prompt.js`) usa `.telegram.notifyBotToken` con fallback a `.telegram.botToken`, y `.telegram.notifyChatId` con fallback a `.telegram.allowedUsers[0]`. No volver a hornear `botToken` a secas.
- Tests: `tests/telegram-notify-bot.test.js`, `tests/scheduler-sinks-notify.test.js`, `tests/telegram-notify-config.test.js`.
- Mensajes de voz:
  - Descarga audio de Telegram y lo transcribe con **Apple Speech en servidor** (vía el helper de voz, ~1-2 s) con **fallback a whisper.cpp local** (2026-08-06): `main/whisper-transcribe.js` enruta — ffmpeg → wav → Apple si dura ≤55 s (tope de ~1 min por petición del servidor) → whisper si Apple falta, falla, devuelve vacío o el audio es largo. Aplica también a WhatsApp y al dictado 🎤. El helper se arranca solo para esto y se para al acabar (salvo modo voz/lector activos); en dev el helper no consigue el permiso de reconocimiento → siempre whisper. Protocolo: `{cmd:'transcribe', id:'ftr:n', path}` → `file-transcript`/`file-transcript-error` (`main/apple-transcribe.js`, consumidos ANTES de viewer-speech/voice-session en el onEvent). Tests: `tests/apple-transcribe.test.js`, `tests/whisper-transcribe.test.js`.
  - **Audio va, audio viene** (2026-08-06): la respuesta a una nota de voz vuelve como **nota de voz** — `_runQuery(..., {voiceReply:true})` no streamea texto: acumula, pasa el markdown por `speakableFromMarkdown` (fuera código/tablas, tope 2000) y `main/voice-note.js` sintetiza con la voz configurada (`{cmd:'synth'}` → .caf → ffmpeg → .ogg libopus) que sube `_sendVoiceNote` (multipart a mano, `buildMultipartBody` exportado). Pie de contexto como caption. Síntesis fallida o nada hablable → texto completo de fallback. Acción de chat `record_voice`. Sin mensajes de estado ni eco «Voz: transcripción» (pedido por Luismi): solo errores van en texto. El synth del helper es UNO a la vez: `voice-note.js` serializa. Tests: `tests/voice-note.test.js`, `tests/telegram-voice-reply.test.js`.
  - **Regla dura del synth en el helper (Swift)**: el fin de la síntesis a fichero lo marca el **`didFinish` del delegate**, NO el buffer con `frameLength 0` de los ejemplos de Apple (en este macOS 12 no llega nunca — el .caf se escribía entero y el `synth-done` no salía). Y el callback de `write()` llega en el MAIN thread: diferirlo con `async` a main cuela el `didFinish` por delante y sale "síntesis vacía" con el audio renderizado — se ejecuta en línea (o `sync` si viniera de otro hilo). Ambas cosas medidas en vivo el 2026-08-06; no "simplificar" sin releer esto.

## Operational notes
- If app starts crashing again:
  1. `npm run doctor`
  2. `npm run reset:state`
  3. Rebuild (`npm run build:zip` or `npm run dist`)
- If `npm run start` fails only in restricted/sandboxed execution runners:
  - Verify again in a normal local terminal session (outside sandbox).
  - This specific crash signature can be environment-related (`SIGABRT` before app JS loads).
- If DMG fails with `hdiutil`/`hdiejectd` sandbox errors:
  - Run DMG build outside sandbox/restricted session.
- ZIP artifacts are usually reliable even when DMG fails in constrained environments.

## Build artifacts
- Output folder: `dist/`
- Intel app: `dist/mac/POWER-AGENT.app`
- Apple Silicon app: `dist/mac-arm64/POWER-AGENT.app`
- Intel DMG: `dist/POWER-AGENT-1.0.0.dmg`
- ARM64 DMG: `dist/POWER-AGENT-1.0.0-arm64.dmg`

## CI/CD

### Tests en local
```bash
node --test tests/*.test.js
```
- Atajo equivalente: `npm test`.
- Requiere Node `20.18.0` (rango `>=20.18.0 <23` declarado en `package.json` engines).
- El Mac de Luismi tiene Node 24 como sistema → antes de `npm install` / `npm test`:
  ```bash
  nvm use 20.18.0
  ```
  Si no está instalada: `nvm install 20.18.0`. El `.nvmrc` del repo ayuda a fijarla.

### Pre-commit hook
```bash
scripts/install-git-hooks.sh
```
- Copia symlink relativo a `.git/hooks/pre-commit` apuntando a `scripts/pre-commit.sh`.
- En cada commit corre:
  - `node --check` sobre los `.js` staged (excluye `node_modules/`, `dist/`, `build/`, `out/`, `automations/`).
  - `node --test tests/*.test.js` (timeout 5min, override con `PRE_COMMIT_TEST_TIMEOUT=secs`).
- Bypass puntual: `git commit --no-verify`.
- Desinstalar: `rm .git/hooks/pre-commit`.

### CI (GitHub Actions)
- Workflow: `.github/workflows/test.yml`.
- Triggers: push a `main` y PRs hacia `main`.
- Runner: `macos-latest` (la app es Mac-only).
- Node: `20.18.0` (cache npm).
- Steps: `npm ci` + `node --test tests/*.test.js`.
- Timeout: 10min. Permisos: `contents: read` (solo lectura, sin deploys ni releases).
