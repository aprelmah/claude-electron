const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  extractFirstJsonObject,
  parseSelectorResponse,
  parseCardSections,
  buildCardBody,
  getKbCard,
  saveKbCard,
  deleteKbCard,
  loadKbIndex
} = require('../whatsapp/whatsapp-kb')

function mkKbDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-kb-rob-'))
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content)
  return dir
}

// ── Selector: JSON con objetos anidados ──────────────────────────────────────
// El `/\{[\s\S]*?\}/` perezoso cortaba en la primera llave de cierre. Bastaba
// con que haiku añadiera un campo anidado para que el JSON quedara a medias,
// JSON.parse lanzara y una consulta con ficha buena acabara escalada al humano.

test('extractFirstJsonObject: objeto plano', () => {
  assert.strictEqual(extractFirstJsonObject('{"tipo":"kb"}'), '{"tipo":"kb"}')
})

test('extractFirstJsonObject: respeta objetos anidados', () => {
  const src = '{"tipo":"kb","ids":["bat"],"meta":{"conf":1}}'
  assert.strictEqual(extractFirstJsonObject(src), src)
})

test('extractFirstJsonObject: ignora llaves dentro de cadenas', () => {
  const src = '{"tipo":"kb","nota":"esto } no cierra","ids":["bat"]}'
  assert.strictEqual(extractFirstJsonObject(src), src)
})

test('extractFirstJsonObject: ignora llaves escapadas dentro de cadenas', () => {
  const src = '{"nota":"comilla \\" y llave }","tipo":"smalltalk"}'
  assert.strictEqual(extractFirstJsonObject(src), src)
})

test('extractFirstJsonObject: descarta prosa alrededor', () => {
  assert.strictEqual(extractFirstJsonObject('Claro, aquí tienes:\n{"tipo":"vago"}\nEso es todo.'), '{"tipo":"vago"}')
})

test('extractFirstJsonObject: sin objeto o sin cerrar → null', () => {
  assert.strictEqual(extractFirstJsonObject('no hay json'), null)
  assert.strictEqual(extractFirstJsonObject('{"tipo":"kb"'), null)
  assert.strictEqual(extractFirstJsonObject(''), null)
})

test('parseSelectorResponse: un campo anidado ya no tira la selección al fallback', () => {
  const sel = parseSelectorResponse('{"tipo":"kb","ids":["bateria"],"meta":{"conf":0.9}}', ['bateria'])
  assert.deepStrictEqual(sel, { tipo: 'kb', ids: ['bateria'] })
})

test('parseSelectorResponse: basura sigue cayendo en sin_ficha', () => {
  assert.deepStrictEqual(parseSelectorResponse('lo siento, no sé', ['x']), { tipo: 'sin_ficha', ids: [] })
})

// ── Editor: secciones que no modela ──────────────────────────────────────────
// kb/ está documentada como markdown a mano. Abrir una ficha con secciones
// propias y darle a Guardar las borraba del disco sin avisar.

test('parseCardSections: devuelve como extra lo que el editor no modela', () => {
  const body = [
    '## Problema',
    'No carga',
    '',
    '## Solución 1',
    'Reinicia',
    '',
    '## Notas internas',
    'NO BORRAR: aviso legal'
  ].join('\n')
  const s = parseCardSections(body)
  assert.strictEqual(s.problema, 'No carga')
  assert.strictEqual(s.soluciones.length, 1)
  assert.match(s.extra, /## Notas internas/)
  assert.match(s.extra, /NO BORRAR/)
})

test('parseCardSections: el preámbulo sin cabecera también se conserva', () => {
  const s = parseCardSections('Ficha revisada por Luismi.\n\n## Problema\nX')
  assert.match(s.extra, /Ficha revisada por Luismi/)
})

test('roundtrip del editor: la sección desconocida sobrevive', () => {
  const body = '## Problema\nX\n\n## Solución 1\npasos\n\n## Notas internas\nNO BORRAR'
  const s = parseCardSections(body)
  const rebuilt = buildCardBody({ problema: s.problema, soluciones: s.soluciones, extra: s.extra })
  assert.match(rebuilt, /## Notas internas\nNO BORRAR/)
  assert.match(rebuilt, /## Problema\nX/)
  assert.match(rebuilt, /## Solución 1\npasos/)
})

test('buildCardBody sin extra se comporta como antes', () => {
  assert.strictEqual(
    buildCardBody({ problema: 'X', soluciones: [{ titulo: '', pasos: 'p' }] }),
    '## Problema\nX\n\n## Solución 1\np'
  )
})

// ── Fichas cuyo nombre de fichero no es el id ────────────────────────────────

const CARD_RAW = '---\nid: bateria-turbo\ntitulo: Batería Turbo\nsintomas: no carga\n---\n## Problema\noriginal\n'

test('getKbCard encuentra la ficha aunque el fichero se llame distinto', () => {
  const dir = mkKbDir({ 'bateria_turbo_v2.md': CARD_RAW })
  const card = getKbCard(dir, 'bateria-turbo')
  assert.ok(card, 'debería encontrarla por el id del frontmatter')
  assert.match(card.body, /original/)
})

test('deleteKbCard borra el fichero real, no <id>.md', () => {
  const dir = mkKbDir({ 'bateria_turbo_v2.md': CARD_RAW })
  deleteKbCard(dir, 'bateria-turbo')
  assert.deepStrictEqual(fs.readdirSync(dir), [])
})

test('editar no duplica el id en un segundo fichero', () => {
  const dir = mkKbDir({ 'bateria_turbo_v2.md': CARD_RAW })
  saveKbCard(dir, { id: 'bateria-turbo', titulo: 'Batería Turbo', sintomas: 'no carga', body: '## Problema\neditado' })
  assert.deepStrictEqual(fs.readdirSync(dir), ['bateria_turbo_v2.md'], 'debe reescribir el fichero existente')
  assert.strictEqual(loadKbIndex(dir).filter((e) => e.id === 'bateria-turbo').length, 1)
  assert.match(getKbCard(dir, 'bateria-turbo').body, /editado/)
})

test('un alta colisiona también contra una ficha con nombre de fichero distinto', () => {
  const dir = mkKbDir({ 'bateria_turbo_v2.md': CARD_RAW })
  assert.throws(
    () => saveKbCard(dir, { id: 'bateria-turbo', titulo: 'x', body: 'nuevo' }, { overwrite: false }),
    /Ya existe una ficha/
  )
})

test('resolveKbFile no relaja la validación del id', () => {
  const dir = mkKbDir({})
  for (const bad of ['../evil', 'a/b', '.oculto', '']) {
    assert.throws(() => getKbCard(dir, bad), /no válido/)
    assert.throws(() => deleteKbCard(dir, bad), /no válido/)
  }
})
