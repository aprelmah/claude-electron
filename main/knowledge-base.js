'use strict'
// Base de conocimiento por proyecto (panel 📚). El estado vive en el CLAUDE.md
// del proyecto: una línea `@ruta` por ficha activa (import de Claude Code) y la
// misma ruta entre backticks por ficha desactivada (los imports dentro de code
// spans no se evalúan). Este módulo no inventa formato nuevo: lee y edita ese
// bloque respetando el resto del fichero.

const fs = require('fs')
const path = require('path')
const { atomicWriteFileSync } = require('./atomic-writes')

const KB_FICHAS_DIR = path.join('kb', 'fichas')
const KB_FUENTES_DIR = path.join('kb', 'fuentes')
const IMPORTS_HEADER = '## Conocimiento precargado'

// ~4 chars por token en texto técnico en español; orientativo para la UI.
function estimateTokens(bytes) {
  return Math.round((Number(bytes) || 0) / 4)
}

function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'ficha'
}

const ACTIVE_IMPORT_RE = /^@(\S+)\s*$/
const INACTIVE_IMPORT_RE = /^`@(\S+)`\s*$/

function claudeMdPath(projectDir) {
  return path.join(projectDir, 'CLAUDE.md')
}

// Plantilla mínima para proyectos que aún no tienen CLAUDE.md.
function buildSkeleton(projectName) {
  const name = String(projectName || '').trim() || 'este proyecto'
  return `# CLAUDE.md — Experto de ${name}

Eres el experto de ${name}. Tu conocimiento operativo está PRECARGADO más abajo
(fichas destiladas de las fuentes del proyecto).

## Cómo responder

- Responde DIRECTO desde el conocimiento precargado, sin abrir archivos ni buscar.
  Corto, certero, español de España. Cita la ficha (y página o minuto si lo trae).
- Si el dato NO está en tu conocimiento: dilo claro y en una línea. PROHIBIDO
  inventar o extrapolar.
- Si Luismi te pide guardar un atajo (pregunta→respuesta, caso→soluciones, lo que
  sea), escribe la entrada en \`kb/fichas/atajos.md\` (formato \`## N · título\`,
  contenido libre, relacionados entre backticks) y asegúrate de que
  \`@kb/fichas/atajos.md\` figura bajo "Conocimiento precargado".

${IMPORTS_HEADER}
`
}

function ensureClaudeMd(projectDir, { projectName } = {}) {
  const target = claudeMdPath(projectDir)
  if (fs.existsSync(target)) return { created: false, path: target }
  atomicWriteFileSync(target, buildSkeleton(projectName || path.basename(projectDir)), 'utf-8')
  return { created: true, path: target }
}

// Lee el CLAUDE.md y devuelve las fichas (imports activos e inactivos) en orden.
function parseImports(claudeMdText) {
  const fichas = []
  const lines = String(claudeMdText || '').split('\n')
  let inCodeBlock = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line.trim())) { inCodeBlock = !inCodeBlock; continue }
    if (inCodeBlock) continue
    const active = line.match(ACTIVE_IMPORT_RE)
    if (active) { fichas.push({ relPath: active[1], active: true, line: i }); continue }
    const inactive = line.match(INACTIVE_IMPORT_RE)
    if (inactive) fichas.push({ relPath: inactive[1], active: false, line: i })
  }
  return fichas
}

function listKnowledge(projectDir) {
  const mdPath = claudeMdPath(projectDir)
  const claudeMdExists = fs.existsSync(mdPath)
  const text = claudeMdExists ? fs.readFileSync(mdPath, 'utf-8') : ''
  const fichas = parseImports(text).map((f) => {
    const abs = path.resolve(projectDir, f.relPath)
    let size = null
    let missing = true
    try {
      const st = fs.statSync(abs)
      if (st.isFile()) { size = st.size; missing = false }
    } catch {}
    return {
      relPath: f.relPath,
      name: path.basename(f.relPath, path.extname(f.relPath)),
      active: f.active,
      size,
      missing
    }
  })
  const fuentesDir = path.join(projectDir, KB_FUENTES_DIR)
  let fuentes = []
  try {
    fuentes = fs.readdirSync(fuentesDir)
      .filter((n) => !n.startsWith('.'))
      .map((n) => {
        const st = fs.statSync(path.join(fuentesDir, n))
        return { name: n, relPath: path.join(KB_FUENTES_DIR, n), size: st.size, mtimeMs: st.mtimeMs }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  } catch {}
  const totalActiveBytes = fichas.reduce((acc, f) => acc + (f.active && f.size ? f.size : 0), 0)
  return {
    ok: true,
    claudeMdExists,
    fichas,
    fuentes,
    totalActiveBytes,
    approxTokens: estimateTokens(totalActiveBytes)
  }
}

// Activa/desactiva una ficha reescribiendo SOLO su línea en el CLAUDE.md.
function toggleImport(projectDir, relPath, active) {
  const mdPath = claudeMdPath(projectDir)
  if (!fs.existsSync(mdPath)) return { ok: false, error: 'CLAUDE.md no existe' }
  const lines = fs.readFileSync(mdPath, 'utf-8').split('\n')
  const wanted = String(relPath || '').trim()
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const activeMatch = lines[i].match(ACTIVE_IMPORT_RE)
    const inactiveMatch = lines[i].match(INACTIVE_IMPORT_RE)
    const current = activeMatch?.[1] || inactiveMatch?.[1]
    if (current !== wanted) continue
    lines[i] = active ? `@${wanted}` : `\`@${wanted}\``
    changed = true
    break
  }
  if (!changed) return { ok: false, error: `import no encontrado: ${wanted}` }
  atomicWriteFileSync(mdPath, lines.join('\n'), 'utf-8')
  return { ok: true }
}

// Añade un import bajo la sección de conocimiento (la crea al final si falta).
// Idempotente: si la ruta ya está (activa o no), no toca nada.
function addImport(projectDir, relPath, { projectName } = {}) {
  ensureClaudeMd(projectDir, { projectName })
  const mdPath = claudeMdPath(projectDir)
  const text = fs.readFileSync(mdPath, 'utf-8')
  const wanted = String(relPath || '').trim()
  if (parseImports(text).some((f) => f.relPath === wanted)) return { ok: true, added: false }
  const lines = text.split('\n')
  let headerIdx = lines.findIndex((l) => l.trim() === IMPORTS_HEADER)
  if (headerIdx === -1) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push('', IMPORTS_HEADER, '')
    headerIdx = lines.length - 2
  }
  // insertar al final de la sección (justo antes del siguiente header ##)
  let insertAt = headerIdx + 1
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('## ')) break
    insertAt = i + 1
  }
  lines.splice(insertAt, 0, `@${wanted}`)
  atomicWriteFileSync(mdPath, lines.join('\n'), 'utf-8')
  return { ok: true, added: true }
}

// Quita el import (activo o desactivado) del CLAUDE.md. No toca el archivo.
function removeImport(projectDir, relPath) {
  const mdPath = claudeMdPath(projectDir)
  if (!fs.existsSync(mdPath)) return { ok: false, error: 'CLAUDE.md no existe' }
  const lines = fs.readFileSync(mdPath, 'utf-8').split('\n')
  const wanted = String(relPath || '').trim()
  const idx = lines.findIndex((l) => {
    const m = l.match(ACTIVE_IMPORT_RE) || l.match(INACTIVE_IMPORT_RE)
    return m && m[1] === wanted
  })
  if (idx === -1) return { ok: false, error: `import no encontrado: ${wanted}` }
  lines.splice(idx, 1)
  atomicWriteFileSync(mdPath, lines.join('\n'), 'utf-8')
  return { ok: true }
}

// Solo las fichas creadas por el panel (kb/fichas/) pueden ir a la Papelera;
// cualquier otro archivo importado (p. ej. .claude/memory/) jamás se borra.
function isPanelFicha(projectDir, relPath) {
  const abs = path.resolve(projectDir, String(relPath || ''))
  const fichasRoot = path.resolve(projectDir, KB_FICHAS_DIR) + path.sep
  return abs.startsWith(fichasRoot)
}

function uniqueTargetPath(dir, baseName) {
  const ext = path.extname(baseName)
  const stem = path.basename(baseName, ext)
  let candidate = path.join(dir, baseName)
  let n = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${n}${ext}`)
    n++
  }
  return candidate
}

// Escribe una ficha destilada en kb/fichas/ y devuelve su ruta relativa.
function writeFicha(projectDir, title, markdown) {
  const dir = path.join(projectDir, KB_FICHAS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const target = uniqueTargetPath(dir, `${slugify(title)}.md`)
  atomicWriteFileSync(target, String(markdown || ''), 'utf-8')
  return { ok: true, relPath: path.relative(projectDir, target) }
}

// Copia una fuente original (PDF, doc…) a kb/fuentes/.
function copySourceFile(projectDir, srcPath) {
  const st = fs.statSync(srcPath)
  if (!st.isFile()) throw new Error('la fuente no es un fichero')
  const dir = path.join(projectDir, KB_FUENTES_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const target = uniqueTargetPath(dir, path.basename(srcPath))
  fs.copyFileSync(srcPath, target)
  return { ok: true, relPath: path.relative(projectDir, target), absPath: target }
}

// --- Atajos: catálogo numerado problema → soluciones -------------------------
// Vive en kb/fichas/atajos.md (importado como cualquier ficha). La cabecera del
// fichero lleva la instrucción de uso, así el agente sabe responder a "1" o al
// título sin tocar el CLAUDE.md. Relacionados en backticks: NO son imports.

const ATAJOS_RELPATH = path.join(KB_FICHAS_DIR, 'atajos.md')
const ATAJOS_HEADER = `# Atajos — respuestas preparadas

Catálogo numerado. Cada entrada es la respuesta preparada a una pregunta o a un
caso: puede ser problema→soluciones, una pregunta frecuente, un procedimiento o
cualquier respuesta que Luismi quiera tener lista. Cuando escriba el número de
un atajo (p. ej. "1") o parte de su título, responde con el contenido de esa
entrada y sus relacionados. Si pide "atajos" o "casos", lista los títulos numerados.

Para AÑADIR un atajo (cuando Luismi diga "esto ponlo como caso", "guarda esto
como atajo" o similar): añade al final de este fichero una entrada
\`## <número siguiente> · <título>\` con su contenido y, si aplica, una línea
\`Relacionados:\` con rutas de fichas entre backticks. No renumeres los
existentes: el número siguiente es el más alto existente + 1, aunque haya
huecos. Después de escribir el fichero, comitéalo (ya tienes git por sesión
disponible): \`git add CLAUDE.md kb/ && git commit -m "kb: nuevo atajo <número> · <título>"\`.
`

const SHORTCUT_TITLE_RE = /^## (\d+) · (.+)$/
const SHORTCUT_RELATED_RE = /^Relacionados: (.+)$/
const SHORTCUT_RELATED_ITEM_RE = /`([^`]+)`/g

function formatRelatedLine(related) {
  const items = (Array.isArray(related) ? related : [])
    .map((r) => String(r || '').trim())
    .filter(Boolean)
  return items.length ? `Relacionados: ${items.map((r) => `\`${r}\``).join(', ')}` : null
}

function parseRelatedLine(line) {
  const m = String(line || '').match(SHORTCUT_RELATED_RE)
  if (!m) return null
  const items = []
  let mm
  SHORTCUT_RELATED_ITEM_RE.lastIndex = 0
  while ((mm = SHORTCUT_RELATED_ITEM_RE.exec(m[1]))) items.push(mm[1])
  return items
}

// Cada entrada devuelve también el cuerpo completo (todo el texto entre su
// cabecera "## N · título" y la siguiente, o el final del fichero) y, si la
// última línea no vacía es "Relacionados: ...", esa línea se separa en
// `related` (array) y `relatedLine` (texto crudo, para preservarla tal cual
// al reescribir la entrada aunque no se toque).
function parseShortcuts(text) {
  const lines = String(text || '').split('\n')
  const headers = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SHORTCUT_TITLE_RE)
    if (m) headers.push({ num: Number(m[1]), title: m[2].trim(), line: i })
  }
  return headers.map((h, idx) => {
    const end = idx + 1 < headers.length ? headers[idx + 1].line : lines.length
    const bodyLines = lines.slice(h.line + 1, end)
    while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop()
    while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift()
    let related = []
    let relatedLine = null
    if (bodyLines.length) {
      const parsed = parseRelatedLine(bodyLines[bodyLines.length - 1])
      if (parsed) {
        related = parsed
        relatedLine = bodyLines[bodyLines.length - 1]
        bodyLines.pop()
        while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop()
      }
    }
    return { num: h.num, title: h.title, body: bodyLines.join('\n'), related, relatedLine }
  })
}

function listShortcuts(projectDir) {
  const abs = path.resolve(projectDir, ATAJOS_RELPATH)
  let entries = []
  try { entries = parseShortcuts(fs.readFileSync(abs, 'utf-8')) } catch {}
  return { relPath: ATAJOS_RELPATH, entries }
}

// Líneas [num, title, ...] de una entrada tal y como las escribe el catálogo.
function buildShortcutLines(num, title, body, relatedLine) {
  const out = [`## ${num} · ${title}`, '', ...String(body).split('\n')]
  if (relatedLine) out.push('', relatedLine)
  out.push('')
  return out
}

function addShortcut(projectDir, { title, body, related = [] } = {}) {
  const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ')
  const cleanBody = String(body || '').trim()
  if (!cleanTitle) return { ok: false, error: 'el atajo necesita título' }
  if (!cleanBody) return { ok: false, error: 'el atajo necesita contenido' }
  const abs = path.resolve(projectDir, ATAJOS_RELPATH)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  let text = ''
  try { text = fs.readFileSync(abs, 'utf-8') } catch {}
  if (!text.trim()) text = ATAJOS_HEADER
  const nums = parseShortcuts(text).map((e) => e.num)
  const num = nums.length ? Math.max(...nums) + 1 : 1
  const relatedLine = formatRelatedLine(related)
  const entry = [''].concat(buildShortcutLines(num, cleanTitle, cleanBody, relatedLine).slice(0, -1)).join('\n')
  const joined = text.replace(/\n*$/, '\n') + entry + '\n'
  atomicWriteFileSync(abs, joined, 'utf-8')
  addImport(projectDir, ATAJOS_RELPATH)
  return { ok: true, num, relPath: ATAJOS_RELPATH }
}

// Reescribe SOLO la entrada `id`, dejando cabecera y demás entradas intactas
// byte a byte (se localizan por rango de líneas entre cabeceras "## N · …").
// Si `related` no se pasa, conserva la línea "Relacionados:" tal cual estaba.
function updateShortcut(projectDir, id, { title, body, related } = {}) {
  const num = Number(id)
  if (!Number.isInteger(num) || num <= 0) return { ok: false, error: `id inválido: ${id}` }
  const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ')
  const cleanBody = String(body || '').trim()
  if (!cleanTitle) return { ok: false, error: 'el atajo necesita título' }
  if (!cleanBody) return { ok: false, error: 'el atajo necesita contenido' }
  const abs = path.resolve(projectDir, ATAJOS_RELPATH)
  let text
  try { text = fs.readFileSync(abs, 'utf-8') } catch { return { ok: false, error: 'atajos.md no existe' } }

  const lines = text.split('\n')
  const headers = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SHORTCUT_TITLE_RE)
    if (m) headers.push({ num: Number(m[1]), line: i })
  }
  const idx = headers.findIndex((h) => h.num === num)
  if (idx === -1) return { ok: false, error: `atajo no encontrado: ${num}` }

  const relatedLine = Array.isArray(related)
    ? formatRelatedLine(related)
    : (parseShortcuts(text).find((e) => e.num === num)?.relatedLine || null)

  const start = headers[idx].line
  const end = idx + 1 < headers.length ? headers[idx + 1].line : lines.length
  lines.splice(start, end - start, ...buildShortcutLines(num, cleanTitle, cleanBody, relatedLine))
  atomicWriteFileSync(abs, lines.join('\n'), 'utf-8')
  return { ok: true, num, relPath: ATAJOS_RELPATH }
}

// Quita la entrada `id` sin renumerar el resto: los números son un catálogo
// estable (los "Relacionados" de otras fichas o lo que Luismi recuerde de
// memoria pueden citarlos), no un índice de array que deba recompactarse.
function deleteShortcut(projectDir, id) {
  const num = Number(id)
  if (!Number.isInteger(num) || num <= 0) return { ok: false, error: `id inválido: ${id}` }
  const abs = path.resolve(projectDir, ATAJOS_RELPATH)
  let text
  try { text = fs.readFileSync(abs, 'utf-8') } catch { return { ok: false, error: 'atajos.md no existe' } }

  const lines = text.split('\n')
  const headers = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SHORTCUT_TITLE_RE)
    if (m) headers.push({ num: Number(m[1]), line: i })
  }
  const idx = headers.findIndex((h) => h.num === num)
  if (idx === -1) return { ok: false, error: `atajo no encontrado: ${num}` }

  const start = headers[idx].line
  const end = idx + 1 < headers.length ? headers[idx + 1].line : lines.length
  lines.splice(start, end - start)
  while (lines.length > 1 && lines[lines.length - 1] === '' && lines[lines.length - 2] === '') lines.pop()
  atomicWriteFileSync(abs, lines.join('\n'), 'utf-8')
  return { ok: true, num, relPath: ATAJOS_RELPATH }
}

// Prompt visible que se manda a la sesión abierta para que incorpore fichas
// nuevas sin reiniciar. Rutas ABSOLUTAS del proyecto real: una sesión en
// worktree no tiene las fichas recién creadas en su copia.
function buildApplyPrompt(absPaths) {
  const files = absPaths.map((p) => `"${p}"`).join(' y ')
  const plural = absPaths.length > 1 ? 'esas fichas' : 'esa ficha'
  return `Conocimiento del proyecto actualizado: lee ${files} y responde desde ahora teniendo en cuenta ${plural}. Confirma en una línea qué has cargado.`
}

module.exports = {
  buildApplyPrompt,
  parseShortcuts,
  listShortcuts,
  addShortcut,
  updateShortcut,
  deleteShortcut,
  ATAJOS_RELPATH,
  ATAJOS_HEADER,
  listKnowledge,
  parseImports,
  toggleImport,
  addImport,
  removeImport,
  isPanelFicha,
  ensureClaudeMd,
  writeFicha,
  copySourceFile,
  estimateTokens,
  slugify,
  KB_FICHAS_DIR,
  KB_FUENTES_DIR,
  IMPORTS_HEADER
}
