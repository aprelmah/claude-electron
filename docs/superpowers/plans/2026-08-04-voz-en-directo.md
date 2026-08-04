# Modo voz en directo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hablarle a POWER-AGENT y que conteste hablando, con dos destinos — charla lateral (sub-chat) y encargo a la sesión de trabajo — sin tocar el teclado.

**Architecture:** Un helper Swift hijo (`voice-helper`) posee micro, reconocimiento y síntesis, y habla con Node por NDJSON sobre stdin/stdout. En Node, cinco módulos pequeños: proceso, filtro de texto, vigía de turno, router y máquina de estados. El vigía **reutiliza** `main/relay-transcript-helpers.js` (ya exportado, genérico y testeado) en vez de tocar `relayThroughPty`, que vive inline en `main.js` con 375 líneas de acoplamiento a Telegram y codex.

**Tech Stack:** Swift 5.7 (Speech.framework, AVFoundation, CoreAudio VoiceProcessingIO), Node 20/24, Electron 43, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-04-voz-en-directo-design.md` — léelo antes de empezar. Todas las cifras de latencia de este plan están medidas allí, no estimadas.

## Global Constraints

- **Estilo del repo, sin excepción:** `'use strict'` arriba, comillas simples, **sin punto y coma**, comentarios en español explicando el *porqué*. Factory `createXxx({ deps } = {})`, validación `if (typeof dep !== 'function') throw new Error('nombre-modulo: dep requerido')`, `module.exports = { createXxx }`.
- **Tests:** solo `node:test` + `node:assert`, sin librerías de mocking. Fakes a mano con arrays-registro. Mensajes de test en español de España.
- **`package.json` `build.files` es WHITELIST.** `main/**/*` ya cubre los módulos nuevos. El binario Swift NO va por ahí: va por `extraResources` (nuevo en este repo).
- **Locale fijo `es-ES`.** Reconocimiento en **modo servidor** (`requiresOnDeviceRecognition = false`): el on-device da RTF 2,5–7,5 en este i7 de 2014 y es inservible. Decisión tomada por Luismi con las cifras delante.
- **Un helper por app**, no por ventana. El micro es un recurso único del sistema.
- **El modo voz solo soporta `activeCli === 'claude'`.** Codex no delimita fin de turno de forma fiable (misma razón por la que el pool de Telegram lo excluye).
- **Tests en el repo real, no en el worktree.** El worktree no tiene `node_modules` y 12 tests fallan por `Cannot find module 'node-pty'`. **Nunca symlinkar `node_modules` dentro de un worktree** (ya provocó un commit de basura, ver CLAUDE.md § Limitaciones).
- Antes de commitear: `node --check` sobre cada `.js` tocado.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `voice-helper/VoiceHelper.swift` | **YA EXISTE Y ESTÁ VALIDADO.** Micro, STT, TTS, barge-in, cancelación de eco. |
| `scripts/build-voice-helper.sh` | Compila el Swift a `resources/voice-helper`. |
| `main/voice-helper-process.js` | Ciclo de vida del proceso hijo + parseo NDJSON + circuit breaker. |
| `main/voice-speakable.js` | Convierte respuesta markdown en prosa decible. Puro. |
| `main/voice-turn-watcher.js` | Vigila el transcript hasta `turnComplete`. |
| `main/voice-router.js` | Decide charla vs encargo. Puro. |
| `main/voice-session.js` | Máquina de estados y orquestación. |
| `main.js` | Instanciación + 5 handlers IPC + `SAFE_CLI`. |
| `preload.js`, `renderer.js`, `index.html`, `styles.css` | Botón y estados en la topbar. |

**Orden obligatorio:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Cada tarea deja la suite en verde.

---

### Task 1: Compilar y empaquetar el helper Swift

`voice-helper/VoiceHelper.swift` **ya está en el repo y ya se ha probado**: compila con `swiftc -O`, responde al protocolo por tubería, y su motor (Speech en servidor + VoiceProcessingIO) es el mismo que se midió en la prueba de humo. No lo reescribas. Esta tarea solo lo compila, lo empaqueta y lo blinda con un test.

Tres trampas ya pagadas que están resueltas en ese fichero — **no las "arregles" de vuelta**:
1. `emit` es asíncrono (no bloquear el hilo de CoreAudio) y `exitDraining` drena antes de morir. Salir a pelo se come el último evento.
2. Al cerrarse stdin, la salida se encola en la cola principal. Salir en el hilo de stdin mata los comandos aún pendientes.
3. Los permisos se piden **en perezoso**, al primer `start`. Pedirlos al arrancar mata el proceso cuando no hay bundle, y lo vuelve intesteable.

**Files:**
- Create: `scripts/build-voice-helper.sh`
- Create: `tests/voice-helper-protocol.test.js`
- Modify: `package.json` (`build.mac.extendInfo`, `build.extraResources`, `scripts`)

**Interfaces:**
- Produces: binario en `resources/voice-helper`; protocolo NDJSON documentado abajo.

**Protocolo (contrato para las tareas 2 y 6):**

| Node → helper | Helper → Node |
|---|---|
| `{cmd:"authorize"}` | `{type:"hello",pid}` al arrancar |
| `{cmd:"start"}` | `{type:"ready",locale,onDeviceAvailable}` |
| `{cmd:"stop"}` | `{type:"listening"}` · `{type:"speech-detected"}` |
| `{cmd:"speak",id,text}` | `{type:"partial",text}` · `{type:"final",text}` · `{type:"empty"}` |
| `{cmd:"shutup"}` | `{type:"speech-start",id}` · `{type:"speech-end",id,finished}` |
| `{cmd:"vocab",words:[…]}` | `{type:"user-interrupt"}` |
| `{cmd:"voice",id}` / `{cmd:"voices"}` | `{type:"voices",voices:[{id,name,language,quality}]}` |
| `{cmd:"quit"}` | `{type:"error",message,fatal}` · `{type:"warn",message}` · `{type:"stopped"}` |

- [ ] **Step 1: Script de compilación**

```bash
cat > scripts/build-voice-helper.sh << 'EOF'
#!/bin/bash
# Compila el helper de voz (Swift) a resources/voice-helper.
# Se ejecuta antes de empaquetar y también a mano durante el desarrollo.
set -e
cd "$(dirname "$0")/.."

if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "✖ swiftc no disponible. Instala las Command Line Tools: xcode-select --install"
  exit 1
fi

mkdir -p resources
swiftc -O voice-helper/VoiceHelper.swift -o resources/voice-helper
echo "✔ resources/voice-helper compilado"
EOF
chmod +x scripts/build-voice-helper.sh
```

- [ ] **Step 2: Escribir el test del protocolo (fallará: aún no hay binario)**

```js
'use strict'

// Prueba el helper de voz por tubería, sin micro ni permisos: solo los
// comandos que no tocan audio. Todo lo demás (latencia, eco, transcripción)
// necesita un humano con boca y está en el checklist manual del spec.

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const HELPER = path.join(REPO_ROOT, 'resources', 'voice-helper')

function runHelper(commands, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(HELPER, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    const events = []
    let buf = ''
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('timeout')) }, timeoutMs)
    proc.stdout.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        try { events.push(JSON.parse(line)) } catch { /* línea no JSON: se ignora */ }
      }
    })
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('close', () => { clearTimeout(timer); resolve(events) })
    for (const c of commands) proc.stdin.write(JSON.stringify(c) + '\n')
    proc.stdin.end()
  })
}

describe('voice-helper: protocolo NDJSON', () => {
  test('el binario está compilado', () => {
    assert.ok(fs.existsSync(HELPER), 'falta resources/voice-helper — corre scripts/build-voice-helper.sh')
  })

  test('saluda al arrancar sin pedir permisos', async () => {
    const events = await runHelper([{ cmd: 'quit' }])
    const hello = events.find((e) => e.type === 'hello')
    assert.ok(hello, 'no llegó el hello')
    assert.ok(Number.isInteger(hello.pid))
    // Si pidiera permisos al arrancar, el proceso moriría sin bundle y no habría hello.
    assert.ok(!events.some((e) => e.type === 'error' && e.fatal), 'no debe haber error fatal sin usar el micro')
  })

  test('lista voces en español con su calidad', async () => {
    const events = await runHelper([{ cmd: 'voices' }, { cmd: 'quit' }])
    const voices = events.find((e) => e.type === 'voices')
    assert.ok(voices, 'no llegó la lista de voces')
    assert.ok(Array.isArray(voices.voices) && voices.voices.length > 0)
    for (const v of voices.voices) {
      assert.ok(v.id && v.name && v.language)
      assert.ok(['default', 'enhanced', 'premium'].includes(v.quality))
    }
  })

  test('un comando desconocido da error no fatal, no tumba el proceso', async () => {
    const events = await runHelper([{ cmd: 'inventado' }, { cmd: 'voices' }, { cmd: 'quit' }])
    const err = events.find((e) => e.type === 'error')
    assert.ok(err && /desconocido/.test(err.message))
    assert.strictEqual(err.fatal, false)
    assert.ok(events.find((e) => e.type === 'voices'), 'debe seguir vivo tras el comando malo')
  })

  test('los eventos no se pierden al salir', async () => {
    // exitDraining vacía la cola antes de morir. Sin eso, `voices` seguido de
    // `quit` se perdería por el desagüe: el bug real que costó media hora.
    const events = await runHelper([{ cmd: 'voices' }, { cmd: 'quit' }])
    assert.ok(events.find((e) => e.type === 'voices'))
  })
})
```

- [ ] **Step 3: Correrlo y verlo fallar**

Run: `node --test tests/voice-helper-protocol.test.js`
Expected: FAIL — `falta resources/voice-helper`

- [ ] **Step 4: Compilar**

Run: `bash scripts/build-voice-helper.sh`
Expected: `✔ resources/voice-helper compilado`

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `node --test tests/voice-helper-protocol.test.js`
Expected: 5 tests PASS

- [ ] **Step 6: Empaquetado en `package.json`**

En `build.mac.extendInfo`, añadir la clave de reconocimiento y actualizar la de micrófono (hoy dice "Dictado por voz con Whisper local"):

```json
"extendInfo": {
  "NSMicrophoneUsageDescription": "POWER-AGENT usa el micrófono para hablar con el agente.",
  "NSSpeechRecognitionUsageDescription": "POWER-AGENT transcribe tu voz para enviársela al agente.",
  "NSApplicationSupportsSecureRestorableState": true
}
```

En `build`, hermano de `files` (no existe hoy, es nuevo):

```json
"extraResources": [
  { "from": "resources/voice-helper", "to": "voice-helper" }
]
```

En `scripts`, añadir el compilado y encadenarlo antes de empaquetar:

```json
"build:voice-helper": "bash ./scripts/build-voice-helper.sh",
"prebuild:zip": "npm run build:voice-helper",
"predist": "npm run build:voice-helper",
```

En `.gitignore`, añadir `resources/voice-helper` (es un artefacto de compilación, no fuente).

- [ ] **Step 7: Añadir el compilado a `scripts/deploy.sh`**

`deploy.sh` llama a `npx electron-builder` directamente, saltándose los hooks `pre*` de npm. Insertar antes del paso "2/4 compilando":

```bash
echo "▶ compilando helper de voz..."
bash scripts/build-voice-helper.sh
```

- [ ] **Step 8: Commit**

```bash
git add voice-helper/ scripts/build-voice-helper.sh scripts/deploy.sh tests/voice-helper-protocol.test.js package.json .gitignore
git commit -m "feat(voz): helper Swift de voz, compilado y empaquetado"
```

---

### Task 2: Proceso del helper en Node

**Files:**
- Create: `main/voice-helper-process.js`
- Test: `tests/voice-helper-process.test.js`

**Interfaces:**
- Consumes: protocolo NDJSON de Task 1.
- Produces: `createVoiceHelperProcess({ spawnFn, helperPath, onEvent, log, maxRestarts })` → `{ start, send, stop, isRunning, isBroken, reset }`.
  - `send(obj)` → `boolean` (false si no está vivo)
  - `onEvent(evt)` recibe cada objeto JSON del helper

Sigue el patrón de circuit breaker de `main/native-notify.js`: tras `maxRestarts` caídas deja de reintentar, loguea **una sola vez** y marca `broken`. Sin eso, un helper que no arranca (sin Command Line Tools, permiso denegado) entra en bucle de respawn.

- [ ] **Step 1: Escribir el test que falla**

```js
'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceHelperProcess } = require(path.join(REPO_ROOT, 'main', 'voice-helper-process.js'))

function makeFakeProc() {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.killed = false
  proc.written = []
  proc.stdin = { write: (d) => { proc.written.push(d); return true }, end: () => {} }
  proc.kill = () => { proc.killed = true; proc.emit('close', 0) }
  return proc
}

function makeHarness(opts = {}) {
  const spawned = []
  const events = []
  const logs = []
  let current = null
  const helper = createVoiceHelperProcess({
    helperPath: '/fake/voice-helper',
    spawnFn: (bin, args, o) => { spawned.push({ bin, args, o }); current = makeFakeProc(); return current },
    onEvent: (e) => events.push(e),
    log: (m) => logs.push(m),
    maxRestarts: opts.maxRestarts
  })
  return { helper, spawned, events, logs, proc: () => current }
}

describe('voice-helper-process: arranque y parseo', () => {
  test('exige helperPath y spawnFn', () => {
    assert.throws(() => createVoiceHelperProcess({}), /helperPath requerido/)
    assert.throws(() => createVoiceHelperProcess({ helperPath: '/x' }), /spawnFn requerido/)
  })

  test('arranca el binario y queda vivo', () => {
    const h = makeHarness()
    h.helper.start()
    assert.strictEqual(h.spawned.length, 1)
    assert.strictEqual(h.spawned[0].bin, '/fake/voice-helper')
    assert.strictEqual(h.helper.isRunning(), true)
  })

  test('parsea una línea JSON completa', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"hello","pid":1}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'hello', pid: 1 }])
  })

  test('reensambla un evento partido entre dos chunks', () => {
    // El bug clásico de leer stdout: un JSON puede llegar cortado por la mitad.
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"par'))
    h.proc().stdout.emit('data', Buffer.from('tial","text":"hola"}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'partial', text: 'hola' }])
  })

  test('varios eventos en un solo chunk salen en orden', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('{"type":"a"}\n{"type":"b"}\n'))
    assert.deepStrictEqual(h.events.map((e) => e.type), ['a', 'b'])
  })

  test('una línea no-JSON se ignora sin tumbar el parser', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().stdout.emit('data', Buffer.from('basura no json\n{"type":"ok"}\n'))
    assert.deepStrictEqual(h.events, [{ type: 'ok' }])
  })

  test('send escribe una línea JSON', () => {
    const h = makeHarness()
    h.helper.start()
    assert.strictEqual(h.helper.send({ cmd: 'start' }), true)
    assert.deepStrictEqual(h.proc().written, ['{"cmd":"start"}\n'])
  })

  test('send devuelve false si no está vivo', () => {
    const h = makeHarness()
    assert.strictEqual(h.helper.send({ cmd: 'start' }), false)
  })
})

describe('voice-helper-process: caídas', () => {
  test('reinicia si el helper muere solo', () => {
    const h = makeHarness()
    h.helper.start()
    h.proc().emit('close', 1)
    assert.strictEqual(h.spawned.length, 2, 'debe respawnear')
  })

  test('no reinicia tras un stop pedido', () => {
    const h = makeHarness()
    h.helper.start()
    h.helper.stop()
    assert.strictEqual(h.spawned.length, 1)
    assert.strictEqual(h.helper.isRunning(), false)
  })

  test('deja de reintentar tras maxRestarts y avisa una sola vez', () => {
    const h = makeHarness({ maxRestarts: 2 })
    h.helper.start()
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    assert.strictEqual(h.spawned.length, 3, 'arranque + 2 reintentos')
    assert.strictEqual(h.helper.isBroken(), true)
    const avisos = h.logs.filter((m) => /no se pudo mantener|se rinde/i.test(m))
    assert.strictEqual(avisos.length, 1, 'el aviso se emite una vez, no en cada caída')
  })

  test('reset vuelve a permitir arrancar', () => {
    const h = makeHarness({ maxRestarts: 1 })
    h.helper.start()
    h.proc().emit('close', 1)
    h.proc().emit('close', 1)
    assert.strictEqual(h.helper.isBroken(), true)
    h.helper.reset()
    assert.strictEqual(h.helper.isBroken(), false)
    h.helper.start()
    assert.ok(h.spawned.length >= 3)
  })

  test('un spawn que lanza se degrada sin propagar', () => {
    const events = []
    const helper = createVoiceHelperProcess({
      helperPath: '/fake/voice-helper',
      spawnFn: () => { throw new Error('ENOENT') },
      onEvent: (e) => events.push(e)
    })
    assert.doesNotThrow(() => helper.start())
    assert.strictEqual(helper.isRunning(), false)
    assert.ok(events.some((e) => e.type === 'error' && e.fatal === true))
  })
})
```

- [ ] **Step 2: Verlo fallar**

Run: `node --test tests/voice-helper-process.test.js`
Expected: FAIL — `Cannot find module '.../main/voice-helper-process.js'`

- [ ] **Step 3: Implementar**

```js
'use strict'

// Proceso hijo del helper de voz (Swift) y su protocolo NDJSON.
// Es el primer proceso persistente no-PTY del repo: todo lo demás usa
// spawnSync o spawn de un solo tiro. De ahí el cuidado con el reensamblado
// de líneas partidas y con el freno de reintentos.
//
// El freno copia el patrón de main/native-notify.js: si el helper no se
// puede mantener vivo (sin Command Line Tools, permiso denegado), marcamos
// `broken`, avisamos UNA vez y paramos. Sin eso queda un bucle de respawn.

const DEFAULT_MAX_RESTARTS = 3

function createVoiceHelperProcess({
  helperPath,
  spawnFn,
  onEvent,
  log,
  maxRestarts
} = {}) {
  if (!helperPath) throw new Error('voice-helper-process: helperPath requerido')
  if (typeof spawnFn !== 'function') throw new Error('voice-helper-process: spawnFn requerido')

  const emit = typeof onEvent === 'function' ? onEvent : () => {}
  const trace = typeof log === 'function' ? log : () => {}
  const MAX = Number.isFinite(maxRestarts) && maxRestarts >= 0 ? maxRestarts : DEFAULT_MAX_RESTARTS

  let proc = null
  let buffer = ''
  let restarts = 0
  let broken = false
  let stopping = false

  function handleChunk(chunk) {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    // La última puede venir a medias: se queda para el siguiente chunk.
    buffer = lines.pop()
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj = null
      try { obj = JSON.parse(trimmed) } catch { continue }
      if (obj && typeof obj === 'object') emit(obj)
    }
  }

  function onClose(code) {
    proc = null
    buffer = ''
    if (stopping) { stopping = false; return }
    if (restarts >= MAX) {
      if (!broken) {
        broken = true
        trace(`el helper de voz no se pudo mantener vivo tras ${MAX} intentos: se rinde`)
        emit({ type: 'error', message: 'el helper de voz no arranca', fatal: true })
      }
      return
    }
    restarts += 1
    trace(`helper de voz cayó (code ${code}), reintento ${restarts}/${MAX}`)
    start()
  }

  function start() {
    if (broken || proc) return
    try {
      proc = spawnFn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      proc = null
      broken = true
      trace(`no se pudo lanzar el helper de voz: ${err?.message || err}`)
      emit({ type: 'error', message: `no se pudo lanzar el helper de voz: ${err?.message || err}`, fatal: true })
      return
    }
    buffer = ''
    proc.stdout?.on('data', handleChunk)
    proc.stderr?.on('data', (d) => trace(`[helper] ${String(d).trim()}`))
    proc.on('error', (err) => trace(`error del helper: ${err?.message || err}`))
    proc.on('close', onClose)
  }

  function send(obj) {
    if (!proc || !proc.stdin) return false
    try { proc.stdin.write(JSON.stringify(obj) + '\n'); return true }
    catch (err) { trace(`no se pudo escribir al helper: ${err?.message || err}`); return false }
  }

  function stop() {
    if (!proc) return
    stopping = true
    send({ cmd: 'quit' })
    try { proc.kill() } catch {}
    proc = null
  }

  return {
    start,
    send,
    stop,
    isRunning: () => !!proc,
    isBroken: () => broken,
    reset: () => { broken = false; restarts = 0 }
  }
}

module.exports = { createVoiceHelperProcess }
```

- [ ] **Step 4: Verlo pasar**

Run: `node --test tests/voice-helper-process.test.js`
Expected: 14 tests PASS

- [ ] **Step 5: Commit**

```bash
node --check main/voice-helper-process.js
git add main/voice-helper-process.js tests/voice-helper-process.test.js
git commit -m "feat(voz): proceso del helper con reensamblado NDJSON y freno de reintentos"
```

---

### Task 3: Filtro de texto decible

**Files:**
- Create: `main/voice-speakable.js`
- Test: `tests/voice-speakable.test.js`

**Interfaces:**
- Produces: `speakableFromMarkdown(md, { maxChars = 700 } = {})` → `string` (vacío si no queda nada que decir).

Nadie quiere oír 40 líneas de JavaScript leídas por Mónica. Módulo puro, sin dependencias.

- [ ] **Step 1: Escribir el test que falla**

```js
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

  test('quita líneas de diff', () => {
    const md = 'Cambio:\n+ añadido\n- quitado\nHecho.'
    const out = speakableFromMarkdown(md)
    assert.ok(!out.includes('añadido'))
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
})
```

- [ ] **Step 2: Verlo fallar**

Run: `node --test tests/voice-speakable.test.js`
Expected: FAIL — módulo no encontrado

- [ ] **Step 3: Implementar**

```js
'use strict'

// Convierte la respuesta markdown del agente en algo que se pueda escuchar.
// Fuera código, diffs, tablas y URLs: en voz no aportan nada y arruinan el
// turno. Si tras limpiar no queda prosa, devuelve '' y quien llame decide
// (un tono corto en vez de leer basura).

const DEFAULT_MAX_CHARS = 700

function speakableFromMarkdown(md, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (typeof md !== 'string' || !md) return ''

  let out = md

  // Bloques de código: incluido el que se quedó sin cerrar (respuesta cortada).
  out = out.replace(/```[\s\S]*?```/g, ' ')
  out = out.replace(/```[\s\S]*$/g, ' ')

  // Tablas y diffs, línea a línea.
  out = out
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (/^\|.*\|$/.test(t)) return false
      if (/^[+-]\s/.test(t)) return false
      if (/^[|+\-\s:]+$/.test(t) && t.length > 2) return false
      return true
    })
    .join('\n')

  // Enlaces: se queda el texto, se va la URL.
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // Código en línea: se queda el contenido, sin las comillas.
  out = out.replace(/`([^`]*)`/g, '$1')
  // Encabezados, citas y viñetas.
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  out = out.replace(/^\s{0,3}>\s?/gm, '')
  out = out.replace(/^\s*[*+]\s+/gm, '')
  out = out.replace(/^\s*\d+\.\s+/gm, '')
  // Énfasis.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  out = out.replace(/\*([^*]+)\*/g, '$1')
  out = out.replace(/__([^_]+)__/g, '$1')

  // Los saltos de línea se vuelven pausas; el sintetizador respeta el punto.
  out = out.replace(/\n{2,}/g, '. ')
  out = out.replace(/\n/g, '. ')
  out = out.replace(/\s+/g, ' ')
  out = out.replace(/\.\s*\./g, '.')
  out = out.trim()
  out = out.replace(/^[.\s]+/, '').trim()

  if (!out) return ''

  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars)
    const lastSpace = cut.lastIndexOf(' ')
    out = (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }

  return out
}

module.exports = { speakableFromMarkdown, DEFAULT_MAX_CHARS }
```

- [ ] **Step 4: Verlo pasar**

Run: `node --test tests/voice-speakable.test.js`
Expected: 13 tests PASS. Si alguno falla por espacios o puntuación, **ajusta la implementación, no el test**: el contrato es el test.

- [ ] **Step 5: Commit**

```bash
node --check main/voice-speakable.js
git add main/voice-speakable.js tests/voice-speakable.test.js
git commit -m "feat(voz): filtro de markdown a prosa decible"
```

---

### Task 4: Vigía del fin de turno

**Files:**
- Create: `main/voice-turn-watcher.js`
- Test: `tests/voice-turn-watcher.test.js`

**Interfaces:**
- Consumes: de `main/relay-transcript-helpers.js` (factory `createRelayTranscriptHelpers`, ya exportada):
  - `findRelayTranscript({ sessionId, cwds })` → `{ filePath, sessionId, size, mtimeMs } | null`
  - `extractAssistantTextFromTranscript(path, offsetBytes, minTimestampMs, opts)` → `{ text, sawAssistant, sawEndTurn, lastStopReason, turnComplete }`
- Produces: `createVoiceTurnWatcher({ findRelayTranscript, extractAssistantTextFromTranscript, statFn, setIntervalFn, clearIntervalFn, pollMs, timeoutMs })` → `{ watch({ sessionId, cwds, baseOffset, onDone, onTimeout }) }`, donde `watch` devuelve `{ cancel }`.

**Por qué no se reutiliza `relayThroughPty`:** vive inline en `main.js:922`, no se exporta, y arrastra 375 líneas de timeouts, fallbacks de codex y streaming a Telegram. El modo voz solo quiere una cosa: avisar cuando el turno cierre. `turnComplete` (el último evento `assistant` no-sidechain con `stop_reason: 'end_turn'`) ya lo calcula el helper reutilizado.

`TRANSCRIPT_POLL_MS = 300` es el mismo valor que usa el relay de Telegram. `stat` antes de leer: sin eso, un transcript de 14 MB se reparsea tres veces por segundo.

- [ ] **Step 1: Escribir el test que falla**

```js
'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceTurnWatcher } = require(path.join(REPO_ROOT, 'main', 'voice-turn-watcher.js'))

// Reloj de mentira: nada de temporizadores reales en los tests.
function makeClock() {
  let handlers = []
  return {
    setIntervalFn: (fn) => { const h = { fn }; handlers.push(h); return h },
    clearIntervalFn: (h) => { handlers = handlers.filter((x) => x !== h) },
    tick: (n = 1) => { for (let i = 0; i < n; i++) handlers.slice().forEach((h) => h.fn()) },
    count: () => handlers.length
  }
}

function makeHarness(opts = {}) {
  const clock = makeClock()
  let size = opts.initialSize ?? 0
  const extractResults = opts.extractResults ? [...opts.extractResults] : []
  const extractCalls = []
  const watcher = createVoiceTurnWatcher({
    findRelayTranscript: opts.findRelayTranscript || (() => ({ filePath: '/fake/t.jsonl', sessionId: 'sid', size, mtimeMs: 1 })),
    extractAssistantTextFromTranscript: (p, offset) => {
      extractCalls.push({ p, offset })
      return extractResults.shift() || { text: '', sawAssistant: false, sawEndTurn: false, lastStopReason: null, turnComplete: false }
    },
    statFn: () => ({ size }),
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    pollMs: 300,
    timeoutMs: opts.timeoutMs ?? 180000
  })
  return { watcher, clock, extractCalls, setSize: (n) => { size = n } }
}

describe('voice-turn-watcher', () => {
  test('exige sus dos dependencias', () => {
    assert.throws(() => createVoiceTurnWatcher({}), /findRelayTranscript requerido/)
    assert.throws(() => createVoiceTurnWatcher({ findRelayTranscript: () => null }), /extractAssistantTextFromTranscript requerido/)
  })

  test('avisa con el texto cuando el turno cierra', () => {
    const h = makeHarness({
      extractResults: [{ text: 'Ya está arreglado.', sawAssistant: true, sawEndTurn: true, lastStopReason: 'end_turn', turnComplete: true }]
    })
    let done = null
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: (r) => { done = r } })
    h.setSize(100)
    h.clock.tick()
    assert.ok(done)
    assert.strictEqual(done.text, 'Ya está arreglado.')
  })

  test('no avisa mientras el turno sigue vivo', () => {
    // Con tool_use por medio puede haber un end_turn suelto sin que el turno acabe.
    const h = makeHarness({
      extractResults: [{ text: 'voy a mirar', sawAssistant: true, sawEndTurn: true, lastStopReason: 'tool_use', turnComplete: false }]
    })
    let done = null
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: (r) => { done = r } })
    h.setSize(100)
    h.clock.tick()
    assert.strictEqual(done, null, 'turnComplete false no debe cerrar el turno')
  })

  test('no lee el fichero si no ha crecido', () => {
    const h = makeHarness({ initialSize: 50 })
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 50, onDone: () => {} })
    h.clock.tick(3)
    assert.strictEqual(h.extractCalls.length, 0, 'sin crecimiento no se parsea: un transcript de 14MB no se relee 3 veces por segundo')
  })

  test('lee desde el offset dado', () => {
    const h = makeHarness({
      extractResults: [{ text: 'hola', sawAssistant: true, sawEndTurn: true, lastStopReason: 'end_turn', turnComplete: true }]
    })
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 4096, onDone: () => {} })
    h.setSize(9000)
    h.clock.tick()
    assert.strictEqual(h.extractCalls[0].offset, 4096)
  })

  test('para el temporizador al cerrar el turno', () => {
    const h = makeHarness({
      extractResults: [{ text: 'listo', sawAssistant: true, sawEndTurn: true, lastStopReason: 'end_turn', turnComplete: true }]
    })
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: () => {} })
    h.setSize(10)
    h.clock.tick()
    assert.strictEqual(h.clock.count(), 0, 'no debe quedar ningún interval vivo')
  })

  test('cancel para el vigía y no llama a onDone', () => {
    const h = makeHarness({
      extractResults: [{ text: 'x', sawAssistant: true, sawEndTurn: true, lastStopReason: 'end_turn', turnComplete: true }]
    })
    let done = null
    const handle = h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: (r) => { done = r } })
    handle.cancel()
    h.setSize(100)
    h.clock.tick()
    assert.strictEqual(done, null)
    assert.strictEqual(h.clock.count(), 0)
  })

  test('avisa por timeout y deja de vigilar', () => {
    const h = makeHarness({ timeoutMs: 900 })
    let timedOut = false
    h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: () => {}, onTimeout: () => { timedOut = true } })
    h.clock.tick(4)   // 4 × 300 ms > 900 ms
    assert.strictEqual(timedOut, true)
    assert.strictEqual(h.clock.count(), 0)
  })

  test('sin transcript localizable avisa por timeout, no revienta', () => {
    const h = makeHarness({ findRelayTranscript: () => null, timeoutMs: 600 })
    let timedOut = false
    assert.doesNotThrow(() => {
      h.watcher.watch({ sessionId: 'sid', cwds: ['/p'], baseOffset: 0, onDone: () => {}, onTimeout: () => { timedOut = true } })
      h.clock.tick(3)
    })
    assert.strictEqual(timedOut, true)
  })

  test('un stat que lanza no tumba el vigía', () => {
    const watcher = createVoiceTurnWatcher({
      findRelayTranscript: () => ({ filePath: '/x', sessionId: 's', size: 0, mtimeMs: 0 }),
      extractAssistantTextFromTranscript: () => ({ turnComplete: false }),
      statFn: () => { throw new Error('ENOENT') },
      setIntervalFn: (fn) => ({ fn }),
      clearIntervalFn: () => {},
      pollMs: 300
    })
    const handle = watcher.watch({ sessionId: 's', cwds: [], baseOffset: 0, onDone: () => {} })
    assert.ok(handle && typeof handle.cancel === 'function')
  })
})
```

- [ ] **Step 2: Verlo fallar**

Run: `node --test tests/voice-turn-watcher.test.js`
Expected: FAIL — módulo no encontrado

- [ ] **Step 3: Implementar**

```js
'use strict'

// Vigila el transcript de una sesión claude hasta que el turno cierra de
// verdad, y devuelve el texto para leerlo en voz.
//
// Reutiliza main/relay-transcript-helpers.js, que ya resuelve lo difícil:
// localizar el .jsonl por sessionId (NO por cwd: una sesión resumida escribe
// en su proyecto original aunque corra en el worktree) y calcular
// `turnComplete` = el ÚLTIMO evento assistant no-sidechain cierra con
// stop_reason 'end_turn'. `sawEndTurn` a secas no vale: con tool_use por
// medio puede ser cierto mientras el turno sigue vivo.
//
// No se usa relayThroughPty porque vive inline en main.js, no se exporta y
// arrastra el streaming a Telegram y las rutas de codex.

const DEFAULT_POLL_MS = 300
const DEFAULT_TIMEOUT_MS = 180000

function createVoiceTurnWatcher({
  findRelayTranscript,
  extractAssistantTextFromTranscript,
  statFn,
  setIntervalFn,
  clearIntervalFn,
  pollMs,
  timeoutMs
} = {}) {
  if (typeof findRelayTranscript !== 'function') throw new Error('voice-turn-watcher: findRelayTranscript requerido')
  if (typeof extractAssistantTextFromTranscript !== 'function') throw new Error('voice-turn-watcher: extractAssistantTextFromTranscript requerido')

  const stat = typeof statFn === 'function' ? statFn : (p) => require('fs').statSync(p)
  const setIv = typeof setIntervalFn === 'function' ? setIntervalFn : setInterval
  const clearIv = typeof clearIntervalFn === 'function' ? clearIntervalFn : clearInterval
  const POLL = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : DEFAULT_POLL_MS
  const TIMEOUT = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS

  function watch({ sessionId, cwds = [], baseOffset = 0, onDone, onTimeout } = {}) {
    const done = typeof onDone === 'function' ? onDone : () => {}
    const timedOut = typeof onTimeout === 'function' ? onTimeout : () => {}

    let cancelled = false
    let elapsed = 0
    let lastSize = baseOffset
    let handle = null

    function stopWatching() {
      if (handle !== null) { try { clearIv(handle) } catch {} ; handle = null }
    }

    function poll() {
      if (cancelled) { stopWatching(); return }

      elapsed += POLL
      if (elapsed >= TIMEOUT) { stopWatching(); timedOut(); return }

      let transcript = null
      try { transcript = findRelayTranscript({ sessionId, cwds }) } catch { transcript = null }
      if (!transcript || !transcript.filePath) return

      let size = 0
      try { size = stat(transcript.filePath)?.size || 0 } catch { return }
      // stat antes de parsear: sin esto, un transcript grande se relee entero
      // varias veces por segundo.
      if (size <= lastSize) return
      lastSize = size

      let result = null
      try { result = extractAssistantTextFromTranscript(transcript.filePath, baseOffset, 0, {}) } catch { return }
      if (!result || !result.turnComplete) return

      stopWatching()
      done({ text: result.text || '', sessionId: transcript.sessionId || sessionId, filePath: transcript.filePath })
    }

    handle = setIv(poll, POLL)
    return { cancel: () => { cancelled = true; stopWatching() } }
  }

  return { watch }
}

module.exports = { createVoiceTurnWatcher, DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MS }
```

- [ ] **Step 4: Verlo pasar**

Run: `node --test tests/voice-turn-watcher.test.js`
Expected: 10 tests PASS

- [ ] **Step 5: Commit**

```bash
node --check main/voice-turn-watcher.js
git add main/voice-turn-watcher.js tests/voice-turn-watcher.test.js
git commit -m "feat(voz): vigía de fin de turno sobre el transcript"
```

---

### Task 5: Router de charla vs encargo

**Files:**
- Create: `main/voice-router.js`
- Test: `tests/voice-router.test.js`

**Interfaces:**
- Produces:
  - `routeVoiceText(text, { forcedMode = null } = {})` → `{ mode: 'charla' | 'encargo', reason: string }`
  - `resolveVoiceTarget(session, { subchatHas } = {})` → `{ ok: true, target: 'subchat' | 'madre', reuseSubchat: boolean } | { ok: false, reason: string }`

Detección por patrones, no por clasificador: un clasificador metería un turno de LLM y su latencia en **cada frase**. El toggle manual siempre gana.

- [ ] **Step 1: Escribir el test que falla**

```js
'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { routeVoiceText, resolveVoiceTarget } = require(path.join(REPO_ROOT, 'main', 'voice-router.js'))

describe('voice-router: intención', () => {
  test('por defecto, charla', () => {
    assert.strictEqual(routeVoiceText('¿por qué falla el relay de Telegram?').mode, 'charla')
    assert.strictEqual(routeVoiceText('explícame cómo va el aislamiento por worktree').mode, 'charla')
  })

  test('los imperativos de ejecución son encargo', () => {
    for (const frase of [
      'hazlo',
      'aplícalo',
      'arréglalo',
      'cámbialo',
      'ejecuta los tests',
      'commitea eso',
      'hazlo ya por favor',
      'venga, aplica el cambio'
    ]) {
      assert.strictEqual(routeVoiceText(frase).mode, 'encargo', `"${frase}" debería ser encargo`)
    }
  })

  test('no confunde una pregunta sobre hacer algo con la orden de hacerlo', () => {
    assert.strictEqual(routeVoiceText('¿cómo lo harías?').mode, 'charla')
    assert.strictEqual(routeVoiceText('¿qué pasa si lo aplico?').mode, 'charla')
    assert.strictEqual(routeVoiceText('¿deberíamos arreglarlo?').mode, 'charla')
  })

  test('funciona sin acentos: el dictado no siempre los pone', () => {
    assert.strictEqual(routeVoiceText('arreglalo').mode, 'encargo')
    assert.strictEqual(routeVoiceText('aplicalo').mode, 'encargo')
  })

  test('el modo forzado manda sobre la detección', () => {
    assert.strictEqual(routeVoiceText('hazlo', { forcedMode: 'charla' }).mode, 'charla')
    assert.strictEqual(routeVoiceText('¿qué opinas?', { forcedMode: 'encargo' }).mode, 'encargo')
    assert.strictEqual(routeVoiceText('hazlo', { forcedMode: 'charla' }).reason, 'forzado')
  })

  test('un modo forzado inválido se ignora', () => {
    assert.strictEqual(routeVoiceText('hazlo', { forcedMode: 'inventado' }).mode, 'encargo')
  })

  test('texto vacío o basura cae en charla sin reventar', () => {
    assert.strictEqual(routeVoiceText('').mode, 'charla')
    assert.strictEqual(routeVoiceText(null).mode, 'charla')
    assert.strictEqual(routeVoiceText(undefined).mode, 'charla')
    assert.strictEqual(routeVoiceText(42).mode, 'charla')
  })

  test('siempre devuelve un motivo legible', () => {
    assert.ok(routeVoiceText('hazlo').reason.length > 0)
    assert.ok(routeVoiceText('¿qué tal?').reason.length > 0)
  })
})

describe('voice-router: destino', () => {
  const sesionViva = { activeCli: 'claude', claudeSessionId: 'sid-1', pty: {}, wcId: 7 }

  test('con sesión viva, la charla va al sub-chat', () => {
    const r = resolveVoiceTarget(sesionViva, { subchatHas: false })
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.target, 'subchat')
    assert.strictEqual(r.reuseSubchat, false)
  })

  test('si ya hay sub-chat abierto, se reutiliza, no se abre otro', () => {
    const r = resolveVoiceTarget(sesionViva, { subchatHas: true })
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.reuseSubchat, true)
  })

  test('sin sesión, no arranca', () => {
    const r = resolveVoiceTarget(null, {})
    assert.strictEqual(r.ok, false)
    assert.ok(/sesión/i.test(r.reason))
  })

  test('sin PTY vivo, no arranca', () => {
    const r = resolveVoiceTarget({ activeCli: 'claude', claudeSessionId: 'x', pty: null }, {})
    assert.strictEqual(r.ok, false)
  })

  test('codex no está soportado y lo dice', () => {
    const r = resolveVoiceTarget({ activeCli: 'codex', claudeSessionId: 'x', pty: {} }, {})
    assert.strictEqual(r.ok, false)
    assert.ok(/codex/i.test(r.reason))
  })

  test('sin sessionId todavía, no hay fork posible', () => {
    // El claudeSessionId no existe hasta el primer turno.
    const r = resolveVoiceTarget({ activeCli: 'claude', claudeSessionId: null, pty: {} }, {})
    assert.strictEqual(r.ok, false)
    assert.ok(/turno|sesión/i.test(r.reason))
  })
})
```

- [ ] **Step 2: Verlo fallar**

Run: `node --test tests/voice-router.test.js`
Expected: FAIL — módulo no encontrado

- [ ] **Step 3: Implementar**

```js
'use strict'

// Decide a dónde va lo que dices: charla lateral (sub-chat forkeado) o
// encargo a la sesión de trabajo.
//
// Patrones, no clasificador: un clasificador metería un turno de LLM y su
// latencia en CADA frase. Se equivoca alguna vez, y para eso está el toggle
// manual, que siempre gana.

const PATRONES_ENCARGO = [
  /\bhaz(lo|lo ya)?\b/i,
  /\bhazme\b/i,
  /\baplica(lo|r)?\b/i,
  /\baplícalo\b/i,
  /\barregla(lo|r)?\b/i,
  /\barréglalo\b/i,
  /\bcambia(lo)?\b/i,
  /\bcámbialo\b/i,
  /\bejecuta\b/i,
  /\bcorre los tests?\b/i,
  /\bcommitea\b/i,
  /\bcommit\b/i,
  /\bimplementa(lo)?\b/i,
  /\bescribe(lo)?\b/i,
  /\bbórra(lo)?\b/i,
  /\bborra(lo)?\b/i,
  /\badelante\b/i,
  /\bdale\b/i
]

// Si la frase es una pregunta sobre hacer algo, no es la orden de hacerlo.
const PATRONES_PREGUNTA = [
  /^\s*¿/,
  /\?\s*$/,
  /\b(cómo|como|qué|que|por qué|porque|cuál|cual|deberíamos|deberias|debería|crees|opinas|piensas|merece la pena)\b/i
]

function routeVoiceText(text, { forcedMode = null } = {}) {
  if (forcedMode === 'charla' || forcedMode === 'encargo') {
    return { mode: forcedMode, reason: 'forzado' }
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { mode: 'charla', reason: 'sin texto' }
  }

  const t = text.trim()
  const pareceOrden = PATRONES_ENCARGO.some((re) => re.test(t))
  if (!pareceOrden) return { mode: 'charla', reason: 'sin verbo de ejecución' }

  const parecePregunta = PATRONES_PREGUNTA.some((re) => re.test(t))
  if (parecePregunta) return { mode: 'charla', reason: 'es una pregunta sobre hacerlo, no la orden' }

  return { mode: 'encargo', reason: 'verbo de ejecución' }
}

function resolveVoiceTarget(session, { subchatHas = false } = {}) {
  if (!session) return { ok: false, reason: 'no hay ninguna sesión abierta' }
  if (session.activeCli !== 'claude') return { ok: false, reason: 'el modo voz solo funciona con claude, no con codex' }
  if (!session.pty) return { ok: false, reason: 'la sesión no tiene un proceso vivo' }
  if (!session.claudeSessionId) return { ok: false, reason: 'la sesión aún no ha completado su primer turno' }

  return { ok: true, target: 'subchat', reuseSubchat: !!subchatHas }
}

module.exports = { routeVoiceText, resolveVoiceTarget }
```

- [ ] **Step 4: Verlo pasar**

Run: `node --test tests/voice-router.test.js`
Expected: 14 tests PASS

- [ ] **Step 5: Commit**

```bash
node --check main/voice-router.js
git add main/voice-router.js tests/voice-router.test.js
git commit -m "feat(voz): router de charla y encargo"
```

---

### Task 6: Máquina de estados

**Files:**
- Create: `main/voice-session.js`
- Test: `tests/voice-session.test.js`

**Interfaces:**
- Consumes: `createVoiceHelperProcess` (Task 2), `speakableFromMarkdown` (Task 3), `createVoiceTurnWatcher` (Task 4), `routeVoiceText` (Task 5).
- Produces: `createVoiceSession({ helper, speakable, watcher, router, sendToTarget, getSession, notifyRenderer, log })` → `{ enable, disable, handleHelperEvent, setForcedMode, getState, isEnabled }`

Estados: `idle → listening → thinking → speaking → listening`. **Mientras piensa o habla, el micro se cierra** (`stop`), y se reabre al terminar. Un micro abierto durante el turno capta la propia respuesta y ruido.

- [ ] **Step 1: Escribir el test que falla**

```js
'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const { createVoiceSession } = require(path.join(REPO_ROOT, 'main', 'voice-session.js'))

function makeHarness(opts = {}) {
  const sent = []
  const helperCmds = []
  const renderer = []
  let watchHandle = null
  let onDoneCb = null

  const session = createVoiceSession({
    helper: {
      start: () => helperCmds.push({ cmd: '__start__' }),
      send: (c) => { helperCmds.push(c); return true },
      stop: () => helperCmds.push({ cmd: '__stop__' }),
      isRunning: () => true,
      isBroken: () => false
    },
    speakable: (md) => (opts.speakable ? opts.speakable(md) : md),
    watcher: {
      watch: ({ onDone }) => { onDoneCb = onDone; watchHandle = { cancel: () => { watchHandle = null } }; return watchHandle }
    },
    router: opts.router || { routeVoiceText: () => ({ mode: 'charla', reason: 'test' }), resolveVoiceTarget: () => ({ ok: true, target: 'subchat', reuseSubchat: false }) },
    sendToTarget: async (payload) => { sent.push(payload); return { ok: true, sessionId: 'sid', cwds: ['/p'], baseOffset: 0 } },
    getSession: () => opts.session || { activeCli: 'claude', claudeSessionId: 'sid', pty: {}, wcId: 1 },
    notifyRenderer: (e) => renderer.push(e),
    log: () => {}
  })

  return { session, sent, helperCmds, renderer, fireDone: (r) => onDoneCb && onDoneCb(r), hasWatch: () => !!watchHandle }
}

describe('voice-session: ciclo básico', () => {
  test('empieza apagada', () => {
    const h = makeHarness()
    assert.strictEqual(h.session.getState(), 'idle')
    assert.strictEqual(h.session.isEnabled(), false)
  })

  test('al activarse arranca el helper y escucha', () => {
    const h = makeHarness()
    h.session.enable()
    assert.strictEqual(h.session.isEnabled(), true)
    assert.ok(h.helperCmds.some((c) => c.cmd === 'start'))
    h.session.handleHelperEvent({ type: 'listening' })
    assert.strictEqual(h.session.getState(), 'listening')
  })

  test('no arranca si no hay sesión válida', () => {
    const h = makeHarness({ session: null, router: {
      routeVoiceText: () => ({ mode: 'charla', reason: '' }),
      resolveVoiceTarget: () => ({ ok: false, reason: 'no hay ninguna sesión abierta' })
    } })
    const r = h.session.enable()
    assert.strictEqual(r.ok, false)
    assert.strictEqual(h.session.isEnabled(), false)
    assert.ok(h.renderer.some((e) => e.type === 'error' && /sesión/i.test(e.message)))
  })

  test('un final manda el texto al destino y pasa a pensar', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'qué tal va el relay' })
    assert.strictEqual(h.sent.length, 1)
    assert.strictEqual(h.sent[0].text, 'qué tal va el relay')
    assert.strictEqual(h.session.getState(), 'thinking')
  })

  test('cierra el micro mientras piensa', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.ok(h.helperCmds.some((c) => c.cmd === 'stop'), 'el micro debe cerrarse: si no, capta su propia respuesta')
  })

  test('al cerrar el turno lo lee y vuelve a escuchar', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: 'Todo bien.', sessionId: 'sid' })
    const speak = h.helperCmds.find((c) => c.cmd === 'speak')
    assert.ok(speak)
    assert.strictEqual(speak.text, 'Todo bien.')
    assert.strictEqual(h.session.getState(), 'speaking')
    h.session.handleHelperEvent({ type: 'speech-end', id: speak.id })
    assert.ok(h.helperCmds.filter((c) => c.cmd === 'start').length >= 2, 'debe volver a escuchar')
  })

  test('si no queda nada decible no habla, pero vuelve a escuchar', async () => {
    const h = makeHarness({ speakable: () => '' })
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    h.fireDone({ text: '```js\nconst x = 1\n```', sessionId: 'sid' })
    assert.ok(!h.helperCmds.some((c) => c.cmd === 'speak'), 'no debe leer un bloque de código')
    assert.ok(h.helperCmds.filter((c) => c.cmd === 'start').length >= 2)
  })

  test('un final vacío se ignora', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'empty' })
    assert.strictEqual(h.sent.length, 0)
  })

  test('ignora un final que llega mientras piensa', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'uno' })
    await h.session.handleHelperEvent({ type: 'final', text: 'dos' })
    assert.strictEqual(h.sent.length, 1, 'un turno cada vez')
  })
})

describe('voice-session: interrupción y apagado', () => {
  test('hablarle encima la calla y reabre el micro', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'speech-start', id: 'a' })
    h.session.handleHelperEvent({ type: 'user-interrupt' })
    assert.strictEqual(h.session.getState(), 'listening')
  })

  test('al apagarse para el helper y cancela el vigía', async () => {
    const h = makeHarness()
    h.session.enable()
    await h.session.handleHelperEvent({ type: 'final', text: 'hola' })
    assert.strictEqual(h.hasWatch(), true)
    h.session.disable()
    assert.strictEqual(h.session.isEnabled(), false)
    assert.strictEqual(h.session.getState(), 'idle')
    assert.strictEqual(h.hasWatch(), false, 'el vigía debe cancelarse: si no, sigue vivo tras apagar')
  })

  test('un error fatal del helper apaga el modo voz y avisa', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'error', message: 'el helper de voz no arranca', fatal: true })
    assert.strictEqual(h.session.isEnabled(), false)
    assert.ok(h.renderer.some((e) => e.type === 'error'))
  })

  test('los parciales llegan al renderer', () => {
    const h = makeHarness()
    h.session.enable()
    h.session.handleHelperEvent({ type: 'partial', text: 'arre' })
    assert.ok(h.renderer.some((e) => e.type === 'partial' && e.text === 'arre'))
  })

  test('setForcedMode se respeta al enrutar', async () => {
    const rutas = []
    const h = makeHarness({ router: {
      routeVoiceText: (t, o) => { rutas.push(o); return { mode: 'encargo', reason: 'forzado' } },
      resolveVoiceTarget: () => ({ ok: true, target: 'subchat', reuseSubchat: false })
    } })
    h.session.enable()
    h.session.setForcedMode('encargo')
    await h.session.handleHelperEvent({ type: 'final', text: 'lo que sea' })
    assert.strictEqual(rutas[0].forcedMode, 'encargo')
  })
})
```

- [ ] **Step 2: Verlo fallar**

Run: `node --test tests/voice-session.test.js`
Expected: FAIL — módulo no encontrado

- [ ] **Step 3: Implementar**

```js
'use strict'

// Máquina de estados del modo voz: idle → listening → thinking → speaking.
//
// Regla dura: mientras piensa o habla, el micro se CIERRA. Aunque la
// cancelación de eco funciona (medido), dejarlo abierto durante el turno
// captaría ruido de fondo y dispararía turnos falsos. Se reabre al acabar.

const VALID_STATES = ['idle', 'listening', 'thinking', 'speaking']

function createVoiceSession({
  helper,
  speakable,
  watcher,
  router,
  sendToTarget,
  getSession,
  notifyRenderer,
  log
} = {}) {
  if (!helper || typeof helper.send !== 'function') throw new Error('voice-session: helper requerido')
  if (typeof speakable !== 'function') throw new Error('voice-session: speakable requerido')
  if (!watcher || typeof watcher.watch !== 'function') throw new Error('voice-session: watcher requerido')
  if (!router || typeof router.routeVoiceText !== 'function') throw new Error('voice-session: router requerido')
  if (typeof sendToTarget !== 'function') throw new Error('voice-session: sendToTarget requerido')

  const notify = typeof notifyRenderer === 'function' ? notifyRenderer : () => {}
  const trace = typeof log === 'function' ? log : () => {}
  const getSess = typeof getSession === 'function' ? getSession : () => null

  let enabled = false
  let state = 'idle'
  let forcedMode = null
  let watchHandle = null
  let speakSeq = 0

  function setState(next) {
    if (!VALID_STATES.includes(next)) return
    state = next
    notify({ type: 'state', state })
  }

  function listen() {
    if (!enabled) return
    setState('listening')
    helper.send({ cmd: 'start' })
  }

  function cancelWatch() {
    if (watchHandle) { try { watchHandle.cancel() } catch {} ; watchHandle = null }
  }

  function enable() {
    if (enabled) return { ok: true }
    const target = router.resolveVoiceTarget(getSess(), {})
    if (!target.ok) {
      notify({ type: 'error', message: target.reason })
      return { ok: false, reason: target.reason }
    }
    enabled = true
    if (typeof helper.start === 'function') helper.start()
    listen()
    return { ok: true }
  }

  function disable() {
    enabled = false
    cancelWatch()
    helper.send({ cmd: 'stop' })
    if (typeof helper.stop === 'function') helper.stop()
    setState('idle')
  }

  async function onFinal(text) {
    // Un turno cada vez: lo que llegue mientras piensa o habla se descarta.
    if (!enabled || state !== 'listening') return
    const clean = String(text || '').trim()
    if (!clean) return

    const decision = router.routeVoiceText(clean, { forcedMode })
    notify({ type: 'heard', text: clean, mode: decision.mode, reason: decision.reason })

    setState('thinking')
    helper.send({ cmd: 'stop' })

    let res = null
    try { res = await sendToTarget({ text: clean, mode: decision.mode }) }
    catch (err) {
      trace(`no se pudo enviar el turno: ${err?.message || err}`)
      notify({ type: 'error', message: `no se pudo enviar: ${err?.message || err}` })
      listen(); return
    }
    if (!res || !res.ok) {
      notify({ type: 'error', message: res?.reason || 'no se pudo enviar el turno' })
      listen(); return
    }

    cancelWatch()
    watchHandle = watcher.watch({
      sessionId: res.sessionId,
      cwds: res.cwds || [],
      baseOffset: res.baseOffset || 0,
      onDone: (r) => { watchHandle = null; onTurnDone(r) },
      onTimeout: () => {
        watchHandle = null
        notify({ type: 'error', message: 'el turno tardó demasiado' })
        listen()
      }
    })
  }

  function onTurnDone(result) {
    if (!enabled) return
    const texto = speakable(result?.text || '')
    if (!texto) {
      // Solo había código o diffs: no se lee nada, se vuelve a escuchar.
      notify({ type: 'nothing-to-say' })
      listen(); return
    }
    speakSeq += 1
    const id = `s${speakSeq}`
    setState('speaking')
    notify({ type: 'saying', text: texto })
    helper.send({ cmd: 'speak', id, text: texto })
  }

  function handleHelperEvent(evt) {
    if (!evt || typeof evt !== 'object') return
    switch (evt.type) {
      case 'listening':
        if (enabled && state !== 'thinking' && state !== 'speaking') setState('listening')
        return
      case 'partial':
        notify({ type: 'partial', text: evt.text })
        return
      case 'final':
        return onFinal(evt.text)
      case 'empty':
        if (enabled && state === 'listening') listen()
        return
      case 'speech-end':
        if (enabled) listen()
        return
      case 'user-interrupt':
        // Le hablas encima: se calla y te escucha.
        if (enabled) listen()
        return
      case 'error':
        notify({ type: 'error', message: evt.message })
        if (evt.fatal) { enabled = false; cancelWatch(); setState('idle') }
        return
      case 'warn':
        notify({ type: 'warn', message: evt.message })
        return
      default:
        return
    }
  }

  return {
    enable,
    disable,
    handleHelperEvent,
    setForcedMode: (m) => { forcedMode = (m === 'charla' || m === 'encargo') ? m : null },
    getState: () => state,
    isEnabled: () => enabled
  }
}

module.exports = { createVoiceSession }
```

- [ ] **Step 4: Verlo pasar**

Run: `node --test tests/voice-session.test.js`
Expected: 14 tests PASS

- [ ] **Step 5: Commit**

```bash
node --check main/voice-session.js
git add main/voice-session.js tests/voice-session.test.js
git commit -m "feat(voz): máquina de estados del modo voz"
```

---

### Task 7: Cableado en `main.js`

**Files:**
- Modify: `main.js` (requires arriba; instanciación junto a `subchatManager` ~línea 1362; handlers IPC junto a los de `subchat:` ~línea 3356; `SAFE_CLI` línea 3738)

**Interfaces:**
- Consumes: todos los módulos anteriores.
- Produces: canales IPC `voice:enable`, `voice:disable`, `voice:set-mode`, `voice:state`, y el evento `voice:event` hacia el renderer.

**Ruta del binario** — patrón nuevo en el repo (hoy no se usa `process.resourcesPath` en ninguna parte):

```js
const VOICE_HELPER_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'voice-helper')
  : path.join(__dirname, 'resources', 'voice-helper')
```

- [ ] **Step 1: Requires (junto al de subchat, línea 67)**

```js
const { createVoiceHelperProcess } = require('./main/voice-helper-process')
const { createVoiceTurnWatcher } = require('./main/voice-turn-watcher')
const { createVoiceSession } = require('./main/voice-session')
const { speakableFromMarkdown } = require('./main/voice-speakable')
const voiceRouter = require('./main/voice-router')
```

- [ ] **Step 2: Instanciación (tras `subchatManager`, ~línea 1370)**

```js
// ── Modo voz (ver docs/superpowers/specs/2026-08-04-voz-en-directo-design.md) ──
const VOICE_HELPER_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'voice-helper')
  : path.join(__dirname, 'resources', 'voice-helper')

let voiceOwnerWcId = null   // el modo voz es de una ventana cada vez: el micro es único

const voiceHelper = createVoiceHelperProcess({
  helperPath: VOICE_HELPER_PATH,
  spawnFn: (bin, args, opts) => spawn(bin, args, opts),
  onEvent: (evt) => { try { voiceSession.handleHelperEvent(evt) } catch (err) { console.warn('[voz]', err?.message || err) } },
  log: (m) => console.log('[voz]', m)
})

const voiceWatcher = createVoiceTurnWatcher({
  findRelayTranscript,
  extractAssistantTextFromTranscript,
  statFn: (p) => safeStat(p)
})

const voiceSession = createVoiceSession({
  helper: voiceHelper,
  speakable: speakableFromMarkdown,
  watcher: voiceWatcher,
  router: voiceRouter,
  getSession: () => (voiceOwnerWcId != null ? sessions.get(voiceOwnerWcId) || null : null),
  sendToTarget: async ({ text, mode }) => {
    const session = voiceOwnerWcId != null ? sessions.get(voiceOwnerWcId) : null
    if (!session) return { ok: false, reason: 'la ventana del modo voz ya no existe' }

    const cwds = relayCwdCandidates(session)

    if (mode === 'encargo') {
      if (!session.pty) return { ok: false, reason: 'la sesión no tiene proceso vivo' }
      const before = safeStat(findRelayTranscript({ sessionId: session.claudeSessionId, cwds })?.filePath || '')?.size || 0
      session.pty.write(text + '\r')
      return { ok: true, sessionId: session.claudeSessionId, cwds, baseOffset: before }
    }

    // Charla: sub-chat forkeado. Si ya hay uno abierto, se reutiliza.
    //
    // TRAMPA: `--fork-session` crea un sessionId NUEVO. El .jsonl de la madre
    // no crece jamás con lo que se hable en el sub-chat, así que vigilar
    // `session.claudeSessionId` deja al relay esperando para siempre. Es la
    // misma trampa que el `--resume` interactivo (CLAUDE.md § Relay de
    // Telegram). Se resuelve con el par snapshot → findUpdatedOrNewClaudeSessionId,
    // que ya existe y está testeado.
    if (!subchatManager.has(session.wcId)) {
      const started = subchatManager.start(session, { cols: 100, rows: 30 })
      if (!started.ok) return { ok: false, reason: started.error || 'no se pudo abrir el sub-chat' }
      await new Promise((r) => setTimeout(r, 1200))   // el fork tarda en tener transcript
    }

    // OJO con las firmas reales (verificadas en main/relay-transcript-helpers.js):
    // snapshotClaudeSessions(cwd) toma UN cwd, no un array, y
    // findUpdatedOrNewClaudeSessionId(cwd, snapshot) solo acepta dos argumentos:
    // no sabe excluir a la madre, así que hay que descartarla aquí a mano o
    // acabas vigilando el transcript equivocado.
    const snapshots = new Map(cwds.map((c) => [c, snapshotClaudeSessions(c)]))
    subchatManager.write(session.wcId, text + '\r')

    // El fork tarda en aparecer en disco: se sondea hasta 3 s.
    let forkSessionId = session.voiceSubchatSessionId || null
    if (!forkSessionId) {
      for (let i = 0; i < 15 && !forkSessionId; i++) {
        await new Promise((r) => setTimeout(r, 200))
        for (const cwd of cwds) {
          const found = findUpdatedOrNewClaudeSessionId(cwd, snapshots.get(cwd))
          if (found && found !== session.claudeSessionId) { forkSessionId = found; break }
        }
      }
      // Se recuerda: a partir de aquí el sub-chat siempre escribe en el mismo.
      if (forkSessionId) session.voiceSubchatSessionId = forkSessionId
    }
    if (!forkSessionId) return { ok: false, reason: 'no se encontró el transcript del sub-chat' }

    const forkPath = findRelayTranscript({ sessionId: forkSessionId, cwds })?.filePath || ''
    const baseOffset = forkPath ? (safeStat(forkPath)?.size || 0) : 0
    return { ok: true, sessionId: forkSessionId, cwds, baseOffset }
  },
  notifyRenderer: (evt) => {
    const session = voiceOwnerWcId != null ? sessions.get(voiceOwnerWcId) : null
    try {
      if (session?.win && !session.win.isDestroyed?.()) session.win.webContents.send('voice:event', evt)
    } catch {}
  },
  log: (m) => console.log('[voz]', m)
})
```

- [ ] **Step 3: Handlers IPC (junto a los de `subchat:`, ~línea 3381)**

```js
ipcMain.handle('voice:enable', (event) => {
  const session = getSessionByEvent(event)
  if (!session) return { ok: false, reason: 'sin sesión' }
  if (voiceOwnerWcId != null && voiceOwnerWcId !== session.wcId) {
    return { ok: false, reason: 'el modo voz ya está activo en otra ventana' }
  }
  voiceOwnerWcId = session.wcId
  const res = voiceSession.enable()
  if (!res.ok) voiceOwnerWcId = null
  return res
})

ipcMain.handle('voice:disable', () => {
  voiceSession.disable()
  voiceOwnerWcId = null
  return { ok: true }
})

ipcMain.handle('voice:set-mode', (event, { mode } = {}) => {
  voiceSession.setForcedMode(mode)
  return { ok: true, mode }
})

ipcMain.handle('voice:state', () => ({
  enabled: voiceSession.isEnabled(),
  state: voiceSession.getState(),
  broken: voiceHelper.isBroken()
}))
```

- [ ] **Step 4: Apagado y limpieza**

Junto a `subchatManager.closeAll()` (~línea 3199):
```js
try { voiceSession.disable() } catch {}
```

Donde `subchatManager.close(s.wcId, 'parent-pty-closed')` (líneas ~1572 y ~1595), añadir:
```js
if (voiceOwnerWcId === s.wcId) { try { voiceSession.disable() } catch {} ; voiceOwnerWcId = null }
s.voiceSubchatSessionId = null   // al morir el sub-chat, su sessionId ya no vale
```

Y en el handler `ipcMain.handle('subchat:close', ...)` (~línea 3376), tras cerrar:
```js
const s = getSessionByEvent(event)
if (s) s.voiceSubchatSessionId = null
```

Sin esto, cerrar el sub-chat y volver a abrirlo deja el modo voz vigilando el transcript del fork viejo, que ya no crece: el turno nunca cierra y muere por timeout a los 3 minutos.

- [ ] **Step 5: `SAFE_CLI` (línea 3738)**

```js
const SAFE_CLI = ['defaultCli', 'claudeBin', 'codexBin', 'whisperBin', 'claudeModel', 'gitSessionIsolation', 'voiceEnabled', 'voiceId']
```

Sin esto, `pick(partial.cli, SAFE_CLI)` descarta las claves nuevas **en silencio**.

- [ ] **Step 6: Sanitizadores en `main/config-store.js`**

Junto a `sanitizeGitSessionIsolation` (línea ~123):

```js
// Modo voz. Default false: es una feature que pide permisos del sistema,
// no se enciende sola.
function sanitizeVoiceEnabled(value, fallback = false) {
  if (value === true) return true
  if (value === false) return false
  return fallback
}

// Identificador de voz de AVSpeechSynthesis. Cadena corta o vacío.
function sanitizeVoiceId(value) {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  if (!v || v.length > 200) return ''
  return /^[A-Za-z0-9._-]+$/.test(v) ? v : ''
}
```

En el bloque `cli` de `normalizeAppConfig` (línea ~192):
```js
gitSessionIsolation: sanitizeGitSessionIsolation(cli.gitSessionIsolation),
voiceEnabled: sanitizeVoiceEnabled(cli.voiceEnabled),
voiceId: sanitizeVoiceId(cli.voiceId)
```

Y añadir ambos al `return` de `createConfigNormalizers` (línea ~219).

- [ ] **Step 7: Verificar y commitear**

```bash
node --check main.js && node --check main/config-store.js
node --test tests/*.test.js
git add main.js main/config-store.js
git commit -m "feat(voz): cableado del modo voz en main e IPC"
```

Expected: la suite entera en verde, sin regresiones.

---

### Task 8: Botón y estados en la interfaz

**Files:**
- Modify: `index.html` (topbar `#controls`, entre `btn-subchat` y `btn-pin`; y el grupo CLI de ajustes)
- Modify: `styles.css`, `preload.js`, `renderer.js`

**Ojo con el micrófono que ya existe:** `#btn-mic` está en `#terminal-toolbar` y es el dictado con Whisper (grabar → transcribir → inyectar). **No lo toques ni lo reutilices.** Son cosas distintas: el dictado escribe en el prompt y funciona sin red; el modo voz conversa. Por eso el botón nuevo lleva icono de **ondas de conversación**, no de micrófono, y va en otra barra.

- [ ] **Step 1: HTML de la topbar (tras `btn-subchat`, línea ~238)**

```html
      <button id="btn-voice" class="icon-btn" title="Modo voz — hablar con el agente" aria-label="Activar modo voz" aria-pressed="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h2M20 12h2M6 8v8M10 5v14M14 7v10M18 9v6"/></svg>
      </button>
```

- [ ] **Step 2: CSS (junto al de `#btn-mic.recording`, línea ~478)**

```css
/* modo voz: un color por estado, para saber sin mirar el texto */
#btn-voice.voice-listening { background: var(--rec) !important; color: white !important; animation: pulse 1.2s ease-in-out infinite; }
#btn-voice.voice-thinking  { background: var(--accent) !important; color: white !important; }
#btn-voice.voice-speaking  { background: #2d9d6b !important; color: white !important; }

#voice-hud {
  position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
  max-width: 62%; padding: 7px 14px; border-radius: 14px;
  background: rgba(0,0,0,0.78); color: #fff; font-size: 13px;
  pointer-events: none; opacity: 0; transition: opacity .18s ease; z-index: 60;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#voice-hud.visible { opacity: 1; }
```

- [ ] **Step 3: HUD en `index.html` (antes de cerrar `<body>`)**

```html
    <div id="voice-hud"></div>
```

- [ ] **Step 4: `preload.js` (junto al bloque `subchat`, línea ~153)**

```js
  voice: {
    enable: () => ipcRenderer.invoke('voice:enable'),
    disable: () => ipcRenderer.invoke('voice:disable'),
    setMode: (mode) => ipcRenderer.invoke('voice:set-mode', { mode }),
    state: () => ipcRenderer.invoke('voice:state'),
    onEvent: (cb) => {
      const h = (_e, evt) => cb(evt)
      ipcRenderer.on('voice:event', h)
      return () => ipcRenderer.removeListener('voice:event', h)
    }
  },
```

- [ ] **Step 5: `renderer.js` (al final, junto al bloque del micro de dictado)**

```js
// ── Modo voz ──
const btnVoice = document.getElementById('btn-voice')
const voiceHud = document.getElementById('voice-hud')
let voiceOn = false
let voiceHudTimer = null

function showVoiceHud(text, holdMs = 2600) {
  if (!voiceHud) return
  voiceHud.textContent = text
  voiceHud.classList.add('visible')
  clearTimeout(voiceHudTimer)
  if (holdMs > 0) voiceHudTimer = setTimeout(() => voiceHud.classList.remove('visible'), holdMs)
}

function setVoiceButtonState(state) {
  if (!btnVoice) return
  btnVoice.classList.remove('voice-listening', 'voice-thinking', 'voice-speaking')
  if (state === 'listening') btnVoice.classList.add('voice-listening')
  else if (state === 'thinking') btnVoice.classList.add('voice-thinking')
  else if (state === 'speaking') btnVoice.classList.add('voice-speaking')
}

if (btnVoice) {
  btnVoice.addEventListener('click', async () => {
    if (voiceOn) {
      await window.api.voice.disable()
      voiceOn = false
      btnVoice.setAttribute('aria-pressed', 'false')
      setVoiceButtonState('idle')
      showVoiceHud('Modo voz apagado')
      return
    }
    const res = await window.api.voice.enable()
    if (!res?.ok) { showStatus(`Modo voz: ${res?.reason || 'no se pudo activar'}`, 'error', 4000); return }
    voiceOn = true
    btnVoice.setAttribute('aria-pressed', 'true')
    showVoiceHud('Modo voz activo — habla cuando quieras')
  })

  window.api.voice.onEvent((evt) => {
    if (!evt) return
    if (evt.type === 'state') { setVoiceButtonState(evt.state); if (evt.state === 'idle') voiceOn = false }
    else if (evt.type === 'partial') showVoiceHud(evt.text, 0)
    else if (evt.type === 'heard') showVoiceHud(`${evt.mode === 'encargo' ? '⚡' : '💬'} ${evt.text}`)
    else if (evt.type === 'saying') showVoiceHud(`🔊 ${evt.text.slice(0, 90)}`)
    else if (evt.type === 'nothing-to-say') showVoiceHud('(sin nada que leer en voz)')
    else if (evt.type === 'warn') showStatus(evt.message, 'warn', 4000)
    else if (evt.type === 'error') {
      voiceOn = false
      btnVoice.setAttribute('aria-pressed', 'false')
      setVoiceButtonState('idle')
      showStatus(`Modo voz: ${evt.message}`, 'error', 5000)
    }
  })
}
```

- [ ] **Step 6: Verificar y commitear**

```bash
node --check renderer.js && node --check preload.js
node --test tests/*.test.js
git add index.html styles.css preload.js renderer.js
git commit -m "feat(voz): botón de modo voz y HUD en la topbar"
```

---

### Task 9: Documentación y cierre

**Files:**
- Modify: `CLAUDE.md`, `.claude/memory/STATE.md`
- Create: `.claude/memory/tech/tech_modo_voz.md`

- [ ] **Step 1: Sección en `CLAUDE.md`**

Añadir tras "Auto-update de los CLI dentro del PTY":

```markdown
## Modo voz

- **Motor: Apple Speech en modo SERVIDOR**, no on-device. Medido en este Mac (i7-4770HQ de 2014): on-device da RTF 2,5–7,5 y se desploma con audio largo; servidor da 617 ms al primer texto y 1022 ms desde que callas. whisper.cpp local (RTF 1,41) tampoco llega. **No "optimizar" esto a on-device: está medido y no funciona.** Consecuencia asumida: el audio va a los servidores de Apple.
- **El eco lo cancela `setVoiceProcessingEnabled(true)`** (VoiceProcessingIO de CoreAudio). Sin eso, el micro capta el propio TTS y se autointerrumpe sin parar. Verificado por altavoz, sin auriculares.
- **`voice-helper` es un proceso hijo persistente**, el primero del repo que no es un PTY. Protocolo NDJSON por stdin/stdout. Tres trampas ya pagadas: `emit` asíncrono para no bloquear CoreAudio; drenar la cola antes de salir; y **permisos en perezoso** (pedirlos al arrancar mata el proceso fuera de un bundle y lo vuelve intesteable).
- **`SFSpeechRecognizer` solo obtiene permiso dentro de una app con bundle lanzada por LaunchServices.** Un binario suelto no lo consigue ni firmado ad-hoc. Por eso el helper es hijo de la app y no se puede testear su parte de audio desde CI.
- **La app no está firmada**: el permiso de micrófono se ancla a la firma, así que cada `npm run deploy` puede volver a pedirlo.
- **El modo voz no reutiliza `relayThroughPty`** (inline en `main.js`, acoplado a Telegram y codex): usa `main/voice-turn-watcher.js` sobre los helpers genéricos de `main/relay-transcript-helpers.js`.
- **El sub-chat forkea el sessionId.** `--fork-session` escribe en un `.jsonl` NUEVO; el de la madre no crece con lo que se hable ahí. La charla por voz se vigila con el sessionId del FORK, detectado con `snapshotClaudeSessions` + `findUpdatedOrNewClaudeSessionId` y cacheado en `session.voiceSubchatSessionId`. Ese caché se limpia al cerrar el sub-chat. Es la tercera vez que esta familia de bugs muerde (relay con `--resume`, pool oculto, y ahora el fork del sub-chat): **ante cualquier spawn nuevo de claude, pregúntate en qué `.jsonl` va a escribir de verdad.**
- **El micro se cierra mientras piensa o habla**, y se reabre después. Un turno cada vez.
- `#btn-mic` (dictado Whisper, barra del terminal) y `#btn-voice` (modo voz, topbar) son **cosas distintas**: el primero escribe en el prompt y funciona sin red; el segundo conversa.
- Solo `claude`. Codex no delimita bien el fin de turno.
```

- [ ] **Step 2: Nota técnica en memoria**

Crear `.claude/memory/tech/tech_modo_voz.md` con: las tablas de medición del spec, la decisión servidor-vs-local y su porqué, las tres trampas del helper, y el checklist manual pendiente.

- [ ] **Step 3: Compilar, desplegar y probar de verdad**

```bash
bash scripts/build-voice-helper.sh
node --test tests/*.test.js
npm run deploy
```

Luego, el **checklist manual** (§9 del spec) — esto **necesita un humano**, no lo puede cerrar un agente:

1. Al activar el modo voz, macOS pide micrófono y reconocimiento. Aceptar.
2. Hablar: el parcial aparece en el HUD en menos de 1 s.
3. Callar: contesta sin tocar nada.
4. Hablarle encima: se calla en el acto.
5. Por altavoz, sin auriculares: no se autointerrumpe.
6. Decir "hazlo": entra en la sesión madre, no en el sub-chat.
7. Un turno con herramientas: lee la conclusión, **no** lee los diffs.
8. Decir tres nombres de módulos del repo: los transcribe bien (si no, ampliar `contextualStrings` vía `{cmd:"vocab"}`).
9. Cortar el wifi: avisa claro, no se cuelga.

- [ ] **Step 4: Actualizar `STATE.md` y commitear**

```bash
git add CLAUDE.md .claude/memory/
git commit -m "docs(voz): runbook del modo voz y estado"
```

---

## Notas para quien ejecute esto

- **El único fichero que ya está escrito y validado es `voice-helper/VoiceHelper.swift`.** Compila, responde al protocolo y su motor es el que se midió. Todo lo demás está por hacer.
- **Los tests de las tareas 2–6 no necesitan micro, ni permisos, ni la app.** Corren en cualquier sitio. Todo lo que toca audio de verdad está en el checklist manual.
- Si un test falla por un detalle de formato (un espacio, un punto), **arregla la implementación, no el test**: el test es el contrato.
- Si `swiftc` no está: `xcode-select --install`.
- El spec tiene el porqué de cada decisión. Ante una duda de diseño, está ahí antes que en este plan.
