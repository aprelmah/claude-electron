# Voz en directo en POWER-AGENT — diseño

**Fecha:** 2026-08-04
**Estado:** diseño aprobado, sin implementar
**Decisiones tomadas con:** Luismi (4 preguntas de producto, ver §2)

## 1. Qué se construye

Un modo voz dentro de POWER-AGENT con dos comportamientos y un interruptor entre ellos:

- **Charla** (por defecto): hablas, contesta hablando, con latencia de conversación. Para consultar, pensar en voz alta, decidir. No toca el repo.
- **Encargo**: dices "hazlo" y la orden pasa a la sesión de Claude Code que ya está trabajando. Silencio mientras trabaja. Al cerrar el turno, te lee la conclusión en prosa.

Manos libres: el micro queda abierto mientras el modo voz está activo, y el fin de frase lo detecta el sistema. Sin pulsar nada.

## 2. Decisiones de producto (cerradas)

| Decisión | Elegido | Descartado |
|---|---|---|
| Alcance | Charla **y** encargo, con interruptor | solo uno de los dos |
| Motor | Apple Speech en **modo servidor** | on-device (imposible, §3), APIs de pago |
| Qué se lee en voz | **Solo la respuesta final, en prosa** | narrar progreso; resumen generado aparte |
| Activación | **Manos libres con VAD** | push-to-talk; palabra clave |

La elección inicial fue "todo local, coste cero". Las mediciones de §3 la invalidaron y Luismi optó por el modo servidor de Apple con el número delante: sigue costando 0 €, pero **el audio de las frases viaja a los servidores de Apple**, igual que el dictado nativo de macOS. Es una renuncia consciente a "nada sale del Mac".

## 3. Mediciones que fundamentan el diseño

Máquina: Intel i7-4770HQ (2014), 8 hilos, macOS 12.7.6. Todas las cifras medidas el 2026-08-04, no estimadas.

### Coste de cómputo local (transcripción de fichero)

| motor | 1,6 s | 5,9 s | 15,1 s | RTF |
|---|---|---|---|---|
| whisper.cpp base-q5_1 | — | 8,3 s | — | 1,41 |
| whisper.cpp small-q5_1 | — | 34,1 s | — | 5,78 |
| Apple on-device | 4,4 s | 18,8 s | 113 s | 2,5–7,5 |
| **Apple servidor** | **1,5 s** | **2,0 s** | **5,8 s** | **0,34–0,38** |

**Ningún motor local transcribe tan rápido como se habla en esta CPU.** El on-device además se desploma con audio largo (RTF 7,5 a los 15 s). La calidad local también era mala: *"el modelo de sesiones decir porque tres… cambios sin comida"*.

### Latencia real hablando (micro en vivo, modo servidor)

| medición | media | rango |
|---|---|---|
| primer texto en pantalla | **617 ms** | 555–701 |
| desde que callas → texto final | **1022 ms** | 896–1186 |

Transcripción correcta en las 3 rondas, castellano natural.

### Eco por altavoz

`AVAudioEngine.setVoiceProcessingEnabled(true)` (VoiceProcessingIO de CoreAudio) **cancela el altavoz**: con el TTS sonando y el micro abierto, el reconocedor no se oyó a sí mismo. **Manos libres sin auriculares es viable.** Era el riesgo principal del diseño.

### Hallazgo operativo

`SFSpeechRecognizer.requestAuthorization` **no responde** si el proceso no es una app con bundle lanzada por LaunchServices. Un binario suelto no obtiene el permiso ni con firma ad-hoc. No afecta a POWER-AGENT (se lanza así), pero sí impide testear el helper desde CI o desde un shell.

Evidencia: `/tmp/voiceprobe.log`, app de laboratorio `VoiceProbe.app` (scratchpad de la sesión).

## 4. Arquitectura

### 4.1 `voice-helper` (Swift)

Un binario propio. Node no tiene acceso a `Speech.framework` ni a `VoiceProcessingIO`, y esas dos son justo las piezas que hacen viable el diseño.

- **Fuente:** `voice-helper/VoiceHelper.swift`
- **Compilado a:** `resources/voice-helper` vía `extraResources` (fuera del asar: un binario dentro del asar no es ejecutable). Resuelto en runtime con `process.resourcesPath`.
- **Proceso único** por app, de vida larga, arrancado bajo demanda al activar el modo voz.

Protocolo JSON por líneas sobre stdin/stdout:

| dirección | mensaje |
|---|---|
| → helper | `{cmd:"start"}` · `{cmd:"stop"}` · `{cmd:"speak",id,text}` · `{cmd:"shutup"}` · `{cmd:"vocab",words:[…]}` |
| ← helper | `{type:"ready"}` · `{type:"partial",text}` · `{type:"final",text}` · `{type:"speech-start",id}` · `{type:"speech-end",id}` · `{type:"user-interrupt"}` · `{type:"error",message}` |

Configuración interna: locale `es-ES`, `requiresOnDeviceRecognition = false`, `shouldReportPartialResults = true`, `setVoiceProcessingEnabled(true)`.

**Endpointing propio**, no el de Apple: se cierra el turno tras **1,1 s** sin voz (RMS bajo umbral) habiendo habido voz antes. El valor sale de la medición: el texto se estabiliza a ~1,0 s de callar.

**Barge-in**: mientras `synth.isSpeaking`, si el RMS supera el umbral de voz → `stopSpeaking(.immediate)` y `{type:"user-interrupt"}`. Es lo que da la sensación de conversación, más que la latencia bruta.

**`vocab`** alimenta `contextualStrings` con vocabulario del proyecto (nombres de módulos, ramas, jerga del repo). Necesario: la prueba de humo validó castellano común, **no** castellano técnico.

### 4.2 `main/voice-session.js`

Dueño del proceso helper y de la máquina de estados:

```
IDLE ──start──> LISTENING ──final──> THINKING ──texto──> SPEAKING ──┐
  ^                  ^                                              │
  └──────stop────────┴──────────── user-interrupt ──────────────────┘
```

Responsabilidades: ciclo de vida del helper (arranque, muerte, reinicio), estado, y reenvío de eventos al renderer. No decide a dónde va el texto — de eso se encarga el router.

### 4.3 `main/voice-router.js`

Decide destino de cada `final`:

- **Charla** → `subchat-pty` de la ventana activa. Fork (`--fork-session`) de la sesión en curso: hereda el contexto de lo que estás haciendo sin ensuciar el hilo madre, y va contra la cuota Max (0 € por turno).
- **Encargo** → PTY de la sesión madre.

Detección de intención en v1: **lista de patrones**, no clasificador ("hazlo", "aplícalo", "arréglalo", "cámbialo", "commitea", "ejecuta"…). Un clasificador añadiría un turno de LLM y latencia a cada frase. Complementado con un **toggle manual** en la UI que manda sobre la detección: si el modo está fijado, no se adivina nada.

### 4.4 Reutilización: el relay ya resuelve lo difícil

`main/relay-transcript-helpers.js` ya sabe **localizar el transcript por `sessionId`** (no por cwd), **detectar el fin de turno de verdad** (`turnComplete`: último evento `assistant` con `stop_reason: 'end_turn'`, ignorando sidechains) y **extraer el texto limpio del JSONL** en vez de raspar el TUI.

El modo voz es **otro consumidor del mismo relay**, no una tubería nueva. Todas las trampas ya documentadas (fork del `--resume`, lectura parcial por offset, la primera línea del slice) se heredan resueltas.

### 4.5 Filtro de lo que se dice en voz

`speakableFromAssistantText(md)`: del texto assistant, fuera bloques de código, diffs, rutas largas y tablas. Lo que queda es prosa. Si tras filtrar no queda nada, no se habla — se emite un tono corto.

Nadie quiere oír 40 líneas de JavaScript leídas por Mónica.

### 4.6 UI

Botón de micro en la topbar con los cuatro estados (apagado / escuchando / pensando / hablando) y el parcial en vivo bajo el botón, para ver qué está entendiendo. Toggle charla/encargo al lado.

## 5. Cambios en `package.json`

- `build.mac.extendInfo`: añadir **`NSSpeechRecognitionUsageDescription`** (`NSMicrophoneUsageDescription` ya existe, con texto que habla de Whisper — actualizarlo).
- `build.extraResources`: nuevo, para `resources/voice-helper`.
- `build.files` es **whitelist**: `main/**/*` ya cubre los módulos nuevos; el helper va por `extraResources`, no por aquí.
- Script `build:voice-helper` (swiftc) encadenado antes del empaquetado.

## 6. Riesgos

1. **App sin firmar.** El permiso de micrófono/reconocimiento se ancla a la firma. Con firma ad-hoc que cambia en cada build, **es probable que macOS vuelva a pedir permiso en cada `npm run deploy`**. Mismo patrón que ya pasó con las notificaciones nativas en Electron 43.
2. **Castellano técnico sin validar.** Mitigado con `contextualStrings`, pero no verificado. Primera cosa a comprobar al implementar.
3. **Voces del sistema robóticas.** Todas las voces es-ES instaladas son `default`. Requiere que Luismi descargue *Mónica (Mejorada)* a mano desde Ajustes → Accesibilidad → Contenido hablado → Gestionar voces. Sin eso, la experiencia es mala por motivos ajenos al código.
4. **Dependencia de red.** En modo servidor, sin internet no hay voz. Fallback previsto: aviso claro, no degradar a whisper local en silencio (8 s por frase se percibe como "se ha colgado").
5. **Techo de plataforma.** macOS 12 es el suelo y Electron 43 el techo (la 44 exige Ventura). El diseño no usa nada posterior a macOS 12.

## 7. Fuera de alcance (v1)

Palabra clave de activación · voz en sesiones LAN · voz en Telegram/WhatsApp · varias ventanas hablando a la vez · TTS neuronal externo (Piper) · elegir modelo/voz por sesión.

## 8. Verificación

- **Tests unitarios** (`node --test`): router (patrones de intención, toggle manual gana), `speakableFromAssistantText` (code fences, diffs, tablas, vacío), máquina de estados de `voice-session` con helper simulado.
- **El helper Swift no es testeable en CI**: requiere micro, altavoz y un bundle autorizado por LaunchServices (§3). Se verifica a mano contra la lista de §9.
- **Sin regresión** en los 612 tests actuales.

## 9. Checklist de aceptación manual

1. Hablas y el parcial aparece en <1 s.
2. Callas y contesta sin tocar nada.
3. Le hablas encima mientras habla y **se calla al instante**.
4. Por altavoz, sin auriculares, no se autointerrumpe.
5. Dices "hazlo" y la orden entra en la sesión madre, no en el subchat.
6. Al terminar un turno con herramientas, lee la conclusión y **no** lee los diffs.
7. Dices tres nombres de módulos del repo y los transcribe bien.
8. Sin internet: avisa claramente, no se cuelga.
