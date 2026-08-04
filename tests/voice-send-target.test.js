'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceSendTarget } = require(path.join(REPO_ROOT, 'main', 'voice-send-target.js'))

// Banco de pruebas: disco y sub-chat de mentira, sin temporizadores reales.
// `sleep` no duerme, solo cuenta: los bucles del módulo avanzan por
// contador (waited += pollMs), así que el tiempo simulado es exacto.
function makeHarness(opts = {}) {
  const escrituras = { madre: [], subchat: [] }
  const llamadas = { detectFork: [], subchatStart: 0, sleeps: 0 }

  const session = {
    wcId: 7,
    activeCli: 'claude',
    claudeSessionId: 'madre-1',
    cwd: '/proj',
    pty: opts.sinPty ? null : { write: (d) => { if (opts.ptyWriteThrows) throw new Error('pipe roto'); escrituras.madre.push(d) } },
    ...opts.session
  }

  // filePath → tamaño. `tamanos` puede mutarse desde los tests.
  const tamanos = new Map(Object.entries(opts.tamanos || { '/proj-dir/madre-1.jsonl': 100 }))
  // cwd → [{ file, sessionId, mtimeMs }]
  let ficheros = opts.ficheros || { '/proj': [{ file: 'madre-1.jsonl', sessionId: 'madre-1', mtimeMs: 10 }] }

  const target = createVoiceSendTarget({
    getSession: () => (opts.sinSesion ? null : session),
    subchat: {
      has: () => (typeof opts.subchatHas === 'function' ? opts.subchatHas() : !!opts.subchatHas),
      start: () => {
        llamadas.subchatStart += 1
        if (opts.onSubchatStart) opts.onSubchatStart()
        return opts.subchatStart || { ok: true }
      },
      write: (wcId, data) => {
        if (opts.subchatWriteThrows) throw new Error('sub-chat muerto')
        escrituras.subchat.push({ wcId, data })
      }
    },
    relayCwdCandidates: () => (opts.cwds || ['/proj']),
    findRelayTranscript: ({ sessionId }) => {
      const filePath = `/proj-dir/${sessionId}.jsonl`
      if (!tamanos.has(filePath)) return null
      return { filePath, sessionId, size: tamanos.get(filePath), mtimeMs: 1 }
    },
    snapshotClaudeSessions: (cwd) => new Map((ficheros[cwd] || []).map((r) => [r.file, r.mtimeMs])),
    listClaudeSessionFilesWithMtime: (cwd) => (ficheros[cwd] || []).slice().sort((a, b) => b.mtimeMs - a.mtimeMs),
    snapshotClaudeSessionMeta: (cwd) => new Map((ficheros[cwd] || []).map((r) => [r.file, { size: tamanos.get(`/proj-dir/${r.file}`) || 0, mtimeMs: r.mtimeMs }])),
    detectForkedRelayTranscript: (args) => {
      llamadas.detectFork.push({ ...args, sleeps: llamadas.sleeps })
      return typeof opts.detectFork === 'function' ? opts.detectFork(args, llamadas.detectFork.length) : (opts.detectFork || null)
    },
    statFn: (p) => (tamanos.has(p) ? { size: tamanos.get(p) } : null),
    sleep: async () => { llamadas.sleeps += 1; if (opts.onSleep) opts.onSleep(llamadas.sleeps) },
    log: () => {}
  })

  return {
    target,
    session,
    escrituras,
    llamadas,
    tamanos,
    setFicheros: (f) => { ficheros = f }
  }
}

describe('voice-send-target — validaciones de entrada', () => {
  test('sin sesión no se envía nada', async () => {
    const h = makeHarness({ sinSesion: true })
    const res = await h.target({ text: 'hola', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /ventana del modo voz/i)
  })

  test('con codex se rechaza: no delimita fin de turno', async () => {
    const h = makeHarness({ session: { activeCli: 'codex' } })
    const res = await h.target({ text: 'hola', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /claude/i)
  })

  test('sin claudeSessionId no hay transcript que vigilar', async () => {
    const h = makeHarness({ session: { claudeSessionId: '' } })
    const res = await h.target({ text: 'hola', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /id de conversación/i)
  })

  test('texto vacío no llega al PTY', async () => {
    const h = makeHarness()
    const res = await h.target({ text: '   ', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(h.escrituras.madre.length, 0)
  })

  test('sin cwds candidatos se rechaza', async () => {
    const h = makeHarness({ cwds: [] })
    const res = await h.target({ text: 'hola', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /directorio/i)
  })
})

describe('voice-send-target — encargo (PTY de la sesión madre)', () => {
  test('escribe el prompt con retorno de carro y devuelve el offset PREVIO al envío', async () => {
    const h = makeHarness()
    // El transcript crece nada más escribir: caso normal, sin fork.
    h.tamanos.set('/proj-dir/madre-1.jsonl', 100)
    const p = h.target({ text: 'arréglalo', mode: 'encargo' })
    h.tamanos.set('/proj-dir/madre-1.jsonl', 180)
    const res = await p
    assert.deepStrictEqual(h.escrituras.madre, ['arréglalo\r'])
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'madre-1')
    assert.strictEqual(res.baseOffset, 100, 'el offset debe ser el de antes de escribir, o el vigía leería la respuesta anterior')
    assert.deepStrictEqual(res.cwds, ['/proj'])
  })

  test('sin proceso vivo no se escribe', async () => {
    const h = makeHarness({ sinPty: true })
    const res = await h.target({ text: 'hazlo', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /proceso vivo/i)
  })

  test('si el PTY revienta al escribir se avisa en vez de colgarse', async () => {
    const h = makeHarness({ ptyWriteThrows: true })
    const res = await h.target({ text: 'hazlo', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /no se pudo escribir/i)
  })

  test('si el transcript esperado crece, no se busca ningún fork', async () => {
    const h = makeHarness({ detectFork: { filePath: '/x', sessionId: 'no-deberia', baseOffset: 0 } })
    const p = h.target({ text: 'hazlo', mode: 'encargo' })
    h.tamanos.set('/proj-dir/madre-1.jsonl', 500)
    const res = await p
    assert.strictEqual(res.sessionId, 'madre-1')
    assert.strictEqual(h.llamadas.detectFork.length, 0, 'buscar fork con el fichero creciendo es pedir un falso positivo')
  })

  test('transcript congelado + fork detectado: devuelve el sessionId forkeado y lo adopta en la sesión', async () => {
    const h = makeHarness({
      detectFork: () => ({ filePath: '/proj-dir/fork-9.jsonl', sessionId: 'fork-9', baseOffset: 640 })
    })
    const res = await h.target({ text: 'aplícalo', mode: 'encargo' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'fork-9')
    assert.strictEqual(res.baseOffset, 640)
    assert.strictEqual(h.session.claudeSessionId, 'fork-9', 'la sesión debe quedarse con el id vivo, no con el muerto')
  })

  test('la detección de fork lleva el prompt como marcador y excluye el id esperado', async () => {
    const h = makeHarness({ detectFork: () => ({ filePath: '/f', sessionId: 'fork-9', baseOffset: 1 }) })
    await h.target({ text: 'ejecuta los tests', mode: 'encargo' })
    const args = h.llamadas.detectFork[0]
    assert.strictEqual(args.promptMarker, 'ejecuta los tests')
    assert.strictEqual(args.excludeSessionId, 'madre-1')
    assert.deepStrictEqual(args.cwds, ['/proj'])
    assert.strictEqual(args.before.length, 1)
  })

  test('no se busca fork durante el primer segundo largo tras escribir', async () => {
    const h = makeHarness({ detectFork: () => null })
    await h.target({ text: 'hazlo', mode: 'encargo' })
    assert.ok(h.llamadas.detectFork.length > 0, 'al final sí debe intentarlo')
    // pollMs=200, forkCheckAfterMs=1200 ⇒ el primer intento cae en el sexto sueño.
    assert.ok(h.llamadas.detectFork[0].sleeps >= 6, `la primera búsqueda de fork llegó demasiado pronto (sueño ${h.llamadas.detectFork[0].sleeps})`)
  })

  test('ni crece ni hay fork: devuelve el id esperado sin colgarse', async () => {
    const h = makeHarness({ detectFork: () => null })
    const res = await h.target({ text: 'hazlo', mode: 'encargo' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'madre-1')
    assert.strictEqual(res.baseOffset, 100)
    // motherWaitMs=3000 / pollMs=200 ⇒ 15 vueltas como mucho.
    assert.ok(h.llamadas.sleeps <= 15, `demasiadas vueltas: ${h.llamadas.sleeps}`)
  })
})

describe('voice-send-target — charla (sub-chat forkeado)', () => {
  test('abre el sub-chat, espera al fork y devuelve SU sessionId, no el de la madre', async () => {
    const h = makeHarness({
      subchatHas: () => false,
      onSubchatStart: () => {
        // El fork aparece en disco en cuanto arranca el sub-chat.
        h.setFicheros({
          '/proj': [
            { file: 'madre-1.jsonl', sessionId: 'madre-1', mtimeMs: 10 },
            { file: 'fork-abc.jsonl', sessionId: 'fork-abc', mtimeMs: 20 }
          ]
        })
        h.tamanos.set('/proj-dir/fork-abc.jsonl', 4096)
      }
    })
    const res = await h.target({ text: '¿qué opinas?', mode: 'charla' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'fork-abc')
    assert.strictEqual(h.llamadas.subchatStart, 1)
    assert.deepStrictEqual(h.escrituras.subchat, [{ wcId: 7, data: '¿qué opinas?\r' }])
    assert.strictEqual(h.escrituras.madre.length, 0, 'la charla no toca el PTY de la madre')
  })

  test('el baseOffset del fork es su tamaño ANTES de escribir, nunca 0', async () => {
    const h = makeHarness({
      subchatHas: () => false,
      onSubchatStart: () => {
        h.setFicheros({
          '/proj': [
            { file: 'madre-1.jsonl', sessionId: 'madre-1', mtimeMs: 10 },
            { file: 'fork-abc.jsonl', sessionId: 'fork-abc', mtimeMs: 20 }
          ]
        })
        h.tamanos.set('/proj-dir/fork-abc.jsonl', 4096)
      }
    })
    const res = await h.target({ text: 'cuéntame', mode: 'charla' })
    assert.strictEqual(res.baseOffset, 4096, 'con offset 0 el vigía leería el historial COPIADO por el fork y hablaría del turno anterior')
  })

  test('reutiliza el sub-chat abierto y su sessionId ya conocido, sin arrancar nada', async () => {
    const h = makeHarness({
      subchatHas: () => true,
      session: { voiceSubchatSessionId: 'fork-abc' },
      tamanos: { '/proj-dir/madre-1.jsonl': 100, '/proj-dir/fork-abc.jsonl': 900 }
    })
    const res = await h.target({ text: 'y esto?', mode: 'charla' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'fork-abc')
    assert.strictEqual(res.baseOffset, 900)
    assert.strictEqual(h.llamadas.subchatStart, 0)
    assert.strictEqual(h.llamadas.sleeps, 0, 'el camino corto no debe esperar nada')
  })

  test('si el sub-chat no arranca, se devuelve el motivo tal cual', async () => {
    const h = makeHarness({ subchatHas: () => false, subchatStart: { ok: false, error: 'Aún no hay contexto que heredar' } })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.reason, 'Aún no hay contexto que heredar')
    assert.strictEqual(h.escrituras.subchat.length, 0)
  })

  test('si el fork no aparece nunca, error claro y sin escribir a ciegas', async () => {
    const h = makeHarness({ subchatHas: () => false, detectFork: () => null })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /transcript del sub-chat/i)
  })

  test('sub-chat abierto por el usuario (sessionId desconocido): se identifica por el prompt', async () => {
    const h = makeHarness({
      subchatHas: () => true,
      detectFork: () => ({ filePath: '/proj-dir/fork-ui.jsonl', sessionId: 'fork-ui', baseOffset: 2048 })
    })
    const res = await h.target({ text: 'una duda', mode: 'charla' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'fork-ui')
    assert.strictEqual(res.baseOffset, 2048)
    assert.strictEqual(h.session.voiceSubchatSessionId, 'fork-ui', 'se recuerda para no repetir la búsqueda en cada turno')
    assert.strictEqual(h.llamadas.detectFork[0].excludeSessionId, 'madre-1')
  })

  test('si el sub-chat revienta al escribir se avisa', async () => {
    const h = makeHarness({
      subchatHas: () => true,
      session: { voiceSubchatSessionId: 'fork-abc' },
      subchatWriteThrows: true
    })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /no se pudo escribir/i)
  })

  test('el fork nunca puede ser el de la madre aunque sea el fichero más reciente', async () => {
    const h = makeHarness({
      subchatHas: () => false,
      detectFork: () => null,
      onSubchatStart: () => {
        // La madre está viva y su .jsonl es el más nuevo, pero ya estaba antes.
        h.setFicheros({ '/proj': [{ file: 'madre-1.jsonl', sessionId: 'madre-1', mtimeMs: 99 }] })
      }
    })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false, 'mejor fallar que vigilar el transcript de la madre creyendo que es el sub-chat')
  })
})
