'use strict'

// Parser y filesystem helpers para el agente PTY (automatizaciones).
// - stripAnsi/flattenTerminal/extractAgentBlocks/blocksEqual: parser de bloques
//   <SCRIPT>/<PLIST>/<DESCRIPCION> en el stream del PTY (legacy fallback, hoy
//   la fuente de verdad es el filesystem).
// - proposalPaths/ensureProposalDir/clearProposalFromDisk/readProposalFromDisk:
//   gestión del directorio /tmp/poweragent-proposal/{id}/ donde el agente
//   escribe script.sh, plist.plist, description.txt y READY.

const fs = require('fs')
const path = require('path')

const ANSI_RE = /\x1B\[[0-9;?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[@-Z\\-_]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

function stripAnsi(s) {
  if (!s) return ''
  return s.replace(ANSI_RE, '')
}

// Quita line-wrapping del terminal: claude code repinta líneas con \r y a veces
// inserta saltos suaves. También quita caracteres de "box drawing" del TUI para no
// confundir los matches.
function flattenTerminal(s) {
  if (!s) return ''
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[─-╿▀-▟■-◿]/g, ' ')
}

function extractAgentBlocks(buffer) {
  const clean = flattenTerminal(stripAnsi(buffer))

  const xmlGrab = (tag) => {
    const re = new RegExp(`<\\s*${tag}\\s*>([\\s\\S]*?)<\\s*/\\s*${tag}\\s*>`, 'i')
    const m = clean.match(re)
    return m ? m[1].trim() : null
  }

  let script = xmlGrab('SCRIPT')
  let plist = xmlGrab('PLIST')
  let description = xmlGrab('DESCRIPCION') || xmlGrab('DESCRIPTION')

  if (!script || !plist) {
    const fenceRe = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g
    let m
    while ((m = fenceRe.exec(clean)) !== null) {
      const lang = (m[1] || '').toLowerCase()
      const body = m[2] || ''
      if (!script && /^(bash|sh|shell|zsh)$/i.test(lang) && body.includes('#!/')) {
        script = body.trim()
      } else if (!plist && /^(xml|plist)$/i.test(lang) && body.includes('<plist')) {
        plist = body.trim()
      }
    }
  }

  const isRealScript = (text) => {
    if (!text || text.length < 40) return false
    if (!text.includes('#!')) return false
    return true
  }
  const isRealPlist = (text) => {
    if (!text || text.length < 80) return false
    if (!/<\?xml|<plist/i.test(text)) return false
    if (!/<\/plist>/i.test(text)) return false
    return true
  }
  const isRealDescription = (text) => {
    if (!text || text.length < 10) return false
    return true
  }

  if (!isRealScript(script)) script = null
  if (!isRealPlist(plist)) plist = null
  if (!isRealDescription(description)) description = null

  if (!script || !plist) return null
  return { script, plist, description }
}

function blocksEqual(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.script === b.script && a.plist === b.plist && a.description === b.description
}

// ── TASK proposal helpers (agente de creación de tareas programadas) ─────
//
// El agente PTY de tareas emite UN bloque <TASK>{...json...}</TASK> y/o
// escribe el archivo task.json + READY a disco. Validamos el JSON contra el
// schema mínimo. Devuelve { task, raw } o null.

const TASK_SCHEMA_KEYS = new Set([
  'name', 'enabled', 'cron', 'cli', 'cwd', 'prompt',
  'model', 'effort', 'resume', 'sinks'
])

function extractTaskBlock(buffer) {
  const clean = flattenTerminal(stripAnsi(buffer))
  const re = /<\s*TASK\s*>([\s\S]*?)<\s*\/\s*TASK\s*>/i
  const m = clean.match(re)
  if (!m) return null
  const body = m[1].trim()
  return parseTaskJson(body)
}

function parseTaskJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let text = raw.trim()
  // Aísla el primer objeto JSON balanceado si hay texto extra alrededor.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  if (!text.startsWith('{')) {
    const i = text.indexOf('{')
    if (i >= 0) text = text.slice(i)
  }
  let obj
  try { obj = JSON.parse(text) } catch {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try { obj = JSON.parse(text.slice(first, last + 1)) } catch {}
    }
    if (!obj) return null
  }
  if (!obj || typeof obj !== 'object') return null
  const task = sanitizeTask(obj)
  if (!task) return null
  return { task, raw }
}

function sanitizeTask(obj) {
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  const cron = typeof obj.cron === 'string' ? obj.cron.trim() : ''
  const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : ''
  if (!name || !cron || !prompt) return null
  // Validación cron: 5 campos básicos.
  if (cron.split(/\s+/).length < 5) return null

  const cli = obj.cli === 'codex' ? 'codex' : 'claude'
  const sinks = (obj.sinks && typeof obj.sinks === 'object') ? obj.sinks : {}
  return {
    name,
    enabled: obj.enabled !== false,
    cron,
    cli,
    cwd: typeof obj.cwd === 'string' ? obj.cwd : '',
    prompt,
    model: typeof obj.model === 'string' ? obj.model : '',
    effort: typeof obj.effort === 'string' ? obj.effort : '',
    resume: obj.resume !== false,
    sinks: {
      logApp: sinks.logApp !== false,
      notifyMacOS: !!sinks.notifyMacOS,
      telegram: !!sinks.telegram
    }
  }
}

function taskBlocksEqual(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  const at = a.task, bt = b.task
  if (!at || !bt) return false
  try { return JSON.stringify(at) === JSON.stringify(bt) } catch { return false }
}

function createTaskProposalFiles(proposalBase) {
  function taskProposalPaths(sessionId) {
    const dir = path.join(proposalBase, 'task-' + sessionId)
    return {
      dir,
      task: path.join(dir, 'task.json'),
      ready: path.join(dir, 'READY')
    }
  }

  function ensureTaskProposalDir(sessionId) {
    const p = taskProposalPaths(sessionId)
    try { fs.mkdirSync(p.dir, { recursive: true }) } catch {}
    for (const f of [p.task, p.ready]) {
      try { fs.unlinkSync(f) } catch {}
    }
    return p
  }

  function clearTaskProposalFromDisk(sessionId) {
    const p = taskProposalPaths(sessionId)
    for (const f of [p.task, p.ready]) {
      try { fs.unlinkSync(f) } catch {}
    }
  }

  function readTaskProposalFromDisk(sessionId) {
    const p = taskProposalPaths(sessionId)
    try {
      if (!fs.existsSync(p.ready)) return null
      if (!fs.existsSync(p.task)) return null
      const raw = fs.readFileSync(p.task, 'utf8')
      const parsed = parseTaskJson(raw)
      return parsed
    } catch {
      return null
    }
  }

  return {
    taskProposalPaths,
    ensureTaskProposalDir,
    clearTaskProposalFromDisk,
    readTaskProposalFromDisk
  }
}

function createProposalFiles(proposalBase) {
  function proposalPaths(automationId) {
    const dir = path.join(proposalBase, automationId)
    return {
      dir,
      script: path.join(dir, 'script.sh'),
      plist: path.join(dir, 'plist.plist'),
      description: path.join(dir, 'description.txt'),
      ready: path.join(dir, 'READY')
    }
  }

  function ensureProposalDir(automationId) {
    const p = proposalPaths(automationId)
    try { fs.mkdirSync(p.dir, { recursive: true }) } catch {}
    for (const f of [p.script, p.plist, p.description, p.ready]) {
      try { fs.unlinkSync(f) } catch {}
    }
    return p
  }

  function clearProposalFromDisk(automationId) {
    const p = proposalPaths(automationId)
    for (const f of [p.script, p.plist, p.description, p.ready]) {
      try { fs.unlinkSync(f) } catch {}
    }
  }

  function readProposalFromDisk(automationId) {
    const p = proposalPaths(automationId)
    try {
      if (!fs.existsSync(p.ready)) return null
      if (!fs.existsSync(p.script) || !fs.existsSync(p.plist)) return null
      const script = fs.readFileSync(p.script, 'utf8')
      const plist = fs.readFileSync(p.plist, 'utf8')
      let description = ''
      try { description = fs.readFileSync(p.description, 'utf8') } catch {}
      if (!script || !script.includes('#!')) return null
      if (!plist || !/<plist[\s>]/i.test(plist) || !/<\/plist>/i.test(plist)) return null
      return {
        script: script.trim(),
        plist: plist.trim(),
        description: description.trim() || null
      }
    } catch {
      return null
    }
  }

  return {
    proposalPaths,
    ensureProposalDir,
    clearProposalFromDisk,
    readProposalFromDisk
  }
}

module.exports = {
  ANSI_RE,
  stripAnsi,
  flattenTerminal,
  extractAgentBlocks,
  blocksEqual,
  createProposalFiles,
  // Task agent (creación de tareas programadas)
  extractTaskBlock,
  parseTaskJson,
  sanitizeTask,
  taskBlocksEqual,
  createTaskProposalFiles,
  TASK_SCHEMA_KEYS
}
