'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

// Los <script src> sueltos de index.html NO son módulos: comparten un único
// ámbito global. Declarar `const x` en dos de ellos es un SyntaxError que no
// rompe una función — mata el fichero ENTERO en silencio, y la app arranca con
// media UI muerta. Ya pasó dos veces:
//   - 2026-08-05 `const api` duplicado (bug_scripts_renderer_ambito_global.md)
//   - 2026-08-21 `const { computeQrRefreshDelay } = ...` en renderer.js contra
//     la función del mismo nombre de main/mirror-connection-status.js: el picker
//     salió sin proyectos recientes y sin personalidades.
// La segunda se coló porque la comprobación de entonces buscaba `const NOMBRE` y
// no miraba el destructuring. Este test mira las dos formas.

function scriptsOfIndexHtml() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1])
  return srcs.filter((src) => !src.startsWith('http') && !src.includes('node_modules'))
}

// Declaraciones a nivel superior: las que caen en el ámbito compartido. Se
// reconocen por estar en columna 0 — lo indentado vive dentro de una función.
function topLevelLexicalNames(source) {
  const names = new Set()
  for (const line of source.split('\n')) {
    if (/^\s/.test(line)) continue
    const simple = line.match(/^(?:const|let|class|function\*?)\s+([A-Za-z_$][\w$]*)/)
    if (simple) { names.add(simple[1]); continue }
    // const { a, b: c } = ... y const [a, b] = ...
    const destructured = line.match(/^(?:const|let)\s+[{[]([^}\]]*)[}\]]\s*=/)
    if (destructured) {
      for (const part of destructured[1].split(',')) {
        const name = part.includes(':') ? part.split(':')[1] : part
        const clean = name.replace(/=.*$/, '').replace(/\.\.\./, '').trim()
        if (/^[A-Za-z_$][\w$]*$/.test(clean)) names.add(clean)
      }
    }
  }
  return names
}

test('ningún <script> de index.html redeclara un nombre de otro', () => {
  const owners = new Map()
  const collisions = []
  for (const src of scriptsOfIndexHtml()) {
    const file = path.join(ROOT, src)
    if (!fs.existsSync(file)) continue
    for (const name of topLevelLexicalNames(fs.readFileSync(file, 'utf8'))) {
      if (owners.has(name)) collisions.push(`${name}: ${owners.get(name)} vs ${src}`)
      else owners.set(name, src)
    }
  }
  assert.deepEqual(collisions, [], `Redeclaración en el ámbito global compartido:\n  ${collisions.join('\n  ')}`)
})

test('el detector reconoce la forma que se coló: destructuring', () => {
  const names = topLevelLexicalNames('const { computeQrRefreshDelay, formatQrCountdown } = window.X || {}')
  assert.ok(names.has('computeQrRefreshDelay'))
  assert.ok(names.has('formatQrCountdown'))
  // y la clásica, con function del otro lado
  assert.ok(topLevelLexicalNames('function computeQrRefreshDelay() {}').has('computeQrRefreshDelay'))
  // lo indentado NO cuenta: vive dentro de una función, no en el ámbito global
  assert.equal(topLevelLexicalNames('  const computeQrRefreshDelay = 1').size, 0)
})

test('renderer.js usa el módulo del espejo cualificado, sin declararlo', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8')
  assert.match(renderer, /window\.MirrorConnectionStatus\?\./)
  assert.doesNotMatch(renderer, /^const\s*\{[^}]*computeQrRefreshDelay/m)
})
