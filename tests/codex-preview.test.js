'use strict'

// El título de las sesiones de codex en el picker salía siempre igual
// ("# AGENTS.md instructions for /Users/...") porque el primer mensaje con
// role:user del rollout no es del usuario: es el preámbulo que inyecta codex.
// Con tres sesiones del mismo día era imposible distinguirlas (reportado en vivo
// 2026-08-07). Y el prompt real puede estar más allá de los 64 KB que se leían:
// en un rollout real de este Mac estaba en el byte 85.882.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  extractCodexSessionFirstPrompt,
  isInjectedCodexPreamble,
  stripAppSystemHint
} = require('../main/claude-session-listing')

// `codex exec` no tiene --append-system-prompt, así que la pista de archivos del
// bridge de Telegram viaja pegada delante del prompt del usuario, en el mismo
// mensaje. El título tiene que quedarse con lo de detrás, no con la pista.
test('stripAppSystemHint: quita el bloque [Sistema: …] y deja el prompt', () => {
  const hint = '[Sistema: si el usuario pide un archivo, búscalo con `find ~ -name "*x*"` … [ARCHIVO:/ruta] — solo si existe.]'
  assert.equal(stripAppSystemHint(`${hint}\n\nLanza la limpieza de las mañanas`), 'Lanza la limpieza de las mañanas')
})

test('stripAppSystemHint: no toca un texto normal', () => {
  assert.equal(stripAppSystemHint('arregla el picker'), 'arregla el picker')
  assert.equal(stripAppSystemHint('[nota] mira esto'), '[nota] mira esto')
})

test('isInjectedCodexPreamble: reconoce los preámbulos inyectados', () => {
  assert.equal(isInjectedCodexPreamble('# AGENTS.md instructions for /Users/isabel/x'), true)
  assert.equal(isInjectedCodexPreamble('<environment_context> <cwd>/Users/isabel/x</cwd>'), true)
  assert.equal(isInjectedCodexPreamble('<skills_instructions>\n## Skills'), true)
  assert.equal(isInjectedCodexPreamble('<user_instructions>haz esto</user_instructions>'), true)
})

test('isInjectedCodexPreamble: no se come un prompt de verdad', () => {
  assert.equal(isInjectedCodexPreamble('esta al corriente de como va el tema de las sesiones lan ?'), false)
  assert.equal(isInjectedCodexPreamble('# TODO de hoy'), false)
  assert.equal(isInjectedCodexPreamble('arregla el <div> del panel'), false)
  assert.equal(isInjectedCodexPreamble(''), false)
})

function userMsg(text) {
  return JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
  })
}

function writeRollout(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-prev-'))
  const file = path.join(dir, 'rollout.jsonl')
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('salta el preámbulo de AGENTS.md y devuelve el prompt del usuario', () => {
  const { file, cleanup } = writeRollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/tmp' } }),
    JSON.stringify({ type: 'response_item', payload: { role: 'developer', content: [{ text: '<skills_instructions>...' }] } }),
    userMsg('# AGENTS.md instructions for /Users/isabel/proyecto\n\nhaz caso a esto'),
    userMsg('esta al corriente de como va el tema de las sesiones lan ?')
  ])
  try {
    assert.equal(
      extractCodexSessionFirstPrompt(file),
      'esta al corriente de como va el tema de las sesiones lan ?'
    )
  } finally { cleanup() }
})

test('encuentra el prompt aunque el preámbulo pase de 64 KB', () => {
  const relleno = 'x'.repeat(90 * 1024)
  const { file, cleanup } = writeRollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/tmp' } }),
    userMsg(`<environment_context> ${relleno}`),
    userMsg('el prompt de verdad')
  ])
  try {
    assert.equal(extractCodexSessionFirstPrompt(file), 'el prompt de verdad')
  } finally { cleanup() }
})

test('una sesión abierta desde Telegram se titula con el encargo, no con la pista', () => {
  const hint = '[Sistema: si el usuario pide un archivo, búscalo con `find ~ -name "*x*"`.]'
  const { file, cleanup } = writeRollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/tmp' } }),
    userMsg('# AGENTS.md instructions for /tmp'),
    userMsg(`${hint}\n\nLanza la automatización de limpieza que hago por las mañanas`)
  ])
  try {
    assert.equal(
      extractCodexSessionFirstPrompt(file),
      'Lanza la automatización de limpieza que hago por las mañanas'
    )
  } finally { cleanup() }
})

test('sesión sin ningún prompt del usuario: cadena vacía', () => {
  const { file, cleanup } = writeRollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/tmp' } }),
    userMsg('# AGENTS.md instructions for /Users/isabel/proyecto')
  ])
  try {
    assert.equal(extractCodexSessionFirstPrompt(file), '')
  } finally { cleanup() }
})

// Los previews viven cacheados en el índice: sin invalidar por versión, los
// títulos malos se arrastran para siempre aunque el extractor ya esté arreglado.
test('un índice en disco de otra versión se descarta en vez de arrastrarse', () => {
  const { createCodexSessionsIndex } = require('../main/codex-sessions-index')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ver-'))
  try {
    fs.writeFileSync(
      path.join(userDataDir, 'codex-sessions-index.json'),
      JSON.stringify({
        version: 0,
        lastFullScanAt: 123,
        byCwd: { '/proj': [{ id: 'viejo', path: '/x.jsonl', mtime: 1, size: 1, preview: '# AGENTS.md instructions for /proj' }] }
      })
    )
    const idx = createCodexSessionsIndex({ userDataDir, sessionsRoot: userDataDir })
    assert.equal(idx.isEmpty(), true, 'debe quedar vacío para forzar re-scan')
    assert.deepEqual(idx.getForCwd('/proj'), [])
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('no se queda leyendo un rollout gigante sin prompts', () => {
  const relleno = 'y'.repeat(200 * 1024)
  const { file, cleanup } = writeRollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/tmp' } }),
    userMsg(`<environment_context> ${relleno}`),
    userMsg(`<environment_context> ${relleno}`),
    userMsg(`<environment_context> ${relleno}`),
    userMsg(`<environment_context> ${relleno}`)
  ])
  try {
    assert.equal(extractCodexSessionFirstPrompt(file, 64 * 1024, 128 * 1024), '')
  } finally { cleanup() }
})
