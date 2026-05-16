module.exports = [
  { label: 'Cada 5 minutos', expr: '*/5 * * * *' },
  { label: 'Cada 15 minutos', expr: '*/15 * * * *' },
  { label: 'Cada hora en punto', expr: '0 * * * *' },
  { label: 'Cada día a las 9:00', expr: '0 9 * * *' },
  { label: 'Cada día a las 21:00', expr: '0 21 * * *' },
  { label: 'Cada lunes a las 8:00', expr: '0 8 * * 1' }
]
