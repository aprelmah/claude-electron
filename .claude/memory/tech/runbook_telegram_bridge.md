# Runbook — Telegram bridge (móvil → Mac) y bot de avisos

> Movido íntegro del CLAUDE.md raíz el 2026-08-09 (dieta del runbook, R6).

## Bridge principal

- Arquitectura: gateway local (long polling) Telegram → PTY local → respuesta Telegram.
- Seguridad: acceso solo para `allowed users`. Si un usuario no autorizado escribe, recibe rechazo (o código de emparejamiento — ver `runbook_hermes_robos.md`).
- Comandos soportados:
  - `/help`
  - `/status`
  - `/proyecto` (elegir proyecto del chat, botones inline; el botón «➕ Nuevo proyecto» ARMA el chat: el siguiente mensaje de texto es el nombre — TTL 5 min, cualquier comando desarma; bug de UX real 2026-08-08, el nombre a secas viajaba como prompt)
  - `/nuevoproyecto <nombre>` (crea la carpeta bajo `~/Desktop/LUISMI/` y la deja elegida para el chat; nombre por allowlist estricta — `sanitizeNewProjectName` en `main/session-helpers.js`, sin separadores de ruta ni carpetas ocultas; si ya existe, se selecciona avisando)
  - `/sesiones` (elegir conversación previa del proyecto, botones inline)
  - `/cwd`
  - `/restart` (alias `/reset` — conserva el proyecto elegido)
  - `/cli claude|codex`
  - `/vinculo` (a qué proyecto/sesión está enganchado el chat: binding PTY vía `onGetLinkStatus` + sesión persistida)
  - `/menu` (botonera inline: cada botón despacha su comando vía callback `mnu:*`)
  - `/tareas` (lanzar YA una tarea programada: botones inline `tsk:<idx>`, patrón picker de `/proyecto`; pre-chequeo antes de confirmar — tarea borrada o run en curso dan error, no un "Lanzada" falso; el resultado viaja por los sinks de siempre, el bridge no espera al run)
  - `/autos` (ejecutar YA una automatización launchd instalada: botones `aut:<idx>`, mismo patrón; solo lista `status === 'installed'`)
  - `/modelo` (modelo de Telegram: botones Default/Haiku/Sonnet/Opus para claude vía `mod:*`; codex por argumento; persiste en `telegram.claudeModel`/`codexModel` sin reiniciar el bridge — `onRunQuery` lee la config viva)
  - `/doctor` (pasa el doctor in-app y devuelve el resultado)
  - `/salir` (alias `/desvincular`, `/unlink`), `/cancel`, `/abrir`
- Al arrancar, el bridge registra los comandos con `setMyCommands` (`_registerCommandMenu`) → botón "Menú" nativo de Telegram junto al campo de texto.
- Cada respuesta de turno lleva pie de contexto «📁 proyecto · abc12345» (`_contextFooter`): un cruce de sesiones se ve al instante en vez de "qué raro responde". Solo con respuesta real, nunca sobre "(sin respuesta)".

## Mensajes de voz (Telegram y WhatsApp)

- Descarga el audio y lo transcribe con **Apple Speech en servidor** (vía el helper de voz, ~1-2 s) con **fallback a whisper.cpp local** (2026-08-06): `main/whisper-transcribe.js` enruta — ffmpeg → wav → Apple si dura ≤55 s (tope de ~1 min por petición del servidor) → whisper si Apple falta, falla, devuelve vacío o el audio es largo. Aplica también a WhatsApp y al dictado 🎤. El helper se arranca solo para esto y se para al acabar (salvo modo voz/lector activos); en dev el helper no consigue el permiso de reconocimiento → siempre whisper. Protocolo: `{cmd:'transcribe', id:'ftr:n', path}` → `file-transcript`/`file-transcript-error` (`main/apple-transcribe.js`, consumidos ANTES de viewer-speech/voice-session en el onEvent). Tests: `tests/apple-transcribe.test.js`, `tests/whisper-transcribe.test.js`.
- **Audio va, audio viene** (2026-08-06): la respuesta a una nota de voz vuelve como **nota de voz** — `_runQuery(..., {voiceReply:true})` no streamea texto: acumula, pasa el markdown por `speakableFromMarkdown` (fuera código/tablas, tope 2000) y `main/voice-note.js` sintetiza con la voz configurada (`{cmd:'synth'}` → .caf → ffmpeg → .ogg libopus) que sube `_sendVoiceNote` (multipart a mano, `buildMultipartBody` exportado). Pie de contexto como caption. Síntesis fallida o nada hablable → texto completo de fallback. Acción de chat `record_voice`. Sin mensajes de estado ni eco «Voz: transcripción» (pedido por Luismi): solo errores van en texto. El synth del helper es UNO a la vez: `voice-note.js` serializa. Tests: `tests/voice-note.test.js`, `tests/telegram-voice-reply.test.js`.
- **Regla dura del synth en el helper (Swift)**: el fin de la síntesis a fichero lo marca el **`didFinish` del delegate**, NO el buffer con `frameLength 0` de los ejemplos de Apple (en este macOS 12 no llega nunca — el .caf se escribía entero y el `synth-done` no salía). Y el callback de `write()` llega en el MAIN thread: diferirlo con `async` a main cuela el `didFinish` por delante y sale "síntesis vacía" con el audio renderizado — se ejecuta en línea (o `sync` si viniera de otro hilo). Ambas cosas medidas en vivo el 2026-08-06; no "simplificar" sin releer esto.

## Bot de avisos separado (automatizaciones → Telegram) — 2026-08-06

- **Por qué existe**: el sink `telegram` del scheduler reclamaba el slot de sesión del chat (`rememberRunForChat` + pool oculto) al terminar cada tarea programada, pisando la conversación en curso — la "mezcla de sesiones" que sufría Luismi. Con el bot de avisos, las notificaciones salen por un **bot distinto** (token propio, BotFather) y el estado del bridge principal queda intacto.
- **Módulo**: `main/telegram-notify-bot.js` (`createTelegramNotifyBot`). Long-poll `getUpdates` propio con offset persistido en `userData/telegram-notify-state.json`. Solo hace dos cosas: mandar avisos y atender el botón inline «▶️ Continuar esta sesión».
- **Binding explícito, nunca implícito**: el aviso de un run OK con sessionId lleva el botón; pulsarlo (callback `cont:<clave>`, clave en memoria — tras reiniciar la app el botón responde "aviso antiguo") ejecuta `onContinueSession` en main.js: `rememberRunForChat` + `ensureHiddenPtyForTaskRun` (compartido con la ruta legacy del sink). En chats privados el chat.id es el mismo user id en ambos bots, así que el bind aplica directo al chat del bot principal.
- **Chat conversacional tras «Continuar»** (pedido por Luismi, 2026-08-06): pulsar el botón abre una ventana de **30 min deslizantes** (`HOT_WINDOW_MS`, en memoria) en la que puedes responder EN EL PROPIO chat de avisos: el texto viaja por `onUserReply` (main.js) al mismo enrutado de siempre (`telegramBridge.onRunQuery`: binding → PTY oculto > headless `--resume`) y la respuesta vuelve por el bot de avisos. Turnos serializados por chat, typing mientras corre. Sin «Continuar» previo (o caducada la ventana), el bot sigue mudo salvo cortesía — la separación anti-mezcla se mantiene.
- **Config**: `telegram.notifyBotToken` y `telegram.notifyChatId` (opcional; si falta, usa defaultChatId/primer allowed user del bridge). Campos en Configuración → Telegram, whitelisted en `SAFE_TELEGRAM`. **Fail-open**: sin token, el sink usa la ruta legacy de siempre (aviso por el bot principal + auto-bind).
- **Regla**: cualquier sink/automatización nueva que notifique por Telegram debe salir por el notify bot si está configurado, y NO tocar `rememberRunForChat`/pool como efecto colateral — el enganche lo pide el usuario con el botón.
- **Scripts bash generados también** (2026-08-07): las automatizaciones de launchd hacen `curl` directo leyendo el config en runtime — el patrón (en `patterns.md` del skill automation-builder y en `automations/system-prompt.js`) usa `.telegram.notifyBotToken` con fallback a `.telegram.botToken`, y `.telegram.notifyChatId` con fallback a `.telegram.allowedUsers[0]`. No volver a hornear `botToken` a secas.
- Tests: `tests/telegram-notify-bot.test.js`, `tests/scheduler-sinks-notify.test.js`, `tests/telegram-notify-config.test.js`.

## Configuración (desde la app)

- Botón `Configuracion` (icono engranaje en barra superior).
- Sección CLI: `CLI por defecto` (`claude`/`codex`), `CLAUDE_BIN`, `CODEX_BIN`, `WHISPER_BIN` (override local), voz (`voiceId`, `voiceRate`, pausa de silencio), aislamiento git + excludes.
- Sección Telegram: activar puente, bot token, allowed users, notify bot, health watchdog.
- Al guardar: persiste en `~/Library/Application Support/CLAUDE-NOVAK/claude-novak.config.json` (ruta `userData` de Electron), reaplica CLI y reinicia terminal, reinicia bridge Telegram si está activado.
