'use strict'

// Whisper.cpp-based audio transcription (ffmpeg → wav → whisper-cli).
// Filters known hallucinations of the Spanish model.

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

function measureMeanVolume(filePath, env) {
  return new Promise((resolve) => {
    const ff = spawn(FFMPEG_BIN, ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { env })
    let stderr = ''
    ff.stderr.on('data', (d) => { stderr += d.toString() })
    ff.on('error', () => resolve(null))
    ff.on('close', () => {
      const m = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)
      resolve(m ? parseFloat(m[1]) : null)
    })
  })
}

function createTranscriber({ getWhisperBin, modelPath, tmpDir }) {
  async function transcribeAudioFile(inputPath, env) {
    const whisperBin = getWhisperBin()
    if (!commandExists(whisperBin, env)) throw new Error(`Whisper no disponible (${whisperBin}). Instala con: brew install whisper-cpp`)
    if (!commandExists(FFMPEG_BIN, env)) throw new Error(`ffmpeg no disponible (${FFMPEG_BIN}).`)
    if (!fs.existsSync(modelPath)) throw new Error(`Modelo no encontrado: ${modelPath}`)

    const meanDb = await measureMeanVolume(inputPath, env)
    if (meanDb !== null && meanDb < -50) {
      throw new Error('Sin audio reconocible (silencio).')
    }

    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const wavPath = path.join(tmpDir, `whisper-${stamp}.wav`)
    const txtBase = path.join(tmpDir, `whisper-${stamp}`)
    const txtPath = `${txtBase}.txt`

    return new Promise((resolve, reject) => {
      const ff = spawn(FFMPEG_BIN, ['-y', '-loglevel', 'error', '-i', inputPath, '-ac', '1', '-ar', '16000', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', wavPath], { env })
      let ffErr = ''
      ff.stderr.on('data', (d) => { ffErr += d.toString() })
      ff.on('error', reject)
      ff.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${ffErr.slice(-300)}`))
        const wp = spawn(whisperBin, ['-m', modelPath, '-l', 'es', '-nt', '-sns', '-nth', '0.3', '--prompt', 'Transcripción en castellano.', '-otxt', '-of', txtBase, '-f', wavPath], { env })
        let wpErr = ''
        wp.stderr.on('data', (d) => { wpErr += d.toString() })
        wp.on('error', (err) => { try { fs.unlinkSync(wavPath) } catch {} ; reject(err) })
        wp.on('close', (wcode) => {
          try { fs.unlinkSync(wavPath) } catch {}
          if (wcode !== 0) return reject(new Error(`whisper-cli exit ${wcode}: ${wpErr.slice(-300)}`))
          try {
            const text = fs.readFileSync(txtPath, 'utf-8').trim()
            try { fs.unlinkSync(txtPath) } catch {}
            if (!text) return reject(new Error('Sin voz reconocida.'))
            if (WHISPER_HALLUCINATIONS.some((re) => re.test(text))) return reject(new Error('Sin voz reconocida.'))
            resolve(text)
          } catch (err) { reject(err) }
        })
      })
    })
  }

  return { transcribeAudioFile, measureMeanVolume }
}

module.exports = {
  createTranscriber,
  measureMeanVolume,
  WHISPER_HALLUCINATIONS
}
