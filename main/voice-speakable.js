'use strict'

// Convierte la respuesta markdown del agente en algo que se pueda escuchar.
// Fuera código, diffs, tablas y URLs: en voz no aportan nada y arruinan el
// turno. Si tras limpiar no queda prosa, devuelve '' y quien llame decide
// (un tono corto en vez de leer basura).

const DEFAULT_MAX_CHARS = 700

function speakableFromMarkdown(md, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (typeof md !== 'string' || !md) return ''

  // maxChars puede venir de config/estado (Tarea 6): si no es un número
  // finito y positivo, no se desactiva el recorte en silencio, se usa el
  // valor por defecto.
  const safeMaxChars = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS

  let out = md

  // CRLF antes que nada: los regex de línea (^, $, split por \n) asumen LF,
  // y un \r suelto delante del \n rompe la cadencia de puntos y pausas.
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Bloques de código: incluido el que se quedó sin cerrar (respuesta cortada).
  out = out.replace(/```[\s\S]*?```/g, ' ')
  out = out.replace(/```[\s\S]*$/g, ' ')

  // Tablas y diffs, línea a línea.
  //
  // Cualquier heurística que infiera "esto es un diff" a partir del patrón
  // de signos +/- (aunque sea "alterna estrictamente") choca tarde o
  // temprano con prosa humana real: una comparativa ("+ más barata / -
  // tarda más") o un changelog ("+ añadido X / - corregido Y") alternan
  // signo a signo exactamente igual que un diff, y no hay forma de
  // distinguirlos mirando solo el patrón — la única heurística de signos
  // que no falla así es no tener ninguna.
  //
  // Por eso el criterio no mira el patrón: solo se trata como diff si el
  // TEXTO trae un marcador inequívoco de diff real —una cabecera
  // 'diff --git', una cabecera de fichero '--- a/x' / '+++ b/x', o una
  // cabecera de hunk '@@ ... @@'—. Sin ninguno de esos marcadores, toda
  // línea que empiece por + o - es una viñeta: se conserva y más abajo se
  // le quita el signo igual que a '*'. Si un diff sin cabeceras se cuela
  // sin detectarse, el usuario oye ruido de más (molesto, recuperable);
  // perder prosa real en silencio no lo es. Ese es el lado seguro del
  // error, y es el mismo criterio con el que ya se limpian bloques de
  // código: nunca se adivina, se exige una marca clara.
  const hasDiffHeader =
    /^diff --git /m.test(out) ||
    /^---\s+\S/m.test(out) ||
    /^\+\+\+\s+\S/m.test(out) ||
    /^@@[^\n]*@@/m.test(out)
  out = out
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (/^\|.*\|$/.test(t)) return false
      if (/^[|+\-\s:]+$/.test(t) && t.length > 2) return false
      if (hasDiffHeader && (/^diff --git /.test(t) || /^@@/.test(t) || /^[+-]/.test(t))) return false
      return true
    })
    .join('\n')

  // Enlaces: se queda el texto, se va la URL.
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // Código en línea: se queda el contenido, sin las comillas.
  out = out.replace(/`([^`]*)`/g, '$1')
  // Encabezados, citas y viñetas (*, + o -).
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  out = out.replace(/^\s{0,3}>\s?/gm, '')
  out = out.replace(/^\s*[*+-]\s+/gm, '')
  out = out.replace(/^\s*\d+\.\s+/gm, '')
  // Énfasis.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  out = out.replace(/\*([^*]+)\*/g, '$1')
  out = out.replace(/__([^_]+)__/g, '$1')

  // Los saltos de línea se vuelven pausas; el sintetizador respeta el punto.
  out = out.replace(/\n{2,}/g, '. ')
  out = out.replace(/\n/g, '. ')
  out = out.replace(/\s+/g, ' ')
  out = out.replace(/\.\s*\./g, '.')
  out = out.trim()
  out = out.replace(/^[.\s]+/, '').trim()

  if (!out) return ''

  if (out.length > safeMaxChars) {
    const cut = out.slice(0, safeMaxChars)
    const lastSpace = cut.lastIndexOf(' ')
    out = (lastSpace > safeMaxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }

  return out
}

module.exports = { speakableFromMarkdown, DEFAULT_MAX_CHARS }
