'use strict'

// Convierte la respuesta markdown del agente en algo que se pueda escuchar.
// Fuera código, diffs, tablas y URLs: en voz no aportan nada y arruinan el
// turno. Si tras limpiar no queda prosa, devuelve '' y quien llame decide
// (un tono corto en vez de leer basura).

// Tope anti-parrafada: que el agente no lea monólogos eternos con el micro
// cerrado. Era 700 y se quedaba corto — caso real 2026-08-05: una respuesta de
// 935 caracteres se cortó en "te suena metálico…" a media frase, y quien
// escucha no sabe si la app se rompió o si faltaba texto. 2000 ≈ dos minutos
// de lectura a la velocidad por defecto; para cortar antes está el botón.
const DEFAULT_MAX_CHARS = 2000

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
  // Detectar "esto es un diff" por el patrón de signos +/- —alternancia,
  // bandera global, o incluso una racha contigua que se expande hacia
  // atrás hasta la marca— siempre acaba borrando prosa real: una
  // comparativa, un changelog o un resumen con viñetas normales pegado a
  // un diff real más abajo generan el mismo patrón de caracteres que un
  // diff de verdad. La única heurística de signos que no falla así es no
  // tener ninguna.
  //
  // Por eso el bloque a borrar se delimita como lo haría un parser de diff
  // real, no por adyacencia de texto:
  //   1. Un bloque SOLO puede EMPEZAR en una marca dura inequívoca
  //      ('diff --git ', cabecera de fichero '--- ruta/con/barra' o
  //      '+++ ruta/con/barra' en su propia línea, o cabecera de hunk
  //      '@@ -a,b +c,d @@'). Nunca se extiende hacia atrás: cualquier
  //      viñeta anterior queda fuera por construcción, esté pegada o no.
  //   2. El FINAL del bloque lo dicen los contadores del propio hunk, no
  //      la adyacencia: 'b' líneas de lado viejo (contexto ' ' o borrado
  //      '-') y 'd' líneas de lado nuevo (contexto ' ' o añadido '+'). En
  //      cuanto los dos contadores llegan a cero el hunk ha terminado ahí
  //      mismo, aunque la línea siguiente también empiece por '-' o '+':
  //      una viñeta de conclusión pegada al diff no es parte del hunk si
  //      el hunk ya dijo que había acabado. Si hay más de un hunk ('@@'
  //      tras '@@'), se repite el cálculo para cada uno.
  //   3. Camino degradado: si la cabecera de hunk no trae contadores
  //      parseables (o hay cabeceras de fichero sin ningún '@@' detrás),
  //      no hay con qué medir el bloque — se avanza mientras las líneas
  //      sigan siendo candidatas (empiezan por +/- o son ellas mismas una
  //      marca dura) hasta la primera que no lo sea, como en la ronda
  //      anterior.
  // Entre 'diff --git' y '---'/'+++' (o incluso sin ellas, en un rename o
  // un cambio de permisos puro) 'git diff' mete líneas de metadatos que
  // salen en prácticamente cualquier diff real: 'index <hash>..<hash>
  // [modo]', 'similarity index NN%', 'rename from/to <ruta>',
  // '(deleted|new) file mode <modo>', 'old/new mode <modo>'. Si no se
  // reconocen, rompen la contigüidad de cabeceras: el resto del diff se
  // limpia igual (empieza en marca dura, termina por contadores), pero
  // estas líneas sueltas quedan fuera y se leen en voz alta tal cual. Cada
  // patrón va anclado al formato exacto de git (no a la palabra suelta:
  // 'index' o 'mode' aparecen en prosa normal constantemente) para no
  // tragarse texto que no tiene nada que ver con un diff.
  const isDiffGitLine = (line) => /^diff --git /.test(line.trim())
  const isFileHeaderLine = (line) => {
    const t = line.trim()
    return /^---[ \t]+\S*\/\S*(?:[ \t]|$)/.test(t) || /^\+\+\+[ \t]+\S*\/\S*(?:[ \t]|$)/.test(t)
  }
  const isGitExtendedHeaderLine = (line) => {
    const t = line.trim()
    return (
      /^index [0-9a-f]+\.\.[0-9a-f]+(?:[ \t]+\d+)?$/.test(t) ||
      /^similarity index \d+%$/.test(t) ||
      /^rename (?:from|to) .+/.test(t) ||
      /^deleted file mode \d+$/.test(t) ||
      /^new file mode \d+$/.test(t) ||
      /^old mode \d+$/.test(t) ||
      /^new mode \d+$/.test(t)
    )
  }
  // '\ No newline at end of file': no es de lado viejo ni de lado nuevo,
  // es una nota sobre la línea de contenido que la precede (puede salir
  // dos veces en el mismo hunk, una tras un '-' y otra tras un '+', si a
  // ambos lados les falta el salto final). No cuenta para los contadores.
  const isNoNewlineMarker = (line) => /^\\ No newline at end of file$/.test(line.trim())
  const isHunkMarkerLine = (line) => /^@@[^\n]*@@/.test(line.trim())
  const isDiffHardSignalLine = (line) => isDiffGitLine(line) || isFileHeaderLine(line) || isHunkMarkerLine(line)
  const isDiffCandidateLine = (line) => /^[+-]/.test(line.trim()) || isDiffHardSignalLine(line)

  // 'b' y 'd' son opcionales en '@@ -a,b +c,d @@' (1 si faltan: hunk de una
  // sola línea). Si la línea no matchea el formato canónico, no hay
  // contadores fiables y toca el camino degradado del punto 3.
  const parseHunkCounts = (line) => {
    const m = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line.trim())
    if (!m) return null
    return {
      oldCount: m[1] !== undefined ? parseInt(m[1], 10) : 1,
      newCount: m[2] !== undefined ? parseInt(m[2], 10) : 1,
    }
  }

  const rawLines = out.split('\n')
  const diffLineIndexes = new Set()
  let i = 0
  while (i < rawLines.length) {
    if (!isDiffHardSignalLine(rawLines[i])) {
      i++
      continue
    }
    const blockStart = i
    let j = i
    // 'diff --git' / '---' / '+++' / metadatos extendidos: cabeceras de
    // fichero, se tragan tal cual, en cualquier orden en que aparezcan.
    while (
      j < rawLines.length &&
      (isDiffGitLine(rawLines[j]) || isFileHeaderLine(rawLines[j]) || isGitExtendedHeaderLine(rawLines[j]))
    )
      j++
    // Cero o más hunks, cada uno medido por sus propios contadores.
    let sawValidHunk = false
    while (j < rawLines.length && isHunkMarkerLine(rawLines[j])) {
      const counts = parseHunkCounts(rawLines[j])
      if (!counts) break
      sawValidHunk = true
      j++
      let oldRemaining = counts.oldCount
      let newRemaining = counts.newCount
      while (j < rawLines.length && (oldRemaining > 0 || newRemaining > 0)) {
        // Una línea de contexto que perdió su espacio inicial (recorte de
        // trailing whitespace, algo habitual al copiar) también cuenta
        // para los dos lados.
        const first = rawLines[j].length === 0 ? ' ' : rawLines[j][0]
        if (first === ' ') {
          oldRemaining--
          newRemaining--
        } else if (first === '-') {
          oldRemaining--
        } else if (first === '+') {
          newRemaining--
        } else {
          break
        }
        j++
        // El aviso de "sin salto de línea final" cuelga de la línea que
        // acabamos de consumir, no cuenta como una línea más del hunk.
        if (j < rawLines.length && isNoNewlineMarker(rawLines[j])) j++
      }
    }
    if (!sawValidHunk) {
      while (j < rawLines.length && isDiffCandidateLine(rawLines[j])) j++
    }
    if (j === blockStart) j = blockStart + 1 // salvaguarda: el bloque siempre avanza
    for (let k = blockStart; k < j; k++) diffLineIndexes.add(k)
    i = j
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
    // Cortar en FIN DE FRASE si hay uno pasada la mitad del tope: oído, un
    // corte a media idea suena a fallo ("…te suena metálico…" y silencio);
    // una frase completa suena a final. El espacio queda de red de seguridad
    // para prosa sin puntos.
    const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    if (lastSentence > safeMaxChars * 0.5) {
      out = cut.slice(0, lastSentence + 1).trim()
    } else {
      const lastSpace = cut.lastIndexOf(' ')
      out = (lastSpace > safeMaxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…'
    }
  }

  return out
}

module.exports = { speakableFromMarkdown, DEFAULT_MAX_CHARS }
