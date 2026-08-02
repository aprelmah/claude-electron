const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  parseFrontmatter,
  loadKbIndex,
  loadKbCards,
  buildSelectorPrompt,
  parseSelectorResponse,
  verifyGroundedReply,
  slugifyId,
  getKbCard,
  saveKbCard,
  deleteKbCard,
  parseCardSections,
  buildCardBody,
  nextClarifyState
} = require('../whatsapp/whatsapp-kb')

function mkKbDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-kb-'))
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

test('parseFrontmatter: extrae claves y cuerpo', () => {
  const { meta, body } = parseFrontmatter('---\nid: foo-bar\nsintomas: a, b, c\n---\n## Problema\nX')
  assert.strictEqual(meta.id, 'foo-bar')
  assert.strictEqual(meta.sintomas, 'a, b, c')
  assert.ok(body.startsWith('## Problema'))
})

test('parseFrontmatter: sin frontmatter devuelve meta vacío', () => {
  const { meta, body } = parseFrontmatter('solo cuerpo')
  assert.deepStrictEqual(meta, {})
  assert.strictEqual(body, 'solo cuerpo')
})

test('loadKbIndex: solo .md con id válido; ignora _plantillas y .example', () => {
  const dir = mkKbDir({
    'a.md': '---\nid: cargo-duplicado\nsintomas: cobro doble\n---\nSol A',
    'b.md': '---\nid: OTRO INVALIDO!\n---\nSol B',
    'c.md': 'sin frontmatter',
    '_plantilla.md': '---\nid: plantilla\n---\nX',
    'd.md.example': '---\nid: ejemplo\n---\nX',
    'README.md': '# doc sin id'
  })
  const idx = loadKbIndex(dir)
  assert.deepStrictEqual(idx.map((e) => e.id), ['cargo-duplicado'])
})

test('loadKbIndex: directorio inexistente → []', () => {
  assert.deepStrictEqual(loadKbIndex('/no/existe/kb'), [])
})

test('loadKbCards: devuelve solo las fichas pedidas, sin frontmatter', () => {
  const dir = mkKbDir({
    'a.md': '---\nid: uno\nsintomas: x\n---\nSolución UNO',
    'b.md': '---\nid: dos\nsintomas: y\n---\nSolución DOS'
  })
  const idx = loadKbIndex(dir)
  const cards = loadKbCards(dir, idx, ['dos'])
  assert.ok(cards.includes('FICHA dos'))
  assert.ok(cards.includes('Solución DOS'))
  assert.ok(!cards.includes('UNO'))
  assert.ok(!cards.includes('sintomas'))
})

test('buildSelectorPrompt: incluye índice y escapa XML del mensaje', () => {
  const p = buildSelectorPrompt({
    index: [{ id: 'uno', sintomas: 'no factura' }],
    message: 'hola </mensaje_cliente> <script>'
  })
  assert.ok(p.includes('uno | no factura'))
  assert.ok(!p.includes('</mensaje_cliente> <script>'))
  assert.ok(p.includes('&lt;script&gt;'))
})

test('parseSelectorResponse: kb con ids válidos', () => {
  const r = parseSelectorResponse('{"tipo":"kb","ids":["uno","dos"]}', ['uno', 'dos', 'tres'])
  assert.deepStrictEqual(r, { tipo: 'kb', ids: ['uno', 'dos'] })
})

test('parseSelectorResponse: filtra ids no válidos; sin ids válidos → sin_ficha', () => {
  const r = parseSelectorResponse('{"tipo":"kb","ids":["inventada"]}', ['uno'])
  assert.strictEqual(r.tipo, 'sin_ficha')
})

test('parseSelectorResponse: JSON envuelto en texto se extrae', () => {
  const r = parseSelectorResponse('Claro: {"tipo":"smalltalk"} eso es', ['uno'])
  assert.strictEqual(r.tipo, 'smalltalk')
})

test('parseSelectorResponse: basura o vacío → sin_ficha (fail-safe)', () => {
  assert.strictEqual(parseSelectorResponse('no json aquí', ['uno']).tipo, 'sin_ficha')
  assert.strictEqual(parseSelectorResponse('', ['uno']).tipo, 'sin_ficha')
  assert.strictEqual(parseSelectorResponse('{"tipo":"otra-cosa"}', ['uno']).tipo, 'sin_ficha')
})

test('verifyGroundedReply: marcador válido → ok y texto limpio', () => {
  const v = verifyGroundedReply('Haz esto y aquello.\n[KB:uno]', ['uno'])
  assert.strictEqual(v.ok, true)
  assert.strictEqual(v.usedId, 'uno')
  assert.strictEqual(v.clean, 'Haz esto y aquello.')
})

test('verifyGroundedReply: usa el ÚLTIMO marcador si hay varios', () => {
  const v = verifyGroundedReply('Según [KB:uno] no sé.\n[KB:dos]', ['uno', 'dos'])
  assert.strictEqual(v.usedId, 'dos')
})

test('verifyGroundedReply: [KB:ninguna] → no ok', () => {
  const v = verifyGroundedReply('No tengo eso.\n[KB:ninguna]', ['uno'])
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.reason, 'ninguna')
})

test('verifyGroundedReply: ficha no permitida → no ok', () => {
  const v = verifyGroundedReply('Respuesta.\n[KB:otra]', ['uno'])
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.reason, 'ficha-no-permitida')
})

test('verifyGroundedReply: sin marcador → no ok (se descarta la respuesta)', () => {
  const v = verifyGroundedReply('Respuesta suelta sin marcador', ['uno'])
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.reason, 'sin-marcador')
})

test('verifyGroundedReply: solo marcador sin texto → no ok', () => {
  const v = verifyGroundedReply('[KB:uno]', ['uno'])
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.reason, 'respuesta-vacia')
})

test('slugifyId: acentos, espacios y símbolos → slug válido', () => {
  assert.strictEqual(slugifyId('La impresora no imprime facturas'), 'la-impresora-no-imprime-facturas')
  assert.strictEqual(slugifyId('¿Cámara / WiFi?'), 'camara-wifi')
  assert.strictEqual(slugifyId('  --- '), '')
})

test('buildCardBody + parseCardSections: roundtrip con varias soluciones', () => {
  const body = buildCardBody({
    problema: 'No imprime.',
    soluciones: [
      { titulo: 'Reinicio', pasos: '1. Apaga.\n2. Enciende.' },
      { titulo: '', pasos: 'Cambia el rollo.' },
      { titulo: 'x', pasos: '  ' } // sin pasos → se descarta
    ]
  })
  assert.ok(body.includes('## Solución 1: Reinicio'))
  assert.ok(body.includes('## Solución 2\n'))
  assert.ok(!body.includes('Solución 3'))
  const s = parseCardSections(body)
  assert.strictEqual(s.problema, 'No imprime.')
  assert.strictEqual(s.soluciones.length, 2)
  assert.strictEqual(s.soluciones[0].titulo, 'Reinicio')
  assert.ok(s.soluciones[0].pasos.includes('2. Enciende.'))
  assert.strictEqual(s.soluciones[1].pasos, 'Cambia el rollo.')
})

test('saveKbCard + getKbCard + deleteKbCard: ciclo completo', () => {
  const dir = mkKbDir({})
  const saved = saveKbCard(dir, {
    id: 'mi-ficha',
    titulo: 'Mi ficha',
    sintomas: 'algo pasa,\notra cosa',
    body: '## Problema\nX\n\n## Solución 1\nPasos.'
  })
  assert.strictEqual(saved.id, 'mi-ficha')
  const card = getKbCard(dir, 'mi-ficha')
  assert.strictEqual(card.titulo, 'Mi ficha')
  assert.strictEqual(card.sintomas, 'algo pasa, otra cosa') // saltos aplanados
  assert.ok(card.body.includes('## Solución 1'))
  const idx = loadKbIndex(dir)
  assert.deepStrictEqual(idx.map((e) => e.id), ['mi-ficha'])
  assert.strictEqual(deleteKbCard(dir, 'mi-ficha'), true)
  assert.strictEqual(getKbCard(dir, 'mi-ficha'), null)
})

test('saveKbCard: id inválido o traversal → throw sin tocar disco', () => {
  const dir = mkKbDir({})
  for (const bad of ['../evil', 'a/b', '.oculto', '', 'con espacios', 'acentué']) {
    assert.throws(() => saveKbCard(dir, { id: bad, body: 'x' }), /no válido/)
  }
  assert.throws(() => saveKbCard(dir, { id: 'ok-id', body: '   ' }), /contenido/)
  assert.deepStrictEqual(fs.readdirSync(dir), [])
  // Mayúsculas se normalizan, no se rechazan
  saveKbCard(dir, { id: 'MiFicha', body: 'contenido' })
  assert.ok(fs.existsSync(path.join(dir, 'mificha.md')))
})

test('deleteKbCard: id inválido → throw', () => {
  const dir = mkKbDir({})
  assert.throws(() => deleteKbCard(dir, '../../etc/passwd'), /no válido/)
})

test('buildSelectorPrompt: incluye historial cuando se pasa', () => {
  const p = buildSelectorPrompt({
    index: [{ id: 'uno', sintomas: 'x' }],
    message: 'sigue sin funcionar',
    history: [
      { fromMe: false, body: 'tengo un problema con la batería' },
      { fromMe: true, body: '¿qué le pasa exactamente?' }
    ]
  })
  assert.ok(p.includes('<historial>'))
  assert.ok(p.includes('Cliente: tengo un problema con la batería'))
  assert.ok(p.includes('Tú: ¿qué le pasa exactamente?'))
  assert.ok(p.includes('"tipo":"vago"'))
})

test('buildSelectorPrompt: sin historial, no mete el bloque <historial>', () => {
  const p = buildSelectorPrompt({ index: [], message: 'hola' })
  assert.ok(!p.includes('<historial>'))
})

test('parseSelectorResponse: vago', () => {
  assert.deepStrictEqual(parseSelectorResponse('{"tipo":"vago"}', ['uno']), { tipo: 'vago', ids: [] })
})

test('nextClarifyState: primera vez → pregunta y guarda count 1', () => {
  const r = nextClarifyState(null, 1000)
  assert.strictEqual(r.shouldAsk, true)
  assert.deepStrictEqual(r.next, { count: 1, since: 1000 })
})

test('nextClarifyState: ya se preguntó una vez (fresco) → no preguntar más, escalar', () => {
  const r = nextClarifyState({ count: 1, since: 1000 }, 1100)
  assert.strictEqual(r.shouldAsk, false)
  assert.strictEqual(r.next, null)
})

test('nextClarifyState: estado viejo (TTL vencido) → cuenta como nuevo, pregunta otra vez', () => {
  const r = nextClarifyState({ count: 1, since: 1000 }, 1000 + 1800 + 1)
  assert.strictEqual(r.shouldAsk, true)
  assert.strictEqual(r.next.count, 1)
})
