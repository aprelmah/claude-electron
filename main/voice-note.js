'use strict'

// Notas de voz de respuesta (Telegram): texto → helper de voz ({cmd:'synth'},
// TTS de Apple con la voz/velocidad configuradas → .caf) → ffmpeg → .ogg opus
// (lo que Telegram pinta como burbuja de nota de voz). El que llama borra el
// .ogg tras enviarlo.
//
// Contrato con el helper: UNA síntesis a la vez (mismo motivo que speak: su
// estado interno es único y encolar en él mezcla los eventos). Aquí se
// serializa con una cadena de promesas.
//
// Ciclo de vida del helper: como main/apple-transcribe.js — se arranca solo
// para esto (empujando las prefs de voz vía applyPrefs, porque el helper nace
// con la voz del sistema) y se para al quedar libre, salvo que el modo voz o
// el lector lo estén usando. La síntesis no necesita permisos de macOS.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const DEFAULT_TIMEOUT_MS = 20000

function createVoiceNoteMaker({
  helper,
  tmpDir,
  ffmpegBin,
  spawnFn,
  applyPrefs,
  isVoiceInUse,
  timeoutMs,
  log
} = {}) {
  if (!helper) throw new Error('voice-note: helper requerido')
  if (!tmpDir) throw new Error('voice-note: tmpDir requerido')
  if (!ffmpegBin) throw new Error('voice-note: ffmpegBin requerido')
  const doSpawn = typeof spawnFn === 'function' ? spawnFn : spawn
  const prefs = typeof applyPrefs === 'function' ? applyPrefs : () => {}
  const vozEnUso = typeof isVoiceInUse === 'function' ? isVoiceInUse : () => false
  const TIMEOUT = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  const trace = typeof log === 'function' ? log : () => {}

  let seq = 0
  const pendientes = new Map()
  let arrancadoPorNosotros = false
  let cola = Promise.resolve()

  function soltarHelper() {
    if (pendientes.size === 0 && arrancadoPorNosotros && !vozEnUso()) {
      arrancadoPorNosotros = false
      try { helper.stop() } catch {}
    }
  }

  function cerrar(id) {
    const w = pendientes.get(id)
    if (!w) return null
    pendientes.delete(id)
    clearTimeout(w.timer)
    return w
  }

  function handleHelperEvent(evt) {
    if (!evt || typeof evt !== 'object') return false
    if (evt.type === 'synth-done' || evt.type === 'synth-error') {
      const w = cerrar(evt.id)
      if (w) {
        if (evt.type === 'synth-done') w.resolve()
        else w.reject(new Error(evt.message || 'la síntesis falló'))
      }
      return true
    }
    if (evt.type === 'error' && evt.fatal) {
      for (const id of [...pendientes.keys()]) {
        const w = cerrar(id)
        if (w) w.reject(new Error(evt.message || 'el helper de voz murió'))
      }
      return false
    }
    return false
  }

  function synthToCaf(text, cafPath) {
    return new Promise((resolve, reject) => {
      const bin = helper.checkBinary()
      if (!bin.ok) return reject(new Error(bin.reason || 'no hay helper de voz'))
      if (helper.isBroken()) return reject(new Error('el helper de voz está roto (no arranca)'))
      if (!helper.isRunning()) {
        try { helper.start() } catch (err) {
          return reject(new Error(`no se pudo arrancar el helper: ${err?.message || err}`))
        }
        arrancadoPorNosotros = true
        try { prefs() } catch {}
      }
      seq += 1
      const id = `syn:${seq}`
      const timer = setTimeout(() => {
        cerrar(id)
        reject(new Error(`el helper no contestó a la síntesis en ${TIMEOUT} ms`))
      }, TIMEOUT)
      if (timer && typeof timer.unref === 'function') timer.unref()
      pendientes.set(id, { resolve, reject, timer })
      if (!helper.send({ cmd: 'synth', id, text, path: cafPath })) {
        cerrar(id)
        reject(new Error('no se pudo escribir al helper de voz'))
      }
    })
  }

  function cafToOgg(cafPath, oggPath) {
    return new Promise((resolve, reject) => {
      // 48k mono opus ~32kbps: lo que Telegram espera en una nota de voz.
      const ff = doSpawn(ffmpegBin, ['-y', '-loglevel', 'error', '-i', cafPath, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', oggPath], {})
      let ffErr = ''
      ff.stderr.on('data', (d) => { ffErr += d.toString() })
      ff.on('error', reject)
      ff.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${ffErr.slice(-300)}`))
        resolve()
      })
    })
  }

  function makeVoiceNote(text) {
    const limpio = String(text || '').trim()
    const trabajo = cola.catch(() => {}).then(async () => {
      if (!limpio) throw new Error('texto vacío: nada que sintetizar')
      const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      const cafPath = path.join(tmpDir, `voice-note-${stamp}.caf`)
      const oggPath = path.join(tmpDir, `voice-note-${stamp}.ogg`)
      try {
        await synthToCaf(limpio, cafPath)
        await cafToOgg(cafPath, oggPath)
        return oggPath
      } finally {
        try { fs.unlinkSync(cafPath) } catch {}
        soltarHelper()
      }
    })
    cola = trabajo
    trace('nota de voz en marcha')
    return trabajo
  }

  return { makeVoiceNote, handleHelperEvent, pendingCount: () => pendientes.size }
}

module.exports = { createVoiceNoteMaker, DEFAULT_TIMEOUT_MS }
