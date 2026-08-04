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
  //
  // OJO con \s en estos regex de detección: \s incluye \n, así que
  // '---\s+\S' no exige que la ruta esté en la MISMA línea que los guiones
  // — '\s+' se traga saltos de línea y párrafos enteros hasta enganchar
  // con cualquier carácter no blanco muchas líneas más abajo (un divisor
  // '---' suelto, tan común entre secciones de una respuesta, activaba así
  // 'hasDiffHeader' para todo el mensaje). Por eso aquí va '[ \t]+', que
  // solo casa espacios y tabs: no puede cruzar un '\n', así que la cabecera
  // queda anclada a su propia línea.
  //
  // Tampoco basta con "hay una palabra detrás en la misma línea": un
  // divisor narrativo ('--- separador narrativo') o una viñeta de
  // prioridad ('+++ urgente') también tienen una palabra detrás y no son
  // cabeceras de diff. Lo que distingue a una cabecera real es que trae
  // una RUTA, no una palabra cualquiera: '--- a/main.js', '+++ b/main.js',
  // '--- /dev/null'. Por eso se exige que el token pegado a los guiones/
  // signos contenga una '/' (todas las rutas de un diff la llevan, sea
  // relativa 'a/x' o absoluta '/dev/null'); un divisor o una viñeta sin
  // barra no matchea, tenga o no palabras detrás.
  //
  // Y el borrado no puede ser global sobre TODO el mensaje en cuanto se
  // encuentra una marca en cualquier parte: un resumen con viñetas
  // normales, seguido más abajo (tras un divisor u otra sección) de un
  // diff real con sus cabeceras, perdía esas viñetas sin relación con el
  // diff. Por eso el borrado se acota al bloque contiguo de líneas +/- (sin
  // línea en blanco ni prosa de por medio) que contiene la marca: un
  // bloque de +/- que no toca ninguna marca se conserva como viñetas,
  // aunque el mensaje tenga un diff real en otra parte.
  const isDiffHardSignalLine = (line) => {
    const t = line.trim()
    return (
      /^diff --git /.test(t) ||
      /^---[ \t]+\S*\/\S*(?:[ \t]|$)/.test(t) ||
      /^\+\+\+[ \t]+\S*\/\S*(?:[ \t]|$)/.test(t) ||
      /^@@[^\n]*@@/.test(t)
    )
  }
  const isDiffCandidateLine = (line) => /^[+-]/.test(line.trim()) || isDiffHardSignalLine(line)

  const rawLines = out.split('\n')
  const diffLineIndexes = new Set()
  let runStart = -1
  for (let i = 0; i <= rawLines.length; i++) {
    const isCandidate = i < rawLines.length && isDiffCandidateLine(rawLines[i])
    if (isCandidate && runStart === -1) {
      runStart = i
      continue
    }
    if (!isCandidate && runStart !== -1) {
      const run = rawLines.slice(runStart, i)
      if (run.some(isDiffHardSignalLine)) {
        for (let j = runStart; j < i; j++) diffLineIndexes.add(j)
      }
      runStart = -1
    }
  }

  out = rawLines
    .filter((line, idx) => {
      const t = line.trim()
      if (/^\|.*\|$/.test(t)) return false
      if (/^[|+\-\s:]+$/.test(t) && t.length > 2) return false
      if (diffLineIndexes.has(idx)) return false
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
