'use strict'

// Convierte la respuesta markdown del agente en algo que se pueda escuchar.
// Fuera código, diffs, tablas y URLs: en voz no aportan nada y arruinan el
// turno. Si tras limpiar no queda prosa, devuelve '' y quien llame decide
// (un tono corto en vez de leer basura).

const DEFAULT_MAX_CHARS = 700

function speakableFromMarkdown(md, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (typeof md !== 'string' || !md) return ''

  let out = md

  // Bloques de código: incluido el que se quedó sin cerrar (respuesta cortada).
  out = out.replace(/```[\s\S]*?```/g, ' ')
  out = out.replace(/```[\s\S]*$/g, ' ')

  // Tablas y diffs, línea a línea. Un '- algo' suelto es viñeta, no diff:
  // solo se trata como diff si aparecen líneas '+' Y '-' a la vez (diff real).
  const rawLines = out.split('\n')
  const looksLikeDiff =
    rawLines.some((l) => /^\+\s/.test(l.trim())) && rawLines.some((l) => /^-\s/.test(l.trim()))
  out = rawLines
    .filter((line) => {
      const t = line.trim()
      if (/^\|.*\|$/.test(t)) return false
      if (looksLikeDiff && /^[+-]\s/.test(t)) return false
      if (/^[|+\-\s:]+$/.test(t) && t.length > 2) return false
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

  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars)
    const lastSpace = cut.lastIndexOf(' ')
    out = (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }

  return out
}

module.exports = { speakableFromMarkdown, DEFAULT_MAX_CHARS }
