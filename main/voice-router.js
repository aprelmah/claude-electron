'use strict'

// Decide a dónde va lo que dices: charla lateral (sub-chat forkeado) o
// encargo a la sesión de trabajo.
//
// Patrones, no clasificador: un clasificador metería un turno de LLM y su
// latencia en CADA frase. Se equivoca alguna vez, y para eso está el toggle
// manual, que siempre gana.
//
// Regla de seguridad de este módulo: lo peor que puede pasar es mandar a
// encargo (con efectos reales en el código) algo que en realidad era charla.
// Por eso, en cualquier caso ambiguo, indeterminado o de entrada rara, el
// resultado por defecto es SIEMPRE 'charla' — nunca 'encargo'.
//
// Ronda de correcciones 1: la versión anterior buscaba el disparador EN
// CUALQUIER PARTE de la frase ("el último commit rompió el build" disparaba
// por la sola palabra "commit"). Alguien hablando cerca del micro nombra
// estas palabras constantemente sin dar ninguna orden. Ahora el disparador
// solo cuenta si ABRE la frase — igual que "pregunta" solo cuenta si el
// interrogativo abre la frase, no si aparece en una subordinada ("aplica el
// cambio QUE te dije" ya no se confunde con una pregunta por el "que").
//
// Ronda de correcciones 2: anclar al inicio no basta si la propia palabra
// FUNCIONA como muletilla en español coloquial — esas son justo las que más
// abren frases sin ser una orden ("dale un vistazo", "dale recuerdos",
// "dale que dale", "adelante, te escucho"). "dale" y "adelante" están fuera
// de PATRONES_ENCARGO_INICIO por eso: no se borran, se degradan a cortesía
// (como "venga" o "vale"), así que siguen sirviendo delante de un disparador
// real ("dale, arregla el login" → encargo) pero ya no ordenan por sí solas.

// Disparadores de encargo. Anclados con ^ a propósito: se evalúan sobre lo
// que queda de la frase tras pelar signos de apertura y, como mucho, UNA
// cortesía/muletilla inicial (ver pelarInicioParaDisparador). Si el
// disparador no abre la frase, no cuenta — habla DE la acción, no la ordena.
const PATRONES_ENCARGO_INICIO = [
  /^haz(lo|lo ya)?\b/i,
  /^hazme\b/i,
  /^aplica(lo|r)?\b/i,
  /^aplícalo\b/i,
  /^arregla(lo|r)?\b/i,
  /^arréglalo\b/i,
  /^cambia(lo)?\b/i,
  /^cámbialo\b/i,
  /^ejecuta\b/i,
  /^corre los tests?\b/i,
  /^commitea\b/i,
  /^commit\b/i,
  /^implementa(lo)?\b/i,
  /^escribe(lo)?\b/i,
  /^bórra(lo)?\b/i,
  /^borra(lo)?\b/i
]

// Cortesías/muletillas que pueden abrir la frase sin contar como parte del
// disparador ("venga, arréglalo", "por favor aplica el cambio..."). Lista
// corta y cerrada a propósito: cualquier otra palabra al principio bloquea
// la detección de disparador-al-inicio. Más falsos negativos, cero falsos
// positivos — el lado seguro.
//
// "dale" y "adelante" viven aquí, no en los disparadores: en español
// coloquial se usan más como interjección de ánimo/permiso ("dale que
// dale", "dale un vistazo", "dale recuerdos", "¡adelante!", "de aquí en
// adelante") que como orden en sí mismas. La propia palabra "dale" es
// sinónimo de "adelante" en ese uso — mismo problema, mismo arreglo.
const PREFIJOS_CORTESIA = ['por favor', 'porfa', 'venga', 'oye', 'ahora', 'vale', 'y', 'pues', 'dale', 'adelante']

// Uno por cortesía, anclado al principio, con \b para no cortar a media
// palabra, y que se coma la puntuación/espacio que la separa del resto
// ("venga," → "venga" + ",").
const RE_PREFIJOS_CORTESIA = PREFIJOS_CORTESIA.map(
  (frase) => new RegExp('^' + frase.replace(/ /g, '\\s+') + '\\b[\\s,;:.!]*', 'i')
)

// El dictado a veces antepone signos de apertura (¡ ¿ comillas) que no
// deben tapar un disparador o una cortesía justo después.
function pelarSignosApertura(s) {
  return s.replace(/^[\s¡¿"'«»“”‘’]+/, '')
}

function pelarInicioParaDisparador(texto) {
  let s = pelarSignosApertura(texto)
  // Como mucho UNA cortesía inicial: "un prefijo corto", no una cadena de
  // muletillas.
  for (const re of RE_PREFIJOS_CORTESIA) {
    const sinPrefijo = s.replace(re, '')
    if (sinPrefijo !== s) {
      s = sinPrefijo
      break
    }
  }
  return pelarSignosApertura(s)
}

// Interrogativos sin tilde incluidos aposta: el dictado se come tildes. Pero
// solo cuentan si ABREN la frase — si no, "que"/"como"/"porque" (las formas
// de subordinada más comunes del español) convierten cualquier orden con
// complemento en charla ("hazlo QUE hace falta ya" no es una pregunta).
const RE_INTERROGATIVO_INICIO =
  /^(cómo|como|qué|que|por qué|porque|cuál|cual|deberíamos|deberias|debería|crees|opinas|piensas|merece la pena)\b/i

function esPreguntaAlInicio(t) {
  if (/^\s*¿/.test(t)) return true
  if (/\?\s*$/.test(t)) return true
  return RE_INTERROGATIVO_INICIO.test(t)
}

function routeVoiceText(text, opts) {
  // opts puede llegar undefined U null — ambos son "sin opciones". El
  // default de parámetro de JS ({} = ...) solo cubre undefined, no null.
  const { forcedMode = null } = opts || {}

  // 1) El toggle manual siempre gana, aunque el texto reconocido sea ruido.
  if (forcedMode === 'charla' || forcedMode === 'encargo') {
    return { mode: forcedMode, reason: 'forzado' }
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { mode: 'charla', reason: 'sin texto' }
  }

  const t = text.trim()

  // 2) Pregunta-al-inicio, antes que nada: una pregunta sobre hacer algo
  // nunca es la orden de hacerlo, aunque contenga el verbo de ejecución.
  if (esPreguntaAlInicio(t)) {
    return { mode: 'charla', reason: 'es una pregunta sobre hacerlo, no la orden' }
  }

  // 3) Disparador-al-inicio: solo cuenta si abre la frase (tras pelar signos
  // de apertura y, como mucho, una cortesía). Un disparador de fondo —
  // hablando DE la acción, no ordenándola— no cuenta.
  const inicio = pelarInicioParaDisparador(t)
  const esOrden = PATRONES_ENCARGO_INICIO.some((re) => re.test(inicio))
  if (esOrden) return { mode: 'encargo', reason: 'verbo de ejecución al inicio de la frase' }

  // 4) Cualquier otro caso: charla. Es el lado seguro.
  return { mode: 'charla', reason: 'sin verbo de ejecución al inicio' }
}

function resolveVoiceTarget(session, opts) {
  // Mismo cuidado que en routeVoiceText: opts puede llegar null explícito.
  const { subchatHas = false } = opts || {}

  if (!session) return { ok: false, reason: 'no hay ninguna sesión abierta' }
  if (session.activeCli !== 'claude') return { ok: false, reason: 'el modo voz solo funciona con claude, no con codex' }
  if (!session.pty) return { ok: false, reason: 'la sesión no tiene un proceso vivo' }
  if (!session.claudeSessionId) return { ok: false, reason: 'la sesión aún no ha completado su primer turno' }

  return { ok: true, target: 'subchat', reuseSubchat: !!subchatHas }
}

module.exports = { routeVoiceText, resolveVoiceTarget }
