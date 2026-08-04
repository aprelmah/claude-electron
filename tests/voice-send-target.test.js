'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceSendTarget, pickForkedSessionId } = require(path.join(REPO_ROOT, 'main', 'voice-send-target.js'))

// Banco de pruebas: disco y sub-chat de mentira, sin temporizadores reales.
// `sleep` no duerme, solo cuenta: los bucles del módulo avanzan por
// contador (waited += pollMs), así que el tiempo simulado es exacto.
function makeHarness(opts = {}) {
  const escrituras = { madre: [], subchat: [] }
  const llamadas = { detectFork: [], subchatStart: 0, sleeps: 0, has: 0, lecturas: [] }

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
  // filePath → contenido, para el recálculo de offset de un fork.
  const contenidos = new Map(Object.entries(opts.contenidos || {}))
  // El sub-chat puede morirse entre una comprobación y la siguiente.
  const hasSeq = Array.isArray(opts.subchatHasSeq) ? [...opts.subchatHasSeq] : null
  // Un start() con éxito deja el sub-chat vivo, como el manager de verdad.
  let arrancado = false

  const target = createVoiceSendTarget({
    getSession: () => (opts.sinSesion ? null : session),
    subchat: {
      has: () => {
        llamadas.has += 1
        if (hasSeq) return hasSeq.length ? hasSeq.shift() : false
        if (arrancado) return true
        return typeof opts.subchatHas === 'function' ? opts.subchatHas() : !!opts.subchatHas
      },
      start: () => {
        llamadas.subchatStart += 1
        if (opts.onSubchatStart) opts.onSubchatStart()
        const r = opts.subchatStart || { ok: true }
        if (r.ok && !opts.muereTrasArrancar) arrancado = true
        return r
      },
      write: (wcId, data) => {
        if (opts.subchatWriteThrows) throw new Error('sub-chat muerto')
        // Contrato real de subchat-pty: booleano. `false` = no llegó al PTY.
        if (opts.subchatWriteFalse) return false
        escrituras.subchat.push({ wcId, data })
        return true
      }
    },
    relayCwdCandidates: () => (opts.cwds || ['/proj']),
    findRelayTranscript: ({ sessionId }) => {
      const filePath = `/proj-dir/${sessionId}.jsonl`
      if (!tamanos.has(filePath)) return null
      return { filePath, sessionId, size: tamanos.get(filePath), mtimeMs: 1 }
    },
    snapshotClaudeSessionMeta: (cwd) => new Map([[cwd, { size: 0, mtimeMs: 0 }]]),
    detectForkedRelayTranscript: (args) => {
      llamadas.detectFork.push({ ...args, sleeps: llamadas.sleeps })
      return typeof opts.detectFork === 'function' ? opts.detectFork(args, llamadas.detectFork.length) : (opts.detectFork || null)
    },
    statFn: (p) => {
      if (tamanos.has(p)) return { size: tamanos.get(p) }
      if (contenidos.has(p)) return { size: Buffer.byteLength(contenidos.get(p), 'utf8') }
      return null
    },
    readFileFn: (p) => {
      llamadas.lecturas.push(p)
      if (opts.readThrows) throw new Error('EACCES')
      if (!contenidos.has(p)) throw new Error('ENOENT')
      return contenidos.get(p)
    },
    sleep: async () => { llamadas.sleeps += 1; if (opts.onSleep) opts.onSleep(llamadas.sleeps) },
    log: () => {}
  })

  return { target, session, escrituras, llamadas, tamanos, contenidos }
}

// Transcript de mentira: historial copiado que YA cierra con end_turn (lo que
// leería la app si el offset fuese 0) y debajo la línea del turno de ahora.
const LINEA_VIEJA = '{"type":"assistant","isSidechain":false,"message":{"stop_reason":"end_turn","content":[{"type":"text","text":"café con leche"}]}}'
function transcriptConHistorial(prompt) {
  return `${LINEA_VIEJA}\n{"type":"user","message":{"content":"${prompt}"}}\n`
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

  test('con un turno de Telegram en vuelo NO se escribe en el mismo PTY', async () => {
    const h = makeHarness({ session: { relayActive: true } })
    const res = await h.target({ text: 'hazlo', mode: 'encargo' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /ocupada/i)
    assert.strictEqual(h.escrituras.madre.length, 0, 'dos turnos interleavados en el mismo PTY dan una respuesta a medias a cada uno')
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

describe('voice-send-target — un baseOffset de 0 nunca se propaga al vigía', () => {
  test('fork sin snapshot previo: el offset se recalcula en la línea del prompt', async () => {
    const prompt = 'aplícalo ya'
    const h = makeHarness({
      contenidos: { '/proj-dir/fork-nuevo.jsonl': transcriptConHistorial(prompt) },
      detectFork: () => ({ filePath: '/proj-dir/fork-nuevo.jsonl', sessionId: 'fork-nuevo', baseOffset: 0 })
    })
    const res = await h.target({ text: prompt, mode: 'encargo' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'fork-nuevo')
    assert.strictEqual(
      res.baseOffset,
      Buffer.byteLength(LINEA_VIEJA + '\n', 'utf8'),
      'con offset 0 el vigía cerraría el turno con el end_turn del historial COPIADO y leería en voz alta la respuesta anterior'
    )
  })

  test('el offset recalculado va en BYTES, no en caracteres', async () => {
    const prompt = 'hazlo'
    const contenido = transcriptConHistorial(prompt)
    const h = makeHarness({
      contenidos: { '/proj-dir/fork-nuevo.jsonl': contenido },
      detectFork: () => ({ filePath: '/proj-dir/fork-nuevo.jsonl', sessionId: 'fork-nuevo', baseOffset: 0 })
    })
    const res = await h.target({ text: prompt, mode: 'encargo' })
    const enCaracteres = contenido.indexOf(`"${prompt}`) >= 0 ? (LINEA_VIEJA + '\n').length : -1
    assert.notStrictEqual(res.baseOffset, enCaracteres, 'el transcript lleva acentos: contar caracteres desplaza el offset y parte una línea JSON')
    assert.strictEqual(res.baseOffset, Buffer.byteLength(LINEA_VIEJA + '\n', 'utf8'))
  })

  test('fork con offset 0 y prompt ilocalizable: se descarta el fork en vez de leer a ciegas', async () => {
    const h = makeHarness({
      contenidos: { '/proj-dir/fork-nuevo.jsonl': `${LINEA_VIEJA}\n` },
      detectFork: () => ({ filePath: '/proj-dir/fork-nuevo.jsonl', sessionId: 'fork-nuevo', baseOffset: 0 })
    })
    const res = await h.target({ text: 'hazlo', mode: 'encargo' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'madre-1', 'mejor un timeout ruidoso que hablar de la respuesta de otro turno')
    assert.strictEqual(h.session.claudeSessionId, 'madre-1', 'un fork descartado no puede quedarse en la sesión')
  })

  test('fork con offset 0 e ilegible: se descarta', async () => {
    const h = makeHarness({
      readThrows: true,
      detectFork: () => ({ filePath: '/proj-dir/fork-nuevo.jsonl', sessionId: 'fork-nuevo', baseOffset: 0 })
    })
    const res = await h.target({ text: 'hazlo', mode: 'encargo' })
    assert.strictEqual(res.sessionId, 'madre-1')
  })

  test('fork con offset > 0: se respeta y no se lee el fichero', async () => {
    const h = makeHarness({ detectFork: () => ({ filePath: '/proj-dir/fork-9.jsonl', sessionId: 'fork-9', baseOffset: 12 }) })
    const res = await h.target({ text: 'hazlo', mode: 'encargo' })
    assert.strictEqual(res.baseOffset, 12)
    assert.strictEqual(h.llamadas.lecturas.length, 0, 'releer el transcript entero cuando el snapshot ya da el offset es trabajo en balde')
  })
})

describe('voice-send-target — charla (sub-chat forkeado)', () => {
  test('abre el sub-chat y devuelve SU sessionId, identificado por el prompt', async () => {
    const h = makeHarness({
      subchatHas: () => false,
      detectFork: () => ({ filePath: '/proj-dir/fork-abc.jsonl', sessionId: 'fork-abc', baseOffset: 4096 })
    })
    const res = await h.target({ text: '¿qué opinas?', mode: 'charla' })
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.sessionId, 'fork-abc')
    assert.strictEqual(res.baseOffset, 4096, 'el historial copiado por el fork queda por debajo del offset')
    assert.strictEqual(h.llamadas.subchatStart, 1)
    assert.deepStrictEqual(h.escrituras.subchat, [{ wcId: 7, data: '¿qué opinas?\r' }])
    assert.strictEqual(h.escrituras.madre.length, 0, 'la charla no toca el PTY de la madre')
    assert.strictEqual(h.session.voiceSubchatSessionId, 'fork-abc', 'se recuerda para no repetir la búsqueda en cada turno')
  })

  test('el sub-chat se identifica por el prompt, nunca por "el .jsonl más nuevo"', async () => {
    const h = makeHarness({ subchatHas: () => false, detectFork: () => null })
    const res = await h.target({ text: 'una duda', mode: 'charla' })
    assert.strictEqual(res.ok, false, 'sin coincidencia de prompt no se adopta nada: el fichero nuevo puede ser de otra ventana o de un PTY oculto de Telegram')
    assert.strictEqual(h.session.voiceSubchatSessionId, null)
    assert.ok(h.llamadas.detectFork.length > 0)
    for (const args of h.llamadas.detectFork) {
      assert.strictEqual(args.promptMarker, 'una duda')
      assert.strictEqual(args.excludeSessionId, 'madre-1', 'la madre nunca puede colarse como sub-chat')
    }
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
    assert.strictEqual(h.llamadas.detectFork.length, 0)
  })

  test('si el sub-chat no arranca, se devuelve el motivo tal cual', async () => {
    const h = makeHarness({ subchatHas: () => false, subchatStart: { ok: false, error: 'Aún no hay contexto que heredar' } })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.reason, 'Aún no hay contexto que heredar')
    assert.strictEqual(h.escrituras.subchat.length, 0)
  })

  test('si el sub-chat muere entre el arranque y la escritura, se avisa y NO se escribe', async () => {
    // has(): true al entrar (ya había sub-chat), false justo antes de escribir.
    const h = makeHarness({ subchatHasSeq: [true, false] })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /se cerró antes de poder escribir/i)
    assert.strictEqual(h.escrituras.subchat.length, 0, 'subchatManager.write se traga los errores: sin este control daba {ok:true} y 180 s de silencio')
  })

  test('si write devuelve false (EPIPE con la entrada aún viva) no se da el turno por enviado', async () => {
    const h = makeHarness({ subchatHas: () => true, session: { voiceSubchatSessionId: 'fork-abc' }, subchatWriteFalse: true })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /no aceptó el texto/i)
  })

  test('si write lanza también se avisa', async () => {
    const h = makeHarness({ subchatHas: () => true, session: { voiceSubchatSessionId: 'fork-abc' }, subchatWriteThrows: true })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /no se pudo escribir/i)
  })

  test('si el fork no aparece nunca: error claro, una sola escritura y nada adoptado', async () => {
    const h = makeHarness({ subchatHas: () => false, detectFork: () => null })
    const res = await h.target({ text: 'hola', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.match(res.reason, /transcript del sub-chat/i)
    // Escribir es obligatorio ANTES de buscar: sin prompt en el fichero no hay
    // forma legítima de identificar el sub-chat. Lo que no puede haber es más
    // de una escritura ni una adopción a ciegas.
    assert.strictEqual(h.escrituras.subchat.length, 1)
    assert.strictEqual(h.session.voiceSubchatSessionId, null)
    // subchatForkWaitMs=5000 / pollMs=200 ⇒ 25 vueltas como mucho.
    assert.ok(h.llamadas.sleeps <= 26, `demasiadas vueltas: ${h.llamadas.sleeps}`)
  })

  test('charla con fork de offset 0: también se recalcula por la línea del prompt', async () => {
    const prompt = 'cuéntame'
    const h = makeHarness({
      subchatHas: () => false,
      contenidos: { '/proj-dir/fork-abc.jsonl': transcriptConHistorial(prompt) },
      detectFork: () => ({ filePath: '/proj-dir/fork-abc.jsonl', sessionId: 'fork-abc', baseOffset: 0 })
    })
    const res = await h.target({ text: prompt, mode: 'charla' })
    assert.strictEqual(res.baseOffset, Buffer.byteLength(LINEA_VIEJA + '\n', 'utf8'))
  })

  test('charla con fork de offset 0 e ilocalizable: se descarta y no se inventa un sessionId', async () => {
    const h = makeHarness({
      subchatHas: () => false,
      contenidos: { '/proj-dir/fork-abc.jsonl': `${LINEA_VIEJA}\n` },
      detectFork: () => ({ filePath: '/proj-dir/fork-abc.jsonl', sessionId: 'fork-abc', baseOffset: 0 })
    })
    const res = await h.target({ text: 'cuéntame', mode: 'charla' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(h.session.voiceSubchatSessionId, null)
  })
})

describe('pickForkedSessionId — el fork que crea un --resume en el spawn', () => {
  const filas = [
    { file: 'vieja.jsonl', sessionId: 'vieja', mtimeMs: 5 },
    { file: 'resumida.jsonl', sessionId: 'resumida', mtimeMs: 30 },
    { file: 'fork.jsonl', sessionId: 'fork', mtimeMs: 20 }
  ]
  const grupo = (rows, before) => [{ rows, before }]

  test('devuelve el .jsonl que no estaba antes del spawn', () => {
    const before = new Map([['vieja.jsonl', 5], ['resumida.jsonl', 10]])
    assert.strictEqual(pickForkedSessionId({ groups: grupo(filas, before), excludeIds: ['resumida'] }), 'fork')
  })

  test('el id resumido nunca se devuelve a sí mismo aunque sea el más reciente', () => {
    const before = new Map([['vieja.jsonl', 5]])
    const soloResumida = [{ file: 'resumida.jsonl', sessionId: 'resumida', mtimeMs: 99 }]
    assert.strictEqual(pickForkedSessionId({ groups: grupo(soloResumida, before), excludeIds: ['resumida'] }), null)
  })

  test('DOS ficheros nuevos: no se adopta ninguno', () => {
    const before = new Map()
    const rows = [
      { file: 'a.jsonl', sessionId: 'a', mtimeMs: 1 },
      { file: 'b.jsonl', sessionId: 'b', mtimeMs: 9 }
    ]
    assert.strictEqual(
      pickForkedSessionId({ groups: grupo(rows, before), excludeIds: [] }),
      null,
      'un fork del propio spawn aparece SOLO; dos candidatos significan otro actor (otra ventana, un headless, un claude a mano) y quedarse con el más reciente es adoptar el de otro'
    )
  })

  test('un id que ya es de otra sesión viva no se adopta aunque el fichero sea nuevo', () => {
    const before = new Map([['resumida.jsonl', 10]])
    const rows = [
      { file: 'resumida.jsonl', sessionId: 'resumida', mtimeMs: 30 },
      { file: 'subchat.jsonl', sessionId: 'subchat-de-la-madre', mtimeMs: 40 }
    ]
    assert.strictEqual(
      pickForkedSessionId({ groups: grupo(rows, before), excludeIds: ['resumida', 'subchat-de-la-madre'] }),
      null,
      'sin esta exclusión la madre adoptaba el id de su propio sub-chat y a partir de ahí todo forkeaba del sub-chat'
    )
  })

  test('con el sub-chat excluido, el fork legítimo sí se adopta', () => {
    const before = new Map([['resumida.jsonl', 10]])
    const rows = [
      { file: 'subchat.jsonl', sessionId: 'subchat-de-la-madre', mtimeMs: 40 },
      { file: 'fork.jsonl', sessionId: 'fork', mtimeMs: 20 }
    ]
    assert.strictEqual(pickForkedSessionId({ groups: grupo(rows, before), excludeIds: ['resumida', 'subchat-de-la-madre'] }), 'fork')
  })

  test('dos ids DISTINTOS en dos grupos distintos: tampoco se adopta ninguno', () => {
    const groups = [
      { rows: [{ file: 'a.jsonl', sessionId: 'a', mtimeMs: 1 }], before: new Map() },
      { rows: [{ file: 'b.jsonl', sessionId: 'b', mtimeMs: 9 }], before: new Map() }
    ]
    assert.strictEqual(
      pickForkedSessionId({ groups, excludeIds: [] }),
      null,
      'la ambigüedad se mide entre TODOS los proyectos, no dentro de cada uno'
    )
  })

  test('el mismo sessionId en dos proyectos candidatos cuenta como UN candidato', () => {
    const rows = [{ file: 'fork.jsonl', sessionId: 'fork', mtimeMs: 20 }]
    const groups = [
      { rows, before: new Map() },
      { rows, before: new Map() }
    ]
    assert.strictEqual(pickForkedSessionId({ groups, excludeIds: [] }), 'fork', 'worktree y dir real son el mismo fichero lógico')
  })

  test('un solo grupo sin snapshot invalida la adopción entera', () => {
    const before = new Map([['vieja.jsonl', 5], ['resumida.jsonl', 10]])
    const groups = [{ rows: filas, before }, { rows: [], before: null }]
    assert.strictEqual(pickForkedSessionId({ groups, excludeIds: ['resumida'] }), null)
  })

  test('sin snapshot previo no se adopta nada: todos los ficheros parecerían nuevos', () => {
    assert.strictEqual(pickForkedSessionId({ groups: grupo(filas, null), excludeIds: ['resumida'] }), null)
    assert.strictEqual(pickForkedSessionId({ groups: [{ rows: filas }], excludeIds: ['resumida'] }), null)
    assert.strictEqual(pickForkedSessionId({}), null)
  })

  test('si no ha aparecido ningún fichero nuevo devuelve null', () => {
    const before = new Map([['vieja.jsonl', 5], ['resumida.jsonl', 30], ['fork.jsonl', 20]])
    assert.strictEqual(pickForkedSessionId({ groups: grupo(filas, before), excludeIds: ['resumida'] }), null)
  })
})
