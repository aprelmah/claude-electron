'use strict'

// Saneado de texto que entra por canal (Telegram, WhatsApp, bot de avisos)
// antes de acabar en un PTY con bypassPermissions o en un prompt headless.
// Patrón robado de Hermes Agent, que escanea la memoria antes de aceptarla:
// aquí se escanea lo que viene de fuera antes de que toque un prompt.
//
// Dos piezas, con políticas distintas por llamador:
// - Limpieza (siempre): Unicode invisible (zero-width, bidi, BOM), secuencias
//   ANSI/escapes y controles C0 — sirven para esconder instrucciones o para
//   inyectar en el terminal. \r se normaliza a \n: un \r crudo dentro de un
//   write al PTY es un ENTER (regla dura de pty-prompt-write.js).
// - Detección (findings): patrones de override de instrucciones, exfiltración
//   de secretos y ejecución peligrosa. Quién decide qué hacer es el llamador:
//   Telegram (allowlisted) solo limpia y registra; WhatsApp (clientes) escala
//   a humano si es risky.

const INVISIBLE_RE = /[\u200B-\u200F\u2060-\u2064\uFEFF\u202A-\u202E\u2066-\u2069\u00AD]/g
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const ESC_RE = /\x1b[@-_]?/g
const C0_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

const INJECTION_PATTERNS = [
  { type: 'override', re: /\b(?:ignora|ignore|olvida|forget|disregard)\b[^.\n]{0,50}\b(?:instrucciones|instructions|reglas|rules|prompt)\b/i },
  { type: 'override', re: /\b(?:nuevas instrucciones|new instructions|system prompt|prompt del sistema)\b/i },
  { type: 'override', re: /\b(?:ahora eres|you are now|act as)\b[^.\n]{0,50}\b(?:otro|different|root|admin|asistente|assistant)\b/i },
  { type: 'exfil', re: /\b(?:env[íi]a|manda|send|sube|upload|post|copia|copy)\b[^.\n]{0,60}(?:\.env\b|\.ssh\b|\bid_rsa|\bauthorized_keys|\bapi[ _-]?key|\btoken\b|\bcredencial\w*|\bcontraseñ\w+|\bpassword\b|\bsecreto\w*|\bsecrets?\b)/i },
  { type: 'exfil', re: /(?:\.env\b|\.ssh\b|\bid_rsa|\bapi[ _-]?key)[^.\n]{0,60}\b(?:env[íi]a|manda|send|sube|upload|post|curl|wget)\b/i },
  { type: 'exec', re: /\b(?:curl|wget)\b[^|\n]{0,140}\|\s*(?:ba|z)?sh\b/i },
  { type: 'exec', re: /\brm\s+-rf\s+[~/]/ }
]

function sanitizeChannelText(input) {
  const raw = input == null ? '' : String(input)
  const findings = []

  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Nunca .test() sobre regex /g (lastIndex es stateful entre llamadas):
  // se compara el resultado del replace, que con /g siempre arranca de 0.
  const sinInvisibles = text.replace(INVISIBLE_RE, '')
  if (sinInvisibles !== text) {
    findings.push({ type: 'invisible-unicode' })
    text = sinInvisibles
  }

  const sinControles = text.replace(ANSI_CSI_RE, '').replace(ESC_RE, '').replace(C0_RE, '')
  if (sinControles !== text) {
    findings.push({ type: 'terminal-control' })
    text = sinControles
  }

  for (const { type, re } of INJECTION_PATTERNS) {
    const match = text.match(re)
    if (match) findings.push({ type, detail: (match[0] || '').slice(0, 120) })
  }

  const risky = findings.some((f) => f.type === 'override' || f.type === 'exfil' || f.type === 'exec')
  return { text, findings, risky }
}

module.exports = { sanitizeChannelText }
