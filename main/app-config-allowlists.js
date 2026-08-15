'use strict'

// SEC-H2/H3: allowlists del canal 'save-app-config' (renderer → main).
// Viven aquí, y no dentro del handler de main.js, para que tengan tests: la
// omisión de un campo es silenciosa —se descarta sin avisar— y así fue como
// publicClientUrl/publicWsUrl quedaron inalcanzables desde la UI (2026-08-13).
//
// Lo que NO entra por este canal, a propósito:
//   - lanServer.authToken: lo genera y persiste main.js.
//   - enterprise.roles/operators/enabled: van por 'enterprise:save-config'.
// Los valores que sí pasan siguen validándose después en normalizeAppConfig;
// esto solo decide qué claves se miran.

const SAFE_CLI = [
  'defaultCli', 'claudeBin', 'codexBin', 'whisperBin', 'claudeModel',
  'gitSessionIsolation', 'gitIsolationExcludes', 'voiceId', 'voiceRate', 'voiceSilenceMs'
]

const SAFE_TELEGRAM = [
  'enabled', 'botToken', 'allowedUsers', 'claudeModel', 'claudeEffort',
  'codexModel', 'codexEffort', 'notifyBotToken', 'notifyChatId', 'healthWatchdog'
]

const SAFE_LAN = ['enabled', 'port', 'publicClientUrl', 'publicWsUrl']

function pick(src, keys) {
  const out = {}
  if (!src || typeof src !== 'object') return out
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k]
  }
  return out
}

// Claves que `pick` tiraría a la basura. El descarte silencioso fue la causa
// del bug de las URLs públicas (seis días de diagnóstico): quien llame a `pick`
// puede llamar también a esto y avisar por log/warning de lo que se ha perdido,
// en vez de dejar al usuario mirando un campo que vuelve vacío sin explicación.
// No altera `pick`: solo informa.
function pickDropped(src, keys) {
  if (!src || typeof src !== 'object') return []
  const allowed = new Set(keys || [])
  return Object.keys(src).filter((k) => !allowed.has(k))
}

module.exports = { SAFE_CLI, SAFE_TELEGRAM, SAFE_LAN, pick, pickDropped }
