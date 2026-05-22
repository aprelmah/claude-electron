'use strict'

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')

const CHAT_DIR_NAME = 'task-chats'
const MAX_HISTORY = 100
const DEFAULT_THREAD_ID = '__new_task__'

const DEFAULTS = { provider: 'claude', model: '', effort: '' }

const VALID_PROVIDERS = new Set(['claude', 'codex'])
const VALID_MODELS_BY_PROVIDER = {
  claude: new Set(['haiku', 'sonnet', 'opus']),
  codex: new Set(['gpt-5.4', 'gpt-5.4-mini', 'o3-mini', 'o3'])
}
const VALID_EFFORTS_BY_PROVIDER = {
  claude: new Set(['low', 'medium', 'high', 'xhigh', 'max']),
  codex: new Set(['low', 'medium', 'high'])
}

// Defaults internos cuando el usuario deja "" en model/effort.
// Para el asistente de creación de tareas usamos Sonnet (rapidito y razona bien)
// en Claude. En Codex dejamos el binario decidir.
const RUNTIME_DEFAULTS = {
  claude: { model: 'sonnet', effort: 'medium' },
  codex: { model: '', effort: 'medium' }
}

// Para que el asistente sepa qué MCPs puede recomendar al usuario en el prompt.
const MCPS_HINT = [
  'Google Calendar (eventos, agenda, suggest_time)',
  'Gmail (leer correo, búsquedas, enviar, etiquetar, borradores)',
  'Google Tasks (listas y tareas)',
  'Google Drive (buscar y leer ficheros)',
  'Obsidian (notas del vault)',
  'Supabase (Postgres, edge functions, migraciones)',
  'Stitch (UI mockups)',
  'context-mode (búsquedas indexadas)'
].join(', ')

const TASK_SCHEMA_TEXT = `{
  "name": string,
  "enabled": boolean,
  "cron": string (5 campos: "min hora dom mes dow"),
  "cli": "claude" | "codex",
  "cwd": string ("" = $HOME),
  "prompt": string (instrucción que se ejecuta cada vez),
  "model": "" | "haiku" | "sonnet" | "opus"   // claude
        | "" | "gpt-5.4" | "gpt-5.4-mini" | "o3-mini" | "o3"   // codex
  "effort": "" | "low" | "medium" | "high" | "xhigh" | "max"  // claude
         | "" | "low" | "medium" | "high"  // codex
  "resume": boolean,
  "sinks": { "logApp": boolean, "notifyMacOS": boolean, "telegram": boolean }
}`

const SYSTEM_INSTRUCTIONS = `Eres un asistente de POWER-AGENT que ayuda a Luismi a crear "tareas programadas".

Una tarea programada es un prompt que se ejecuta automáticamente cada cierto tiempo contra Claude o Codex en modo headless, sin que Luismi tenga que estar delante. Útil para: revisar correo cada 4h, listar eventos del día, generar resúmenes diarios, monitorizar algo, alertas, etc.

Tu trabajo: hacer las preguntas mínimas necesarias para entender qué quiere Luismi, y proponer una tarea bien formada en formato JSON dentro de un bloque <TASK>...</TASK>. Pregunta solo lo imprescindible, asume valores razonables y proponlos para que Luismi confirme o corrija.

# Schema esperado

${TASK_SCHEMA_TEXT}

# Reglas duras

1. Pregunta poco. Asume defaults razonables. Luismi confirma o corrige.
2. Modelo por defecto en Claude: "haiku" si la tarea es rutinaria (listar correo, listar eventos, recordatorios), "sonnet" si requiere algo de razonamiento (resumir, comparar, priorizar), "opus" solo si es análisis complejo. En Codex deja "" salvo que pidan modelo concreto.
3. Effort por defecto: "" (cada CLI decide) salvo que la tarea pida razonamiento alto.
4. resume: true SIEMPRE salvo que Luismi diga lo contrario. Mantener contexto entre runs es el comportamiento útil casi siempre.
5. cwd: deja vacío "" salvo que la tarea necesite un proyecto concreto. Vacío = $HOME en runtime.
6. sinks por defecto: { logApp: true, notifyMacOS: true, telegram: false }. Activa telegram solo si Luismi lo pide o tiene sentido obvio (alertas, recordatorios urgentes).
7. cli: "claude" por defecto. SOLO usa "codex" si Luismi lo pide explícitamente o si la tarea es de generación/edición de código sin MCPs.
8. cron: usa formato de 5 campos. Presets útiles:
   - "0 9 * * *" diario a las 09:00
   - "0 */4 * * *" cada 4 horas
   - "0 0 * * 1-5" laborables a medianoche
   - "*/30 * * * *" cada 30 minutos
   - "0 8 * * 1" lunes a las 08:00
   Si no está clara la frecuencia, pregunta.
9. prompt: redáctalo claro y directo, en castellano. Si la tarea necesita un MCP, MENCIONA el MCP por nombre en el prompt. Ejemplo: "Usa el MCP de Google Calendar para listar los eventos de hoy. Devuelve una lista concisa con hora y título."
10. MCPs disponibles en claude headless: ${MCPS_HINT}. Sabe explotarlos.

# Formato de salida

Cuando estés listo para proponer la tarea, devuelve UN ÚNICO bloque exactamente así (el JSON sin comentarios, válido):

<TASK>
{
  "name": "...",
  "enabled": true,
  "cron": "...",
  "cli": "claude",
  "cwd": "",
  "prompt": "...",
  "model": "haiku",
  "effort": "",
  "resume": true,
  "sinks": { "logApp": true, "notifyMacOS": true, "telegram": false }
}
</TASK>

Si todavía necesitas más información, NO devuelvas el bloque — solo conversa.
Cuando devuelvas el bloque, fuera del bloque escribe 1-2 frases cortas resumiendo qué propones y por qué (sin repetir el JSON).

# Tono

Castellano de España. Coloquial pero profesional. Sin emojis. Frases cortas. Como un colega sénior que entiende qué quiere el usuario y propone sin marear.`

function createMutex() {
  let chain = Promise.resolve()
  return function run(fn) {
    const next = chain.then(() => fn(), () => fn())
    chain = next.catch(() => {})
    return next
  }
}

async function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp`
  const json = JSON.stringify(data, null, 2)
  await fsp.writeFile(tmp, json, 'utf8')
  await fsp.rename(tmp, filePath)
}

function extractTaskBlock(text) {
  const re = /<TASK>\s*([\s\S]*?)\s*<\/TASK>/i
  const m = String(text || '').match(re)
  if (!m) return null
  return m[1].trim()
}

function stripTaskBlocks(text) {
  return String(text || '')
    .replace(/<TASK>[\s\S]*?<\/TASK>/gi, '')
    .trim()
}

function nowIso() { return new Date().toISOString() }

function emptyThread() {
  return { sessionId: null, messages: [] }
}

function normalizeProvider(p) {
  return VALID_PROVIDERS.has(p) ? p : 'claude'
}

function safeId(threadId) {
  const raw = (typeof threadId === 'string' && threadId.trim()) || DEFAULT_THREAD_ID
  // Restringe a chars seguros para nombre de fichero.
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100)
}

function validateAndNormalizeProposedTask(rawJson) {
  let parsed
  try {
    parsed = JSON.parse(rawJson)
  } catch (err) {
    throw new Error(`JSON propuesto inválido: ${err.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('La propuesta no es un objeto JSON')
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  if (!name) throw new Error('Falta "name" en la propuesta')

  const cron = typeof parsed.cron === 'string' ? parsed.cron.trim() : ''
  if (!cron) throw new Error('Falta "cron" en la propuesta')
  // Validación mínima de forma: 5 campos separados por espacios.
  if (cron.split(/\s+/).length !== 5) {
    throw new Error(`Cron debe tener 5 campos, recibido: "${cron}"`)
  }

  const cli = parsed.cli === 'codex' ? 'codex' : 'claude'

  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
  if (!prompt) throw new Error('Falta "prompt" en la propuesta')

  const validModels = VALID_MODELS_BY_PROVIDER[cli]
  const validEfforts = VALID_EFFORTS_BY_PROVIDER[cli]
  const model = (typeof parsed.model === 'string' && (parsed.model === '' || validModels.has(parsed.model)))
    ? parsed.model
    : ''
  const effort = (typeof parsed.effort === 'string' && (parsed.effort === '' || validEfforts.has(parsed.effort)))
    ? parsed.effort
    : ''

  const sinksIn = (parsed.sinks && typeof parsed.sinks === 'object') ? parsed.sinks : {}

  return {
    name,
    enabled: parsed.enabled !== false,
    cron,
    cli,
    cwd: typeof parsed.cwd === 'string' ? parsed.cwd : '',
    prompt,
    model,
    effort,
    resume: parsed.resume !== false,
    sinks: {
      logApp: sinksIn.logApp !== false,
      notifyMacOS: sinksIn.notifyMacOS !== false,
      telegram: sinksIn.telegram === true
    }
  }
}

class TaskChat {
  constructor({ runClaudeHeadless, runCodexHeadless, getScheduler, broadcast, userDataDir } = {}) {
    if (typeof runClaudeHeadless !== 'function') throw new Error('TaskChat: runClaudeHeadless requerido')
    if (typeof getScheduler !== 'function') throw new Error('TaskChat: getScheduler requerido')
    if (!userDataDir) throw new Error('TaskChat: userDataDir requerido')
    this._runClaude = runClaudeHeadless
    this._runCodex = typeof runCodexHeadless === 'function' ? runCodexHeadless : null
    this._getScheduler = getScheduler
    this._broadcast = typeof broadcast === 'function' ? broadcast : () => {}
    this._chatDir = path.join(userDataDir, CHAT_DIR_NAME)
    try { fs.mkdirSync(this._chatDir, { recursive: true }) } catch {}
    this._mutex = new Map()
  }

  _mutexFor(threadId) {
    const id = safeId(threadId)
    let m = this._mutex.get(id)
    if (!m) {
      m = createMutex()
      this._mutex.set(id, m)
    }
    return m
  }

  _filePath(threadId) {
    return path.join(this._chatDir, `${safeId(threadId)}.json`)
  }

  async _readFile(threadId) {
    try {
      const raw = await fsp.readFile(this._filePath(threadId), 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      return parsed
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
  }

  async _writeFile(threadId, data) {
    await atomicWriteJson(this._filePath(threadId), data)
  }

  async _loadOrInit(threadId) {
    const existing = await this._readFile(threadId)
    if (existing && existing.threads && existing.preferences) return existing
    return {
      threadId: safeId(threadId),
      preferences: { ...DEFAULTS },
      threads: { claude: emptyThread(), codex: emptyThread() }
    }
  }

  _ensureThread(data, provider) {
    const p = normalizeProvider(provider)
    if (!data.threads) data.threads = {}
    if (!data.threads[p]) data.threads[p] = emptyThread()
    return data.threads[p]
  }

  _emit(channel, payload) {
    try { this._broadcast(channel, payload) } catch {}
  }

  async getPreferences(threadId) {
    const data = await this._readFile(threadId)
    if (!data || !data.preferences) return { ...DEFAULTS }
    return {
      provider: normalizeProvider(data.preferences.provider) || DEFAULTS.provider,
      model: typeof data.preferences.model === 'string' ? data.preferences.model : '',
      effort: typeof data.preferences.effort === 'string' ? data.preferences.effort : ''
    }
  }

  async setPreferences(threadId, { provider, model, effort } = {}) {
    const mutex = this._mutexFor(threadId)
    return mutex(async () => {
      const data = await this._loadOrInit(threadId)
      const prefs = data.preferences || { ...DEFAULTS }

      let activeProvider = normalizeProvider(prefs.provider) || DEFAULTS.provider
      if (typeof provider === 'string' && VALID_PROVIDERS.has(provider)) {
        activeProvider = provider
        prefs.provider = provider
      }

      const validModels = VALID_MODELS_BY_PROVIDER[activeProvider]
      const validEfforts = VALID_EFFORTS_BY_PROVIDER[activeProvider]

      if (typeof model === 'string') {
        prefs.model = (model === '' || validModels.has(model)) ? model : (prefs.model || '')
      }
      if (typeof effort === 'string') {
        prefs.effort = (effort === '' || validEfforts.has(effort)) ? effort : (prefs.effort || '')
      }

      if (typeof provider === 'string' && VALID_PROVIDERS.has(provider)) {
        if (prefs.model && !validModels.has(prefs.model)) prefs.model = ''
        if (prefs.effort && !validEfforts.has(prefs.effort)) prefs.effort = ''
      }

      data.preferences = prefs
      this._ensureThread(data, activeProvider)
      await this._writeFile(threadId, data)
      return { ...prefs }
    })
  }

  async getHistory(threadId, opts = {}) {
    const data = await this._readFile(threadId)
    if (!data) return []
    const provider = normalizeProvider(opts.provider || (data.preferences && data.preferences.provider)) || DEFAULTS.provider
    const thread = (data.threads && data.threads[provider]) || emptyThread()
    const msgs = Array.isArray(thread.messages) ? thread.messages : []
    if (msgs.length <= MAX_HISTORY) return msgs
    return msgs.slice(-MAX_HISTORY)
  }

  async getLastUserMessage(threadId, { provider } = {}) {
    const data = await this._readFile(threadId)
    if (!data) return null
    const p = normalizeProvider(provider || (data.preferences && data.preferences.provider)) || DEFAULTS.provider
    const thread = (data.threads && data.threads[p]) || emptyThread()
    const msgs = Array.isArray(thread.messages) ? thread.messages : []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i] && msgs[i].role === 'user' && typeof msgs[i].content === 'string') {
        return msgs[i].content
      }
    }
    return null
  }

  _buildPreamble(history) {
    const recent = (history || []).slice(-10).map((m) => {
      const who = m.role === 'user' ? 'Usuario' : 'Agente'
      return `${who}: ${m.content}`
    }).join('\n\n')
    return [
      SYSTEM_INSTRUCTIONS,
      recent ? `\n## Conversación previa (resumen)\n${recent}\n` : ''
    ].join('\n')
  }

  async sendMessage(threadId, userMessage, opts = {}) {
    const id = safeId(threadId)
    if (!userMessage || !String(userMessage).trim()) throw new Error('sendMessage: mensaje vacío')

    const mutex = this._mutexFor(id)
    const messageId = crypto.randomUUID()

    return mutex(async () => {
      const data = await this._loadOrInit(id)
      const prefs = data.preferences || { ...DEFAULTS }

      const optProvider = (typeof opts.provider === 'string' && VALID_PROVIDERS.has(opts.provider)) ? opts.provider : null
      const provider = optProvider || normalizeProvider(prefs.provider) || DEFAULTS.provider

      const validModels = VALID_MODELS_BY_PROVIDER[provider]
      const validEfforts = VALID_EFFORTS_BY_PROVIDER[provider]

      const optModel = (typeof opts.model === 'string' && validModels.has(opts.model)) ? opts.model : null
      const optEffort = (typeof opts.effort === 'string' && validEfforts.has(opts.effort)) ? opts.effort : null
      const prefModel = (typeof prefs.model === 'string' && validModels.has(prefs.model)) ? prefs.model : null
      const prefEffort = (typeof prefs.effort === 'string' && validEfforts.has(prefs.effort)) ? prefs.effort : null
      const useModel = optModel || prefModel || RUNTIME_DEFAULTS[provider].model
      const useEffort = optEffort || prefEffort || RUNTIME_DEFAULTS[provider].effort

      if (optProvider) prefs.provider = optProvider
      if (optModel) prefs.model = optModel
      if (optEffort) prefs.effort = optEffort
      data.preferences = prefs

      if (provider === 'codex' && typeof this._runCodex !== 'function') {
        throw new Error('Codex no disponible en este build')
      }

      const thread = this._ensureThread(data, provider)
      const sessionId = thread.sessionId || null

      const userMsg = {
        id: crypto.randomUUID(),
        role: 'user',
        content: String(userMessage),
        timestamp: nowIso(),
        provider
      }
      thread.messages.push(userMsg)
      await this._writeFile(id, data)
      this._emit('task-chat:user-message', { threadId: id, provider, message: userMsg })

      const history = thread.messages.slice(0, -1)
      const preamble = this._buildPreamble(history)
      const prompt = sessionId
        ? String(userMessage)
        : `${preamble}\n\n# Mensaje del usuario\n${userMessage}`

      const runner = provider === 'codex' ? this._runCodex : this._runClaude

      let collected = ''
      let newSessionId = sessionId
      try {
        const result = await runner({
          prompt,
          sessionId: sessionId || null,
          model: useModel,
          effort: useEffort,
          cwd: require('os').homedir(),
          onText: (chunk) => {
            collected += String(chunk || '')
            this._emit('task-chat:token', {
              threadId: id,
              provider,
              messageId,
              token: String(chunk || '')
            })
          },
          onSessionId: (sid) => {
            if (sid) newSessionId = sid
          }
        })
        if (result && result.text && !collected) collected = result.text
        if (result && result.sessionId) newSessionId = result.sessionId
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err)
        try {
          const sysMsg = {
            id: crypto.randomUUID(),
            role: 'system',
            kind: 'provider-error',
            content: errMsg,
            error: errMsg,
            lastUserMessage: String(userMessage),
            timestamp: nowIso(),
            provider
          }
          const fresh = (await this._readFile(id)) || data
          const freshThread = this._ensureThread(fresh, provider)
          freshThread.messages.push(sysMsg)
          fresh.preferences = prefs
          await this._writeFile(id, fresh)
        } catch {}
        this._emit('task-chat:error', { threadId: id, provider, messageId, error: errMsg })
        this._emit('task-chat:provider-error', {
          threadId: id,
          provider,
          error: errMsg,
          lastUserMessage: String(userMessage),
          messageId
        })
        return { ok: false, providerError: true, error: errMsg, provider, messageId }
      }

      const rawTask = extractTaskBlock(collected)
      let proposedTask = null
      let proposedTaskError = null
      if (rawTask) {
        try {
          proposedTask = validateAndNormalizeProposedTask(rawTask)
        } catch (err) {
          proposedTaskError = err.message
        }
      }

      const visibleText = stripTaskBlocks(collected) || (proposedTask
        ? '(Propuesta de tarea lista — pulsa "Aplicar" para crearla.)'
        : collected.trim())

      const agentMsg = {
        id: messageId,
        role: 'assistant',
        content: visibleText,
        rawContent: collected,
        timestamp: nowIso(),
        provider,
        proposedTask: proposedTask || null,
        proposedTaskRaw: rawTask || null,
        proposedTaskError: proposedTaskError || null
      }

      const fresh = (await this._readFile(id)) || data
      const freshThread = this._ensureThread(fresh, provider)
      freshThread.messages.push(agentMsg)
      freshThread.sessionId = newSessionId || freshThread.sessionId
      fresh.preferences = prefs
      await this._writeFile(id, fresh)

      this._emit('task-chat:message-done', { threadId: id, provider, messageId, message: agentMsg })
      return { ok: true, messageId, message: agentMsg, provider }
    })
  }

  async switchProvider(threadId, { toProvider, withSummary } = {}) {
    if (!VALID_PROVIDERS.has(toProvider)) throw new Error('switchProvider: toProvider inválido')
    const id = safeId(threadId)
    const mutex = this._mutexFor(id)
    return mutex(async () => {
      const data = await this._loadOrInit(id)
      const prefs = data.preferences || { ...DEFAULTS }
      const fromProvider = normalizeProvider(prefs.provider) || DEFAULTS.provider

      let summary = null
      if (withSummary && fromProvider !== toProvider) {
        summary = this._buildSummary(data, fromProvider)
      }

      prefs.provider = toProvider
      const validModels = VALID_MODELS_BY_PROVIDER[toProvider]
      const validEfforts = VALID_EFFORTS_BY_PROVIDER[toProvider]
      if (prefs.model && !validModels.has(prefs.model)) prefs.model = ''
      if (prefs.effort && !validEfforts.has(prefs.effort)) prefs.effort = ''
      data.preferences = prefs
      this._ensureThread(data, toProvider)
      await this._writeFile(id, data)

      return { ok: true, fromProvider, toProvider, preferences: { ...prefs }, summary }
    })
  }

  async clearThread(threadId, { provider } = {}) {
    const target = normalizeProvider(provider) || DEFAULTS.provider
    const id = safeId(threadId)
    const mutex = this._mutexFor(id)
    return mutex(async () => {
      const data = await this._loadOrInit(id)
      data.threads = data.threads || {}
      data.threads[target] = emptyThread()
      await this._writeFile(id, data)
      this._emit('task-chat:thread-cleared', { threadId: id, provider: target })
      return { ok: true, provider: target }
    })
  }

  _buildSummary(data, fromProvider) {
    const fromLabel = fromProvider === 'codex' ? 'Codex' : 'Claude'
    const thread = (data.threads && data.threads[fromProvider]) || emptyThread()
    const msgs = Array.isArray(thread.messages) ? thread.messages : []
    const recent = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-6)
    const lines = recent.map((m) => {
      const who = m.role === 'user' ? 'usuario' : 'agente'
      const content = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 200)
      return `  · [${who}]: ${content}`
    }).join('\n')
    return [
      `Vengo de una conversación con ${fromLabel} en la que estábamos definiendo una nueva tarea programada.`,
      `Resumen de los últimos ${recent.length} mensajes:`,
      lines || '  · (sin historial previo)',
      ``,
      `Sigue ayudándome desde aquí.`
    ].join('\n')
  }

  async applyChanges(threadId, { taskJson, taskOverride } = {}) {
    const scheduler = this._getScheduler()
    if (!scheduler) return { ok: false, error: 'Scheduler no inicializado' }

    // El renderer puede pasar el JSON crudo (string) o un objeto override (tras edits).
    let proposed = null
    if (taskOverride && typeof taskOverride === 'object') {
      try {
        proposed = validateAndNormalizeProposedTask(JSON.stringify(taskOverride))
      } catch (err) {
        return { ok: false, error: err.message }
      }
    } else if (typeof taskJson === 'string' && taskJson.trim()) {
      try {
        proposed = validateAndNormalizeProposedTask(taskJson)
      } catch (err) {
        return { ok: false, error: err.message }
      }
    } else {
      // Fallback: leer último assistant message del thread activo y extraerlo.
      const data = await this._readFile(threadId)
      const prefs = (data && data.preferences) || DEFAULTS
      const provider = normalizeProvider(prefs.provider) || DEFAULTS.provider
      const thread = (data && data.threads && data.threads[provider]) || emptyThread()
      const msgs = Array.isArray(thread.messages) ? thread.messages : []
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        if (m && m.role === 'assistant' && m.proposedTask) {
          proposed = m.proposedTask
          break
        }
        if (m && m.role === 'assistant' && m.proposedTaskRaw) {
          try { proposed = validateAndNormalizeProposedTask(m.proposedTaskRaw) } catch {}
          if (proposed) break
        }
      }
      if (!proposed) return { ok: false, error: 'No hay propuesta de tarea para aplicar' }
    }

    try {
      const created = await scheduler.upsertTask(proposed)
      return { ok: true, id: created && created.id, task: created }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }

  async deleteChat(threadId) {
    try { await fsp.unlink(this._filePath(threadId)) } catch {}
    return { ok: true }
  }
}

module.exports = {
  TaskChat,
  createTaskChat: (opts) => new TaskChat(opts),
  DEFAULT_THREAD_ID,
  validateAndNormalizeProposedTask
}
