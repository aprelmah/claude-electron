'use strict'

const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { createPersistence } = require('./persistence')
const { createGenerator } = require('./generator')
const { createInstaller } = require('./installer')
const { slugify } = require('./slug')
const { scheduleToCron } = require('./schedule-to-cron')
const { lintScript, findShellcheck } = require('./validator')

const MAX_GEN_RETRIES = 3

const LABEL_PREFIX = 'com.luismi.poweragent.'
const SCRIPT_DIR = path.join(os.homedir(), 'Library', 'PowerAgent', 'automations')
const LOG_DIR = path.join(SCRIPT_DIR, 'logs')
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents')

function nowIso() {
  return new Date().toISOString()
}

function buildPathsFromSlug(slug) {
  return {
    scriptPath: path.join(SCRIPT_DIR, `${slug}.sh`),
    logPath: path.join(LOG_DIR, `${slug}.log`),
    plistPath: path.join(PLIST_DIR, `${LABEL_PREFIX}${slug}.plist`),
    label: `${LABEL_PREFIX}${slug}`
  }
}

class AutomationManager {
  constructor({ userDataDir, runClaudeHeadless, appConfig, telegramBridge, broadcast } = {}) {
    if (!userDataDir) throw new Error('AutomationManager: userDataDir requerido')
    if (typeof runClaudeHeadless !== 'function') throw new Error('AutomationManager: runClaudeHeadless requerido')
    this._userDataDir = userDataDir
    this._appConfig = appConfig || null
    this._telegramBridge = telegramBridge || null
    this._broadcast = typeof broadcast === 'function' ? broadcast : () => {}
    this._persistence = createPersistence({ userDataDir })
    this._generator = createGenerator({ runClaudeHeadless })
    this._installer = createInstaller()
    this._initialized = false
  }

  async init() {
    await this._persistence.load()
    this._initialized = true
  }

  _emit(channel, payload) {
    try { this._broadcast(channel, payload) } catch {}
  }

  _emitListChanged() {
    this._emit('automations:list-changed', null)
  }

  async list() {
    return this._persistence.load()
  }

  async get(id) {
    return this._persistence.get(id)
  }

  async _existingSlugs(excludeId) {
    const list = await this._persistence.load()
    return list.filter(a => a.id !== excludeId).map(a => a.slug).filter(Boolean)
  }

  async _generateWithLintRetry(genOpts) {
    // Llama al generator, valida el script con shellcheck. Si hay errores, reintenta
    // hasta MAX_GEN_RETRIES alimentando el output de shellcheck al LLM.
    // Devuelve { gen, lintFinal, attempts }.
    let lastGen = null
    let lastLint = null
    let attempts = 0
    let previousIssues = null
    let sessionId = null

    for (let i = 0; i < MAX_GEN_RETRIES; i++) {
      attempts++
      const gen = await this._generator.generate({
        ...genOpts,
        previousIssues,
        sessionId
      })
      lastGen = gen
      sessionId = gen.sessionId || sessionId

      const lint = await lintScript(gen.script)
      lastLint = lint

      // Si shellcheck no está instalado → no podemos validar, salimos con lo que hay.
      if (!lint.available) break

      // Si no hay errores críticos → ok (warnings pasan).
      if (!lint.hasIssues) break

      // Si hay errores y aún quedan intentos → preparar feedback para siguiente vuelta.
      previousIssues = lint.raw
    }

    return { gen: lastGen, lint: lastLint, attempts, sessionId }
  }

  // Crea un borrador vacío (sin script/plist) para que el agente PTY pueda trabajar
  // sobre él antes de generar nada. Devuelve el automation persistido.
  async createDraftShell({ name, description, schedule }) {
    try {
      if (!name || !String(name).trim()) return { ok: false, error: 'Nombre requerido' }
      if (!schedule) return { ok: false, error: 'Frecuencia requerida' }
      const cronRes = scheduleToCron(schedule)
      if (cronRes.error) return { ok: false, error: `Frecuencia inválida: ${cronRes.error}` }
      const cron = cronRes.cron
      const existing = await this._existingSlugs(null)
      const slug = slugify(name, existing)
      const paths = buildPathsFromSlug(slug)
      const now = nowIso()
      const automation = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        description: String(description || '').trim(),
        schedule,
        cron,
        slug,
        scriptPath: paths.scriptPath,
        plistPath: paths.plistPath,
        label: paths.label,
        logPath: paths.logPath,
        status: 'draft',
        generatedScript: '',
        generatedPlist: '',
        explanation: '',
        chatSessionId: null,
        lintWarnings: null,
        lintAttempts: 0,
        enabled: true,
        lastRunAt: null,
        lastStatus: null,
        lastLogTail: null,
        createdAt: now,
        updatedAt: now,
        installedAt: null
      }
      await this._persistence.upsert(automation)
      this._emitListChanged()
      return { ok: true, automation }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }

  async generateDraft({ name, description, schedule }) {
    try {
      if (!name || !String(name).trim()) return { ok: false, error: 'Nombre requerido' }
      if (!description || !String(description).trim()) return { ok: false, error: 'Descripción requerida' }
      if (!schedule) return { ok: false, error: 'Frecuencia requerida' }

      const cronRes = scheduleToCron(schedule)
      if (cronRes.error) return { ok: false, error: `Frecuencia inválida: ${cronRes.error}` }
      const cron = cronRes.cron

      const existing = await this._existingSlugs(null)
      const slug = slugify(name, existing)
      const paths = buildPathsFromSlug(slug)

      const { gen, lint, attempts, sessionId } = await this._generateWithLintRetry({
        name: String(name).trim(),
        description: String(description).trim(),
        schedule,
        cron,
        slug,
        scriptPath: paths.scriptPath,
        plistPath: paths.plistPath,
        logPath: paths.logPath,
        label: paths.label
      })

      const now = nowIso()
      const automation = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        description: String(description).trim(),
        schedule,
        cron,
        slug,
        scriptPath: paths.scriptPath,
        plistPath: paths.plistPath,
        label: paths.label,
        logPath: paths.logPath,
        status: 'draft',
        generatedScript: gen.script,
        generatedPlist: gen.plist,
        explanation: gen.explanation,
        chatSessionId: sessionId || null,
        lintWarnings: lint && lint.available && lint.hasIssues ? lint.raw : null,
        lintAttempts: attempts,
        enabled: true,
        lastRunAt: null,
        lastStatus: null,
        lastLogTail: null,
        createdAt: now,
        updatedAt: now,
        installedAt: null
      }

      await this._persistence.upsert(automation)
      this._emitListChanged()
      return {
        ok: true,
        automation,
        lint: lint
          ? { available: lint.available, hasIssues: lint.hasIssues, raw: lint.raw, attempts }
          : { available: false, hasIssues: false, raw: '', attempts }
      }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }

  async regenerate(id, patch = {}) {
    try {
      const current = await this._persistence.get(id)
      if (!current) return { ok: false, error: `Automatización no encontrada: ${id}` }

      const description = typeof patch.description === 'string' && patch.description.trim()
        ? patch.description.trim()
        : current.description
      const schedule = patch.schedule || current.schedule

      const cronRes = scheduleToCron(schedule)
      if (cronRes.error) return { ok: false, error: `Frecuencia inválida: ${cronRes.error}` }
      const cron = cronRes.cron

      const { gen, lint, attempts, sessionId } = await this._generateWithLintRetry({
        name: current.name,
        description,
        schedule,
        cron,
        slug: current.slug,
        scriptPath: current.scriptPath,
        plistPath: current.plistPath,
        logPath: current.logPath,
        label: current.label,
        // Reusa sessionId del agente si ya existía para mantener contexto.
        sessionId: current.chatSessionId || null
      })

      const updated = {
        ...current,
        description,
        schedule,
        cron,
        generatedScript: gen.script,
        generatedPlist: gen.plist,
        explanation: gen.explanation,
        chatSessionId: sessionId || current.chatSessionId || null,
        lintWarnings: lint && lint.available && lint.hasIssues ? lint.raw : null,
        lintAttempts: attempts,
        updatedAt: nowIso()
      }
      await this._persistence.upsert(updated)
      this._emitListChanged()
      return {
        ok: true,
        automation: updated,
        lint: lint
          ? { available: lint.available, hasIssues: lint.hasIssues, raw: lint.raw, attempts }
          : { available: false, hasIssues: false, raw: '', attempts }
      }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }

  async updateDraft(id, { scriptText, plistText, description } = {}) {
    const current = await this._persistence.get(id)
    if (!current) throw new Error(`Automatización no encontrada: ${id}`)
    const updated = { ...current, updatedAt: nowIso() }
    if (typeof scriptText === 'string') updated.generatedScript = scriptText
    if (typeof plistText === 'string') updated.generatedPlist = plistText
    if (typeof description === 'string' && description.trim()) updated.description = description.trim()
    await this._persistence.upsert(updated)
    this._emitListChanged()
    return updated
  }

  async install(id, opts = {}) {
    const force = !!(opts && opts.force)
    const current = await this._persistence.get(id)
    if (!current) return { ok: false, error: `Automatización no encontrada: ${id}` }

    // Validación pre-install: shellcheck sobre el script actual.
    if (!force) {
      try {
        const lint = await lintScript(current.generatedScript || '')
        if (lint.available && lint.hasIssues) {
          return {
            ok: false,
            error: 'Script tiene errores críticos de shellcheck:\n' + lint.raw,
            lintIssues: lint.raw,
            lintBlocking: true
          }
        }
        if (lint.available && lint.warnings.length && !current.lintWarnings) {
          // Persistir warnings (no bloqueantes) para mostrar en UI.
          const patched = { ...current, lintWarnings: lint.raw, updatedAt: nowIso() }
          await this._persistence.upsert(patched)
        }
      } catch (err) {
        // Validación no debe romper instalación: log y seguimos.
        console.error('[automations] lint pre-install error:', err && err.message ? err.message : err)
      }
    }

    try {
      const res = await this._installer.install(current)
      if (!res.ok) {
        const updated = {
          ...current,
          status: 'failed-install',
          lastStatus: 'error',
          lastLogTail: res.error || null,
          updatedAt: nowIso()
        }
        await this._persistence.upsert(updated)
        this._emitListChanged()
        return { ok: false, error: res.error }
      }
      const updated = {
        ...current,
        status: 'installed',
        paused: false,
        installedAt: nowIso(),
        updatedAt: nowIso()
      }
      await this._persistence.upsert(updated)
      this._emitListChanged()
      return { ok: true }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      const updated = {
        ...current,
        status: 'failed-install',
        lastStatus: 'error',
        lastLogTail: msg,
        updatedAt: nowIso()
      }
      await this._persistence.upsert(updated)
      this._emitListChanged()
      return { ok: false, error: msg }
    }
  }

  async uninstall(id) {
    const current = await this._persistence.get(id)
    if (!current) return { ok: false, error: `Automatización no encontrada: ${id}` }
    try {
      await this._installer.uninstall(current)
      const updated = { ...current, status: 'removed', updatedAt: nowIso() }
      await this._persistence.upsert(updated)
      this._emitListChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }

  async runOnce(id) {
    const current = await this._persistence.get(id)
    if (!current) return { ok: false, error: `Automatización no encontrada: ${id}` }
    this._emit('automations:run-started', { automationId: id })
    try {
      const res = await this._installer.runOnce(current)
      const finishedAt = nowIso()
      const updated = {
        ...current,
        lastRunAt: finishedAt,
        lastStatus: res.ok ? 'ok' : 'error',
        lastLogTail: res.logTail || null,
        updatedAt: finishedAt
      }
      await this._persistence.upsert(updated)
      this._emit('automations:run-finished', { automationId: id, ok: res.ok, durationMs: res.durationMs })
      this._emitListChanged()
      return res
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      this._emit('automations:run-finished', { automationId: id, ok: false, durationMs: 0, error: msg })
      return { ok: false, durationMs: 0, logTail: '', error: msg }
    }
  }

  async pause(id) {
    const current = await this._persistence.get(id)
    if (!current) return { ok: false, error: `Automatización no encontrada: ${id}` }
    if (current.status !== 'installed') return { ok: false, error: 'Solo se pueden pausar automatizaciones instaladas' }
    try {
      await this._installer.unloadLaunchd(current)
      const updated = { ...current, paused: true, updatedAt: nowIso() }
      await this._persistence.upsert(updated)
      this._emitListChanged()
      return { ok: true, automation: updated }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }

  async resume(id) {
    const current = await this._persistence.get(id)
    if (!current) return { ok: false, error: `Automatización no encontrada: ${id}` }
    if (current.status !== 'installed') return { ok: false, error: 'Solo se pueden reanudar automatizaciones instaladas' }
    try {
      const res = await this._installer.loadLaunchd(current)
      if (!res.ok) return { ok: false, error: res.error }
      const updated = { ...current, paused: false, updatedAt: nowIso() }
      await this._persistence.upsert(updated)
      this._emitListChanged()
      return { ok: true, automation: updated }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }

  async getRunningIds() {
    const list = await this._persistence.load()
    const out = []
    for (const a of list) {
      if (a.status !== 'installed' || a.paused) continue
      try {
        if (await this._installer.isRunning(a)) out.push(a.id)
      } catch { /* ignora */ }
    }
    return out
  }

  async stopRun(id) {
    const current = await this._persistence.get(id)
    if (!current) return { ok: false, error: `Automatización no encontrada: ${id}` }
    if (current.status !== 'installed') return { ok: false, error: 'Solo se pueden parar automatizaciones instaladas' }
    try {
      const res = await this._installer.stopRun(current)
      if (!res.ok) return { ok: false, error: res.error }
      this._emitListChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }

  async readLog(id, opts = {}) {
    const current = await this._persistence.get(id)
    if (!current) throw new Error(`Automatización no encontrada: ${id}`)
    return this._installer.readLog(current, opts)
  }

  async getShellcheckStatus() {
    const bin = await findShellcheck()
    return {
      available: !!bin,
      path: bin || null,
      installHint: 'brew install shellcheck'
    }
  }

  async lintAutomation(id) {
    const current = await this._persistence.get(id)
    if (!current) return { ok: false, error: `Automatización no encontrada: ${id}` }
    const lint = await lintScript(current.generatedScript || '')
    return { ok: true, lint }
  }

  async remove(id) {
    const current = await this._persistence.get(id)
    if (!current) return { ok: true }
    if (current.status === 'installed') {
      try { await this._installer.uninstall(current) } catch { /* ignora */ }
    }
    await this._persistence.delete(id)
    this._emitListChanged()
    return { ok: true }
  }
}

module.exports = {
  AutomationManager,
  createAutomationManager: (opts) => new AutomationManager(opts),
  _internals: { buildPathsFromSlug, SCRIPT_DIR, LOG_DIR, PLIST_DIR, LABEL_PREFIX }
}
