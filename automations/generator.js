'use strict'

const os = require('os')
const path = require('path')
const { buildSystemPrompt } = require('./system-prompt')
const { scheduleToCalendarInterval, scheduleToStartInterval } = require('./schedule-to-cron')

const DEFAULT_PATTERNS_PATH = path.join(os.homedir(), '.claude', 'skills', 'luismi', 'automation-builder', 'patterns.md')

function extractBlock(text, tag) {
  // Acepta whitespace alrededor, multiline, captura mínima.
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i')
  const m = text.match(re)
  return m ? m[1] : null
}

function repairPlist(raw) {
  // El LLM a veces se corta y deja el plist sin cerrar </plist> al final.
  // Esto provoca "Encountered unexpected EOF" en plutil y exit 5 en launchctl bootstrap.
  // Reparamos cerrando los tags pendientes en orden inverso al stack.
  let p = String(raw).trimEnd()
  if (!/<\/plist>\s*$/i.test(p)) {
    // Cuenta abiertos vs cerrados de <dict> después del <plist version=...>
    const afterPlist = p.replace(/^[\s\S]*?<plist[^>]*>/i, '')
    const opens = (afterPlist.match(/<dict>/gi) || []).length
    const closes = (afterPlist.match(/<\/dict>/gi) || []).length
    for (let i = closes; i < opens; i++) p += '\n</dict>'
    p += '\n</plist>\n'
  } else if (!p.endsWith('\n')) {
    p += '\n'
  }
  return p
}

function formatHints({ scriptPath, plistPath, logPath, label, slug, cron, schedule }) {
  const cal = scheduleToCalendarInterval(schedule)
  const startInterval = scheduleToStartInterval(schedule)
  let triggerHint
  if (cal) {
    triggerHint = `Usa StartCalendarInterval con este valor exacto (objeto único o array de objetos):\n${JSON.stringify(cal, null, 2)}`
  } else if (startInterval) {
    triggerHint = `Usa StartInterval = ${startInterval}  (segundos)`
  } else if (schedule && schedule.type === 'advanced') {
    triggerHint = `El cron crudo es: ${cron}. launchd no entiende cron de 5 campos directamente. Traduce a StartCalendarInterval si es expresable (campos fijos o listas), o si no, usa StartInterval lo más aproximado posible. Si no es traducible, comenta el problema en EXPLANATION.`
  } else {
    triggerHint = `Cron de referencia: ${cron || '(ninguno)'}.`
  }
  return triggerHint
}

function buildUserPrompt({ name, description, schedule, cron, slug, scriptPath, plistPath, logPath, label, previousIssues }) {
  const triggerHint = formatHints({ scriptPath, plistPath, logPath, label, slug, cron, schedule })
  const regenHeader = previousIssues
    ? `REGENERACIÓN — el intento anterior tenía estos errores reportados por shellcheck:\n\n${previousIssues}\n\nCorrígelos manteniendo el resto del script igual. Devuelve los 3 bloques otra vez (SCRIPT, PLIST, EXPLANATION).\n\n---\n\n`
    : ''
  return `${regenHeader}Genera el script bash y el plist launchd para esta automatización.

# Datos concretos (úsalos tal cual)

- Nombre humano: ${name}
- Slug: ${slug}
- Label del plist: ${label}
- Ruta del script (absoluta): ${scriptPath}
- Ruta del plist (absoluta): ${plistPath}
- Ruta del log (absoluta, ya creada por el installer): ${logPath}
- Schedule (objeto del usuario): ${JSON.stringify(schedule)}
- Cron equivalente (referencia): ${cron || '(no aplicable)'}

# Disparo del plist

${triggerHint}

# Descripción del usuario (qué debe hacer el script)

${description}

# Recordatorio del formato de salida

Tres bloques exactos: <SCRIPT>...</SCRIPT>, <PLIST>...</PLIST>, <EXPLANATION>...</EXPLANATION>. Nada fuera de esos tags.`
}

function createGenerator({ runClaudeHeadless, patternsPath } = {}) {
  if (typeof runClaudeHeadless !== 'function') {
    throw new Error('createGenerator: runClaudeHeadless requerido')
  }
  const resolvedPatternsPath = patternsPath || DEFAULT_PATTERNS_PATH

  async function generate(opts) {
    const { name, description, schedule, cron, slug, scriptPath, plistPath, logPath, label, previousIssues, sessionId } = opts || {}
    if (!name) throw new Error('generator: name requerido')
    if (!description) throw new Error('generator: description requerido')
    if (!schedule) throw new Error('generator: schedule requerido')
    if (!slug) throw new Error('generator: slug requerido')
    if (!scriptPath || !plistPath || !logPath || !label) {
      throw new Error('generator: scriptPath, plistPath, logPath y label son requeridos')
    }

    const system = buildSystemPrompt({ patternsPath: resolvedPatternsPath })
    const user = buildUserPrompt({ name, description, schedule, cron, slug, scriptPath, plistPath, logPath, label, previousIssues })
    // El CLI de Claude headless toma un único prompt; concatenamos system + user con separador claro.
    // Si reusamos sessionId (regeneración), el system prompt ya está en contexto: mandamos solo user.
    const fullPrompt = sessionId ? user : `${system}\n\n---\n\n${user}`

    const result = await runClaudeHeadless({
      prompt: fullPrompt,
      sessionId: sessionId || null,
      model: 'opus',
      effort: 'high',
      cwd: os.homedir()
    })

    const text = (result && typeof result.text === 'string') ? result.text : ''
    if (!text.trim()) {
      throw new Error('generator: el LLM devolvió respuesta vacía')
    }

    const script = extractBlock(text, 'SCRIPT')
    const plist = extractBlock(text, 'PLIST')
    const explanation = extractBlock(text, 'EXPLANATION')

    const missing = []
    if (!script) missing.push('SCRIPT')
    if (!plist) missing.push('PLIST')
    if (!explanation) missing.push('EXPLANATION')
    if (missing.length) {
      const preview = text.slice(0, 400).replace(/\s+/g, ' ')
      throw new Error(`generator: faltan bloques en la respuesta del LLM: ${missing.join(', ')}. Inicio respuesta: "${preview}"`)
    }

    if (!script.startsWith('#!')) {
      throw new Error('generator: el script no empieza con shebang (#!)')
    }
    if (!plist.includes('<?xml')) {
      throw new Error('generator: el plist no contiene <?xml')
    }

    const safePlist = repairPlist(plist)

    return { script, plist: safePlist, explanation, sessionId: result?.sessionId || null }
  }

  return { generate }
}

module.exports = { createGenerator }
