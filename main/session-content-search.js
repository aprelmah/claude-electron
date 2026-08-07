'use strict'

// Búsqueda de contenido en las sesiones de un proyecto (robo de Hermes Agent:
// "search your own past conversations"). Sin índice nuevo: streaming línea a
// línea de los .jsonl con readline — la lección del relay (transcripts de
// 14MB) prohíbe readFileSync entero, y un índice FTS sería otra pieza que
// mantener para una búsqueda que se lanza a demanda.
//
// El plegado (minúsculas + sin tildes) es por code point y 1:1, así el índice
// de la coincidencia en el texto plegado mapea directo al original para poder
// recortar el snippet sin descuadres.

const fs = require('fs')
const readline = require('readline')

const MAX_FILE_BYTES = 60 * 1024 * 1024
const MATCHES_PER_FILE = 5
const SNIPPET_BEFORE = 50
const SNIPPET_AFTER = 100

const COMBINING_RE = /[\u0300-\u036f]/g

function foldChar(ch) {
  const n = ch.toLowerCase().normalize('NFD').replace(COMBINING_RE, '')
  return n.length ? n[0] : ' '
}

function foldedOf(codePoints) {
  let out = ''
  for (const ch of codePoints) out += foldChar(ch)
  return out
}

function extractTextFromLine(line) {
  let obj
  try { obj = JSON.parse(line) } catch { return '' }
  const out = []
  const content = obj?.message?.content
  if (typeof content === 'string') {
    out.push(content)
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part.text === 'string') out.push(part.text)
    }
  }
  if (typeof obj?.summary === 'string') out.push(obj.summary)
  return out.join('\n')
}

function makeSnippet(text, needleFolded) {
  const cps = [...text]
  const folded = foldedOf(cps)
  const idx = folded.indexOf(needleFolded)
  if (idx === -1) return text.slice(0, SNIPPET_AFTER)
  const start = Math.max(0, idx - SNIPPET_BEFORE)
  const end = Math.min(cps.length, idx + needleFolded.length + SNIPPET_AFTER)
  const chunk = cps.slice(start, end).join('').replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${chunk}${end < cps.length ? '…' : ''}`
}

function searchOneFile(entry, needleFolded) {
  return new Promise((resolve) => {
    let count = 0
    let snippet = ''
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve(count ? { id: entry.id, count, snippet } : null)
    }
    let stream
    try {
      stream = fs.createReadStream(entry.path, { encoding: 'utf8' })
    } catch {
      resolve(null)
      return
    }
    stream.on('error', done)
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (count >= MATCHES_PER_FILE) return
      const text = extractTextFromLine(line)
      if (!text) return
      if (foldedOf(text).indexOf(needleFolded) === -1) return
      count++
      if (!snippet) snippet = makeSnippet(text, needleFolded)
    })
    rl.on('close', done)
  })
}

// entries: [{ id, path }] en el orden en que deben evaluarse (la lista de
// sesiones ya viene por mtime desc). Devuelve solo las que tienen coincidencia.
async function searchSessionContentInFiles({ entries, query, maxResults = 40, statFn = fs.statSync } = {}) {
  const needleFolded = foldedOf(String(query || '').trim())
  if (!needleFolded) return []
  const results = []
  for (const entry of entries || []) {
    if (results.length >= maxResults) break
    if (!entry?.id || !entry?.path) continue
    let st
    try { st = statFn(entry.path) } catch { continue }
    if (!st || st.size > MAX_FILE_BYTES) continue
    const found = await searchOneFile(entry, needleFolded)
    if (found) results.push(found)
  }
  return results
}

module.exports = { searchSessionContentInFiles, extractTextFromLine, foldedOf, makeSnippet }
