'use strict'

const MAX_LEN = 40

function slugifyBase(name) {
  if (typeof name !== 'string') return ''
  let s = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
  s = s.toLowerCase()
  s = s.replace(/[^a-z0-9]+/g, '-')
  s = s.replace(/^-+|-+$/g, '')
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN).replace(/-+$/g, '')
  return s
}

function slugify(name, existingSlugs = []) {
  const base = slugifyBase(name) || 'automation'
  const existing = new Set(Array.isArray(existingSlugs) ? existingSlugs : [])
  if (!existing.has(base)) return base
  let i = 2
  while (true) {
    const suffix = `-${i}`
    const capped = base.length + suffix.length > MAX_LEN
      ? base.slice(0, MAX_LEN - suffix.length).replace(/-+$/g, '') + suffix
      : base + suffix
    if (!existing.has(capped)) return capped
    i += 1
    if (i > 9999) throw new Error('slugify: demasiadas colisiones')
  }
}

module.exports = { slugify }
