'use strict'

// Decide CUÁNDO ha terminado de hablar el usuario, con umbral relativo a su
// propia voz en vez de un absoluto fijo.
//
// El helper cerraba el turno cuando pasaban N segundos sin ningún buffer por
// encima de 0,012 de RMS. Ese 0,012 es un absoluto: una tele, un ventilador o
// una conversación en la habitación lo superan de sobra, así que reiniciaban el
// reloj del silencio para siempre y el micro no cerraba NUNCA (reportado por
// Luismi el 2026-08-08). Aquí el umbral se calcula en cada tramo a partir de
// dos referencias medidas en vivo:
//
// - `floor`: el suelo de ruido de la sala. Baja rápido (un hueco de silencio es
//   información fiable) y sube muy lento, y además se CONGELA mientras se está
//   hablando: el ruido se aprende en los huecos, nunca de la propia voz. Sin
//   congelarlo, un ruido sostenido acaba metiéndose en el suelo y subiendo el
//   umbral hasta cortar al usuario.
// - `speechLevel`: media móvil del nivel de la voz del usuario en este turno. Se
//   usa la MEDIA y no el pico porque el pico lo fija un golpe de sílaba o una
//   tos: con el pico, bajar la voz a mitad de frase te corta.
//
// El umbral de salida (¿sigue hablando?) es el mayor de los tres, y el de
// entrada (¿ha empezado a hablar?) lleva un 50% de histéresis encima para que un
// ruido que roce el umbral no abra turno.
//
// Segunda señal, independiente del audio: el texto del reconocedor. Si lo que
// entra por el micro no genera palabras nuevas durante `staleTextMs` y además
// está por debajo del umbral de entrada, es ruido — se cierra aunque el nivel no
// haya bajado nunca. Cubre el caso duro: ruido sostenido tan alto que se cuela
// por encima del umbral adaptativo.
//
// Módulo puro: sin temporizadores, sin E/S, sin estado global. Recibe niveles y
// texto con su instante, y devuelve la decisión. Quien lo usa (main/voice-session.js)
// es quien manda el cierre al helper.

// Suelo duro. Por debajo de esto no hay voz útil ni en una sala insonorizada, y
// evita que un micro silenciado dé umbral cero y todo parezca voz.
const ABS_MIN = 0.012
// Cuánto tiene que despegar la voz del suelo de ruido para contar.
const FLOOR_MULT = 2.2
// Fracción de tu propio nivel de voz por debajo de la cual algo ya no eres tú.
// 0,28 ≈ 11 dB por debajo: una voz al otro lado de la habitación cae ahí.
const SPEECH_RATIO = 0.28
// Histéresis: entrar cuesta más que mantenerse.
const ENTER_MULT = 1.5
// Adaptación del suelo de ruido, por tramo (~100 ms).
const FLOOR_DOWN = 0.25
const FLOOR_UP = 0.002
// Media móvil del nivel de voz.
const SPEECH_ALPHA = 0.15

const DEFAULT_SILENCE_MS = 1800
// El respaldo por texto congelado va SIEMPRE por detrás de la pausa de silencio:
// existe para el ruido alto sostenido, donde el reloj del silencio no vence
// nunca. Con un valor fijo por debajo de la pausa cortaba al usuario mientras
// pensaba a mitad de frase (2026-08-08, primera prueba de Luismi).
const STALE_TEXT_FACTOR = 1.5
const STALE_TEXT_EXTRA_MS = 1500

function createVoiceEndpointer({
  silenceMs,
  staleTextMs,
  absMin,
  floorMult,
  speechRatio,
  enterMult
} = {}) {
  const SILENCE = Number.isFinite(silenceMs) && silenceMs > 0 ? silenceMs : DEFAULT_SILENCE_MS
  const STALE = Number.isFinite(staleTextMs) && staleTextMs > 0
    ? staleTextMs
    : Math.max(SILENCE * STALE_TEXT_FACTOR, SILENCE + STALE_TEXT_EXTRA_MS)
  const MIN = Number.isFinite(absMin) && absMin > 0 ? absMin : ABS_MIN
  const FMULT = Number.isFinite(floorMult) && floorMult > 0 ? floorMult : FLOOR_MULT
  const RATIO = Number.isFinite(speechRatio) && speechRatio > 0 ? speechRatio : SPEECH_RATIO
  const EMULT = Number.isFinite(enterMult) && enterMult > 1 ? enterMult : ENTER_MULT

  let floor = null
  let speechLevel = 0
  let hasSpeech = false
  let lastVoiceAt = 0
  let lastText = ''
  let lastTextAt = 0
  let closed = false

  function exitThreshold() {
    const base = floor === null ? 0 : floor * FMULT
    return Math.max(MIN, base, speechLevel * RATIO)
  }

  function reset() {
    floor = null
    speechLevel = 0
    hasSpeech = false
    lastVoiceAt = 0
    lastText = ''
    lastTextAt = 0
    closed = false
  }

  // Devuelve {close:true, reason} UNA vez por turno, o null.
  function onLevel(raw, now) {
    if (closed) return null
    const v = Number(raw)
    if (!Number.isFinite(v) || v < 0) return null
    const t = Number(now)
    if (!Number.isFinite(t)) return null

    if (floor === null) floor = v

    const exit = exitThreshold()
    const enter = exit * EMULT

    if (v >= enter) {
      if (!hasSpeech) { hasSpeech = true; lastVoiceAt = t }
      speechLevel = speechLevel === 0 ? v : speechLevel + (v - speechLevel) * SPEECH_ALPHA
      lastVoiceAt = t
    } else if (hasSpeech && v >= exit) {
      lastVoiceAt = t
    }

    // El suelo aprende en los huecos: mientras lo que entra cuenta como voz, se
    // congela. Bajar es siempre fiable, subir no.
    if (v < floor) floor += (v - floor) * FLOOR_DOWN
    else if (!hasSpeech || v < exit) floor += (v - floor) * FLOOR_UP

    if (!hasSpeech) return null

    if (t - lastVoiceAt >= SILENCE) {
      closed = true
      return { close: true, reason: 'silence' }
    }
    if (lastTextAt && t - lastTextAt >= STALE && v < enter) {
      closed = true
      return { close: true, reason: 'stale-text' }
    }
    return null
  }

  // Parciales del reconocedor. Que haya transcripción es prueba de voz aunque
  // el nivel no la haya visto (un micro lejano con la ganancia baja).
  function onText(text, now) {
    const clean = String(text == null ? '' : text).trim()
    if (!clean || clean === lastText) return
    const t = Number(now)
    if (!Number.isFinite(t)) return
    lastText = clean
    lastTextAt = t
    if (!hasSpeech) { hasSpeech = true }
    lastVoiceAt = t
  }

  function snapshot() {
    return {
      floor: floor === null ? null : Number(floor.toFixed(5)),
      speechLevel: Number(speechLevel.toFixed(5)),
      exit: Number(exitThreshold().toFixed(5)),
      enter: Number((exitThreshold() * EMULT).toFixed(5)),
      hasSpeech,
      closed
    }
  }

  return { reset, onLevel, onText, snapshot }
}

module.exports = {
  createVoiceEndpointer,
  ABS_MIN,
  DEFAULT_SILENCE_MS,
  STALE_TEXT_FACTOR,
  STALE_TEXT_EXTRA_MS
}
