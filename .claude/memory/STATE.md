# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `decisions/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-06 noche (verificado contra git, tests y el asar desplegado; probado en vivo por Luismi)._

---

# 🚦 EMPIEZA POR AQUÍ — Audios por Apple Speech + "audio va, audio viene" en Telegram

**Sesión 2026-08-06 noche.** Queja de Luismi: los audios de Telegram tardaban un mundo (whisper local, RTF ~1,4 en este i7). Se cambió el motor y por el camino cayeron dos bugs gordos. Todo con TDD. **Tests: 1063 (1057 pass / 0 fail / 6 skip).** Detalle en CLAUDE.md (§ "Telegram bridge → Mensajes de voz" y § "Relay de Telegram") y auto-memory (`update_2026_08_06_noche_audio_voz_telegram.md`).

1. **Transcripción por Apple Speech en servidor** (~1-2 s) con fallback a whisper: `main/apple-transcribe.js` (protocolo `{cmd:'transcribe'}`) + enrutado en `main/whisper-transcribe.js` (Apple si ≤55 s; whisper si falta/falla/vacío/largo). Aplica a Telegram, WhatsApp y dictado 🎤. En dev el helper no consigue el permiso → siempre whisper.
2. **Bug histórico del relay**: `relayThroughPty` escribía `prompt + '\r'` PEGADOS → el TUI lo trataba como pegado y el turno quedaba escrito sin enviar. Con textos cortos colaba; la primera transcripción larga lo destapó. Fix: `main/pty-prompt-write.js` (`writePromptThenEnter`, 150 ms). Regla: TODO write de prompt a un PTY de claude pasa por ahí.
3. **Audio va, audio viene**: la respuesta a una nota de voz vuelve como nota de voz — `{cmd:'synth'}` en el helper (TTS con la voz configurada → .caf) → ffmpeg → .ogg libopus → `_sendVoiceNote` (multipart a mano). `speakableFromMarkdown` filtra; fallback a texto si falla o no hay nada hablable. Sin eco «Voz:» ni mensajes de estado (pedido por Luismi). Módulo `main/voice-note.js` (serializa: el synth del helper es UNO a la vez).
4. **Dos reglas Swift medidas en vivo** (en CLAUDE.md, no "simplificar"): el fin del synth lo marca el `didFinish` del delegate (el buffer frameLength 0 de los ejemplos de Apple NO llega en macOS 12) y el callback de `write()` llega en el MAIN thread (diferirlo con `async` cuela el didFinish delante → "síntesis vacía" con el audio renderizado).
5. **Cerrojo voz↔Telegram corregido**: se suelta en el `onDone` del vigía (turno completado); los 180 s quedan de red para vigía muerto. Antes daba "sesión enlazada no disponible" hasta 3 min tras cada turno de voz (visto en vivo, dos veces).
6. **Traza `[voz-evt]`** en el onEvent del helper (main.js): lanzando la app instalada desde Terminal con redirect se ve el ciclo listening→speech-detected→partial→final. Así se descartó el "se queda escuchando" reportado (el log salió sano).

## Estado de entrega (verificado 2026-08-06 ~22:00, tras el push)

- Rama `main` == `origin/main`, working tree limpio (`git status -sb` sin ahead/behind).
- Último commit: `4807d37` "fix(voz): soltar el cerrojo voz↔Telegram al completar el turno". La noche son 4 commits (`2f3b96f`, `2d4cf98`, `8122a3d`, `4807d37`), todos pusheados a `aprelmah/claude-electron`.
- Tests: **1063 (1057 pass / 0 fail / 6 skip)** — hook pre-commit corrió la suite en cada commit.
- Deploy: **HECHO 2026-08-06 ~22:00** — asar verificado por CONTENIDO (voice-note, pty-prompt-write, apple-transcribe y bridge con voiceReply dentro; helper con transcribe+synth por strings largas). Probado en vivo por Luismi: transcripción rápida ✓, prompt enviado de verdad al PTY ✓, nota de voz de vuelta ✓, modo voz en la app ✓.
- La app quedó corriendo **lanzada desde Terminal** con log en `/tmp/poweragent-voice-debug.log` (para diagnóstico de voz). Un arranque normal posterior pierde la captura — sin consecuencias.

## Próximo paso

- Nada urgente. Si Luismi reporta otra vez "el modo voz se queda escuchando": relanzar desde Terminal con redirect y mirar `[voz-evt]` (¿llega `speech-detected`? ¿parciales? ¿`final`?) — la vez anterior el ciclo salió sano y no se reprodujo.
- Consciente y sin hacer: notas de voz solo en el bridge principal (el bot de avisos responde en texto); audios >55 s van por whisper sin trocear.

## Notas operativas

- El helper se prueba SUELTO por stdin/stdout para todo lo que no toque micrófono (synth, listado de voces): así se cazaron los dos bugs del synth sin tocar la app. Lo que toca micrófono/reconocimiento solo funciona como hijo de la app empaquetada.
- `strings` sobre el binario Swift NO vale para verificar literales cortos (≤15 bytes van inline, no a la tabla): verificar con cadenas largas del mismo bloque de código.
- Trampa vigente: `npm run deploy` no mata la instancia dev → SingletonLock → la empaquetada se suicida en silencio. Matar dev a mano antes.
