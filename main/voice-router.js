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

const PATRONES_ENCARGO = [
  /\bhaz(lo|lo ya)?\b/i,
  /\bhazme\b/i,
  /\baplica(lo|r)?\b/i,
  /\baplícalo\b/i,
  /\barregla(lo|r)?\b/i,
  /\barréglalo\b/i,
  /\bcambia(lo)?\b/i,
  /\bcámbialo\b/i,
  /\bejecuta\b/i,
  /\bcorre los tests?\b/i,
  /\bcommitea\b/i,
  /\bcommit\b/i,
  /\bimplementa(lo)?\b/i,
  /\bescribe(lo)?\b/i,
  /\bbórra(lo)?\b/i,
  /\bborra(lo)?\b/i,
  /\badelante\b/i,
  /\bdale\b/i
]

// Si la frase es una pregunta sobre hacer algo, no es la orden de hacerlo.
const PATRONES_PREGUNTA = [
  /^\s*¿/,
  /\?\s*$/,
  /\b(cómo|como|qué|que|por qué|porque|cuál|cual|deberíamos|deberias|debería|crees|opinas|piensas|merece la pena)\b/i
]

function routeVoiceText(text, { forcedMode = null } = {}) {
  // El toggle manual siempre gana, aunque el texto reconocido sea ruido.
  if (forcedMode === 'charla' || forcedMode === 'encargo') {
    return { mode: forcedMode, reason: 'forzado' }
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { mode: 'charla', reason: 'sin texto' }
  }

  const t = text.trim()
  const pareceOrden = PATRONES_ENCARGO.some((re) => re.test(t))
  if (!pareceOrden) return { mode: 'charla', reason: 'sin verbo de ejecución' }

  const parecePregunta = PATRONES_PREGUNTA.some((re) => re.test(t))
  if (parecePregunta) return { mode: 'charla', reason: 'es una pregunta sobre hacerlo, no la orden' }

  return { mode: 'encargo', reason: 'verbo de ejecución' }
}

function resolveVoiceTarget(session, { subchatHas = false } = {}) {
  if (!session) return { ok: false, reason: 'no hay ninguna sesión abierta' }
  if (session.activeCli !== 'claude') return { ok: false, reason: 'el modo voz solo funciona con claude, no con codex' }
  if (!session.pty) return { ok: false, reason: 'la sesión no tiene un proceso vivo' }
  if (!session.claudeSessionId) return { ok: false, reason: 'la sesión aún no ha completado su primer turno' }

  return { ok: true, target: 'subchat', reuseSubchat: !!subchatHas }
}

module.exports = { routeVoiceText, resolveVoiceTarget }
