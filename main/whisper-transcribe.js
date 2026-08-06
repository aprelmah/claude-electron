'use strict'

// Transcripción de audio: Apple Speech (servidor, vía helper de voz) primero,
// whisper.cpp de fallback. ffmpeg → wav 16k mono → Apple si el audio cabe en
// una petición (~1 min de tope en servidor) → whisper si Apple falta, falla,
// devuelve vacío o el audio es largo.
//
// El fallback no es opcional: en dev el helper no consigue el permiso de
// reconocimiento (requestAuthorization solo responde dentro de una app con
// bundle) y con el toggle apagado o el binario ausente tampoco hay Apple.
// Filtra las alucinaciones conocidas del modelo español de whisper.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { commandExists, FFMPEG_BIN } = require('./cli-resolver')

const WHISPER_HALLUCINATIONS = [
  /iglesia de jesucristo/i,
  /santos de los .*ltimos d.as/i,
  /amara\.org/i,
  /subt.tulos? (realizados|por la comunidad|creados)/i,
  /subtitulado por/i,
  /^\s*\[?(m.sica|aplausos|risas|silencio|ruido)\]?\s*$/i,
  /gracias por ver/i,
  /suscr.bete/i
]

// Tope de audio para la vía Apple: el reconocimiento en servidor corta en ~1
// minuto por petición (mismo límite que dispara el isFinal del modo voz).
// Más largo que esto → whisper directo, sin trocear (v1 consciente).
const APPLE_MAX_SECONDS = 55

// wav de ffmpeg con -ac 1 -ar 16000 (16-bit PCM): 32000 bytes por segundo.
const WAV_BYTES_PER_SEC = 32000
const WAV_HEADER_BYTES = 44

function wavDurationSeconds(wavPath) {
  try {
    const size = fs.statSync(wavPath).size
    return Math.max(0, size - WAV_HEADER_BYTES) / WAV_BYTES_PER_SEC
  } catch {
    return Infinity
  }
}

function measureMeanVolume(filePath, env, spawnFn = spawn) {
  return new Promise((resolve) => {
    const ff = spawnFn(FFMPEG_BIN, ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { env })
    let stderr = ''
    ff.stderr.on('data', (d) => { stderr += d.toString() })
    ff.on('error', () => resolve(null))
    ff.on('close', () => {
      const m = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)
      resolve(m ? parseFloat(m[1]) : null)
    })
  })
}

function createTranscriber({
  getWhisperBin,
  modelPath,
  tmpDir,
  appleTranscribe,
  spawnFn,
  commandExistsFn,
  measureVolumeFn,
  log
} = {}) {
  const doSpawn = typeof spawnFn === 'function' ? spawnFn : spawn
  const existsCmd = typeof commandExistsFn === 'function' ? commandExistsFn : commandExists
  const measure = typeof measureVolumeFn === 'function'
    ? measureVolumeFn
    : (p, env) => measureMeanVolume(p, env, doSpawn)
  const trace = typeof log === 'function' ? log : () => {}

  function convertToWav(inputPath, wavPath, env) {
    return new Promise((resolve, reject) => {
      const ff = doSpawn(FFMPEG_BIN, ['-y', '-loglevel', 'error', '-i', inputPath, '-ac', '1', '-ar', '16000', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', wavPath], { env })
      let ffErr = ''
      ff.stderr.on('data', (d) => { ffErr += d.toString() })
      ff.on('error', reject)
      ff.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${ffErr.slice(-300)}`))
        resolve()
      })
    })
  }

  function runWhisper(whisperBin, wavPath, txtBase, env) {
    return new Promise((resolve, reject) => {
      const wp = doSpawn(whisperBin, ['-m', modelPath, '-l', 'es', '-nt', '-sns', '-nth', '0.3', '--prompt', 'Transcripción en castellano.', '-otxt', '-of', txtBase, '-f', wavPath], { env })
      let wpErr = ''
      wp.stderr.on('data', (d) => { wpErr += d.toString() })
      wp.on('error', reject)
      wp.on('close', (wcode) => {
        if (wcode !== 0) return reject(new Error(`whisper-cli exit ${wcode}: ${wpErr.slice(-300)}`))
        try {
          const txtPath = `${txtBase}.txt`
          const text = fs.readFileSync(txtPath, 'utf-8').trim()
          try { fs.unlinkSync(txtPath) } catch {}
          if (!text) return reject(new Error('Sin voz reconocida.'))
          if (WHISPER_HALLUCINATIONS.some((re) => re.test(text))) return reject(new Error('Sin voz reconocida.'))
          resolve(text)
        } catch (err) { reject(err) }
      })
    })
  }

  async function transcribeAudioFile(inputPath, env) {
    if (!existsCmd(FFMPEG_BIN, env)) throw new Error(`ffmpeg no disponible (${FFMPEG_BIN}).`)

    const meanDb = await measure(inputPath, env)
    if (meanDb !== null && meanDb < -50) {
      throw new Error('Sin audio reconocible (silencio).')
    }

    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const wavPath = path.join(tmpDir, `whisper-${stamp}.wav`)
    const txtBase = path.join(tmpDir, `whisper-${stamp}`)

    await convertToWav(inputPath, wavPath, env)

    try {
      // Vía rápida: Apple Speech en servidor si el audio cabe en una petición.
      if (typeof appleTranscribe === 'function') {
        const durationSec = wavDurationSeconds(wavPath)
        if (durationSec <= APPLE_MAX_SECONDS) {
          try {
            const text = String((await appleTranscribe(wavPath, { durationSec })) || '').trim()
            if (text) return text
            trace('Apple devolvió vacío: caigo a whisper')
          } catch (err) {
            trace(`Apple falló (${err?.message || err}): caigo a whisper`)
          }
        } else {
          trace(`audio de ${Math.round(durationSec)}s supera el tope Apple (${APPLE_MAX_SECONDS}s): whisper directo`)
        }
      }

      const whisperBin = getWhisperBin()
      if (!existsCmd(whisperBin, env)) throw new Error(`Whisper no disponible (${whisperBin}). Instala con: brew install whisper-cpp`)
      if (!fs.existsSync(modelPath)) throw new Error(`Modelo no encontrado: ${modelPath}`)
      return await runWhisper(whisperBin, wavPath, txtBase, env)
    } finally {
      try { fs.unlinkSync(wavPath) } catch {}
    }
  }

  return { transcribeAudioFile, measureMeanVolume }
}

module.exports = {
  createTranscriber,
  measureMeanVolume,
  WHISPER_HALLUCINATIONS,
  APPLE_MAX_SECONDS
}
