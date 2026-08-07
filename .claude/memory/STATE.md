# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-07 tarde (robos de Hermes implementados; tests en verde; SIN commitear — esperando OK de Luismi)._

---

# 🚦 EMPIEZA POR AQUÍ — 4 "robos" de Hermes Agent implementados (2026-08-07 tarde, /loop autónomo)

Luismi pidió comparar POWER-AGENT con Hermes Agent (Nous Research) y aprobó robarle 4 ideas. Las 4 están implementadas con TDD, **suite 1124 (1118 pass / 0 fail / 6 skip)**, `node --check` limpio en todos los tocados. **SIN commitear, SIN deploy, SIN prueba en vivo** — la app empaquetada de Luismi estaba corriendo y no se mató (dev y empaquetada comparten SingletonLock).

1. **Emparejamiento por código** (`main/telegram-pairing.js` + hook en `telegram-bridge.js` `_handleUnauthorized`): un chat desconocido recibe código de 6 dígitos (TTL 10 min, máx. 5 pendientes, mismo código si insiste); se aprueba/rechaza en Configuración → Telegram (IPC `telegram:pairing-*`, notificación nativa, bloque UI nuevo). Aprobar persiste en `allowedUsers` y reaplica el bridge en vivo. Códigos solo en memoria (reinicio = caducados). Sin hook o hook roto → rechazo legacy (fail-open). Tests: `telegram-pairing.test.js`, `telegram-bridge-pairing.test.js`.
2. **Saneado anti-inyección** (`main/untrusted-input.js`, `sanitizeChannelText`): limpia Unicode invisible (zero-width/bidi/BOM), ANSI/C0 y normaliza `\r`→`\n` (un `\r` crudo es un ENTER en el PTY); detecta override/exfil/exec. Política por llamador: Telegram (`_enqueueQuery`) y notify bot (intake) SOLO limpian (quien habla es Luismi); WhatsApp escala a humano si `risky` (`respondTo` en `whatsapp-client.js`) y `buildPrompt` limpia body+historial. OJO: regex con clases `\uXXXX` en ASCII — jamás pegar caracteres invisibles literales en el código (se hizo por error y se corrigió). Tampoco `.test()` sobre regex `/g` (lastIndex stateful). Tests: `untrusted-input.test.js`, `channel-input-sanitized.test.js`.
3. **Detector de tareas repetidas** (`main/repeated-prompts.js`): Jaccard de tokens (normalización sin tildes), 3+ hits similares en 30 días → notificación nativa proponiendo tarea 📌 o skill; cooldown 7 días por cluster, `minGapMs` 60s (reintentos no cuentan), store atómico `userData/repeated-prompts.json`. Alimentado desde: `onSemanticInput` de Telegram, `onUserReply` del notify bot y encargos de voz (wrapper de `voiceSendTarget` en main.js — la charla no cuenta). Tests: `repeated-prompts.test.js`.
4. **Búsqueda en contenido de sesiones** (`main/session-content-search.js` + input en el modal Sesiones): streaming readline de los `.jsonl` del proyecto (nada de readFileSync — lección del relay), plegado 1:1 por code point (tildes/mayúsculas), snippet como tooltip de la fila, IPC `search-session-content` (solo claude), debounce 350ms + token anti-carreras en renderer. La "lupa" vieja era solo del grafo; el modal de sesiones no tenía búsqueda ninguna. Tests: `session-content-search.test.js`.

**Pendiente (necesita a Luismi)**: probar en vivo (matar app → dev → verificar pairing/buscador), OK para plan de commits troceado (4 commits, uno por robo), deploy. Informe completo en el chat de la sesión.

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
