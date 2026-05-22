'use strict'

// Config schema + pure normalizers (profiles, enterprise, LAN server, telegram).
// Load/save is provided as a factory that captures the config file path and the
// active enterprise policy/Lan port helpers, but state lives in main.js.

const fs = require('fs')
const path = require('path')
const { atomicWriteJsonSync } = require('./atomic-writes')

const CONFIG_FILENAME = 'claude-novak.config.json'
const DEFAULT_PROFILE_ID = 'default'

function normalizeMcpServerList(raw) {
  const values = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' ? raw.split(',') : [])
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)))
}

function sanitizePersonaPrompt(raw, maxLen = 12000) {
  if (typeof raw !== 'string') return ''
  const clean = raw.replace(/\r\n/g, '\n').trim()
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean
}

function sanitizeProfileId(rawId, fallback = '') {
  const clean = String(rawId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  if (clean) return clean
  return String(fallback || '').trim() || DEFAULT_PROFILE_ID
}

function normalizeProfileEntry(raw, fallbackId = '') {
  const id = sanitizeProfileId(raw?.id, fallbackId)
  const name = String(raw?.name || '').trim() || 'Perfil'
  const claudeMdPath = typeof raw?.claudeMdPath === 'string' ? raw.claudeMdPath.trim() : ''
  const cwd = typeof raw?.cwd === 'string' ? raw.cwd.trim() : ''
  const mcpServers = normalizeMcpServerList(raw?.mcpServers)
  const personaPrompt = sanitizePersonaPrompt(raw?.personaPrompt)
  return { id, name, claudeMdPath, mcpServers, cwd, personaPrompt }
}

function normalizeProfiles(rawProfiles) {
  const list = Array.isArray(rawProfiles) ? rawProfiles : []
  const seen = new Set()
  const result = []
  for (const item of list) {
    const next = normalizeProfileEntry(item)
    if (!next.id || seen.has(next.id)) continue
    seen.add(next.id)
    result.push(next)
  }
  if (!seen.has(DEFAULT_PROFILE_ID)) {
    result.unshift({
      id: DEFAULT_PROFILE_ID,
      name: 'Personal',
      claudeMdPath: '',
      mcpServers: [],
      cwd: '',
      personaPrompt: ''
    })
  } else {
    for (let i = 0; i < result.length; i += 1) {
      if (result[i].id !== DEFAULT_PROFILE_ID) continue
      result[i] = {
        ...result[i],
        id: DEFAULT_PROFILE_ID,
        name: result[i].name || 'Personal',
        mcpServers: normalizeMcpServerList(result[i].mcpServers),
        personaPrompt: sanitizePersonaPrompt(result[i].personaPrompt)
      }
      break
    }
  }
  return result
}

function resolveActiveProfileId(profiles, rawActiveProfile) {
  const wanted = sanitizeProfileId(rawActiveProfile, '')
  if (wanted && profiles.some((p) => p.id === wanted)) return wanted
  if (profiles.some((p) => p.id === DEFAULT_PROFILE_ID)) return DEFAULT_PROFILE_ID
  return profiles[0]?.id || DEFAULT_PROFILE_ID
}

function makeProfileIdFromName(name, existingIds = new Set()) {
  const base = sanitizeProfileId(name, 'profile')
  if (!existingIds.has(base)) return base
  let n = 2
  while (existingIds.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

// Factory: pass clampLanPort + normalizeEnterpriseConfig + defaultEnterpriseRoleId
// so we don't depend on ws-server / enterprise-policy at load time.
function createConfigNormalizers({ clampLanPort, normalizeEnterpriseConfig, defaultEnterpriseRoleId }) {
  function normalizeLanServerConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {}
    return {
      enabled: Boolean(cfg.enabled),
      port: clampLanPort(cfg.port)
    }
  }

  function normalizeAppConfig(raw) {
    const cli = raw?.cli || {}
    const telegram = raw?.telegram || {}
    const lanServer = normalizeLanServerConfig(raw?.lanServer)
    const profiles = normalizeProfiles(raw?.profiles)
    const activeProfile = resolveActiveProfileId(profiles, raw?.activeProfile)
    const enterprise = normalizeEnterpriseConfig(raw?.enterprise, {
      profileIds: profiles.map((p) => p.id),
      defaultRoleId: defaultEnterpriseRoleId
    })

    const normalized = {
      cli: {
        defaultCli: cli.defaultCli === 'codex' ? 'codex' : 'claude',
        claudeBin: typeof cli.claudeBin === 'string' ? cli.claudeBin.trim() : '',
        codexBin: typeof cli.codexBin === 'string' ? cli.codexBin.trim() : '',
        whisperBin: typeof cli.whisperBin === 'string' ? cli.whisperBin.trim() : ''
      },
      telegram: {
        enabled: Boolean(telegram.enabled),
        botToken: typeof telegram.botToken === 'string' ? telegram.botToken.trim() : '',
        allowedUsers: [],
        claudeModel: typeof telegram.claudeModel === 'string' ? telegram.claudeModel.trim() : '',
        claudeEffort: typeof telegram.claudeEffort === 'string' ? telegram.claudeEffort.trim() : '',
        codexModel: typeof telegram.codexModel === 'string' ? telegram.codexModel.trim() : '',
        codexEffort: typeof telegram.codexEffort === 'string' ? telegram.codexEffort.trim() : ''
      },
      lanServer,
      profiles,
      activeProfile,
      enterprise
    }

    if (Array.isArray(telegram.allowedUsers)) {
      normalized.telegram.allowedUsers = telegram.allowedUsers.map((u) => String(u).trim()).filter(Boolean)
    } else if (typeof telegram.allowedUsers === 'string') {
      normalized.telegram.allowedUsers = telegram.allowedUsers.split(/[,\s]+/g).map((u) => u.trim()).filter(Boolean)
    }
    normalized.telegram.allowedUsers = Array.from(new Set(normalized.telegram.allowedUsers))

    return normalized
  }

  return {
    normalizeAppConfig,
    normalizeLanServerConfig
  }
}

// Filesystem helpers (sync). Reads/writes through atomic-writes.
function readConfigFromFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return raw
  } catch {
    return fallback
  }
}

function writeConfigToFile(filePath, value) {
  atomicWriteJsonSync(filePath, value)
}

module.exports = {
  CONFIG_FILENAME,
  DEFAULT_PROFILE_ID,
  normalizeMcpServerList,
  sanitizePersonaPrompt,
  sanitizeProfileId,
  normalizeProfileEntry,
  normalizeProfiles,
  resolveActiveProfileId,
  makeProfileIdFromName,
  createConfigNormalizers,
  readConfigFromFile,
  writeConfigToFile
}
