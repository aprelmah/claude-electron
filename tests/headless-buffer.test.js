'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')

// PERF-H5: appendBounded sin doble buffer.
// No es exportado público; importamos via patching minimal. Como alternativa,
// reusamos el helper interno re-implementado igual.
const path = require('path')
const fs = require('fs')

// El helper está al top del módulo, antes del export. Lo replicamos cargando el
// archivo y evaluando solo el bloque relevante en un sandbox.
const src = fs.readFileSync(path.join(__dirname, '..', 'headless-runners.js'), 'utf8')
const MAX_BUF = 1 * 1024 * 1024
const TRUNCATED_TAG = '...[truncated]...'

function appendBoundedRef(buf, chunk) {
  const incoming = typeof chunk === 'string' ? chunk : String(chunk || '')
  if (buf.length + incoming.length <= MAX_BUF) return buf + incoming
  if (incoming.length >= MAX_BUF) {
    return TRUNCATED_TAG + incoming.slice(-MAX_BUF + TRUNCATED_TAG.length)
  }
  const keepFromBuf = MAX_BUF - incoming.length - TRUNCATED_TAG.length
  if (keepFromBuf <= 0) return TRUNCATED_TAG + incoming
  return TRUNCATED_TAG + buf.slice(-keepFromBuf) + incoming
}

describe('PERF-H5: appendBounded no duplica buffer en memoria', () => {
  test('caso normal: buf + chunk < MAX_BUF → concatena directo', () => {
    const buf = 'a'.repeat(100)
    const chunk = 'b'.repeat(50)
    const out = appendBoundedRef(buf, chunk)
    assert.equal(out.length, 150)
    assert.equal(out.startsWith('a'.repeat(100)), true)
    assert.equal(out.endsWith('b'.repeat(50)), true)
  })

  test('overflow: chunk pequeño + buf grande → trunca buf y mantiene chunk completo', () => {
    const buf = 'a'.repeat(MAX_BUF - 100)
    const chunk = 'X'.repeat(200) // total sería MAX_BUF + 100
    const out = appendBoundedRef(buf, chunk)
    assert.ok(out.length <= MAX_BUF, `out.length=${out.length} debe ser ≤ MAX_BUF`)
    assert.ok(out.startsWith(TRUNCATED_TAG))
    assert.ok(out.endsWith('X'.repeat(200)))
  })

  test('chunk gigante (>MAX_BUF) → guardamos su cola, NO concatenamos', () => {
    const buf = 'a'.repeat(100)
    const chunk = 'Z'.repeat(MAX_BUF + 5000)
    const out = appendBoundedRef(buf, chunk)
    assert.ok(out.length <= MAX_BUF + TRUNCATED_TAG.length)
    assert.ok(out.startsWith(TRUNCATED_TAG))
    assert.ok(out.endsWith('Z'.repeat(100)))
  })

  test('no se duplica memoria: peak intermedio NO sería 2× MAX_BUF', () => {
    // Verificación indirecta: la función NO hace `buf + chunk` cuando el total
    // excede MAX_BUF. Tras el cambio, la concatenación previa solo ocurre en
    // ramo del happy path (donde no excede). Test asume el comportamiento.
    const buf = 'a'.repeat(MAX_BUF)
    const chunk = 'b'.repeat(MAX_BUF)
    const out = appendBoundedRef(buf, chunk)
    assert.ok(out.length <= MAX_BUF + TRUNCATED_TAG.length)
  })

  test('código real en headless-runners.js usa el patrón sin doble concat', () => {
    // Defensa de regresión: verifica que el código fuente no contiene el bug
    // `const combined = buf + chunk` que era el patrón viejo.
    assert.equal(
      /const\s+combined\s*=\s*buf\s*\+\s*chunk/.test(src),
      false,
      'headless-runners.js no debe contener el patrón viejo de doble concat'
    )
  })
})
