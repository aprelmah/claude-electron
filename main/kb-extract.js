'use strict'
// Extractores de texto para la base de conocimiento por proyecto (panel 📚).
// PDF vía PDFKit (swift, compilado una vez en userData), web vía fetch + strip
// HTML, YouTube vía yt-dlp (subtítulos VTT; no descarga el vídeo) y audio vía
// el transcriptor existente de POWER-AGENT.
// Todo lo que sale de aquí es contenido NO CONFIABLE: el llamador lo pasa por
// sanitizeChannelText y lo delimita en el prompt del destilador.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const MAX_EXTRACT_CHARS = 180_000
const YTDLP_TIMEOUT_MS = 120_000
const PDF_TIMEOUT_MS = 60_000
const WEB_TIMEOUT_MS = 30_000
const AUDIO_EXTENSIONS = new Set(['.3gp', '.aac', '.aiff', '.amr', '.caf', '.flac', '.m4a', '.mp3', '.mpga', '.oga', '.ogg', '.opus', '.wav', '.webm'])

// Fuente Swift del extractor PDF (PDFKit conserva tablas mejor que pypdf en
// los manuales técnicos). Se compila una única vez a userData/kb-tools/pdftxt.
const PDFTXT_SWIFT_SOURCE = `import Foundation
import PDFKit
let args = CommandLine.arguments
guard args.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("cannot open\\n".data(using: .utf8)!)
    exit(1)
}
var out = ""
for i in 0..<doc.pageCount {
    let p = doc.page(at: i)
    out += "\\n\\n===== [pag \\(i+1)] =====\\n" + (p?.string ?? "")
}
print(out)
`

function isYoutubeUrl(input) {
  if (typeof input !== 'string') return false
  const s = input.trim()
  return /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i.test(s)
}

function isWebUrl(input) {
  if (typeof input !== 'string') return false
  return /^https?:\/\/\S+$/i.test(input.trim())
}

// 'youtube' | 'web' | 'pdf' | 'text' | 'audio' | null
function detectSourceType(input) {
  if (typeof input !== 'string' || !input.trim()) return null
  const s = input.trim()
  if (isYoutubeUrl(s)) return 'youtube'
  if (isWebUrl(s)) return 'web'
  const ext = path.extname(s).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (['.md', '.txt', '.markdown', '.csv', '.json', '.html', '.htm', '.vtt', '.srt'].includes(ext)) return 'text'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  return null
}

// --- HTML → texto plano -----------------------------------------------------

const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', iquest: '¿', iexcl: '¡',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ordm: 'º', ordf: 'ª', deg: '°', middot: '·', hellip: '…',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—'
}

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16)
      return code > 8 && code < 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const code = parseInt(d, 10)
      return code > 8 && code < 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in HTML_ENTITIES ? HTML_ENTITIES[name] : m))
}

function stripHtml(html) {
  const raw = String(html || '')
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : ''
  const text = decodeEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text }
}

// --- VTT → transcripción con marcas de tiempo -------------------------------

function parseVttTimestamp(line) {
  const m = String(line).match(/^(\d{2,}):(\d{2}):(\d{2})[.,]\d{3}\s+-->/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function formatMinSec(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`
}

// Los subtítulos automáticos de YouTube repiten cada frase en cues solapados
// (efecto "rolling"): se deduplica línea a línea y se emite una marca [mm:ss]
// cada ~30 s de contenido nuevo.
function parseVtt(vttText, { markEverySeconds = 30 } = {}) {
  const lines = String(vttText || '').split('\n')
  const out = []
  let currentTs = null
  let lastMarkTs = -Infinity
  let lastLine = ''
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line === 'WEBVTT' || /^(Kind|Language|NOTE|STYLE|REGION)\b/i.test(line)) continue
    const ts = parseVttTimestamp(line)
    if (ts !== null) { currentTs = ts; continue }
    if (/^\d+$/.test(line)) continue
    const clean = decodeEntities(line.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (!clean || clean === lastLine) continue
    if (lastLine && (lastLine.endsWith(clean) || clean.startsWith(lastLine))) {
      // cue rodante: la línea nueva contiene o repite la anterior
      if (clean.length > lastLine.length && out.length) {
        out[out.length - 1] = out[out.length - 1].replace(lastLine, clean)
        lastLine = clean
        continue
      }
      if (clean.length <= lastLine.length) continue
    }
    if (currentTs !== null && currentTs - lastMarkTs >= markEverySeconds) {
      out.push(`${formatMinSec(currentTs)} ${clean}`)
      lastMarkTs = currentTs
    } else {
      out.push(clean)
    }
    lastLine = clean
  }
  return out.join('\n')
}

function isYoutubeRateLimit(text) {
  return /429|Too Many Requests/i.test(String(text || ''))
}

// --- Resolución de yt-dlp ---------------------------------------------------

// Candidatos en orden: binario en PATH, instalaciones pip de usuario (versión
// de Python más alta primero), y python3 -m yt_dlp como red final.
function resolveYtDlpCandidates({ homeDir = os.homedir(), existsFn = fs.existsSync, readdirFn = fs.readdirSync } = {}) {
  const candidates = [{ cmd: 'yt-dlp', args: [] }]
  try {
    const pyRoot = path.join(homeDir, 'Library', 'Python')
    const versions = readdirFn(pyRoot)
      .filter((v) => /^\d+\.\d+$/.test(v))
      .sort((a, b) => {
        const [aMaj, aMin] = a.split('.').map(Number)
        const [bMaj, bMin] = b.split('.').map(Number)
        return bMaj - aMaj || bMin - aMin
      })
    for (const v of versions) {
      const bin = path.join(pyRoot, v, 'bin', 'yt-dlp')
      if (existsFn(bin)) candidates.push({ cmd: bin, args: [] })
    }
  } catch {}
  candidates.push({ cmd: 'python3', args: ['-m', 'yt_dlp'] })
  return candidates
}

// --- Factory ----------------------------------------------------------------

function createKbExtractor({
  userDataDir,
  tmpDir = os.tmpdir(),
  spawnFn = spawn,
  fetchFn = globalThis.fetch,
  transcribeAudioFile,
  buildRuntimeEnv,
  log = () => {}
} = {}) {
  function runCommand(cmd, args, { timeoutMs, cwd } = {}) {
    return new Promise((resolve, reject) => {
      let out = ''
      let err = ''
      let settled = false
      const child = spawnFn(cmd, args, { cwd: cwd || tmpDir, stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { child.kill('SIGKILL') } catch {}
        reject(new Error(`timeout tras ${Math.round((timeoutMs || 0) / 1000)}s: ${cmd}`))
      }, timeoutMs || 60_000)
      child.stdout.on('data', (d) => { if (out.length < 8_000_000) out += d })
      child.stderr.on('data', (d) => { if (err.length < 200_000) err += d })
      child.on('error', (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(e)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code === 0) resolve({ stdout: out, stderr: err })
        else reject(new Error(`${path.basename(cmd)} salió con código ${code}: ${err.slice(-400)}`))
      })
    })
  }

  // Compila el extractor Swift una vez y lo cachea en userData/kb-tools/.
  async function ensurePdftxtBin() {
    const toolsDir = path.join(userDataDir, 'kb-tools')
    const bin = path.join(toolsDir, 'pdftxt')
    if (fs.existsSync(bin)) return bin
    fs.mkdirSync(toolsDir, { recursive: true })
    const src = path.join(toolsDir, 'pdftxt.swift')
    fs.writeFileSync(src, PDFTXT_SWIFT_SOURCE, 'utf-8')
    await runCommand('swiftc', ['-O', '-o', bin, src], { timeoutMs: 120_000 })
    return bin
  }

  async function extractPdf(pdfPath) {
    const bin = await ensurePdftxtBin()
    const { stdout } = await runCommand(bin, [pdfPath], { timeoutMs: PDF_TIMEOUT_MS })
    return { title: path.basename(pdfPath, path.extname(pdfPath)), text: stdout, origin: pdfPath }
  }

  async function extractTextFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.html' || ext === '.htm') {
      const { title, text } = stripHtml(raw)
      return { title: title || path.basename(filePath, ext), text, origin: filePath }
    }
    if (ext === '.vtt') {
      return { title: path.basename(filePath, ext), text: parseVtt(raw), origin: filePath }
    }
    return { title: path.basename(filePath, ext), text: raw, origin: filePath }
  }

  async function extractAudioFile(filePath) {
    if (typeof transcribeAudioFile !== 'function') {
      throw new Error('transcripción de audio no disponible')
    }
    const env = typeof buildRuntimeEnv === 'function' ? buildRuntimeEnv() : undefined
    const text = await transcribeAudioFile(filePath, env)
    return {
      title: path.basename(filePath, path.extname(filePath)),
      text: String(text || ''),
      origin: filePath
    }
  }

  async function extractWeb(url) {
    if (typeof fetchFn !== 'function') throw new Error('fetch no disponible')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS)
    let resp
    try {
      resp = await fetchFn(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) POWER-AGENT-KB/1.0' }
      })
    } finally {
      clearTimeout(timer)
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar ${url}`)
    const body = await resp.text()
    const contentType = String(resp.headers?.get?.('content-type') || '')
    if (contentType.includes('text/html') || /^\s*</.test(body)) {
      const { title, text } = stripHtml(body)
      return { title: title || url, text, origin: url }
    }
    return { title: url, text: body, origin: url }
  }

  async function extractYoutube(url) {
    const workDir = fs.mkdtempSync(path.join(tmpDir, 'kb-yt-'))
    const outTemplate = path.join(workDir, 'sub.%(ext)s')
    const titleFile = path.join(workDir, 'title.txt')
    const baseArgs = [
      '--skip-download', '--no-playlist',
      '--write-subs', '--write-auto-subs',
      '--sub-format', 'vtt/best',
      '--sleep-subtitles', '1',
      '--print-to-file', '%(title)s', titleFile,
      '-o', outTemplate
    ]
    // Español primero y, solo si no hay, inglés: pedir todos los idiomas a la
    // vez multiplica las peticiones y dispara el 429 de YouTube.
    const langSets = ['es,es-orig,es-419', 'en,en-orig']
    let lastError = null
    try {
      for (const langs of langSets) {
        const ytArgs = [...baseArgs, '--sub-langs', langs, url]
        lastError = null
        for (const cand of resolveYtDlpCandidates()) {
          try {
            await runCommand(cand.cmd, [...cand.args, ...ytArgs], { timeoutMs: YTDLP_TIMEOUT_MS, cwd: workDir })
            lastError = null
            break
          } catch (e) {
            lastError = e
            if (!/ENOENT/.test(String(e?.code || e?.message))) break
          }
        }
        if (lastError && isYoutubeRateLimit(lastError.message)) {
          throw new Error('YouTube está limitando las descargas de subtítulos ahora mismo (HTTP 429). Es temporal: espera unos minutos y reintenta.')
        }
        if (!lastError && fs.readdirSync(workDir).some((f) => f.endsWith('.vtt'))) break
      }
      if (lastError) throw lastError
      const vttFiles = fs.readdirSync(workDir).filter((f) => f.endsWith('.vtt'))
      if (!vttFiles.length) {
        throw new Error('El vídeo no tiene subtítulos (ni automáticos). Transcripción por audio: pendiente de v2.')
      }
      // preferencia: es manual > es auto > en
      const pick = vttFiles.sort((a, b) => {
        const score = (f) => (/\.es[.-]/.test(f) || f.endsWith('.es.vtt') ? 0 : 1)
        return score(a) - score(b)
      })[0]
      const vttText = fs.readFileSync(path.join(workDir, pick), 'utf-8')
      let title = ''
      try { title = fs.readFileSync(titleFile, 'utf-8').split('\n')[0].trim() } catch {}
      return { title: title || url, text: parseVtt(vttText), origin: url }
    } finally {
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
    }
  }

  // Punto de entrada único: source = { kind: 'url'|'file', url?, path? }
  async function extractSource(source) {
    const ref = source?.kind === 'url' ? String(source.url || '').trim() : String(source?.path || '').trim()
    if (!ref) throw new Error('fuente vacía')
    const type = detectSourceType(ref)
    let result
    if (type === 'youtube') result = await extractYoutube(ref)
    else if (type === 'web') result = await extractWeb(ref)
    else if (type === 'pdf') result = await extractPdf(ref)
    else if (type === 'text') result = await extractTextFile(ref)
    else if (type === 'audio') result = await extractAudioFile(ref)
    else throw new Error(`tipo de fuente no soportado: ${ref}`)
    let truncated = false
    if (result.text.length > MAX_EXTRACT_CHARS) {
      result.text = result.text.slice(0, MAX_EXTRACT_CHARS)
      truncated = true
    }
    if (!result.text.trim()) throw new Error('la fuente no contiene texto extraíble')
    log(`[kb-extract] ${type} "${result.title}" → ${result.text.length} chars${truncated ? ' (truncado)' : ''}`)
    return { ...result, type, truncated }
  }

  return { extractSource, extractPdf, extractWeb, extractYoutube, extractTextFile, extractAudioFile, ensurePdftxtBin }
}

module.exports = {
  createKbExtractor,
  detectSourceType,
  isYoutubeUrl,
  isWebUrl,
  isYoutubeRateLimit,
  stripHtml,
  parseVtt,
  resolveYtDlpCandidates,
  AUDIO_EXTENSIONS,
  MAX_EXTRACT_CHARS
}
