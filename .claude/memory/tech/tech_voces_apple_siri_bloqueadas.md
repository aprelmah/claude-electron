# Las voces de Siri no se pueden usar desde POWER-AGENT (cerrado 2026-08-08)

**No volver a intentarlo.** Está comprobado con sonda propia sobre este Mac (macOS 12.6 Monterey, Intel), no con documentación ni suposiciones. Repetir la investigación cuesta una tarde.

## Qué se quería

Luismi descargó *Siri Voz 1* y *Siri Voz 2* en español (Preferencias → Accesibilidad → **Contenido leído** → Voz del sistema → Personalizar…, 1 GB) para que sonaran en el modo voz, porque las voces de fábrica suenan a robot.

## Resultado de cada vía probada

| Vía | Resultado |
|---|---|
| `AVSpeechSynthesisVoice.speechVoices()` — la que usa el helper | 5 voces es-*, ninguna Siri |
| Métodos de clase de `AVSpeechSynthesisVoice` (runtime ObjC) | solo `speechVoices`, `voiceWithLanguage:`, `voiceWithIdentifier:`. **No hay listado ampliado ni selector privado** |
| `AVSpeechSynthesisVoice(identifier:)` con 12 identificadores candidatos de Siri | los 12 devuelven `nil` |
| `say -v ?` (NSSpeechSynthesizer, API clásica) | solo Jorge y Monica |
| **`TTSSpeechSynthesizer`** (`TextToSpeech.framework` privado, el que usa "Leer selección" del sistema) | `allAvailableVoices`, `availableVoices` y `availableVoicesForLanguageCode:queryingMobileAssets:` devuelven **0 voces para CUALQUIER idioma**, incluido `en-US`, incluso tras `refreshAllAvailableVoices` |

El último dato es el que cierra el asunto: ese framework no está filtrando las voces de Siri, está **capado entero** para procesos sin el entitlement interno de Apple — ni siquiera devuelve las voces básicas que sí funcionan por la vía pública. Ese entitlement se concede firmando con certificados que solo tiene Apple.

## Dato secundario útil

Los identificadores reales de las voces instaladas son `com.apple.speech.synthesis.voice.jorge.premium` y `...monica.premium`: **ya se está usando la mejor versión que Apple presta a las apps** en Monterey. En es-ES este macOS no ofrece variantes "(Mejorada)"/"(Premium)" descargables aparte; solo Jorge, Mónica y las dos de Siri.

No hace falta redesplegar para que la app vea una voz nueva: el helper pide la lista al sistema cada vez que se abre el desplegable (`voice:voices`), no la cachea.

## Decisión de producto (Luismi, 2026-08-08)

**No** integrar un motor TTS externo. Se evaluaron:

- **Piper** — `es_ES-davefx`, castellano real, 3-5× más rápido que tiempo real en CPU, calidad valorada C+.
- **Kokoro-82M** — Apache 2.0, 327 MB, calidad A/A-, pero acento neutro panhispánico (no castellano) y va justo en un i7 de 2014 sin GPU.

Criterio de Luismi: *"si la mejora va a ser mucha hazlo, si no paso"*. Veredicto dado: mejora **media, no transformadora** — ninguna de las dos gratis suena a persona, y el coste es otro binario que mantener, latencia antes de cada frase (hoy Apple arranca instantáneo) y riesgo sobre un modo voz que acaba de empezar a ir bien. Se queda con Mónica.

Las voces instalables en el sistema que SÍ aparecerían solas en el desplegable (CereProc, Acapela, Infovox iVox) son **de pago**, 30-100 €. Gratis y por esa vía no hay nada que supere a Mónica.

## Dónde están las sondas

Se escribieron en el scratchpad de la sesión (`probe-siri.swift`, `probe-tts*.swift`) y no se conservan: lo que importa son los resultados de la tabla. Si alguna vez hay que rehacerlas, el patrón es `dlopen` del framework privado + `objc_copyMethodList` sobre la metaclase + `perform` del selector.
