'use strict'

// Doctor in-app: una vez al día evalúa el estado de salud de la app
// (reutilizando collectHealthSnapshot de health-collectors) y avisa por el
// bot de avisos SOLO si hay problemas. Sin problemas = silencio total.
//
// Vive dentro del proceso main (setInterval con unref), nada de launchd: el
// doctor de la app viaja con la app. El día de última pasada está en memoria
// a propósito — si la app se reinicia y el problema sigue, que vuelva a avisar.

const DEFAULT_HOUR_LOCAL = 8
const DEFAULT_CHECK_EVERY_MS = 15 * 60 * 1000

const PART_LABELS = {
  pty: 'Terminal (CLI)',
  telegram: 'Bridge de Telegram',
  whatsapp: 'Bridge de WhatsApp',
  launchd: 'Automatizaciones (launchd)',
  scheduler: 'Tareas programadas'
}

function evaluateHealthProblems(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return [{ key: 'collect', label: 'Chequeo de salud', detail: 'no se pudo recoger el estado' }]
  }
  const problems = []
  for (const key of Object.keys(PART_LABELS)) {
    const part = snapshot[key]
    if (part && part.state === 'error') {
      problems.push({ key, label: PART_LABELS[key], detail: String(part.detail || 'en error') })
    }
  }
  return problems
}

function formatHealthReport(problems) {
  const lines = ['🩺 Doctor de POWER-AGENT — algo necesita un vistazo:']
  for (const p of problems) lines.push(`• ${p.label}: ${p.detail}`)
  return lines.join('\n').slice(0, 3900)
}

function localDayOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function createHealthWatchdog({
  collect,
  notify,
  isEnabled = () => true,
  hourLocal = DEFAULT_HOUR_LOCAL,
  checkEveryMs = DEFAULT_CHECK_EVERY_MS,
  now = () => new Date(),
  log = () => {}
} = {}) {
  if (typeof collect !== 'function') throw new Error('health-watchdog: collect requerido')
  if (typeof notify !== 'function') throw new Error('health-watchdog: notify requerido')

  let timer = null
  let lastRunDay = ''

  async function runOnce({ force = false } = {}) {
    const d = now()
    if (!force) {
      if (!isEnabled()) return { ran: false, reason: 'disabled' }
      if (d.getHours() < hourLocal) return { ran: false, reason: 'early' }
      if (lastRunDay === localDayOf(d)) return { ran: false, reason: 'done' }
    }
    lastRunDay = localDayOf(d)
    let snapshot = null
    try { snapshot = await collect() } catch (err) {
      log(`collect falló: ${err?.message || err}`)
    }
    const problems = evaluateHealthProblems(snapshot)
    if (problems.length) {
      try { await notify(formatHealthReport(problems)) } catch (err) {
        log(`notify falló: ${err?.message || err}`)
      }
    }
    return { ran: true, problems }
  }

  function start() {
    if (timer) return
    timer = setInterval(() => { runOnce().catch(() => {}) }, checkEveryMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, runOnce }
}

module.exports = { createHealthWatchdog, evaluateHealthProblems, formatHealthReport }
