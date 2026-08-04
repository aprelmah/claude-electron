'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { speakableFromMarkdown } = require(path.join(REPO_ROOT, 'main', 'voice-speakable.js'))

describe('voice-speakable', () => {
  test('deja la prosa tal cual', () => {
    assert.strictEqual(speakableFromMarkdown('He arreglado el bug del relay.'), 'He arreglado el bug del relay.')
  })

  test('quita los bloques de código y conserva la prosa', () => {
    const md = 'He cambiado esto:\n\n```js\nconst x = 1\nconsole.log(x)\n```\n\nY ya funciona.'
    const out = speakableFromMarkdown(md)
    assert.ok(!out.includes('const x'))
    assert.ok(out.includes('He cambiado esto'))
    assert.ok(out.includes('Y ya funciona'))
  })

  test('un bloque de código sin cerrar no se come el resto', () => {
    const out = speakableFromMarkdown('Mira:\n\n```js\nconst x = 1\n')
    assert.ok(out.includes('Mira'))
    assert.ok(!out.includes('const x'))
  })

  test('quita el código en línea pero deja su contenido legible', () => {
    assert.strictEqual(speakableFromMarkdown('Toca `main.js` y listo.'), 'Toca main.js y listo.')
  })

  test('quita tablas markdown', () => {
    const md = 'Resultado:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEso es todo.'
    const out = speakableFromMarkdown(md)
    assert.ok(!out.includes('|'))
    assert.ok(out.includes('Resultado'))
    assert.ok(out.includes('Eso es todo'))
  })

  // Actualizado en la ronda de correcciones 2 (decisión explícita del
  // revisor, ver informe): un '+'/'-' suelto sin cabecera de diff ya NO se
  // borra por patrón de signos —eso es justo la clase de bug que esa ronda
  // cierra—, se trata como viñeta y se conserva. El caso de un diff real
  // SÍ eliminado queda cubierto por el test de cabeceras más abajo.
  test('sin cabecera de diff, un + y un - sueltos son viñetas y se conservan', () => {
    const md = 'Cambio:\n+ añadido\n- quitado\nHecho.'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('añadido'))
    assert.ok(out.includes('quitado'))
    assert.ok(out.includes('Hecho'))
  })

  test('deja el texto de los enlaces, no la URL', () => {
    assert.strictEqual(speakableFromMarkdown('Mira [la doc](https://x.com/y).'), 'Mira la doc.')
  })

  test('quita las marcas de encabezado y de énfasis', () => {
    assert.strictEqual(speakableFromMarkdown('## Resumen\n\nEsto es **importante** y *claro*.'), 'Resumen. Esto es importante y claro.')
  })

  test('convierte viñetas en frases', () => {
    const out = speakableFromMarkdown('- uno\n- dos')
    assert.ok(!out.includes('-'))
    assert.ok(out.includes('uno'))
    assert.ok(out.includes('dos'))
  })

  test('devuelve vacío si solo había código', () => {
    assert.strictEqual(speakableFromMarkdown('```js\nconst x = 1\n```'), '')
  })

  test('devuelve vacío ante entrada vacía o no-string', () => {
    assert.strictEqual(speakableFromMarkdown(''), '')
    assert.strictEqual(speakableFromMarkdown(null), '')
    assert.strictEqual(speakableFromMarkdown(undefined), '')
    assert.strictEqual(speakableFromMarkdown(42), '')
  })

  test('recorta por longitud sin cortar una palabra a la mitad', () => {
    const md = 'palabra '.repeat(300)
    const out = speakableFromMarkdown(md, { maxChars: 100 })
    assert.ok(out.length <= 104, `demasiado largo: ${out.length}`)
    assert.ok(!/palab$/.test(out), 'no debe cortar una palabra por la mitad')
  })

  test('colapsa espacios y líneas en blanco de sobra', () => {
    assert.strictEqual(speakableFromMarkdown('Hola\n\n\n\nqué    tal'), 'Hola. qué tal')
  })

  // Ronda de correcciones 1: la heurística diff/viñeta no puede ser global
  // sobre todo el mensaje, o borra viñetas legítimas con + o - en cuanto
  // aparece una línea suelta del otro signo en cualquier parte del texto.
  test('no confunde viñetas sueltas de + y - en distintos bloques con un diff', () => {
    const md = 'Cosas pendientes:\n- revisar el log\n- avisar a Luismi\n\n+ nota aparte: tarea nueva en la cola.'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('revisar el log'), 'se perdió "revisar el log"')
    assert.ok(out.includes('avisar a Luismi'), 'se perdió "avisar a Luismi"')
    assert.ok(out.includes('nota aparte'), 'se perdió "nota aparte"')
  })

  test('no confunde una lista de pros y contras (+ y - agrupados) con un diff', () => {
    const md = 'Pros y contras:\n+ es más rápido\n+ es más simple\n- consume más memoria\n- no soporta undo'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('es más rápido'), 'se perdió "es más rápido"')
    assert.ok(out.includes('es más simple'), 'se perdió "es más simple"')
    assert.ok(out.includes('consume más memoria'), 'se perdió "consume más memoria"')
    assert.ok(out.includes('no soporta undo'), 'se perdió "no soporta undo"')
  })

  test('normaliza CRLF antes de procesar, sin degradar la cadencia', () => {
    const lf = speakableFromMarkdown('Linea uno\n\nLinea dos\n- item uno\n- item dos')
    const crlf = speakableFromMarkdown('Linea uno\r\n\r\nLinea dos\r\n- item uno\r\n- item dos')
    assert.strictEqual(crlf, lf)
  })

  test('maxChars no numérico o inválido cae al valor por defecto en vez de desactivar el recorte', () => {
    const md = 'palabra '.repeat(300)
    const outDefault = speakableFromMarkdown(md)
    assert.strictEqual(speakableFromMarkdown(md, { maxChars: NaN }), outDefault)
    assert.strictEqual(speakableFromMarkdown(md, { maxChars: -5 }), outDefault)
    assert.strictEqual(speakableFromMarkdown(md, { maxChars: 'muchos' }), outDefault)
    assert.strictEqual(speakableFromMarkdown(md, { maxChars: 0 }), outDefault)
  })

  // Ronda de correcciones 2: la alternancia estricta seguía siendo una
  // heurística basada solo en el patrón de signos +/-, y una comparativa o
  // un changelog alternan por diseño igual que un diff. Ahora solo cuenta
  // como diff si hay un marcador inequívoco (cabecera de fichero o de
  // hunk); sin eso, las líneas +/- son viñetas y se conservan.
  test('no confunde una comparativa (+/- alternando) con un diff', () => {
    const md = 'Comparativa:\n+ Opción A es más barata\n- Opción A tarda más\n+ Opción B es más rápida\n- Opción B es más cara'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('Opción A es más barata'), 'se perdió "Opción A es más barata"')
    assert.ok(out.includes('Opción A tarda más'), 'se perdió "Opción A tarda más"')
    assert.ok(out.includes('Opción B es más rápida'), 'se perdió "Opción B es más rápida"')
    assert.ok(out.includes('Opción B es más cara'), 'se perdió "Opción B es más cara"')
  })

  test('no confunde un changelog (+/- alternando) con un diff', () => {
    const md = 'Changelog:\n+ Añadido soporte para dark mode\n- Corregido el bug del login\n+ Añadido export a PDF\n- Corregido crash al abrir\n\nListo.'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('Añadido soporte para dark mode'), 'se perdió la primera entrada')
    assert.ok(out.includes('Corregido el bug del login'), 'se perdió la segunda entrada')
    assert.ok(out.includes('Añadido export a PDF'), 'se perdió la tercera entrada')
    assert.ok(out.includes('Corregido crash al abrir'), 'se perdió la cuarta entrada')
    assert.ok(out.includes('Listo'), 'se perdió el cierre')
  })

  test('un diff real con cabeceras sí se elimina entero, cabeceras incluidas', () => {
    const md = 'Parche:\ndiff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1,3 +1,4 @@\n-const x = 1\n+const x = 2\n+const y = 3\nListo.'
    const out = speakableFromMarkdown(md)
    assert.ok(!out.includes('diff --git'))
    assert.ok(!out.includes('a/x.js'))
    assert.ok(!out.includes('const x'))
    assert.ok(!out.includes('const y'))
    assert.ok(out.includes('Parche'))
    assert.ok(out.includes('Listo'))
  })

  // Ronda de correcciones 3: '\s' en los regex de cabecera cruza saltos de
  // línea, así que un divisor '---' suelto (sin nada real detrás) activaba
  // hasDiffHeader para TODO el mensaje y borraba viñetas de secciones sin
  // relación. '[ \t]+' no puede cruzar '\n', ancla la cabecera a su línea.
  test('un divisor "---" suelto no borra las viñetas de antes y de después', () => {
    const md = 'He hecho esto:\n- arreglado el bug\n- añadido el test\n\n---\n\nPendiente:\n- revisar en prod'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('arreglado el bug'), 'se perdió "arreglado el bug"')
    assert.ok(out.includes('añadido el test'), 'se perdió "añadido el test"')
    assert.ok(out.includes('revisar en prod'), 'se perdió "revisar en prod"')
  })

  test('un divisor "---" narrativo en la misma línea que un changelog no lo borra', () => {
    const md = 'Changelog:\n+ Añadido X\n- Corregido Y\n--- separador narrativo\n+ Añadido Z'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('Añadido X'), 'se perdió "Añadido X"')
    assert.ok(out.includes('Corregido Y'), 'se perdió "Corregido Y"')
    assert.ok(out.includes('Añadido Z'), 'se perdió "Añadido Z"')
  })

  test('una checklist con "+++"/"++"/"+" de prioridad no se borra entera', () => {
    const md = 'Nivel de prioridad:\n+++ urgente\n++ medio\n+ bajo'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('urgente'), 'se perdió "urgente"')
    assert.ok(out.includes('medio'), 'se perdió "medio"')
    assert.ok(out.includes('bajo'), 'se perdió "bajo"')
  })

  test('un divisor "---" entre dos secciones con viñetas conserva todo el contenido', () => {
    const md = 'Sección A:\n- uno\n- dos\n\n---\n\nSección B:\n- tres\n- cuatro'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('uno'), 'se perdió "uno"')
    assert.ok(out.includes('dos'), 'se perdió "dos"')
    assert.ok(out.includes('tres'), 'se perdió "tres"')
    assert.ok(out.includes('cuatro'), 'se perdió "cuatro"')
  })

  // Agujero encontrado al intentar romperlo tras el fix de esta ronda: con
  // el borrado todavía global (por marca detectada en cualquier parte del
  // mensaje), un resumen con viñetas normales perdía su contenido en
  // cuanto el mensaje traía, más abajo y sin relación, un diff real con
  // cabeceras. El borrado se acotó al bloque contiguo que contiene la
  // marca; este test fija esa acotación como contrato.
  test('viñetas normales antes de un diff real (con cabeceras) más abajo no se pierden', () => {
    const md =
      'Resumen:\n- corregido el login\n- añadido el export\n\n---\n\nParche aplicado:\ndiff --git a/auth.js b/auth.js\n--- a/auth.js\n+++ b/auth.js\n@@ -10,3 +10,4 @@\n-return null\n+return token\nListo.'
    const out = speakableFromMarkdown(md)
    assert.ok(out.includes('corregido el login'), 'se perdió "corregido el login"')
    assert.ok(out.includes('añadido el export'), 'se perdió "añadido el export"')
    assert.ok(!out.includes('diff --git'), 'el diff real no se limpió')
    assert.ok(!out.includes('return null'), 'el diff real no se limpió')
    assert.ok(!out.includes('return token'), 'el diff real no se limpió')
    assert.ok(out.includes('Listo'), 'se perdió el cierre')
  })
})
