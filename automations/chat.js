'use strict'

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { lintScript } = require('./validator')

const CHAT_DIR_NAME = 'automation-chats'
const MAX_HISTORY = 100

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
const RUNTIME_DEFAULTS = {
  claude: { model: 'opus', effort: 'high' },
  codex: { model: '', effort: 'high' }
}

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

function extractBlock(text, tag) {
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i')
  const m = String(text || '').match(re)
  return m ? m[1] : null
}

function stripBlocks(text) {
  return String(text || '')
    .replace(/<SCRIPT>[\s\S]*?<\/SCRIPT>/gi, '')
    .replace(/<PLIST>[\s\S]*?<\/PLIST>/gi, '')
    .trim()
}

function nowIso() {
  return new Date().toISOString()
}

const SYSTEM_INSTRUCTIONS = `Eres el agente que creó esta automation de POWER-AGENT. Mantienes una conversación
con el usuario sobre el script bash y el plist launchd que escribiste.

REGLAS DE FORMATO IMPORTANTÍSIMAS:
- Si propones modificar el script bash, devuélvelo COMPLETO dentro de <SCRIPT>...</SCRIPT>.
- Si propones modificar el plist, devuélvelo COMPLETO dentro de <PLIST>...</PLIST>.
- Si solo es una explicación o respuesta conversacional, NO uses esos tags.
- Fuera de los tags, da un resumen breve y claro de los cambios propuestos y su porqué.
- No uses comillas triples ni markdown code fences para el script/plist (usa los tags).
- Si el usuario pega un log de error, analiza el error concreto y propón el cambio mínimo necesario.`

function emptyThread() {
  return { sessionId: null, messages: [] }
}

function normalizeProvider(p) {
  return VALID_PROVIDERS.has(p) ? p : 'claude'
}

class AutomationChat {
  constructor({ runClaudeHeadless, runCodexHeadless, persistence, automationManager, broadcast, userDataDir } = {}) {
    if (typeof runClaudeHeadless !== 'function') throw new Error('AutomationChat: runClaudeHeadless requerido')
    if (!persistence) throw new Error('AutomationChat: persistence requerido')
    if (!automationManager) throw new Error('AutomationChat: automationManager requerido')
    if (!userDataDir) throw new Error('AutomationChat: userDataDir requerido')
    this._runClaude = runClaudeHeadless
    this._runCodex = typeof runCodexHeadless === 'function' ? runCodexHeadless : null
    this._persistence = persistence
    this._am = automationManager
    this._broadcast = typeof broadcast === 'function' ? broadcast : () => {}
    this._chatDir = path.join(userDataDir, CHAT_DIR_NAME)
    try { fs.mkdirSync(this._chatDir, { recursive: true }) } catch {}
    this._mutex = new Map()
  }

  _mutexFor(automationId) {
    let m = this._mutex.get(automationId)
    if (!m) {
      m = createMutex()
      this._mutex.set(automationId, m)
    }
    return m
  }

  _filePath(automationId) {
    return path.join(this._chatDir, `${automationId}.json`)
  }

  async _readFile(automationId) {
    try {
      const raw = await fsp.readFile(this._filePath(automationId), 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      return parsed
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
  }

  async _writeFile(automationId, data) {
    await atomicWriteJson(this._filePath(automationId), data)
  }

  _migrate(data, automationId, automation) {
    // Forma nueva ya: threads + preferences.
    if (data && data.threads && data.preferences) return data

    // Forma vieja: { automationId, sessionId, messages, modelPref, effortPref }
    const old = data || {}
    const oldMessages = Array.isArray(old.messages) ? old.messages : []
    const oldSession = old.sessionId || (automation && automation.chatSessionId) || null

    return {
      automationId,
      preferences: {
        provider: normalizeProvider(old.provider) || DEFAULTS.provider,
        model: typeof old.modelPref === 'string' ? old.modelPref : '',
        effort: typeof old.effortPref === 'string' ? old.effortPref : ''
      },
      threads: {
        claude: { sessionId: oldSession, messages: oldMessages },
        codex: emptyThread()
      }
    }
  }

  async _loadOrInit(automationId, automation) {
    const existing = await this._readFile(automationId)
    if (existing && existing.threads && existing.preferences) return existing
    if (existing) {
      const migrated = this._migrate(existing, automationId, automation)
      try { await this._writeFile(automationId, migrated) } catch {}
      return migrated
    }
    return {
      automationId,
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

  async getPreferences(automationId) {
    if (!automationId) return { ...DEFAULTS }
    const data = await this._readFile(automationId)
    if (!data) return { ...DEFAULTS }
    if (!data.preferences) {
      const migrated = this._migrate(data, automationId, null)
      return { ...migrated.preferences }
    }
    return {
      provider: normalizeProvider(data.preferences.provider) || DEFAULTS.provider,
      model: typeof data.preferences.model === 'string' ? data.preferences.model : '',
      effort: typeof data.preferences.effort === 'string' ? data.preferences.effort : ''
    }
  }

  async setPreferences(automationId, { provider, model, effort } = {}) {
    if (!automationId) throw new Error('setPreferences: automationId requerido')
    const mutex = this._mutexFor(automationId)
    return mutex(async () => {
      const automation = await this._am.get(automationId)
      const data = await this._loadOrInit(automationId, automation)
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

      // Si tras el cambio de provider, el model/effort previo no aplica → resetear a "".
      if (typeof provider === 'string' && VALID_PROVIDERS.has(provider)) {
        if (prefs.model && !validModels.has(prefs.model)) prefs.model = ''
        if (prefs.effort && !validEfforts.has(prefs.effort)) prefs.effort = ''
      }

      data.preferences = prefs
      this._ensureThread(data, activeProvider)
      await this._writeFile(automationId, data)
      return { ...prefs }
    })
  }

  async getHistory(automationId, opts = {}) {
    const data = await this._readFile(automationId)
    if (!data) return []
    const migrated = (data.threads && data.preferences) ? data : this._migrate(data, automationId, null)
    const provider = normalizeProvider(opts.provider || migrated.preferences.provider) || DEFAULTS.provider
    const thread = migrated.threads[provider] || emptyThread()
    const msgs = Array.isArray(thread.messages) ? thread.messages : []
    if (msgs.length <= MAX_HISTORY) return msgs
    return msgs.slice(-MAX_HISTORY)
  }

  _emit(channel, payload) {
    try { this._broadcast(channel, payload) } catch {}
  }

  _buildContextPreamble(automation, history, logTail) {
    const recent = (history || []).slice(-10).map((m) => {
      const who = m.role === 'user' ? 'Usuario' : 'Agente'
      return `${who}: ${m.content}`
    }).join('\n\n')

    return [
      SYSTEM_INSTRUCTIONS,
      '',
      `# Automation: ${automation.name || automation.slug || automation.id}`,
      `- Slug: ${automation.slug || '—'}`,
      `- Cron: ${automation.cron || '—'}`,
      `- Script path: ${automation.scriptPath || '—'}`,
      `- Plist path: ${automation.plistPath || '—'}`,
      `- Log path: ${automation.logPath || '—'}`,
      `- Estado actual: ${automation.status || '—'}`,
      '',
      '## Descripción original del usuario',
      automation.description || '(sin descripción)',
      '',
      '## Script ACTUAL',
      '```bash',
      automation.generatedScript || '(vacío)',
      '```',
      '',
      '## Plist ACTUAL',
      '```xml',
      automation.generatedPlist || '(vacío)',
      '```',
      logTail
        ? `## Últimas líneas del log\n\`\`\`\n${logTail}\n\`\`\`\n`
        : '',
      recent
        ? `## Conversación previa (resumen)\n${recent}\n`
        : ''
    ].join('\n')
  }

  async sendMessage(automationId, userMessage, opts = {}) {
    if (!automationId) throw new Error('sendMessage: automationId requerido')
    if (!userMessage || !String(userMessage).trim()) throw new Error('sendMessage: mensaje vacío')

    const automation = await this._am.get(automationId)
    if (!automation) throw new Error(`Automation no encontrada: ${automationId}`)

    const mutex = this._mutexFor(automationId)
    const messageId = crypto.randomUUID()

    return mutex(async () => {
      const data = await this._loadOrInit(automationId, automation)
      const prefs = data.preferences || { ...DEFAULTS }

      // Resolver provider: opts > preferencia > default.
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

      // Persistir cambios live de preferencias.
      if (optProvider) prefs.provider = optProvider
      if (optModel) prefs.model = optModel
      if (optEffort) prefs.effort = optEffort
      data.preferences = prefs

      // Codex check.
      if (provider === 'codex' && typeof this._runCodex !== 'function') {
        throw new Error('Codex no disponible en este build')
      }

      const thread = this._ensureThread(data, provider)
      const sessionId = thread.sessionId || null

      // Log tail opcional.
      let logTail = ''
      if (opts.includeLog) {
        try {
          const tail = await this._am.readLog(automationId, { lines: 80 })
          logTail = String(tail || '').slice(-4000)
        } catch {}
      }

      // Persistir mensaje usuario en el thread del provider activo.
      const userMsg = {
        id: crypto.randomUUID(),
        role: 'user',
        content: String(userMessage),
        timestamp: nowIso(),
        provider
      }
      thread.messages.push(userMsg)
      await this._writeFile(automationId, data)
      this._emit('automation-chat:user-message', { automationId, provider, message: userMsg })

      // Prompt.
      const history = thread.messages.slice(0, -1)
      const preamble = this._buildContextPreamble(automation, history, logTail)
      const prompt = sessionId
        ? `${logTail ? `Últimas líneas del log:\n\`\`\`\n${logTail}\n\`\`\`\n\n` : ''}${userMessage}`
        : `${preamble}\n\n# Mensaje del usuario\n${userMessage}`

      // Runner según provider.
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
            this._emit('automation-chat:token', {
              automationId,
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
        // Persistir mensaje system con el fallo del provider (no como mensaje normal del agente).
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
          const fresh = (await this._readFile(automationId)) || data
          const freshNorm = (fresh.threads && fresh.preferences) ? fresh : this._migrate(fresh, automationId, automation)
          const freshThread = this._ensureThread(freshNorm, provider)
          freshThread.messages.push(sysMsg)
          freshNorm.preferences = prefs
          await this._writeFile(automationId, freshNorm)
        } catch {}
        this._emit('automation-chat:error', { automationId, provider, messageId, error: errMsg })
        this._emit('automation-chat:provider-error', {
          automationId,
          provider,
          error: errMsg,
          lastUserMessage: String(userMessage),
          messageId
        })
        return { ok: false, providerError: true, error: errMsg, provider, messageId }
      }

      const proposedScript = extractBlock(collected, 'SCRIPT')
      const proposedPlist = extractBlock(collected, 'PLIST')
      const visibleText = stripBlocks(collected) || (proposedScript || proposedPlist
        ? '(El agente propone cambios — pulsa "Aplicar" para revisarlos.)'
        : collected.trim())

      const agentMsg = {
        id: messageId,
        role: 'assistant',
        content: visibleText,
        rawContent: collected,
        timestamp: nowIso(),
        provider,
        proposedScript: proposedScript || null,
        proposedPlist: proposedPlist || null
      }

      const fresh = (await this._readFile(automationId)) || data
      const freshNorm = (fresh.threads && fresh.preferences) ? fresh : this._migrate(fresh, automationId, automation)
      const freshThread = this._ensureThread(freshNorm, provider)
      freshThread.messages.push(agentMsg)
      freshThread.sessionId = newSessionId || freshThread.sessionId
      freshNorm.preferences = prefs
      await this._writeFile(automationId, freshNorm)

      // Persistir sessionId solo si provider === 'claude' (compatibilidad con automation.chatSessionId).
      if (provider === 'claude' && newSessionId && (!automation.chatSessionId || automation.chatSessionId !== newSessionId)) {
        try {
          const current = await this._am.get(automationId)
          if (current) {
            await this._persistence.upsert({
              ...current,
              chatSessionId: newSessionId,
              updatedAt: nowIso()
            })
          }
        } catch {}
      }

      this._emit('automation-chat:message-done', { automationId, provider, messageId, message: agentMsg })
      return { ok: true, messageId, message: agentMsg, provider }
    })
  }

  async switchProvider(automationId, { toProvider, withSummary } = {}) {
    if (!automationId) throw new Error('switchProvider: automationId requerido')
    if (!VALID_PROVIDERS.has(toProvider)) throw new Error('switchProvider: toProvider inválido')
    const mutex = this._mutexFor(automationId)
    return mutex(async () => {
      const automation = await this._am.get(automationId)
      const data = await this._loadOrInit(automationId, automation)
      const prefs = data.preferences || { ...DEFAULTS }
      const fromProvider = normalizeProvider(prefs.provider) || DEFAULTS.provider

      let summary = null
      if (withSummary && fromProvider !== toProvider) {
        summary = this._buildContextSummaryFromData(data, automation, fromProvider)
      }

      // Cambiar provider activo. Resetear model/effort si no aplican al nuevo provider.
      prefs.provider = toProvider
      const validModels = VALID_MODELS_BY_PROVIDER[toProvider]
      const validEfforts = VALID_EFFORTS_BY_PROVIDER[toProvider]
      if (prefs.model && !validModels.has(prefs.model)) prefs.model = ''
      if (prefs.effort && !validEfforts.has(prefs.effort)) prefs.effort = ''
      data.preferences = prefs
      this._ensureThread(data, toProvider)
      await this._writeFile(automationId, data)

      return { ok: true, fromProvider, toProvider, preferences: { ...prefs }, summary }
    })
  }

  async clearThread(automationId, { provider } = {}) {
    if (!automationId) throw new Error('clearThread: automationId requerido')
    const target = normalizeProvider(provider) || DEFAULTS.provider
    const mutex = this._mutexFor(automationId)
    return mutex(async () => {
      const automation = await this._am.get(automationId)
      const data = await this._loadOrInit(automationId, automation)
      data.threads = data.threads || {}
      data.threads[target] = emptyThread()
      await this._writeFile(automationId, data)
      this._emit('automation-chat:thread-cleared', { automationId, provider: target })
      return { ok: true, provider: target }
    })
  }

  _buildContextSummaryFromData(data, automation, fromProvider) {
    const fromLabel = fromProvider === 'codex' ? 'Codex' : 'Claude'
    const thread = (data.threads && data.threads[fromProvider]) || emptyThread()
    const msgs = Array.isArray(thread.messages) ? thread.messages : []
    const recent = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-6)

    const name = (automation && (automation.name || automation.slug || automation.id)) || '(sin nombre)'
    const description = (automation && automation.description) ? String(automation.description).split('\n')[0].trim() : '(sin descripción)'

    let lastLog = ''
    try {
      // No bloqueamos en log aquí; lo dejamos opcional vacío para no encadenar I/O.
      // El renderer puede pedir log aparte si lo necesita.
    } catch {}

    const lines = recent.map((m) => {
      const who = m.role === 'user' ? 'usuario' : 'agente'
      const content = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 200)
      return `  · [${who}]: ${content}`
    }).join('\n')

    return [
      `Vengo de una conversación con ${fromLabel} sobre la automation "${name}".`,
      `Resumen del contexto:`,
      `- Descripción de la automation: ${description}`,
      lastLog ? `- Último log relevante: ${lastLog}` : null,
      `- Lo que hablamos (últimos ${recent.length} mensajes resumidos):`,
      lines || '  · (sin historial previo)',
      ``,
      `Sigo aquí. ¿Por dónde estábamos?`
    ].filter(Boolean).join('\n')
  }

  async buildContextSummary(automationId, { fromProvider } = {}) {
    if (!automationId) throw new Error('buildContextSummary: automationId requerido')
    const from = normalizeProvider(fromProvider) || DEFAULTS.provider
    const automation = await this._am.get(automationId)
    const data = await this._loadOrInit(automationId, automation)
    return this._buildContextSummaryFromData(data, automation, from)
  }

  async getLastUserMessage(automationId, { provider } = {}) {
    if (!automationId) return null
    const data = await this._readFile(automationId)
    if (!data) return null
    const normalized = (data.threads && data.preferences) ? data : this._migrate(data, automationId, null)
    const p = normalizeProvider(provider || normalized.preferences.provider) || DEFAULTS.provider
    const thread = normalized.threads[p] || emptyThread()
    const msgs = Array.isArray(thread.messages) ? thread.messages : []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i] && msgs[i].role === 'user' && typeof msgs[i].content === 'string') {
        return msgs[i].content
      }
    }
    return null
  }

  async applyProposedChanges(automationId, { script, plist } = {}) {
    if (!automationId) throw new Error('applyProposedChanges: automationId requerido')
    const current = await this._am.get(automationId)
    if (!current) return { ok: false, error: `Automation no encontrada: ${automationId}` }

    let lintResult = null
    if (typeof script === 'string' && script.trim()) {
      lintResult = await lintScript(script)
      if (lintResult.available && lintResult.hasIssues) {
        return { ok: false, error: 'Script tiene errores de shellcheck', lintIssues: lintResult.raw }
      }
    }

    const patch = {}
    if (typeof script === 'string') patch.scriptText = script
    if (typeof plist === 'string') patch.plistText = plist
    if (!Object.keys(patch).length) return { ok: false, error: 'Sin cambios que aplicar' }

    await this._am.updateDraft(automationId, patch)
    return {
      ok: true,
      lintWarnings: lintResult && lintResult.available && lintResult.warnings.length
        ? lintResult.raw
        : null
    }
  }

  async applyAndReinstall(automationId, { script, plist } = {}) {
    const applyRes = await this.applyProposedChanges(automationId, { script, plist })
    if (!applyRes.ok) return applyRes

    const current = await this._am.get(automationId)
    if (!current) return { ok: false, error: 'Automation no encontrada tras aplicar' }

    if (current.status !== 'installed') {
      return { ok: true, reinstalled: false, lintWarnings: applyRes.lintWarnings || null }
    }

    try { await this._am.uninstall(automationId) } catch {}
    const installRes = await this._am.install(automationId)
    if (!installRes || installRes.ok === false) {
      return {
        ok: false,
        reinstalled: false,
        error: (installRes && installRes.error) || 'Error al reinstalar',
        lintIssues: installRes && installRes.lintIssues ? installRes.lintIssues : null
      }
    }
    return { ok: true, reinstalled: true, lintWarnings: applyRes.lintWarnings || null }
  }

  async deleteChat(automationId) {
    try { await fsp.unlink(this._filePath(automationId)) } catch {}
    return { ok: true }
  }
}

module.exports = {
  AutomationChat,
  createAutomationChat: (opts) => new AutomationChat(opts)
}
