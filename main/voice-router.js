'use strict'

// Decide a dónde va lo que dices: encargo a la sesión de trabajo (por defecto)
// o charla lateral en el sub-chat forkeado (solo a petición).
//
// DECISIÓN DE PRODUCTO 2026-08-05, tomada por Luismi con el modo voz ya
// funcionando en vivo: hablar por voz es hablarle a TU sesión de claude. El
// sub-chat es un sitio al que se va queriendo, pulsando el toggle, no el
// destino por omisión de lo que dices.
//
// Aquí vivía un detector de intención por patrones (verbos de ejecución al
// inicio de la frase, cortesías, retractaciones, preguntas) que mandaba a
// charla todo lo ambiguo. Se ha retirado entero: con este default no queda
// ninguna decisión automática que tomar, y 200 líneas de heurística de español
// que nadie ejecuta son deuda, no seguridad. Está en el historial de git
// (rama `feat/modo-voz`) si algún día se quiere volver a un modo mixto.
//
// Consecuencia asumida y consciente: TODO lo que digas con el modo voz
// encendido —incluidas las preguntas y lo que hables de fondo— entra como
// prompt en la sesión de trabajo, que tiene efectos reales sobre el proyecto.
// Es exactamente lo que se pidió.

function routeVoiceText(text, opts) {
  // opts puede llegar undefined U null — ambos son "sin opciones". El default
  // de parámetro de JS ({} = ...) solo cubre undefined, no null.
  const { forcedMode = null } = opts || {}

  // El toggle manual manda, aunque el texto reconocido sea ruido.
  if (forcedMode === 'charla' || forcedMode === 'encargo') {
    return { mode: forcedMode, reason: 'forzado' }
  }

  return { mode: 'encargo', reason: 'por defecto va a la sesión de trabajo' }
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
