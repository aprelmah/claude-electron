'use strict'

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

const FILE_NAME = 'automations.json'

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

async function readJsonOrDefault(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

function createPersistence({ userDataDir }) {
  if (!userDataDir) throw new Error('automations/persistence: userDataDir requerido')
  try { fs.mkdirSync(userDataDir, { recursive: true }) } catch {}

  const filePath = path.join(userDataDir, FILE_NAME)
  const writeLock = createMutex()

  async function load() {
    const data = await readJsonOrDefault(filePath, [])
    return Array.isArray(data) ? data : []
  }

  async function get(id) {
    const list = await load()
    return list.find(a => a.id === id) || null
  }

  async function upsert(automation) {
    if (!automation || typeof automation !== 'object') throw new Error('upsert: automation requerido')
    if (!automation.id) throw new Error('upsert: automation.id requerido')
    return writeLock(async () => {
      const list = await load()
      const idx = list.findIndex(a => a.id === automation.id)
      if (idx >= 0) list[idx] = automation
      else list.push(automation)
      await atomicWriteJson(filePath, list)
      return automation
    })
  }

  async function del(id) {
    return writeLock(async () => {
      const list = await load()
      const next = list.filter(a => a.id !== id)
      await atomicWriteJson(filePath, next)
      return { ok: true }
    })
  }

  return { load, get, upsert, delete: del, _paths: { filePath } }
}

module.exports = { createPersistence }
