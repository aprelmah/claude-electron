'use strict'

const crypto = require('crypto')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { atomicWriteJsonAsync } = require('./atomic-writes')
const { normalizeSecurityMode } = require('./execution-policy')

const MAX_ITEMS = 100
const MAX_OUTPUT = 80 * 1024
const MAX_GOAL = 60 * 1024

function appendBounded(value, chunk) {
  const incoming = String(chunk || '')
  const next = String(value || '') + incoming
  return next.length <= MAX_OUTPUT ? next : next.slice(-MAX_OUTPUT)
}

function createDelegationManager({
  userDataDir,
  runChild,
  prepareWorkspace,
  finalizeWorkspace,
  maxConcurrent = 3,
  broadcast,
} = {}) {
  if (!userDataDir) throw new Error('delegation: userDataDir requerido')
  if (typeof runChild !== 'function') throw new Error('delegation: runChild requerido')

  const filePath = path.join(userDataDir, 'delegations.json')
  const items = new Map()
  const active = new Map()
  let writeChain = Promise.resolve()
  const limit = Math.max(1, Math.min(8, Number(maxConcurrent) || 3))

  function emit(event, item) {
    try { broadcast?.(event, snapshot(item)) } catch {}
  }

  function snapshot(item) {
    if (!item) return null
    return {
      ...item,
      output: String(item.output || '').slice(-12000),
      context: undefined,
    }
  }

  async function persist() {
    const data = [...items.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MAX_ITEMS)
      .map((item) => ({ ...item, context: undefined, output: String(item.output || '').slice(-MAX_OUTPUT) }))
    const next = writeChain.then(async () => {
      await fsp.mkdir(userDataDir, { recursive: true })
      await atomicWriteJsonAsync(filePath, data)
    })
    writeChain = next.catch(() => {})
    return next
  }

  async function init() {
    let stored = []
    try {
      stored = JSON.parse(await fsp.readFile(filePath, 'utf8'))
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[delegation] no se pudo leer el estado:', err.message)
    }
    if (Array.isArray(stored)) {
      for (const raw of stored.slice(0, MAX_ITEMS)) {
        if (!raw || !raw.id || !raw.goal) continue
        const item = {
          ...raw,
          status: ['queued', 'running'].includes(raw.status) ? 'unknown' : (raw.status || 'unknown'),
          output: String(raw.output || ''),
          context: undefined,
        }
        items.set(item.id, item)
      }
    }
    await persist()
    return list()
  }

  function list() {
    return [...items.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(snapshot)
  }

  function get(id) {
    return snapshot(items.get(String(id || '')))
  }

  async function dispatch({
    goal,
    context = '',
    cwd = '',
    cli = 'claude',
    model = '',
    effort = '',
    securityMode = 'safe',
    parentSessionId = null,
    mergeOnSuccess = false,
  } = {}) {
    const cleanGoal = String(goal || '').trim()
    if (!cleanGoal) throw new Error('delegation: falta el objetivo')
    if (cleanGoal.length > MAX_GOAL) throw new Error('delegation: objetivo demasiado grande')
    const selectedCli = cli === 'codex' ? 'codex' : 'claude'
    const now = new Date().toISOString()
    const item = {
      id: crypto.randomUUID(),
      goal: cleanGoal,
      context: String(context || '').slice(0, MAX_GOAL),
      cwd: String(cwd || ''),
      cli: selectedCli,
      model: String(model || ''),
      effort: String(effort || ''),
      securityMode: normalizeSecurityMode(securityMode),
      parentSessionId: parentSessionId ? String(parentSessionId) : null,
      mergeOnSuccess: mergeOnSuccess === true,
      status: 'queued',
      output: '',
      sessionId: null,
      workspacePath: null,
      workspaceOutcome: null,
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    }
    items.set(item.id, item)
    await persist()
    emit('delegation:updated', item)
    pump().catch((err) => console.warn('[delegation] pump:', err.message))
    return snapshot(item)
  }

  async function startItem(item) {
    const controller = new AbortController()
    active.set(item.id, controller)
    item.status = 'running'
    item.startedAt = new Date().toISOString()
    emit('delegation:updated', item)
    await persist()

    let workspace = null
    let childCwd = item.cwd
    try {
      if (typeof prepareWorkspace === 'function' && item.cwd) {
        workspace = await prepareWorkspace({ realCwd: item.cwd, delegationId: item.id })
        if (workspace?.workCwd) {
          childCwd = workspace.workCwd
          item.workspacePath = workspace.worktreePath || workspace.workCwd
        }
      }

      const prompt = [
        'Eres una subdelegación de POWER-AGENT.',
        'Trabaja únicamente sobre el objetivo indicado y devuelve un resultado verificable.',
        'No delegues a otros agentes, no envíes mensajes y no cambies de proyecto.',
        '',
        'OBJETIVO:',
        item.goal,
        item.context ? '\nCONTEXTO:\n' + item.context : '',
        item.workspacePath
          ? '\nESTÁS EN UN WORKTREE AISLADO. Deja allí todos los cambios para revisión.'
          : '',
      ].join('\n')
      let output = ''
      const result = await runChild({
        prompt,
        cwd: childCwd,
        cli: item.cli,
        model: item.model,
        effort: item.effort,
        securityMode: item.securityMode,
        signal: controller.signal,
        origin: 'delegation',
        onText: (chunk) => {
          output = appendBounded(output, chunk)
          item.output = output
          emit('delegation:progress', item)
        },
        onSessionId: (sessionId) => {
          if (sessionId) item.sessionId = sessionId
        },
      })
      item.output = String(result?.text || result?.output || output || '')
      item.sessionId = result?.sessionId || item.sessionId || null
      item.status = 'ok'
      if (workspace && item.mergeOnSuccess && typeof finalizeWorkspace === 'function') {
        item.workspaceOutcome = await finalizeWorkspace(workspace)
      }
    } catch (err) {
      item.status = err?.name === 'AbortError' || /cancel/i.test(err?.message || '')
        ? 'cancelled'
        : 'error'
      item.error = err?.message || String(err)
    } finally {
      item.finishedAt = new Date().toISOString()
      active.delete(item.id)
      emit('delegation:updated', item)
      await persist()
      pump().catch((err) => console.warn('[delegation] pump:', err.message))
    }
  }

  async function pump() {
    while (active.size < limit) {
      const next = [...items.values()]
        .filter((item) => item.status === 'queued')
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0]
      if (!next) return
      startItem(next).catch((err) => console.warn('[delegation] item:', err.message))
    }
  }

  async function cancel(id) {
    const item = items.get(String(id || ''))
    if (!item) return { ok: false, reason: 'not-found' }
    if (item.status === 'queued') {
      item.status = 'cancelled'
      item.finishedAt = new Date().toISOString()
      await persist()
      emit('delegation:updated', item)
      return { ok: true }
    }
    const controller = active.get(item.id)
    if (!controller) return { ok: false, reason: 'not-active' }
    controller.abort()
    return { ok: true }
  }

  function destroy() {
    for (const controller of active.values()) {
      try { controller.abort() } catch {}
    }
    active.clear()
  }

  return {
    init,
    list,
    get,
    dispatch,
    cancel,
    destroy,
    _paths: { filePath },
  }
}

module.exports = { createDelegationManager, appendBounded }
