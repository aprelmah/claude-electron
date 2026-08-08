# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre.

_Última actualización: 2026-08-08 (verificado contra git y filesystem en el mismo turno)._

## Estado de entrega (verificado)

- Rama `main`. Último commit: `21911e3 feat(telegram+ui): sesión real siempre, badge de modelo y menú de tareas` (2026-08-08 noche).
- Tests: `1383` totales, `1377` pass, `0` fail, `6` skip.
- Deploy: `/Applications/POWER-AGENT.app` **redeployado el 2026-08-08 a las 21:32** (verificado por contenido del asar: `main/session-model-reader.js` dentro). La app está abierta.
- Acceso exterior LAN: sin cambios desde el 2026-08-07. No activo, `cloudflared` sin instalar.

## Sesión 2026-08-08 noche — sesión real siempre, badge de modelo, menú de tareas (pendiente de prueba de Luismi)

- **Fuera la compactación de 20 turnos** (Telegram/LAN): `compactClaudeSessionIfNeeded` tiraba el sessionId con >30 turnos y arrancaba conversación nueva con los turnos pegados — la real quedaba huérfana y la CLI solo enseñaba 20 turnos (bug con pantallazo de Luismi). El headless resume SIEMPRE la sesión real. No reintroducir.
- **Badge de modelo en la tira de sesión** (`main/session-model-reader.js`): claude del transcript (último assistant no-sidechain, ignora `<synthetic>`), codex del rollout (último `turn_context`, fichero localizado por la fecha del UUIDv7 ±1 día). Cola de 64KB + caché por stat. Se pinta (`meta.model`), jamás se persiste.
- **`/tareas` y `/autos` en Telegram** (+ botones en `/menu`): lanzar YA tareas programadas y automatizaciones launchd. Patrón picker de `/proyecto`; pre-chequeo antes de confirmar; resultado por los sinks de siempre.

## Última sesión — modo voz: no esperar por ruido, y leer mientras escribe

- **El fin de turno ya no usa un umbral absoluto.** El helper cortaba con `voiceThreshold = 0.012` fijo: una tele o gente hablando al lado lo superan, reiniciaban el reloj del silencio y el micro no cerraba nunca. Nuevo `main/voice-endpointer.js` (Node decide, el helper emite `audio-level` cada 100 ms y acepta `{cmd:'endturn'}`), con umbral relativo al suelo de ruido de la sala y a la media de la voz del usuario. El corte absoluto del helper queda como red de seguridad y por construcción nunca dispara antes.
- **La respuesta se lee a trozos según claude la escribe**, sin esperar al `end_turn`: `splitSpeakableChunk` + `onChunk` en `main/voice-turn-watcher.js`, y `main/voice-speech-queue.js` porque el helper solo maneja una frase a la vez.
- **Ajuste tras la primera prueba real de Luismi**: el respaldo por texto congelado iba a 1,2 s contra una pausa de silencio de 1,8 s — cortaba ANTES que la pausa, justo al pararse a pensar. Ahora va siempre por detrás (×1,5 o +1,5 s). Tope del slider subido de 3 s a 6 s en los tres sitios (UI, `sanitizeVoiceSilenceMs`, `setSilence` del Swift).
- **Voces de Siri: cerrado, no se pueden usar.** Investigado con sonda propia, cinco vías. Detalle y datos: `.claude/memory/tech/tech_voces_apple_siri_bloqueadas.md`. Decisión de producto de Luismi: **no** integrar Piper ni Kokoro; la mejora no compensa latencia ni mantenimiento.
- Reglas nuevas del modo voz documentadas en `CLAUDE.md` del repo (dentro del commit `031d20e`).

## Próximo paso

- Nada bloqueante: el modo voz queda validado en uso real. Lo siguiente lo marca Luismi.
- Si con el uso la pausa de 4,5 s se hace larga para frases cortas, bajarla en Configuración → CLI (rango 0,8–6 s). Vive en la config de Luismi; el default del código sigue en 1.800 ms.
- Si hace falta afinar los umbrales del endpointer, el helper ya emite `audio-level`: se calibra con datos, no a ojo.

## Notas operativas

- **Los umbrales del endpointer están razonados, NO medidos** (0,28 de la media de voz; 2,2× el suelo de ruido). Es la deuda consciente que dejó esta sesión.
- La pausa de 4,5 s vive en `~/Library/Application Support/CLAUDE-NOVAK/claude-novak.config.json` (`cli.voiceSilenceMs`), no en el código. Backup: `claude-novak.config.json.bak.2026-08-08`.
- **Verificar un deploy por el timestamp del asar, nunca por haber lanzado el script.** El 2026-08-08 un `npm run deploy` lanzado por osascript no llegó a ejecutarse y Luismi estuvo probando una build a medias durante media sesión.
- Sin verificar todavía: `npm run dist`/`build:zip` a secas con el helper de voz (solo se usa `deploy.sh`), y build `arm64`.
- Reglas duras heredadas: WhatsApp siempre con `X-Auth-Token` y prefijo internacional; state crítico mediante `main/atomic-writes.js`; no ampliar `WA_SAFE_CONFIG_FIELDS`; `package.json` `build.files` es whitelist para `.js` nuevos en raíz.
