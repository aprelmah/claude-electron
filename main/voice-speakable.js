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
  // La detección de diff NO puede ser una bandera global sobre todo el
  // mensaje: un simple "hay una línea '+' y una línea '-' en algún sitio
  // del texto" borra viñetas legítimas con + o - en cuanto el mensaje trae
  // las dos en cualquier parte, aunque estén en bloques sin relación
  // ("Cosas pendientes" con viñetas '-' y aparte una nota con '+').
  //
  // Tampoco basta con "bloque contiguo de líneas +/-": una lista de pros y
  // contras agrupa varias '+' seguidas y luego varias '-' seguidas, y es
  // tan contigua como un diff real.
  //
  // La señal que sí distingue un diff real (hunk tipo "- antes" / "+
  // después") de una lista con viñetas + o -: dentro de un bloque contiguo
  // de líneas +/-, un diff alterna signo línea a línea (nunca dos '+'
  // seguidas ni dos '-' seguidas), mientras que una lista agrupa varias
  // líneas del mismo signo seguidas. Solo se borra el bloque cuando tiene
  // AMBOS signos y alterna estrictamente; ante cualquier duda se conserva
  // el contenido (perderlo en silencio es peor que dejar pasar alguna
  // viñeta rara con + o -).
  const rawLines = out.split('\n')
  const isDiffMarkerLine = (line) => /^[+-]\s/.test(line.trim())
  const diffLineIndexes = new Set()
  let runStart = -1
  for (let i = 0; i <= rawLines.length; i++) {
    const isMarker = i < rawLines.length && isDiffMarkerLine(rawLines[i])
    if (isMarker && runStart === -1) {
      runStart = i
      continue
    }
    if (!isMarker && runStart !== -1) {
      const run = rawLines.slice(runStart, i)
      const signs = run.map((line) => line.trim()[0])
      const hasBothSigns = signs.includes('+') && signs.includes('-')
      const alternates = signs.every((sign, idx) => idx === 0 || sign !== signs[idx - 1])
      if (hasBothSigns && alternates) {
        for (let j = runStart; j < i; j++) diffLineIndexes.add(j)
      }
      runStart = -1
    }
  }
  out = rawLines
    .filter((line, idx) => {
      const t = line.trim()
      if (/^\|.*\|$/.test(t)) return false
      if (diffLineIndexes.has(idx)) return false
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

  if (out.length > safeMaxChars) {
    const cut = out.slice(0, safeMaxChars)
    const lastSpace = cut.lastIndexOf(' ')
    out = (lastSpace > safeMaxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }

  return out
}

module.exports = { speakableFromMarkdown, DEFAULT_MAX_CHARS }
