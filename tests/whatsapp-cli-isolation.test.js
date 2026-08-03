const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { buildClaudeArgs } = require(path.join(REPO_ROOT, 'whatsapp', 'whatsapp-auto-reply.js'))

function pairs(args) {
  const out = new Map()
  for (let i = 0; i < args.length; i++) {
    if (String(args[i]).startsWith('--') || args[i] === '-p') out.set(args[i], args[i + 1])
  }
  return out
}

// Cada spawn del bot heredaba el entorno personal de Luismi: los servidores MCP
// configurados, el CLAUDE.md global, settings, hooks y skills. Nada de eso lo usa
// —va con --tools ''— pero lo pagaba igual: ~9.000 tokens de entrada y ~3,6 s de
// arranque POR TURNO, y cada respuesta al cliente son dos turnos.
// Estos flags son la diferencia entre 11,2 s y 6,9 s por turno. Si alguien los
// quita "porque no parecen hacer nada", el bot vuelve a tardar el doble y además
// se reabre el camino del cliente hacia los MCP y hooks personales.
describe('aislamiento del CLI en el bot de WhatsApp', () => {
  const args = buildClaudeArgs({ prompt: 'hola', systemPrompt: 'persona' })

  test('no carga los MCP del usuario', () => {
    assert.ok(args.includes('--strict-mcp-config'), args.join(' '))
    assert.ok(!args.includes('--mcp-config'), 'no debe pasarse ninguna config MCP')
  })

  test('no carga CLAUDE.md, settings, hooks ni skills', () => {
    assert.strictEqual(pairs(args).get('--setting-sources'), '', args.join(' '))
  })

  test('sigue sin tools y sin persistir sesión', () => {
    assert.strictEqual(pairs(args).get('--tools'), '')
    assert.ok(args.includes('--no-session-persistence'))
  })

  test('NO usa --bare: rompería el login OAuth del plan Max', () => {
    assert.ok(!args.includes('--bare'))
  })

  test('prompt y persona viajan como argumentos, no por stdin ni por shell', () => {
    const p = pairs(args)
    assert.strictEqual(p.get('-p'), 'hola')
    assert.strictEqual(p.get('--system-prompt'), 'persona')
  })

  test('modelo y effort solo se añaden cuando se piden', () => {
    assert.ok(!args.includes('--model'))
    assert.ok(!args.includes('--effort'))
    const full = buildClaudeArgs({ prompt: 'x', systemPrompt: 'y', model: 'haiku', effort: 'low' })
    assert.strictEqual(pairs(full).get('--model'), 'haiku')
    assert.strictEqual(pairs(full).get('--effort'), 'low')
  })
})
