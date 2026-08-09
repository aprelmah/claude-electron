'use strict'

const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const { atomicWriteFileAsync } = require('./atomic-writes')
const { normalizeSkills } = require('./execution-policy')

const MAX_SKILL_BYTES = 80 * 1024
const MAX_PROMPT_BYTES = 120 * 1024
const SKILL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i

function isSafeSkillId(id) {
  return SKILL_ID_RE.test(String(id || '').trim())
}

function parseSkillMetadata(raw, fallbackId) {
  const text = String(raw || '')
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)
  const fields = {}
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(':')
      if (separator <= 0) continue
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
      if (key) fields[key] = value
    }
  }
  return {
    id: fallbackId,
    name: fields.name || fallbackId,
    description: fields.description || '',
  }
}

function readSkillFile(filePath, source, readOnly) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) return null
    const content = fs.readFileSync(filePath, 'utf8')
    const id = path.basename(path.dirname(filePath))
    if (!isSafeSkillId(id)) return null
    const metadata = parseSkillMetadata(content, id)
    return {
      ...metadata,
      source,
      readOnly: readOnly === true,
      filePath,
      content,
      updatedAt: stat.mtimeMs,
    }
  } catch {
    return null
  }
}

function rootCandidates({ userDataDir, cwd } = {}) {
  const roots = []
  if (cwd) roots.push({ root: path.join(cwd, '.power-agent', 'skills'), source: 'project', readOnly: false })
  if (userDataDir) roots.push({ root: path.join(userDataDir, 'skills'), source: 'user', readOnly: false })
  roots.push({ root: path.join(os.homedir(), '.claude', 'skills'), source: 'claude', readOnly: true })
  roots.push({ root: path.join(os.homedir(), '.agents', 'skills'), source: 'agents', readOnly: true })
  return roots
}

function discoverSkills(options = {}) {
  const byId = new Map()
  for (const candidate of rootCandidates(options)) {
    let entries
    try { entries = fs.readdirSync(candidate.root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeSkillId(entry.name)) continue
      const filePath = path.join(candidate.root, entry.name, 'SKILL.md')
      const skill = readSkillFile(filePath, candidate.source, candidate.readOnly)
      if (skill && !byId.has(skill.id)) byId.set(skill.id, skill)
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map(({ content, filePath, ...metadata }) => metadata)
}

function findSkill(options = {}, id) {
  const normalizedId = String(id || '').trim()
  if (!isSafeSkillId(normalizedId)) return null
  for (const candidate of rootCandidates(options)) {
    const skill = readSkillFile(
      path.join(candidate.root, normalizedId, 'SKILL.md'),
      candidate.source,
      candidate.readOnly
    )
    if (skill) return skill
  }
  return null
}

function loadSkillsForPrompt(options = {}, requestedSkills) {
  const ids = normalizeSkills(requestedSkills)
  if (!ids.length) return { text: '', loaded: [], missing: [] }
  const loaded = []
  const missing = []
  let totalBytes = 0
  for (const id of ids) {
    const skill = findSkill(options, id)
    if (!skill) {
      missing.push(id)
      continue
    }
    const remaining = MAX_PROMPT_BYTES - totalBytes
    if (remaining <= 0) {
      missing.push(id + ' (límite de contexto)')
      continue
    }
    const content = skill.content.slice(0, remaining)
    totalBytes += Buffer.byteLength(content, 'utf8')
    loaded.push({ id: skill.id, name: skill.name, content })
  }
  const text = loaded.length
    ? [
      'POWER-AGENT SKILLS (instrucciones reutilizables seleccionadas para esta tarea):',
      ...loaded.map((skill) => '\n--- skill: ' + skill.id + ' ---\n' + skill.content),
      '\nFIN POWER-AGENT SKILLS.'
    ].join('\n')
    : ''
  return { text, loaded: loaded.map(({ id, name }) => ({ id, name })), missing }
}

async function saveSkill({ userDataDir, id, content, name, description } = {}) {
  const normalizedId = String(id || '').trim().toLowerCase()
  if (!userDataDir) throw new Error('skills: userDataDir requerido')
  if (!isSafeSkillId(normalizedId)) throw new Error('skills: id inválido')
  const body = String(content || '').trim()
  if (!body) throw new Error('skills: contenido vacío')
  if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_BYTES) throw new Error('skills: contenido demasiado grande')
  const dir = path.join(userDataDir, 'skills', normalizedId)
  const filePath = path.join(dir, 'SKILL.md')
  const frontmatter = [
    '---',
    'name: ' + String(name || normalizedId).trim(),
    'description: ' + String(description || '').trim(),
    '---',
    '',
  ].join('\n')
  await fsp.mkdir(dir, { recursive: true })
  await atomicWriteFileAsync(filePath, frontmatter + body + '\n', 'utf8')
  return { id: normalizedId, filePath }
}

module.exports = {
  MAX_SKILL_BYTES,
  isSafeSkillId,
  parseSkillMetadata,
  discoverSkills,
  findSkill,
  loadSkillsForPrompt,
  saveSkill,
  _internal: { rootCandidates, readSkillFile },
}
