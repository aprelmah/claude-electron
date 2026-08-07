# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-07 noche, cierre de sesión (todo commiteado, pusheado y desplegado; wrap hecho)._

# 🚦 EMPIEZA POR AQUÍ — Profesionalización + doctor a demanda (2026-08-07 noche)

Luismi pidió "si POWER-AGENT fuera tuyo, ¿qué harías?" y autorizó ejecutarlo entero en /loop. 4 fases + 4 remates pedidos en vivo. Detalle de reglas en CLAUDE.md §"Profesionalización (2026-08-07 noche)".

## Estado de entrega (verificado al cierre)

- `main` == `origin/main`, HEAD **`a6c8c6e`**, árbol limpio salvo docs de este wrap. 10 commits del tramo: `f1b317d` (flakes+humo), `fb6ca9d` (doctor), `880b890` (propuestas+builder panel), `24043c9` (cableado app), `057dbb0` (docs), `0697bda` (CSS modal), `68c7817` (hora bitácora), `9d8fedb` (doctor manual panel), `2cbb03d` (/doctor Telegram), `a6c8c6e` (🩺 en /menu).
- Tests: **1233 (1227 pass / 0 fail / 6 skip)** — el día empezó en 1079.
- Deploy: **HECHO** (5 deploys, último tras `a6c8c6e`), asar verificado por contenido en cada uno; panel verificado por CDP con captura; botón 🩺 probado en vivo por Luismi ("funciona").
- Bugs cazados con captura tras el deploy: modal del panel sin CSS por ID (tira rota al fondo) y hora de bitácora "39" (ts epoch). Ambos arreglados y desplegados.

## Próximo paso

- Probar `/doctor` desde el móvil (el botón del panel está probado; el comando no).
- Verificar que el `1` de prueba salió de `telegram.allowedUsers`.
- UX pendiente: el icono del panel (pulso) se camufla — más contraste o etiqueta.
- Deuda consciente: rama codex de `buildCurrentSessionMeta` sigue adivinando.

## Backlog aprobado por Luismi (2026-08-07 noche, "apúntalos y haremos")

Segunda ronda de robos de Hermes, por orden de valor:

1. **Jardinero de memoria** (el gordo; transversal, no de la app): Hermes acota la memoria con presupuesto visible y obliga a podar. El sistema de Luismi crece sin tope — `~/claude-shared/memory/02-feedback.md` ya pesa 73KB y el MEMORY.md del proyecto suma un bloque por sesión; todo entra al contexto de arranque. Hacer: pase periódico (o skill `/jardinero`) que compacte sesiones viejas en resúmenes, pode lo obsoleto y muestre presupuesto por archivo.
2. **Escáner de skills de terceros** (tarde corta): reutilizar `main/untrusted-input.js` en un `/revisar-skill` que pase revista a un SKILL.md/plugin antes de instalarlo (exfil, comandos destructivos, Unicode invisible), estilo el scanner del Skills Hub de Hermes.
3. **Vocabulario del modo voz** (tarde corta): el helper YA tiene `{cmd:'vocab'}` (contextualStrings) en el protocolo y nadie lo llama. Mandarle la jerga del proyecto activo (nombres de módulos, "worktree", "eatbook") al encender el modo voz.

1. **Consolidar**: los DOS flakes históricos eran la misma causa — `ws-server-auth-token.test.js` elegía puertos dentro del rango efímero del SO (49152–65535) y chocaba con sockets salientes de otros tests (EADDRINUSE + 404-vs-401). Banda movida a 18500–19900. Test de humo `module-load-smoke.test.js` (73 requires). `resolveSessionIdForRelay` ya no persiste ids adivinados.
2. **Doctor in-app** (`main/health-watchdog.js` + toggle `telegram.healthWatchdog`): chequeo diario 08:00, avisa por notify bot solo con problemas.
3. **Bandeja única**: sección "Decisiones" en el dropdown del 🔔 (pairing accionable + encargos repetidos con "📌 Crear tarea"/"Descartar"). El detector de repetidos ahora persiste propuestas (`listProposals`/`resolveProposal`; descartado = no propone nunca más).
4. **Panel "¿qué está pasando?"** (botón nuevo en topbar): sesiones vivas con aislamiento/Telegram/voz, pool oculto y últimos eventos de la bitácora, refresco 3 s.

Además, misma sesión (tarde): **aislamiento git por carpeta** (`gitIsolationExcludes` + botón selector + badge 🌿; excludes de Luismi rellenados: TURBO-ENERGY RMA, DMWEB, DOCUMENTOS_AGENTE, ~/Documents) — commits `dbbc772`+`62de42d`+`f6cfc90` pusheados y desplegados.

---

# Sesión anterior — 4 robos de Hermes Agent: hechos, pusheados y probados (2026-08-07 tarde)

Luismi pidió comparar POWER-AGENT con Hermes Agent (Nous Research, MIT, ~220k estrellas) y aprobó robarle 4 ideas. Veredicto de la comparativa: Hermes es el mejor agente personal genérico, pero no sustituye a POWER-AGENT (no pilota Claude Code, cobraría por API teniendo Max, sin el WhatsApp de negocio). Las 4 implementadas con TDD en `/loop` autónomo y **probadas en vivo por Luismi en modo dev ("funciona todo")** — el pairing con el truco del ID falso `1` en allowedUsers.

## Estado de entrega (verificado 2026-08-07 tarde)

- Rama `main` == `origin/main`: **6 commits pusheados** `d7fa0fd..5f0f089` (4193c04 saneado, ef395c3 pairing, 3b31f0f repetidos, 866411a búsqueda, 9ee0d9b cableado app, 5f0f089 docs). Árbol limpio salvo este STATE.md.
- Tests: **1124 (1118 pass / 0 fail / 6 skip)** — el hook corrió la suite en cada commit.
- **Deploy: HECHO 2026-08-07 tarde** (`npm run deploy`, exit 0, helper de voz firmado). Verificado por CONTENIDO del asar: los 4 módulos nuevos dentro, `sessions-search` en renderer y `cfg-telegram-pairing-block` en index.html. App empaquetada corriendo desde /Applications.
- Percance corregido sobre la marcha: el hook falló en el commit del cableado (flake EADDRINUSE) y el pipe `| tail` se tragó el exit → el commit de docs arrastró 7 archivos; `reset --soft` + recommit limpio. **Regla: jamás `git commit | tail && siguiente` — el pipe devuelve el exit de tail.**

1. **Emparejamiento por código** (`main/telegram-pairing.js` + hook en `telegram-bridge.js` `_handleUnauthorized`): un chat desconocido recibe código de 6 dígitos (TTL 10 min, máx. 5 pendientes, mismo código si insiste); se aprueba/rechaza en Configuración → Telegram (IPC `telegram:pairing-*`, notificación nativa, bloque UI nuevo). Aprobar persiste en `allowedUsers` y reaplica el bridge en vivo. Códigos solo en memoria (reinicio = caducados). Sin hook o hook roto → rechazo legacy (fail-open). Tests: `telegram-pairing.test.js`, `telegram-bridge-pairing.test.js`.
2. **Saneado anti-inyección** (`main/untrusted-input.js`, `sanitizeChannelText`): limpia Unicode invisible (zero-width/bidi/BOM), ANSI/C0 y normaliza `\r`→`\n` (un `\r` crudo es un ENTER en el PTY); detecta override/exfil/exec. Política por llamador: Telegram (`_enqueueQuery`) y notify bot (intake) SOLO limpian (quien habla es Luismi); WhatsApp escala a humano si `risky` (`respondTo` en `whatsapp-client.js`) y `buildPrompt` limpia body+historial. OJO: regex con clases `\uXXXX` en ASCII — jamás pegar caracteres invisibles literales en el código (se hizo por error y se corrigió). Tampoco `.test()` sobre regex `/g` (lastIndex stateful). Tests: `untrusted-input.test.js`, `channel-input-sanitized.test.js`.
3. **Detector de tareas repetidas** (`main/repeated-prompts.js`): Jaccard de tokens (normalización sin tildes), 3+ hits similares en 30 días → notificación nativa proponiendo tarea 📌 o skill; cooldown 7 días por cluster, `minGapMs` 60s (reintentos no cuentan), store atómico `userData/repeated-prompts.json`. Alimentado desde: `onSemanticInput` de Telegram, `onUserReply` del notify bot y encargos de voz (wrapper de `voiceSendTarget` en main.js — la charla no cuenta). Tests: `repeated-prompts.test.js`.
4. **Búsqueda en contenido de sesiones** (`main/session-content-search.js` + input en el modal Sesiones): streaming readline de los `.jsonl` del proyecto (nada de readFileSync — lección del relay), plegado 1:1 por code point (tildes/mayúsculas), snippet como tooltip de la fila, IPC `search-session-content` (solo claude), debounce 350ms + token anti-carreras en renderer. La "lupa" vieja era solo del grafo; el modal de sesiones no tenía búsqueda ninguna. Tests: `session-content-search.test.js`.

## Además (2026-08-07 noche): aislamiento git por carpeta + chivato

Luismi, harto del baile de worktrees en sus carpetas de trabajo ("Estás en un worktree nuevo" en TURBO-ENERGY): `cli.gitIsolationExcludes` (Configuración → "Carpetas SIN aislamiento", una por línea, `~` y subcarpetas; `cwdExcludedFromIsolation` en `main/session-git.js`, `isEnabled(realCwd)`) + badge «🌿 worktree» en la tira de sesión (`meta.gitIsolation`). Toggle global intacto; exclusión gana. Tests **1133 (1127/0/6)**, 9 nuevos en `git-isolation-excludes.test.js`. Segundo flake pre-existente visto en suite completa: 404-vs-401 en un test HTTP (no reproduce en re-run), además del EADDRINUSE 55555.

(Sus pendientes se cerraron en la sesión de la noche: carpetas excluidas rellenadas, flake arreglado de raíz; los vivos están en el "Próximo paso" de arriba.)

# Sesión anterior — Fix: la sesión nueva adoptaba la conversación vieja (envenenamiento del sessionId)

**Sesión 2026-08-07 mediodía** (`6956fd5`, probado en vivo por Luismi: "va bien"). Reporte real: sesión nueva + "Llevar a Terminal" → Terminal abría OTRA conversación. **No era el botón**: `buildCurrentSessionMeta` (`main/claude-session-cache.js`, código de mayo `f6cebba`) rellenaba `session.claudeSessionId` con la última `.jsonl` del cwd por mtime cuando el campo estaba vacío. El renderer refresca la tira de sesión nada más arrancar el PTY → milisegundos después del spawn la sesión nueva ya llevaba el id de la conversación vieja, y el vigía de `startPty` (`main.js:1763`) al ver el campo relleno se paraba para siempre (escribir después no lo curaba). El mismo veneno alimentaba en silencio el sub-chat ("contexto congelado") y el modo voz.

**Fix**: el meta ya no adivina ni persiste — sin id, topbar «(sesión nueva)» y `sessionId: null`; el id lo ponen solo el spawn (`--resume`), el vigía o el relay. Verificado e2e por CDP en dev: guarda del botón correcta sin conversación (el PTY sobrevive al error), y tras el primer mensaje adopta SU id en ~5s (jsonl con el prompt comprobado). Tests **1079 (1073/0/6)**, 3 nuevos en `tests/current-session-meta.test.js`.

**Queda un patrón hermano**: `resolveSessionIdForRelay` (`main.js:3068`) hace la misma adivinanza por mtime para la ruta Telegram; se auto-repara por prompt en el relay, se dejó a propósito. Si algún día hay mezcla por Telegram en sesiones recién abiertas, empezar por ahí.

# Sesión anterior — Avisos de automatizaciones al notify bot + botón "Llevar a Terminal"

**Sesión 2026-08-07 mañana.** Dos entregas, ambas probadas por Luismi. **Tests: 1070 (1064 pass / 0 fail / 6 skip).** Detalle en auto-memory (`update_2026_08_07_avisos_y_boton_terminal.md`).

1. **Avisos de automatizaciones por el bot de avisos** (`899807d`). Las automatizaciones (scripts bash de launchd) hacían `curl` directo con `.telegram.botToken` — el patrón venía horneado de `patterns.md` §4 del skill `automation-builder` y de `automations/system-prompt.js` (regla 8 + fallback). Arreglado en ambos y en los 3 scripts instalados en `~/Library/PowerAgent/automations/`: ahora `notifyBotToken`/`notifyChatId` con fallback a `botToken`/`allowedUsers[0]`. Los scripts leen el token EN RUNTIME del config: cambiar el campo los re-apunta sin reinstalar. `notifyChatId` sigue vacío en config (fallback al mismo chat — funciona).
2. **Botón "Llevar a Terminal"** (`2595248`, topbar junto al de voz). Handoff de la sesión activa a Terminal.app: captura cli/cwd/sessionId → `killPty` → `pty-exit` explícito (el guard `_alive` del onExit lo suprime tras killPty) → **await finalize del worktree** → osascript con `claude --resume <id>` / `codex resume <id>` en el cwd real. Módulo `main/terminal-handoff.js` (12 tests). El orden es de carga: `copySessionsHome` dentro del finalize copia el `.jsonl` al proyecto real; sin eso el resume da "No conversation found". `finalizeWorkspaceForSession` ahora devuelve su promesa. Spec/plan en `docs/superpowers/{specs,plans}/2026-08-07-*`.
3. **Supuesto tumbado por la verificación CDP**: la app arranca con PTY auto-restaurado — el primer click de prueba "sin sesión" abrió Terminal con la última conversación. De ahí la guarda: sin `session.pty` no hay handoff (`claudeSessionId` sobrevive a la muerte del PTY). Sin la guarda, el botón desde el picker abriría una conversación vieja.

## Estado de entrega (verificado 2026-08-07 mediodía)

- Rama `main` == `origin/main`: `6956fd5` (fix) + `4e2814b` (docs) **pusheados** (`04e0441..4e2814b`).
- Tests: **1079 (1073 pass / 0 fail / 6 skip)** — hook pre-commit corrió la suite en el commit.
- Deploy: **HECHO 2026-08-07 ~12:00** — asar verificado por CONTENIDO (`claude-session-cache.js` con «(sesión nueva)» y sin la línea del veneno). Probado en vivo por Luismi ("va bien").

## Próximo paso

- Nada urgente. Opcional: poner `telegram.notifyChatId` en Configuración si algún día los avisos deben ir a un chat distinto del primero de `allowedUsers`.
- Cosmético sin reporte: con el picker abierto, el overlay tapa visualmente la topbar (el botón sigue en el DOM); con sesión abierta se ve normal.
- Heredados: skill `luismi:telegram-bridge-relay` roto (confirmar con Luismi antes de borrar); elegir `gpt-5.6-sol` en codex (quedó en `codex-auto-review`).

## Notas operativas

- El handoff a Terminal NO es un spawn nuevo de PTY: abre una Terminal externa tras finalizar el worktree. El `--resume` interactivo en esa Terminal forkea sessionId (ventana de adopción ya documentada en CLAUDE.md para "un `claude` lanzado a mano"; la sesión de la app muere antes, sin trabajo nuevo).
- Verificación por CDP en modo dev: `npx electron . --remote-debugging-port=9222` vía Terminal/osascript (el skill `verify` documenta el resto; vale igual para dev, no solo para /Applications).
- Reincidencia sin daño: `npx asar extract-file` desde el repo otra vez (extrajo al root, no pisó nada). SIEMPRE desde scratchpad.
- Trampa vigente: `npm run deploy` no mata la instancia dev → SingletonLock → la empaquetada se suicida en silencio. Matar dev a mano antes.
- El helper de voz se prueba SUELTO por stdin/stdout para lo que no toque micrófono; lo que toca micrófono solo funciona como hijo de la app empaquetada.
