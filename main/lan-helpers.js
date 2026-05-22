'use strict'

const os = require('os')
const path = require('path')

const LAN_CLAUDE_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const LAN_CODEX_EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh'])

function buildLanSessionLegacyRoots(baseCwd) {
  const roots = new Set()
  if (baseCwd) roots.add(baseCwd)
  roots.add(os.homedir())
  return Array.from(roots).map((item) => path.resolve(item))
}

function createLanPermissionNormalizer({ LAN_PERMISSION_KEYS, DEFAULT_LAN_ROLE_PERMISSIONS }) {
  return function normalizeLanPermissionMap(rawPermissions) {
    const src = rawPermissions && typeof rawPermissions === 'object' ? rawPermissions : {}
    const out = {}
    for (const key of LAN_PERMISSION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = Boolean(src[key])
      else out[key] = Boolean(DEFAULT_LAN_ROLE_PERMISSIONS[key])
    }
    return out
  }
}

function sanitizeLanRequestedModel(raw, maxLen = 120) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const clipped = text.length > maxLen ? text.slice(0, maxLen) : text
  if (!/^[a-zA-Z0-9._:/-]+$/.test(clipped)) return ''
  return clipped
}

function sanitizeLanRequestedCli(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return ''
  if (text === 'claude' || text === 'codex') return text
  return ''
}

function sanitizeLanRequestedEffort(raw, cli = '') {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return ''
  if (cli === 'codex') return LAN_CODEX_EFFORT_LEVELS.has(text) ? text : ''
  if (cli === 'claude') return LAN_CLAUDE_EFFORT_LEVELS.has(text) ? text : ''
  if (LAN_CLAUDE_EFFORT_LEVELS.has(text) || LAN_CODEX_EFFORT_LEVELS.has(text)) return text
  return ''
}

function buildLanCliArgs(cli, { model = '', effort = '' } = {}) {
  const args = []
  if (cli === 'codex') {
    args.push('--no-alt-screen')
    if (model) args.push('-m', model)
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`)
    return args
  }
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  return args
}

function resolveLanRemoteContextInput(remoteMeta = {}) {
  if (remoteMeta && typeof remoteMeta === 'object' && remoteMeta.requestedContext && typeof remoteMeta.requestedContext === 'object') {
    return remoteMeta.requestedContext
  }
  return remoteMeta
}

function resolveLanRemoteIp(remoteMeta = {}) {
  if (remoteMeta && typeof remoteMeta === 'object') {
    if (typeof remoteMeta.ip === 'string' && remoteMeta.ip.trim()) return remoteMeta.ip.trim()
    const reqIp = remoteMeta.req?.socket?.remoteAddress
    if (typeof reqIp === 'string' && reqIp.trim()) return reqIp.trim()
  }
  return ''
}

module.exports = {
  LAN_CLAUDE_EFFORT_LEVELS,
  LAN_CODEX_EFFORT_LEVELS,
  buildLanSessionLegacyRoots,
  createLanPermissionNormalizer,
  sanitizeLanRequestedModel,
  sanitizeLanRequestedCli,
  sanitizeLanRequestedEffort,
  buildLanCliArgs,
  resolveLanRemoteContextInput,
  resolveLanRemoteIp
}
