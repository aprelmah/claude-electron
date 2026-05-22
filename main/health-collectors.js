'use strict'

const http = require('http')
const { spawnSync } = require('child_process')

function countConfiguredTelegramUsers(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean).length
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/g)
      .map((v) => v.trim())
      .filter(Boolean)
      .length
  }
  return 0
}

function inferWhatsappBridgeState(payload) {
  if (!payload || typeof payload !== 'object') return 'disconnected'
  const rawState = String(payload.state || payload.status || '').toLowerCase()
  if (payload.error) return 'error'
  if (
    payload.ready === true ||
    payload.connected === true ||
    rawState === 'ready' ||
    rawState === 'connected' ||
    rawState === 'open' ||
    rawState.includes('ready') ||
    rawState.includes('connect')
  ) {
    return 'ready'
  }
  if (
    payload.connected === false ||
    rawState === 'disconnected' ||
    rawState === 'closed' ||
    rawState.includes('disconnect') ||
    rawState.includes('close')
  ) {
    return 'disconnected'
  }
  return 'disconnected'
}

function httpGetJson(url, timeoutMs = 2000, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        let json = null
        if (body.trim()) {
          try { json = JSON.parse(body) } catch {}
        }
        resolve({ statusCode: Number(res.statusCode || 0), json, raw: body })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

async function collectWhatsappBridgeHealth() {
  try {
    const headers = {}
    try {
      const waAuth = require('../whatsapp/whatsapp-auth')
      const token = waAuth.readToken(waAuth.defaultTokenPath())
      if (token) headers[waAuth.HEADER_NAME] = token
    } catch {}
    const { statusCode, json, raw } = await httpGetJson('http://127.0.0.1:3031/status', 2000, headers)
    if (statusCode >= 400) {
      return {
        state: 'error',
        statusCode,
        detail: `HTTP ${statusCode}${raw ? ` · ${raw.slice(0, 120)}` : ''}`
      }
    }
    const state = inferWhatsappBridgeState(json)
    const detail = json?.message || json?.status || json?.state || (state === 'ready' ? 'ready' : 'disconnected')
    return { state, statusCode, detail: String(detail || '').slice(0, 180) }
  } catch (err) {
    const code = String(err?.code || '')
    const message = err?.message || String(err)
    if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
      return { state: 'disconnected', statusCode: 0, detail: message }
    }
    return { state: 'error', statusCode: 0, detail: message }
  }
}

function collectLaunchdHealth() {
  try {
    const run = spawnSync('launchctl', ['list'], { encoding: 'utf8' })
    if (run.error) {
      return { state: 'error', count: 0, detail: run.error.message || 'launchctl error' }
    }
    const stdout = String(run.stdout || '')
    const stderr = String(run.stderr || '').trim()
    if (run.status !== 0) {
      return {
        state: 'error',
        count: 0,
        detail: `launchctl exit ${run.status}${stderr ? ` · ${stderr.slice(0, 140)}` : ''}`
      }
    }
    const count = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\bcom\.luismi([.\-]|$)/.test(line))
      .length
    return { state: 'ok', count, detail: count > 0 ? `${count} jobs activos` : 'Sin jobs com.luismi activos' }
  } catch (err) {
    return { state: 'error', count: 0, detail: err?.message || String(err) }
  }
}

function createHealthCollectors({
  getTasksScheduler,
  getPrimarySession,
  getSessions,
  ensureCliAvailable,
  getAppConfig,
  getTelegramBridge
}) {
  function collectSchedulerHealth() {
    const tasksScheduler = getTasksScheduler()
    if (!tasksScheduler) {
      return { state: 'error', activeJobs: 0, runningJobs: 0, detail: 'TaskScheduler no inicializado' }
    }
    const activeJobs = Number(tasksScheduler.jobs?.size || 0)
    const runningJobs = Number(tasksScheduler.activeRuns?.size || 0)
    return {
      state: 'ok',
      activeJobs,
      runningJobs,
      detail: runningJobs > 0
        ? `${activeJobs} jobs activos · ${runningJobs} ejecutándose`
        : `${activeJobs} jobs activos`
    }
  }

  function collectPtyHealth(session) {
    const current = session || getPrimarySession()
    const cli = current?.activeCli === 'codex' ? 'codex' : 'claude'
    const cliCheck = ensureCliAvailable(cli)
    if (!cliCheck.ok) {
      return { state: 'error', cli, detail: cliCheck.error }
    }
    if (!current) return { state: 'stopped', cli, detail: 'Sin sesión activa' }
    if (current.pty) return { state: 'active', cli, detail: 'PTY en ejecución' }
    return { state: 'stopped', cli, detail: 'PTY detenido' }
  }

  function collectTelegramHealth() {
    const cfg = getAppConfig()?.telegram || {}
    const enabled = !!cfg.enabled
    const hasToken = typeof cfg.botToken === 'string' && cfg.botToken.trim().length > 0
    const usersCount = countConfiguredTelegramUsers(cfg.allowedUsers)
    const telegramBridge = getTelegramBridge()
    const status = telegramBridge?.getStatus() || null
    if (!enabled || !hasToken || usersCount === 0) {
      return {
        state: 'unconfigured',
        running: false,
        detail: 'Sin configurar',
        botUsername: status?.botUsername || '',
        activeChats: Number(status?.activeChats?.length || 0)
      }
    }
    if (status?.lastError) {
      return {
        state: status.running ? 'linked' : 'error',
        running: !!status.running,
        detail: status.lastError,
        botUsername: status?.botUsername || '',
        activeChats: Number(status?.activeChats?.length || 0)
      }
    }
    if (status?.running) {
      return {
        state: 'linked',
        running: true,
        detail: status?.lastInfo || 'Telegram activo',
        botUsername: status?.botUsername || '',
        activeChats: Number(status?.activeChats?.length || 0)
      }
    }
    return {
      state: 'disconnected',
      running: false,
      detail: status?.lastInfo || 'Bridge detenido',
      botUsername: status?.botUsername || '',
      activeChats: Number(status?.activeChats?.length || 0)
    }
  }

  async function collectHealthSnapshot(session) {
    const pty = collectPtyHealth(session)
    const telegram = collectTelegramHealth()
    const whatsapp = await collectWhatsappBridgeHealth()
    const launchd = collectLaunchdHealth()
    const scheduler = collectSchedulerHealth()
    const hasError = (
      pty.state === 'error' ||
      telegram.state === 'error' ||
      whatsapp.state === 'error' ||
      launchd.state === 'error' ||
      scheduler.state === 'error'
    )
    return {
      ts: Date.now(),
      global: { state: hasError ? 'error' : 'ok' },
      pty,
      telegram,
      whatsapp,
      launchd,
      scheduler
    }
  }

  return {
    countConfiguredTelegramUsers,
    inferWhatsappBridgeState,
    httpGetJson,
    collectWhatsappBridgeHealth,
    collectLaunchdHealth,
    collectSchedulerHealth,
    collectPtyHealth,
    collectTelegramHealth,
    collectHealthSnapshot
  }
}

module.exports = {
  createHealthCollectors,
  countConfiguredTelegramUsers,
  inferWhatsappBridgeState,
  httpGetJson,
  collectWhatsappBridgeHealth,
  collectLaunchdHealth
}
