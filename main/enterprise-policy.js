'use strict'

const path = require('path')

const DEFAULT_ENTERPRISE_VERSION = 1
const DEFAULT_ROLE_ID = 'default-role'

const ENTERPRISE_PERMISSION_KEYS = Object.freeze([
  'pty.execute',
  'fs.read',
  'fs.write',
  'fs.list',
  'fs.delete',
  'fs.rename',
  'viewer.open',
  'automations.manage'
])

function sanitizeId(rawId, fallback = '') {
  const clean = String(rawId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
  if (clean) return clean.slice(0, 80)
  const next = String(fallback || '').trim()
  return next || ''
}

function sanitizeUsername(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return ''
  return text
    .replace(/[^a-z0-9._@-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 120)
}

function sanitizePrompt(raw, maxLen = 12000) {
  if (typeof raw !== 'string') return ''
  const clean = raw.replace(/\r\n/g, '\n').trim()
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean
}

function isSubPath(childPath, parentPath) {
  if (!childPath || !parentPath) return false
  const child = path.resolve(childPath)
  const parent = path.resolve(parentPath)
  if (child === parent) return true
  const rel = path.relative(parent, child)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function normalizePathList(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' ? raw.split(',') : [])
  const seen = new Set()
  const result = []
  for (const item of list) {
    const text = String(item || '').trim()
    if (!text) continue
    const resolved = path.resolve(text)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    result.push(resolved)
  }
  return result
}

function normalizeStringList(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' ? raw.split(',') : [])
  const seen = new Set()
  const result = []
  for (const item of list) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

function permissionTemplate(defaultValue = false) {
  const out = {}
  for (const key of ENTERPRISE_PERMISSION_KEYS) out[key] = !!defaultValue
  return out
}

function normalizePermissions(raw, defaults = false) {
  const base = permissionTemplate(defaults)
  if (!raw || typeof raw !== 'object') return base
  for (const key of ENTERPRISE_PERMISSION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) base[key] = Boolean(raw[key])
  }
  return base
}

function normalizeRoleEntry(raw, fallbackId = '', defaults = false) {
  const id = sanitizeId(raw?.id, fallbackId || '')
  if (!id) return null
  const name = String(raw?.name || '').trim() || 'Rol'
  const permissions = normalizePermissions(raw?.permissions, defaults)
  const allowedRoots = normalizePathList(raw?.allowedRoots)
  const readOnlyRoots = normalizePathList(raw?.readOnlyRoots)
    .filter((candidate) => allowedRoots.some((root) => isSubPath(candidate, root)))
  const allowedMcpServers = normalizeStringList(raw?.allowedMcpServers)
  return {
    id,
    name,
    permissions,
    allowedRoots,
    readOnlyRoots,
    allowedMcpServers
  }
}

function normalizeRoles(rawRoles, { defaultRoleId = DEFAULT_ROLE_ID } = {}) {
  const list = Array.isArray(rawRoles) ? rawRoles : []
  const seen = new Set()
  const result = []

  for (const item of list) {
    const role = normalizeRoleEntry(item)
    if (!role || seen.has(role.id)) continue
    seen.add(role.id)
    result.push(role)
  }

  if (!seen.has(defaultRoleId)) {
    result.unshift({
      id: defaultRoleId,
      name: 'Operador estándar',
      permissions: permissionTemplate(true),
      allowedRoots: [],
      readOnlyRoots: [],
      allowedMcpServers: []
    })
    seen.add(defaultRoleId)
  }

  for (let i = 0; i < result.length; i += 1) {
    if (result[i].id !== defaultRoleId) continue
    result[i] = {
      ...result[i],
      id: defaultRoleId,
      name: result[i].name || 'Operador estándar',
      permissions: normalizePermissions(result[i].permissions, true),
      allowedRoots: normalizePathList(result[i].allowedRoots),
      readOnlyRoots: normalizePathList(result[i].readOnlyRoots).filter((candidate) => (
        normalizePathList(result[i].allowedRoots).some((root) => isSubPath(candidate, root))
      )),
      allowedMcpServers: normalizeStringList(result[i].allowedMcpServers)
    }
    break
  }
  return result
}

function normalizeOperatorEntry(raw, { fallbackId = '', validRoleIds = new Set(), profileIds = new Set(), defaultRoleId = DEFAULT_ROLE_ID } = {}) {
  const username = sanitizeUsername(raw?.username || raw?.user || raw?.identifier)
  const id = sanitizeId(raw?.id, fallbackId || username || '')
  if (!id) return null
  const name = String(raw?.name || '').trim() || username || 'Operador'
  const enabled = raw?.enabled !== false
  const requestedRoleId = sanitizeId(raw?.roleId, '')
  const roleId = validRoleIds.has(requestedRoleId) ? requestedRoleId : defaultRoleId
  const requestedProfileId = sanitizeId(raw?.defaultProfileId, '')
  const defaultProfileId = profileIds.has(requestedProfileId) ? requestedProfileId : ''
  const personaPrompt = sanitizePrompt(raw?.personaPrompt)
  return {
    id,
    name,
    username,
    enabled,
    roleId,
    defaultProfileId,
    personaPrompt
  }
}

function normalizeOperators(rawOperators, { validRoleIds = new Set(), profileIds = new Set(), defaultRoleId = DEFAULT_ROLE_ID } = {}) {
  const list = Array.isArray(rawOperators) ? rawOperators : []
  const seenIds = new Set()
  const seenUsers = new Set()
  const result = []
  for (const item of list) {
    const normalized = normalizeOperatorEntry(item, { validRoleIds, profileIds, defaultRoleId })
    if (!normalized || seenIds.has(normalized.id)) continue
    if (normalized.username && seenUsers.has(normalized.username)) continue
    seenIds.add(normalized.id)
    if (normalized.username) seenUsers.add(normalized.username)
    result.push(normalized)
  }
  return result
}

function normalizeEnterpriseConfig(rawEnterprise, { profileIds = [], defaultRoleId = DEFAULT_ROLE_ID } = {}) {
  const src = rawEnterprise && typeof rawEnterprise === 'object' ? rawEnterprise : {}
  const profileIdSet = new Set((Array.isArray(profileIds) ? profileIds : []).map((id) => sanitizeId(id)).filter(Boolean))
  const roles = normalizeRoles(src.roles, { defaultRoleId })
  const roleIdSet = new Set(roles.map((r) => r.id))
  const operators = normalizeOperators(src.operators, { validRoleIds: roleIdSet, profileIds: profileIdSet, defaultRoleId })
  return {
    version: DEFAULT_ENTERPRISE_VERSION,
    enabled: Boolean(src.enabled),
    roles,
    operators
  }
}

function normalizeRemoteContext(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const enterpriseFlagRaw = src.enterpriseEnabled ?? src.enterprise ?? src.enterpriseMode
  return {
    operatorId: sanitizeId(src.operatorId || src.operator || ''),
    roleId: sanitizeId(src.roleId || src.role || ''),
    profileId: sanitizeId(src.profileId || src.profile || ''),
    username: sanitizeUsername(src.username || src.user || src.login || ''),
    enterpriseRequested: (
      enterpriseFlagRaw === true ||
      enterpriseFlagRaw === 1 ||
      String(enterpriseFlagRaw || '').trim().toLowerCase() === 'true' ||
      String(enterpriseFlagRaw || '').trim() === '1'
    )
  }
}

function emptyResolvedContext({ legacyProfileId = '', legacyAllowedRoots = [] } = {}) {
  return {
    mode: 'legacy',
    enterpriseApplied: false,
    operatorId: '',
    roleId: '',
    profileId: sanitizeId(legacyProfileId, ''),
    personaResolved: '',
    personaSource: 'none',
    allowedRoots: normalizePathList(legacyAllowedRoots),
    readOnlyRoots: [],
    allowedMcpServers: [],
    permissions: permissionTemplate(true),
    fallbackReasons: [],
    requested: normalizeRemoteContext({})
  }
}

function resolveEffectiveSessionContext({
  enterprise,
  profiles = [],
  activeProfileId = '',
  remoteContext,
  legacyAllowedRoots = [],
  preferLegacyWhenNoRemoteContext = true,
  defaultRoleId = DEFAULT_ROLE_ID
} = {}) {
  const requested = normalizeRemoteContext(remoteContext)
  const profileList = Array.isArray(profiles) ? profiles : []
  const profileMap = new Map(profileList.map((profile) => [sanitizeId(profile?.id), profile]))
  const activeProfile = sanitizeId(activeProfileId)
  const enterpriseCfg = normalizeEnterpriseConfig(enterprise, { profileIds: Array.from(profileMap.keys()), defaultRoleId })

  const hasRemoteHints = (
    requested.enterpriseRequested ||
    !!requested.operatorId ||
    !!requested.username ||
    !!requested.roleId ||
    !!requested.profileId
  )

  if (!enterpriseCfg.enabled) {
    return {
      ...emptyResolvedContext({ legacyProfileId: activeProfile, legacyAllowedRoots }),
      requested,
      fallbackReasons: ['enterprise-disabled']
    }
  }

  if (!hasRemoteHints && preferLegacyWhenNoRemoteContext) {
    return {
      ...emptyResolvedContext({ legacyProfileId: activeProfile, legacyAllowedRoots }),
      requested,
      fallbackReasons: ['remote-context-missing']
    }
  }

  const fallbackReasons = []
  const rolesById = new Map(enterpriseCfg.roles.map((role) => [role.id, role]))
  const operatorsById = new Map(enterpriseCfg.operators.map((operator) => [operator.id, operator]))
  const operatorsByUsername = new Map(
    enterpriseCfg.operators
      .filter((operator) => operator.username)
      .map((operator) => [operator.username, operator])
  )

  let operator = null
  if (requested.operatorId) {
    const found = operatorsById.get(requested.operatorId) || null
    if (found && found.enabled) operator = found
    else fallbackReasons.push('operator-not-found-or-disabled')
  } else if (requested.username) {
    const found = operatorsByUsername.get(requested.username) || null
    if (found && found.enabled) operator = found
    else fallbackReasons.push('operator-username-not-found-or-disabled')
  }

  let role = null
  if (operator?.roleId) {
    role = rolesById.get(operator.roleId) || null
    if (!role) fallbackReasons.push('operator-role-invalid')
  } else if (requested.roleId) {
    role = rolesById.get(requested.roleId) || null
    if (!role) fallbackReasons.push('requested-role-invalid')
  }
  if (!role) role = rolesById.get(defaultRoleId) || enterpriseCfg.roles[0] || null

  const candidateProfileIds = [
    requested.profileId,
    operator?.defaultProfileId,
    activeProfile,
    profileList[0]?.id
  ]
    .map((id) => sanitizeId(id))
    .filter(Boolean)
  let profile = null
  for (const id of candidateProfileIds) {
    const found = profileMap.get(id)
    if (found) {
      profile = found
      break
    }
  }
  if (!profile) fallbackReasons.push('profile-fallback-empty')
  const resolvedProfileId = sanitizeId(profile?.id, activeProfile || '')

  const operatorPersona = sanitizePrompt(operator?.personaPrompt)
  const profilePersona = sanitizePrompt(profile?.personaPrompt)
  const personaResolved = operatorPersona || profilePersona || ''
  const personaSource = operatorPersona
    ? 'operator'
    : (profilePersona ? 'profile' : 'none')

  const roleAllowedRoots = normalizePathList(role?.allowedRoots)
  const allowedRoots = roleAllowedRoots.length
    ? roleAllowedRoots
    : normalizePathList(legacyAllowedRoots)

  const readOnlyRoots = normalizePathList(role?.readOnlyRoots)
    .filter((candidate) => allowedRoots.some((root) => isSubPath(candidate, root)))

  const profileMcp = normalizeStringList(profile?.mcpServers)
  const roleMcp = normalizeStringList(role?.allowedMcpServers)
  const allowedMcpServers = roleMcp.length
    ? (profileMcp.length ? profileMcp.filter((server) => roleMcp.includes(server)) : roleMcp)
    : profileMcp

  return {
    mode: 'enterprise',
    enterpriseApplied: true,
    operatorId: operator?.id || '',
    roleId: role?.id || '',
    profileId: resolvedProfileId,
    personaResolved,
    personaSource,
    allowedRoots,
    readOnlyRoots,
    allowedMcpServers,
    permissions: normalizePermissions(role?.permissions, true),
    fallbackReasons,
    requested
  }
}

module.exports = {
  DEFAULT_ENTERPRISE_VERSION,
  DEFAULT_ROLE_ID,
  ENTERPRISE_PERMISSION_KEYS,
  sanitizeId,
  sanitizeUsername,
  sanitizePrompt,
  normalizeEnterpriseConfig,
  normalizeRemoteContext,
  resolveEffectiveSessionContext,
  normalizePermissions,
  normalizePathList,
  normalizeStringList
}
