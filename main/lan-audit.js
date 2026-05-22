'use strict'

const { buildLanSessionLegacyRoots } = require('./lan-helpers')

function createLanAudit({
  getAppConfig,
  resolveEffectiveSessionContext,
  sanitizeProfileId,
  logSemantic,
  DEFAULT_PROFILE_ID,
  DEFAULT_ENTERPRISE_ROLE_ID
}) {
  function resolveLanEnterpriseContext(remoteContext, activeProfile, fallbackCwd) {
    const appConfig = getAppConfig()
    const legacyRoots = buildLanSessionLegacyRoots(fallbackCwd)
    const resolved = resolveEffectiveSessionContext({
      enterprise: appConfig?.enterprise,
      profiles: appConfig?.profiles,
      activeProfileId: activeProfile?.id || appConfig?.activeProfile || DEFAULT_PROFILE_ID,
      remoteContext,
      legacyAllowedRoots: legacyRoots,
      preferLegacyWhenNoRemoteContext: true,
      defaultRoleId: DEFAULT_ENTERPRISE_ROLE_ID
    })
    const activeProfileId = sanitizeProfileId(activeProfile?.id || appConfig?.activeProfile, DEFAULT_PROFILE_ID)
    if (!resolved.enterpriseApplied) {
      return {
        ...resolved,
        profileId: resolved.profileId || activeProfileId || DEFAULT_PROFILE_ID,
        allowedRoots: Array.isArray(resolved.allowedRoots) && resolved.allowedRoots.length
          ? resolved.allowedRoots
          : legacyRoots
      }
    }
    return {
      ...resolved,
      profileId: sanitizeProfileId(resolved.profileId, activeProfileId || DEFAULT_PROFILE_ID),
      allowedRoots: Array.isArray(resolved.allowedRoots) && resolved.allowedRoots.length
        ? resolved.allowedRoots
        : legacyRoots
    }
  }

  function logEnterpriseSessionSemantic(ctx, meta = {}) {
    if (!ctx || !ctx.enterpriseApplied) return
    const remoteIp = typeof meta?.ip === 'string' ? meta.ip.trim() : ''
    const fallbackLabel = Array.isArray(ctx.fallbackReasons) && ctx.fallbackReasons.length
      ? ` fallback=${ctx.fallbackReasons.join('|')}`
      : ''
    if (ctx.operatorId) {
      logSemantic('empresa_login_operador', {
        detail: `operator=${ctx.operatorId} role=${ctx.roleId || '-'} ip=${remoteIp || '-'}`
      })
    }
    logSemantic('empresa_sesion_iniciada', {
      detail: `operator=${ctx.operatorId || '-'} role=${ctx.roleId || '-'} profile=${ctx.profileId || '-'} ip=${remoteIp || '-'}${fallbackLabel}`
    })
    logSemantic('empresa_perfil_aplicado', {
      detail: `profile=${ctx.profileId || '-'} operator=${ctx.operatorId || '-'}`
    })
    if (ctx.personaResolved) {
      logSemantic('empresa_persona_aplicada', {
        detail: `source=${ctx.personaSource || 'unknown'} operator=${ctx.operatorId || '-'} profile=${ctx.profileId || '-'}`
      })
    }
    logSemantic('empresa_mcp_policy_aplicada', {
      detail: `operator=${ctx.operatorId || '-'} role=${ctx.roleId || '-'} mcp_count=${Array.isArray(ctx.allowedMcpServers) ? ctx.allowedMcpServers.length : 0}`
    })
  }

  function logLanAuditSemantic(event = {}) {
    const action = String(event?.action || '').trim()
    if (!action) return
    const safe = (value, max = 240) => {
      const text = String(value == null ? '' : value).trim()
      if (!text) return '-'
      return text.length > max ? text.slice(0, max) : text
    }

    let parts = null
    if (action === 'empresa_permiso_denegado_fs') {
      parts = [
        `session=${safe(event?.sessionId, 120)}`,
        `operator=${safe(event?.operatorId, 120)}`,
        `role=${safe(event?.roleId, 120)}`,
        `profile=${safe(event?.profileId, 120)}`,
        `op=${safe(event?.op, 60)}`,
        `path=${safe(event?.path, 320)}`,
        `code=${safe(event?.code, 80)}`,
        `msg=${safe(event?.message, 320)}`
      ]
    } else if (action === 'empresa_upload_remoto') {
      parts = [
        `session=${safe(event?.sessionId, 120)}`,
        `operator=${safe(event?.operatorId, 120)}`,
        `role=${safe(event?.roleId, 120)}`,
        `profile=${safe(event?.profileId, 120)}`,
        `path=${safe(event?.path, 320)}`,
        `size=${Number(event?.size || 0)}`,
        `mime=${safe(event?.mime, 120)}`,
        `ext=${safe(event?.ext, 40)}`
      ]
    } else if (action === 'empresa_upload_remoto_denegado') {
      parts = [
        `session=${safe(event?.sessionId, 120)}`,
        `operator=${safe(event?.operatorId, 120)}`,
        `role=${safe(event?.roleId, 120)}`,
        `profile=${safe(event?.profileId, 120)}`,
        `name=${safe(event?.name, 140)}`,
        `mime=${safe(event?.mime, 120)}`,
        `code=${safe(event?.code, 80)}`,
        `msg=${safe(event?.message, 320)}`
      ]
    } else if (action === 'empresa_handshake_contexto_actualizado') {
      parts = [
        `session=${safe(event?.sessionId, 120)}`,
        `source=${safe(event?.source, 80)}`,
        `changed=${safe(event?.changed, 120)}`,
        `requested_operator=${safe(event?.requestedOperatorId, 120)}`,
        `requested_role=${safe(event?.requestedRoleId, 120)}`,
        `requested_profile=${safe(event?.requestedProfileId, 120)}`,
        `username_provided=${event?.usernameProvided ? '1' : '0'}`,
        `requested_cli=${safe(event?.requestedCli, 80)}`,
        `requested_model=${safe(event?.requestedModel, 120)}`,
        `requested_effort=${safe(event?.requestedEffort, 80)}`,
        `late=${event?.late ? '1' : '0'}`
      ]
    } else if (action === 'empresa_contexto_resuelto') {
      parts = [
        `session=${safe(event?.sessionId, 120)}`,
        `request_source=${safe(event?.requestSource, 80)}`,
        `requested_operator=${safe(event?.requestedOperatorId, 120)}`,
        `requested_role=${safe(event?.requestedRoleId, 120)}`,
        `requested_profile=${safe(event?.requestedProfileId, 120)}`,
        `username_provided=${event?.usernameProvided ? '1' : '0'}`,
        `requested_cli=${safe(event?.requestedCli, 80)}`,
        `requested_model=${safe(event?.requestedModel, 120)}`,
        `requested_effort=${safe(event?.requestedEffort, 80)}`,
        `mode=${safe(event?.mode, 40)}`,
        `enterprise=${event?.enterpriseEnabled ? '1' : '0'}`,
        `applied_operator=${safe(event?.appliedOperatorId, 120)}`,
        `applied_role=${safe(event?.appliedRoleId, 120)}`,
        `applied_profile=${safe(event?.appliedProfileId, 120)}`,
        `applied_cli=${safe(event?.appliedCli, 80)}`,
        `applied_model=${safe(event?.appliedModel, 120)}`,
        `applied_effort=${safe(event?.appliedEffort, 80)}`
      ]
    } else if (action === 'empresa_fs_watch_iniciado' || action === 'empresa_fs_watch_detenido' || action === 'empresa_fs_watch_error') {
      parts = [
        `session=${safe(event?.sessionId, 120)}`,
        `operator=${safe(event?.operatorId, 120)}`,
        `role=${safe(event?.roleId, 120)}`,
        `profile=${safe(event?.profileId, 120)}`,
        `watch=${safe(event?.watchId, 120)}`,
        `path=${safe(event?.path, 320)}`,
        `reason=${safe(event?.reason || event?.fallback || '', 260)}`,
        `code=${safe(event?.code, 80)}`,
        `msg=${safe(event?.message, 320)}`,
        `auto=${event?.auto ? '1' : '0'}`
      ]
    }

    if (!parts || !parts.length) return
    logSemantic(action, { detail: parts.join(' ') })
  }

  return {
    resolveLanEnterpriseContext,
    logEnterpriseSessionSemantic,
    logLanAuditSemantic
  }
}

module.exports = { createLanAudit }
