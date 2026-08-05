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
