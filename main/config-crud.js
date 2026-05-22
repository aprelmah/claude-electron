'use strict'

function createConfigCrud({
  getAppConfig,
  saveAppConfig,
  normalizeAppConfig,
  normalizeEnterpriseConfig,
  normalizeProfileEntry,
  sanitizeProfileId,
  sanitizeEnterpriseId,
  sanitizePersonaPrompt,
  makeProfileIdFromName,
  resolveActiveProfileId,
  DEFAULT_PROFILE_ID,
  DEFAULT_ENTERPRISE_ROLE_ID
}) {
  function getProfileById(profileId, config = getAppConfig()) {
    const id = sanitizeProfileId(profileId, '')
    if (!id) return null
    const profiles = Array.isArray(config?.profiles) ? config.profiles : []
    return profiles.find((p) => p.id === id) || null
  }

  function getActiveProfile(config = getAppConfig()) {
    const activeId = resolveActiveProfileId(Array.isArray(config?.profiles) ? config.profiles : [], config?.activeProfile)
    return getProfileById(activeId, config) || getProfileById(DEFAULT_PROFILE_ID, config) || {
      id: DEFAULT_PROFILE_ID,
      name: 'Personal',
      claudeMdPath: '',
      mcpServers: [],
      cwd: '',
      personaPrompt: ''
    }
  }

  function listProfilesPayload(config = getAppConfig()) {
    const normalized = normalizeAppConfig(config)
    return {
      profiles: normalized.profiles.map((p) => ({
        ...p,
        mcpServers: [...p.mcpServers],
        personaPrompt: sanitizePersonaPrompt(p.personaPrompt)
      })),
      activeProfile: normalized.activeProfile
    }
  }

  function createProfile(profileInput) {
    const current = listProfilesPayload()
    const existing = new Set(current.profiles.map((p) => p.id))
    const name = String(profileInput?.name || '').trim() || 'Nuevo perfil'
    const generatedId = makeProfileIdFromName(name, existing)
    const base = normalizeProfileEntry(profileInput, generatedId)
    const nextProfile = { ...base, id: generatedId, name }
    const merged = normalizeAppConfig({
      ...getAppConfig(),
      profiles: [...current.profiles, nextProfile]
    })
    saveAppConfig(merged)
    return { profile: nextProfile, ...listProfilesPayload() }
  }

  function updateProfile(profileId, profileInput) {
    const id = sanitizeProfileId(profileId, '')
    if (!id) throw new Error('Perfil inválido')
    const current = listProfilesPayload()
    const idx = current.profiles.findIndex((p) => p.id === id)
    if (idx < 0) throw new Error('Perfil no encontrado')
    const prev = current.profiles[idx]
    const draft = normalizeProfileEntry({
      ...prev,
      ...profileInput,
      id
    }, id)
    if (id === DEFAULT_PROFILE_ID) draft.name = 'Personal'
    current.profiles[idx] = draft
    const merged = normalizeAppConfig({
      ...getAppConfig(),
      profiles: current.profiles
    })
    saveAppConfig(merged)
    return { profile: draft, ...listProfilesPayload() }
  }

  function deleteProfile(profileId) {
    const id = sanitizeProfileId(profileId, '')
    if (!id) throw new Error('Perfil inválido')
    if (id === DEFAULT_PROFILE_ID) throw new Error('El perfil Personal no se puede borrar')
    const current = listProfilesPayload()
    const exists = current.profiles.some((p) => p.id === id)
    if (!exists) throw new Error('Perfil no encontrado')
    const profiles = current.profiles.filter((p) => p.id !== id)
    const merged = normalizeAppConfig({
      ...getAppConfig(),
      profiles,
      activeProfile: current.activeProfile === id ? DEFAULT_PROFILE_ID : current.activeProfile
    })
    saveAppConfig(merged)
    return listProfilesPayload()
  }

  function setActiveProfile(profileId) {
    const id = sanitizeProfileId(profileId, '')
    const current = listProfilesPayload()
    if (!current.profiles.some((p) => p.id === id)) throw new Error('Perfil no encontrado')
    const merged = normalizeAppConfig({
      ...getAppConfig(),
      activeProfile: id
    })
    saveAppConfig(merged)
    return listProfilesPayload()
  }

  function makeEnterpriseEntityIdFromName(name, existingIds = new Set(), fallbackPrefix = 'entity') {
    const baseSeed = sanitizeEnterpriseId(name, fallbackPrefix) || fallbackPrefix
    const base = sanitizeEnterpriseId(baseSeed, fallbackPrefix) || fallbackPrefix
    if (!existingIds.has(base)) return base
    let n = 2
    while (existingIds.has(`${base}-${n}`)) n += 1
    return `${base}-${n}`
  }

  function listEnterprisePayload(config = getAppConfig()) {
    const normalized = normalizeAppConfig(config)
    const enterprise = normalized.enterprise || normalizeEnterpriseConfig({}, {
      profileIds: normalized.profiles.map((p) => p.id),
      defaultRoleId: DEFAULT_ENTERPRISE_ROLE_ID
    })
    return {
      enterprise: {
        version: Number(enterprise.version || 1),
        enabled: Boolean(enterprise.enabled),
        roles: (enterprise.roles || []).map((role) => ({
          ...role,
          permissions: { ...(role.permissions || {}) },
          allowedRoots: Array.isArray(role.allowedRoots) ? [...role.allowedRoots] : [],
          readOnlyRoots: Array.isArray(role.readOnlyRoots) ? [...role.readOnlyRoots] : [],
          allowedMcpServers: Array.isArray(role.allowedMcpServers) ? [...role.allowedMcpServers] : []
        })),
        operators: (enterprise.operators || []).map((operator) => ({
          ...operator,
          enabled: operator?.enabled !== false
        }))
      },
      profiles: normalized.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        mcpServers: Array.isArray(profile.mcpServers) ? [...profile.mcpServers] : [],
        personaPrompt: sanitizePersonaPrompt(profile.personaPrompt)
      })),
      activeProfile: normalized.activeProfile
    }
  }

  function saveEnterpriseConfig(enterpriseInput) {
    const merged = normalizeAppConfig({
      ...getAppConfig(),
      enterprise: enterpriseInput
    })
    saveAppConfig(merged)
    return listEnterprisePayload()
  }

  function createEnterpriseRole(roleInput = {}) {
    const current = listEnterprisePayload()
    const roles = Array.isArray(current.enterprise.roles) ? [...current.enterprise.roles] : []
    const existingIds = new Set(roles.map((role) => role.id))
    const requestedId = sanitizeEnterpriseId(roleInput?.id, '')
    const roleId = requestedId && !existingIds.has(requestedId)
      ? requestedId
      : makeEnterpriseEntityIdFromName(roleInput?.name || requestedId || 'rol', existingIds, 'role')
    const draft = { ...roleInput, id: roleId }
    return saveEnterpriseConfig({
      ...current.enterprise,
      roles: [...roles, draft]
    })
  }

  function updateEnterpriseRole(roleId, patch = {}) {
    const id = sanitizeEnterpriseId(roleId, '')
    if (!id) throw new Error('Rol inválido')
    const current = listEnterprisePayload()
    const roles = Array.isArray(current.enterprise.roles) ? [...current.enterprise.roles] : []
    const idx = roles.findIndex((role) => role.id === id)
    if (idx < 0) throw new Error('Rol no encontrado')
    roles[idx] = { ...roles[idx], ...patch, id }
    return saveEnterpriseConfig({
      ...current.enterprise,
      roles
    })
  }

  function deleteEnterpriseRole(roleId) {
    const id = sanitizeEnterpriseId(roleId, '')
    if (!id) throw new Error('Rol inválido')
    if (id === DEFAULT_ENTERPRISE_ROLE_ID) throw new Error('No se puede borrar el rol por defecto')
    const current = listEnterprisePayload()
    const roles = Array.isArray(current.enterprise.roles) ? current.enterprise.roles.filter((role) => role.id !== id) : []
    if (roles.length === current.enterprise.roles.length) throw new Error('Rol no encontrado')
    const operators = Array.isArray(current.enterprise.operators)
      ? current.enterprise.operators.map((operator) => (
        operator.roleId === id
          ? { ...operator, roleId: DEFAULT_ENTERPRISE_ROLE_ID }
          : operator
      ))
      : []
    return saveEnterpriseConfig({
      ...current.enterprise,
      roles,
      operators
    })
  }

  function createEnterpriseOperator(operatorInput = {}) {
    const current = listEnterprisePayload()
    const operators = Array.isArray(current.enterprise.operators) ? [...current.enterprise.operators] : []
    const existingIds = new Set(operators.map((operator) => operator.id))
    const requestedId = sanitizeEnterpriseId(operatorInput?.id, '')
    const operatorId = requestedId && !existingIds.has(requestedId)
      ? requestedId
      : makeEnterpriseEntityIdFromName(operatorInput?.name || operatorInput?.username || 'operador', existingIds, 'operator')
    const draft = { ...operatorInput, id: operatorId }
    return saveEnterpriseConfig({
      ...current.enterprise,
      operators: [...operators, draft]
    })
  }

  function updateEnterpriseOperator(operatorId, patch = {}) {
    const id = sanitizeEnterpriseId(operatorId, '')
    if (!id) throw new Error('Operador inválido')
    const current = listEnterprisePayload()
    const operators = Array.isArray(current.enterprise.operators) ? [...current.enterprise.operators] : []
    const idx = operators.findIndex((operator) => operator.id === id)
    if (idx < 0) throw new Error('Operador no encontrado')
    operators[idx] = { ...operators[idx], ...patch, id }
    return saveEnterpriseConfig({
      ...current.enterprise,
      operators
    })
  }

  function deleteEnterpriseOperator(operatorId) {
    const id = sanitizeEnterpriseId(operatorId, '')
    if (!id) throw new Error('Operador inválido')
    const current = listEnterprisePayload()
    const operators = Array.isArray(current.enterprise.operators)
      ? current.enterprise.operators.filter((operator) => operator.id !== id)
      : []
    if (operators.length === current.enterprise.operators.length) throw new Error('Operador no encontrado')
    return saveEnterpriseConfig({
      ...current.enterprise,
      operators
    })
  }

  return {
    getProfileById,
    getActiveProfile,
    listProfilesPayload,
    createProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
    makeEnterpriseEntityIdFromName,
    listEnterprisePayload,
    saveEnterpriseConfig,
    createEnterpriseRole,
    updateEnterpriseRole,
    deleteEnterpriseRole,
    createEnterpriseOperator,
    updateEnterpriseOperator,
    deleteEnterpriseOperator
  }
}

module.exports = { createConfigCrud }
