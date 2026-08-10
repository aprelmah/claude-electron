'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createProjectKbChat,
  tokenize,
  splitMarkdownIntoChunks,
  selectEvidence,
  normalizeAnswer,
  buildAskPrompt
} = require('../main/kb-chat')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeFicha(root, relPath, text) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}

test('tokenize normaliza tildes y quita palabras vacías', () => {
  assert.deepEqual(tokenize('¿Cómo configuro la batería de 10 kWh?'), ['configuro', 'bateria', '10', 'kwh'])
})

test('splitMarkdownIntoChunks conserva título y referencias de página', () => {
  const chunks = splitMarkdownIntoChunks(
    '# Puesta en marcha\n\n## Parámetros\n\n===== [pag 7] =====\nTensión máxima: 500 V.\n\n## Advertencias\n\nNo conectar sin tierra.',
    { relPath: 'kb/fichas/manual.md', maxChars: 80 }
  )
  assert.ok(chunks.length >= 2)
  assert.equal(chunks[0].title, 'Puesta en marcha')
  assert.ok(chunks.some((chunk) => chunk.location === 'pág. 7'))
})

test('selectEvidence prioriza coincidencia completa y códigos técnicos', () => {
  const chunks = [
    { title: 'General', relPath: 'general.md', text: 'Información general del equipo.', tokens: tokenize('Información general del equipo.') },
    { title: 'Error F58', relPath: 'f58.md', text: 'El código F58 indica pérdida de comunicación CAN.', tokens: tokenize('El código F58 indica pérdida de comunicación CAN.') }
  ]
  const result = selectEvidence(chunks, '¿Qué significa el error F58?')
  assert.equal(result[0].relPath, 'f58.md')
})

test('normalizeAnswer solo acepta citas de la evidencia', () => {
  const evidence = [{ title: 'Manual', relPath: 'kb/fichas/manual.md', text: 'Dato exacto.', location: 'pág. 4' }]
  const ok = normalizeAnswer('{"answer":"El dato es exacto [KB1].","citationIds":["KB1"],"confidence":"alta"}', evidence)
  assert.equal(ok.grounded, true)
  assert.equal(ok.answer, 'El dato es exacto.')
  assert.equal(ok.citations[0].location, 'pág. 4')

  const forged = normalizeAnswer('{"answer":"Respuesta inventada [KB99].","citationIds":["KB99"],"confidence":"alta"}', evidence)
  assert.equal(forged.grounded, false)
  assert.deepEqual(forged.citations, [])
})

test('normalizeAnswer acepta una propuesta de edición sobre una ficha de la evidencia', () => {
  const evidence = [{ title: 'Manual', relPath: 'kb/fichas/manual.md', text: 'Voltaje: 220 V.', location: '' }]
  const raw = '{"answer":"Corregido.","citationIds":["KB1"],"confidence":"alta","edit":{"relPath":"kb/fichas/manual.md","find":"Voltaje: 220 V.","replace":"Voltaje: 230 V.","reason":"dato mal transcrito"}}'
  const result = normalizeAnswer(raw, evidence)
  assert.deepEqual(result.edit, {
    relPath: 'kb/fichas/manual.md',
    find: 'Voltaje: 220 V.',
    replace: 'Voltaje: 230 V.',
    reason: 'dato mal transcrito'
  })
})

test('normalizeAnswer rechaza una edición fuera de la evidencia', () => {
  const evidence = [{ title: 'Manual', relPath: 'kb/fichas/manual.md', text: 'Voltaje: 220 V.', location: '' }]
  const raw = '{"answer":"—","citationIds":[],"confidence":"baja","edit":{"relPath":"kb/fichas/otra.md","find":"x","replace":"y"}}'
  const result = normalizeAnswer(raw, evidence)
  assert.equal(result.edit, null)
})

test('normalizeAnswer ignora un edit sin find', () => {
  const evidence = [{ title: 'Manual', relPath: 'kb/fichas/manual.md', text: 'Voltaje: 220 V.', location: '' }]
  const raw = '{"answer":"—","citationIds":[],"confidence":"baja","edit":{"relPath":"kb/fichas/manual.md","find":"","replace":"y"}}'
  const result = normalizeAnswer(raw, evidence)
  assert.equal(result.edit, null)
})

test('buildAskPrompt instruye sobre cuándo proponer una edición', () => {
  const prompt = buildAskPrompt({ projectName: 'X', question: 'corrige el voltaje', evidence: [], history: [] })
  assert.ok(prompt.includes('"edit"'))
})

test('el chat carga solo las fichas activas y queda aislado por proyecto', async () => {
  const projectA = tmpDir('kb-chat-a-')
  const projectB = tmpDir('kb-chat-b-')
  const userData = tmpDir('kb-chat-userdata-')
  const claudeMd = (active) => `# Proyecto\n\n## Conocimiento precargado\n@${active}\n\`@kb/fichas/privada.md\`\n`
  fs.writeFileSync(path.join(projectA, 'CLAUDE.md'), claudeMd('kb/fichas/a.md'))
  fs.writeFileSync(path.join(projectB, 'CLAUDE.md'), claudeMd('kb/fichas/b.md'))
  writeFicha(projectA, 'kb/fichas/a.md', '# Proyecto A\n\n[KB-A] Batería del proyecto A: 10 kWh.')
  writeFicha(projectA, 'kb/fichas/privada.md', '# Privada\n\nNunca debe entrar en la consulta.')
  writeFicha(projectB, 'kb/fichas/b.md', '# Proyecto B\n\n[KB-B] Este dato solo pertenece al proyecto B.')

  const prompts = []
  const chat = createProjectKbChat({
    userDataDir: userData,
    getModel: () => 'test-model',
    runClaudeHeadless: async ({ prompt }) => {
      prompts.push(prompt)
      return { text: '{"answer":"La batería es de 10 kWh [KB1].","citationIds":["KB1"],"confidence":"alta"}' }
    }
  })

  const a = await chat.ask({ projectDir: projectA, question: '¿Cuánta capacidad tiene la batería?' })
  assert.equal(a.grounded, true)
  assert.equal(a.citations[0].relPath, 'kb/fichas/a.md')
  assert.ok(prompts[0].includes('Proyecto A'))
  assert.ok(!prompts[0].includes('Privada'))
  assert.ok(!prompts[0].includes('Proyecto B'))

  const b = await chat.ask({ projectDir: projectB, question: '¿Qué dato hay?' })
  assert.equal(b.citations[0].relPath, 'kb/fichas/b.md')
  assert.equal((await chat.history(projectA)).length, 2)
  assert.equal((await chat.history(projectB)).length, 2)
})

test('pregunta sin coincidencias no llama al modelo', async () => {
  const project = tmpDir('kb-chat-empty-')
  const userData = tmpDir('kb-chat-empty-userdata-')
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# Proyecto\n\n@kb/fichas/a.md\n')
  writeFicha(project, 'kb/fichas/a.md', '# Ficha\n\nParámetro de red: 230 V.')
  let calls = 0
  const chat = createProjectKbChat({
    userDataDir: userData,
    getModel: () => 'test',
    runClaudeHeadless: async () => { calls++; return { text: '{}' } }
  })
  const result = await chat.ask({ projectDir: project, question: '¿Qué dice sobre impresoras?' })
  assert.equal(result.grounded, false)
  assert.equal(calls, 0)
})

test('selectEvidence ya no vuelca fichas al azar en preguntas de orientación sin coincidencia léxica', () => {
  const chunks = [
    { title: 'Parámetros de red', relPath: 'a.md', text: 'Tensión nominal 230 V, frecuencia 50 Hz.', tokens: tokenize('Tensión nominal 230 V, frecuencia 50 Hz.') }
  ]
  // antes de este fix, la palabra "resumen" disparaba el volcado de las primeras fichas
  const result = selectEvidence(chunks, 'Dame un resumen')
  assert.deepEqual(result, [])
})

test('selectEvidence no corta coincidencias reales por debajo de 8 candidatos', () => {
  const chunks = Array.from({ length: 15 }, (_, i) => {
    const text = `Especificación de la batería modelo ${i}: capacidad y voltaje nominal.`
    return { title: `Batería ${i}`, relPath: `bateria-${i}.md`, text, tokens: tokenize(text) }
  })
  const result = selectEvidence(chunks, '¿Qué batería tiene más capacidad y voltaje?')
  assert.ok(result.length > 8, `esperaba más de 8 candidatos, hubo ${result.length}`)
})
