'use strict'

function parseHHMM(s) {
  if (typeof s !== 'string') return null
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hh = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm }
}

function parseDate(s) {
  if (typeof s !== 'string') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, mo, d }
}

function scheduleToCron(s) {
  if (!s || typeof s !== 'object') return { error: 'Configuración vacía' }
  switch (s.type) {
    case 'interval-min': {
      const n = Number(s.every)
      if (!Number.isInteger(n) || n < 1) return { error: 'Minutos debe ser un entero ≥ 1' }
      if (n >= 60) return { error: 'Usa "Cada X horas" si pasa de 59 minutos' }
      return { cron: n === 1 ? '* * * * *' : `*/${n} * * * *` }
    }
    case 'interval-hour': {
      const n = Number(s.every)
      if (!Number.isInteger(n) || n < 1) return { error: 'Horas debe ser un entero ≥ 1' }
      if (n > 23) return { error: 'Máximo 23 horas' }
      return { cron: n === 1 ? '0 * * * *' : `0 */${n} * * *` }
    }
    case 'daily': {
      const t = parseHHMM(s.time)
      if (!t) return { error: 'Hora inválida' }
      return { cron: `${t.mm} ${t.hh} * * *` }
    }
    case 'weekly': {
      const t = parseHHMM(s.time)
      if (!t) return { error: 'Hora inválida' }
      const days = Array.isArray(s.weekdays) ? s.weekdays.filter((d) => d >= 0 && d <= 6) : []
      if (!days.length) return { error: 'Selecciona al menos un día' }
      const uniq = [...new Set(days)].sort((a, b) => a - b)
      return { cron: `${t.mm} ${t.hh} * * ${uniq.join(',')}` }
    }
    case 'monthly': {
      const t = parseHHMM(s.time)
      if (!t) return { error: 'Hora inválida' }
      const d = Number(s.dayOfMonth)
      if (!Number.isInteger(d) || d < 1 || d > 28) return { error: 'Día del mes debe estar entre 1 y 28' }
      return { cron: `${t.mm} ${t.hh} ${d} * *` }
    }
    case 'once': {
      const t = parseHHMM(s.time)
      if (!t) return { error: 'Hora inválida' }
      const dd = parseDate(s.date)
      if (!dd) return { error: 'Fecha inválida' }
      const target = new Date(dd.y, dd.mo - 1, dd.d, t.hh, t.mm, 0)
      if (isNaN(target.getTime())) return { error: 'Fecha inválida' }
      if (target.getTime() < Date.now() - 60_000) return { error: 'La fecha ya pasó' }
      return { cron: `${t.mm} ${t.hh} ${dd.d} ${dd.mo} *` }
    }
    case 'advanced': {
      const expr = (s.expr || '').trim()
      if (!expr) return { error: 'Cron vacío' }
      if (expr.split(/\s+/).length !== 5) return { error: 'Cron debe tener 5 campos' }
      return { cron: expr }
    }
    default:
      return { error: 'Tipo de frecuencia desconocido' }
  }
}

// Devuelve objeto JS con keys Minute/Hour/Day/Month/Weekday (omitiendo comodín).
// Devuelve null para tipos que NO se pueden expresar con StartCalendarInterval
// (interval-min, interval-hour, advanced multi-campo).
function scheduleToCalendarInterval(s) {
  if (!s || typeof s !== 'object') return null
  switch (s.type) {
    case 'daily': {
      const t = parseHHMM(s.time)
      if (!t) return null
      return { Hour: t.hh, Minute: t.mm }
    }
    case 'weekly': {
      const t = parseHHMM(s.time)
      if (!t) return null
      const days = Array.isArray(s.weekdays) ? [...new Set(s.weekdays.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b) : []
      if (!days.length) return null
      // Múltiples días requieren array de dicts; devolvemos array.
      if (days.length === 1) return { Hour: t.hh, Minute: t.mm, Weekday: days[0] }
      return days.map(d => ({ Hour: t.hh, Minute: t.mm, Weekday: d }))
    }
    case 'monthly': {
      const t = parseHHMM(s.time)
      if (!t) return null
      const d = Number(s.dayOfMonth)
      if (!Number.isInteger(d) || d < 1 || d > 28) return null
      return { Hour: t.hh, Minute: t.mm, Day: d }
    }
    case 'once': {
      const t = parseHHMM(s.time)
      if (!t) return null
      const dd = parseDate(s.date)
      if (!dd) return null
      return { Hour: t.hh, Minute: t.mm, Day: dd.d, Month: dd.mo }
    }
    case 'interval-min':
    case 'interval-hour':
    case 'advanced':
    default:
      return null
  }
}

// Para interval-min/hour, devuelve segundos (StartInterval).
function scheduleToStartInterval(s) {
  if (!s || typeof s !== 'object') return null
  if (s.type === 'interval-min') {
    const n = Number(s.every)
    if (!Number.isInteger(n) || n < 1) return null
    return n * 60
  }
  if (s.type === 'interval-hour') {
    const n = Number(s.every)
    if (!Number.isInteger(n) || n < 1) return null
    return n * 3600
  }
  return null
}

module.exports = { scheduleToCron, scheduleToCalendarInterval, scheduleToStartInterval }
