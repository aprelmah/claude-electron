# Modo voz — mediciones y reglas duras

_2026-08-04. Medido en el Mac de Luismi: **Intel i7-4770HQ (2014), 8 hilos, macOS 12.7.6**. Nada de esto está estimado._

Este archivo existe para que **nadie repita estas mediciones**. Costaron una sesión y el resultado es contraintuitivo.

## El reconocimiento local no sirve en esta máquina

Transcripción de fichero, mismo audio en castellano:

| motor | 1,6 s | 5,9 s | 15,1 s | RTF |
|---|---|---|---|---|
| whisper.cpp `base-q5_1` | — | 8,3 s | — | 1,41 |
| whisper.cpp `small-q5_1` | — | 34,1 s | — | 5,78 |
| Apple Speech **on-device** | 4,4 s | 18,8 s | 113 s | 2,5–7,5 |
| Apple Speech **servidor** | 1,5 s | **2,0 s** | 5,8 s | 0,34–0,38 |

**RTF > 1 significa que transcribir tarda más que hablar.** Los tres motores locales lo superan. El on-device de Apple además **se desploma con audio largo** (RTF 7,5 a los 15 s) y destroza el castellano técnico: *"el modelo de sesiones decir porque tres… cambios sin comida"*.

**REGLA DURA: no volver a intentar reconocimiento local en este Mac.** Está probado con tres motores. Si alguien lo propone "para no depender de la red", que lea esta tabla. Solo cambia si cambia el hardware: un Apple Silicon deja whisper.cpp en RTF ~0,05 y lo vuelve trivial.

## Con los servidores de Apple sí funciona

Micro real, streaming, `es-ES`, 3 rondas:

| medición | media | rango |
|---|---|---|
| primer texto en pantalla | **617 ms** | 555–701 |
| desde que callas → texto final | **1022 ms** | 896–1186 |

Transcripción correcta en las 3 rondas. **Coste 0 €** — es el mismo motor del dictado de macOS. Contrapartida asumida por Luismi con el dato delante: **el audio sale del Mac hacia Apple**.

De aquí sale el endpointing de 1,1 s del helper: el texto se estabiliza a ~1,0 s de callar.

## El eco no es un problema

`AVAudioEngine.inputNode.setVoiceProcessingEnabled(true)` (VoiceProcessingIO de CoreAudio) **cancela el altavoz**. Verificado: con el TTS sonando por altavoz y el micro abierto, el reconocedor **no se oyó a sí mismo**.

Era el riesgo que podía matar el manos libres. No hace falta obligar a usar auriculares.

## Hallazgos operativos que costaron tiempo

1. **`SFSpeechRecognizer.requestAuthorization` no responde fuera de un bundle.** Un binario suelto —aunque esté firmado ad-hoc— no obtiene permiso: el callback nunca llega y el proceso **muere en silencio**. Solo funciona en una app con `Info.plist` lanzada por LaunchServices. Consecuencia: el helper tiene que ser hijo de la app, y su parte de audio **no es testeable desde CI ni desde un shell**.
2. **`timeout` no existe en macOS.** Varios intentos de probar el helper fallaron con `command not found`, aparentando que el binario estaba roto cuando ni llegaba a ejecutarse. Usar `gtimeout` (coreutils) o nada.
3. **Las voces instaladas son todas `default`** (Jorge, Mónica, Diego, Juan, Paulina). Ninguna `enhanced` ni `premium`: suenan a robot. Se arregla desde Ajustes → Accesibilidad → Contenido hablado → Gestionar voces → *Mónica (Mejorada)*. **Es GUI, lo tiene que hacer Luismi.** Sin eso la experiencia es mala por motivos ajenos al código.

## Trampas ya resueltas dentro de `voice-helper/VoiceHelper.swift`

No "arreglarlas" de vuelta — cada una costó una depuración:

- **`emit` es asíncrono.** Se le llama desde el hilo de CoreAudio (barge-in); bloquearlo con E/S corta el audio.
- **`exitDraining` vacía la cola antes de morir.** Salir a pelo se come los eventos pendientes: el último `final` o un `error` fatal se pierden y Node espera una respuesta que ya no llega.
- **Al cerrarse stdin, la salida se encola en la cola principal.** Salir desde el hilo de stdin mata los comandos ya leídos que aún esperaban turno.
- **Permisos en perezoso**, al primer `start`. Pedirlos al arrancar mata el proceso fuera de un bundle (ver hallazgo 1) y vuelve el binario intesteable.

## El sub-chat forkea el sessionId

`--fork-session` escribe en un `.jsonl` **nuevo**; el de la sesión madre no crece con lo que se hable en el sub-chat. Vigilar el sessionId de la madre deja el turno esperando hasta el timeout.

Se detecta con `snapshotClaudeSessions(cwd)` + `findUpdatedOrNewClaudeSessionId(cwd, snapshot)` — **ojo: toman UN cwd, no un array, y el segundo no sabe excluir a la madre**, hay que descartarla a mano.

**Es la tercera vez que esta familia de bugs muerde** (relay con `--resume` el 2026-08-02, pool de PTYs ocultos, ahora el fork del sub-chat). Ante cualquier spawn nuevo de claude, la pregunta obligatoria es: **¿en qué `.jsonl` va a escribir de verdad?**

## Por qué no se reutiliza `relayThroughPty`

Vive **inline en `main.js:922`**, no se exporta, y arrastra 375 líneas de timeouts, rutas de codex y streaming a Telegram. El modo voz solo necesita saber cuándo cierra el turno, y eso ya lo da `extractAssistantTextFromTranscript` (`turnComplete`) de `main/relay-transcript-helpers.js`, que **sí** está exportado, es genérico y está testeado. Son ~60 líneas propias en vez de un refactor de 375 sobre código en producción.

## Enlaces

- Spec: `docs/superpowers/specs/2026-08-04-voz-en-directo-design.md`
- Plan: `docs/superpowers/plans/2026-08-04-voz-en-directo.md`
- Helper: `voice-helper/VoiceHelper.swift`
