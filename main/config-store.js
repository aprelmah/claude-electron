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

// SEC-C2: allowlist de paths donde es legítimo apuntar claudeBin/codexBin/whisperBin.
// Cualquier path absoluto fuera de estos roots se rechaza (vacío = autodetectar).
const CLI_BIN_ALLOWED_ROOTS = [
  '/usr/local/bin/',
  '/usr/local/Cellar/',
  '/opt/homebrew/bin/',
  '/opt/homebrew/Cellar/',
  '/usr/bin/',
  '/bin/'
]

// Modelo Claude por defecto del PTY local. Default 'opus' (contexto estándar
// 200k) para NO disparar el gate de créditos del 1M (`claude-opus-4-8[1m]`).
// Acepta alias (opus/sonnet/haiku) e ids tipo `claude-opus-4-8` o `...[1m]`.
function sanitizeClaudeModel(value, fallback = 'opus') {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!v) return fallback
  if (v.length > 60) return fallback
  if (!/^[a-z0-9][a-z0-9.\-]*(\[[a-z0-9]+\])?$/.test(v)) return fallback
  return v
}

// Aislamiento git por sesión (rama+commit automático por PTY en repos git).
// Default true. Escape hatch: solo `false` explícito lo desactiva; cualquier
// otro valor (ausente, basura, tipo incorrecto) cae al default seguro.
function sanitizeGitSessionIsolation(value, fallback = true) {
  if (value === false) return false
  if (value === true) return true
  return fallback
}

// Carpetas excluidas del aislamiento git (una por línea en la UI). Acepta
// array o string multilínea/comas. Solo rutas absolutas o con ~; tope de 50
// entradas y 500 chars cada una para que un config roto no infle el JSON.
function sanitizeGitIsolationExcludes(value) {
  let items = []
  if (Array.isArray(value)) items = value
  else if (typeof value === 'string') items = value.split(/[\n,]+/g)
  const out = []
  for (const raw of items) {
    const s = String(raw || '').trim()
    if (!s || s.length > 500) continue
    if (!s.startsWith('/') && !s.startsWith('~')) continue
    if (!out.includes(s)) out.push(s)
    if (out.length >= 50) break
  }
  return out
}

// El modo voz NO tiene clave de "arrancado": se enciende siempre desde el botón
// de la ventana, nunca al abrir la app. Persistir un `voiceEnabled` obligaría a
// pedir micrófono y reconocimiento de voz en el arranque sin que nadie lo haya
// pedido, y el dueño del micro es una ventana concreta (`voiceOwnerWcId`), no la
// app: no hay a quién devolvérselo al restaurar la config.
//
// Velocidad de la voz del modo voz. Escala de AVSpeechUtterance.rate: 0..1,
// con 0.5 como "normal" del sistema. Se acota a un rango audible-útil: por
// debajo de 0.3 arrastra las sílabas, por encima de 0.7 no se entiende.
// '' = sin preferencia (el helper usa su 0.52 por defecto).
function sanitizeVoiceRate(value) {
  // Ojo: Number('') === 0. El vacío es "sin preferencia", no "al mínimo".
  if (typeof value === 'string' && !value.trim()) return ''
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  return String(Math.min(0.7, Math.max(0.3, Math.round(n * 100) / 100)))
}

// Pausa de silencio (ms) que cierra el turno del modo voz. El 1,1 s medido de
// estabilización del texto cortaba al usuario al respirar o pensar; el helper
// usa 1,8 s por defecto. '' = sin preferencia. Acotado a 800–6000: por debajo
// corta en cada coma, y el techo subió de 3 s a 6 s porque 3 s seguían cortando
// a Luismi cuando se paraba a pensar a mitad de frase (2026-08-08). El precio de
// una pausa larga es que cada turno tarda eso en salir: es su decisión, con el
// slider a mano.
function sanitizeVoiceSilenceMs(value) {
  // Ojo: Number('') === 0. El vacío es "sin preferencia", no "al mínimo".
  if (typeof value === 'string' && !value.trim()) return ''
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  return String(Math.min(6000, Math.max(800, Math.round(n))))
}

// Identificador de voz de AVSpeechSynthesis (p. ej.
// `com.apple.voice.premium.es-ES.Monica`). Viaja al helper como valor de un
// JSON por NDJSON, así que lo único intolerable son los saltos de línea (parten
// el protocolo) y los controles. Sí se admiten acentos y espacios: hay voces
// que se llaman `Mónica` o `Eddy (Español)` y descartarlas en silencio dejaba
// al usuario cambiando una voz que nunca se aplicaba.
function sanitizeVoiceId(value) {
  if (typeof value !== 'string') return ''
  const v = value.trim()
  if (!v || v.length > 200) return ''
  // Saltos de línea y controles: partirían el NDJSON del helper.
  if (/[\u0000-\u001f\u007f]/.test(v)) return ''
  return /^[\p{L}\p{N}._\-: ()]+$/u.test(v) ? v : ''
}

function sanitizeCliBinaryPath(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return ''
  // Rechazar caracteres shell peligrosos.
  if (/[;&|`$<>\\\n\r\t"'*?]/.test(v)) return ''
  // Rechazar traversal.
  if (v.includes('..')) return ''
  // Solo paths absolutos.
  if (!v.startsWith('/') && !v.startsWith('~')) return ''
  const os = require('os')
  const path = require('path')
  let resolved = v
  if (v.startsWith('~')) {
    resolved = path.join(os.homedir(), v.slice(1))
  }
  if (!path.isAbsolute(resolved)) return ''
  // Allowlist de roots (paths del HOME también permitidos para nvm/.local).
  const home = os.homedir()
  const userRoots = [
    path.join(home, '.local/bin/'),
    path.join(home, 'bin/'),
    path.join(home, '.nvm/versions/node/')
  ]
  const allowed = [...CLI_BIN_ALLOWED_ROOTS, ...userRoots]
  const ok = allowed.some((root) => resolved === root.replace(/\/$/, '') || resolved.startsWith(root))
  if (!ok) return ''
  return resolved
}

// Factory: pass clampLanPort + normalizeEnterpriseConfig + defaultEnterpriseRoleId
// so we don't depend on ws-server / enterprise-policy at load time.
function createConfigNormalizers({ clampLanPort, normalizeEnterpriseConfig, defaultEnterpriseRoleId }) {
  function normalizeLanPublicUrl(raw, protocols) {
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text || text.length > 500 || /[\u0000\r\n]/.test(text)) return ''
    try {
      const parsed = new URL(text)
      if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password) return ''
      // Los parámetros los añade el servidor (token, invite, wsUrl). No
      // persistimos query/hash escritos a mano para evitar guardar secretos.
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString().replace(/\/$/, '')
    } catch {
      return ''
    }
  }

  function normalizeLanServerConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {}
    return {
      enabled: Boolean(cfg.enabled),
      port: clampLanPort(cfg.port),
      // SEC-C1: token Bearer para auth WS+HTTP. Si vacío, server queda inseguro
      // (compat hacia atrás); main.js genera y persiste uno al primer arranque.
      authToken: typeof cfg.authToken === 'string' ? cfg.authToken.trim() : '',
      // Opcionales: solo aceptamos HTTPS/WSS para una publicación exterior.
      // Vacíos = solo LAN/local, sin publicar nada.
      publicClientUrl: normalizeLanPublicUrl(cfg.publicClientUrl, ['https:']),
      publicWsUrl: normalizeLanPublicUrl(cfg.publicWsUrl, ['wss:'])
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
        // SEC-C2: solo paths absolutos dentro de roots conocidos (Homebrew, nvm,
        // .local/bin, /usr/local). Bloquea RCE local vía XSS que setea bin a /tmp/x.
        claudeBin: sanitizeCliBinaryPath(cli.claudeBin),
        codexBin: sanitizeCliBinaryPath(cli.codexBin),
        whisperBin: sanitizeCliBinaryPath(cli.whisperBin),
        claudeModel: sanitizeClaudeModel(cli.claudeModel),
        gitSessionIsolation: sanitizeGitSessionIsolation(cli.gitSessionIsolation),
        gitIsolationExcludes: sanitizeGitIsolationExcludes(cli.gitIsolationExcludes),
        voiceId: sanitizeVoiceId(cli.voiceId),
        voiceRate: sanitizeVoiceRate(cli.voiceRate),
        voiceSilenceMs: sanitizeVoiceSilenceMs(cli.voiceSilenceMs)
      },
      telegram: {
        enabled: Boolean(telegram.enabled),
        botToken: typeof telegram.botToken === 'string' ? telegram.botToken.trim() : '',
        notifyBotToken: typeof telegram.notifyBotToken === 'string' ? telegram.notifyBotToken.trim() : '',
        notifyChatId: typeof telegram.notifyChatId === 'string' ? telegram.notifyChatId.trim() : '',
        // Doctor diario in-app (health-watchdog): default ON, solo avisa con problemas.
        healthWatchdog: telegram.healthWatchdog !== false,
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
    normalizeLanServerConfig,
    sanitizeCliBinaryPath,
    sanitizeClaudeModel,
    sanitizeGitSessionIsolation,
    sanitizeGitIsolationExcludes,
    sanitizeVoiceId,
    sanitizeVoiceRate,
    sanitizeVoiceSilenceMs
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
  // SEC-H1: 0o600 — el config guarda telegram.botToken y lanServer.authToken.
  atomicWriteJsonSync(filePath, value, { mode: 0o600 })
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
  writeConfigToFile,
  sanitizeCliBinaryPath,
  sanitizeClaudeModel,
  sanitizeGitSessionIsolation,
  sanitizeGitIsolationExcludes,
  sanitizeVoiceId,
  sanitizeVoiceRate,
  sanitizeVoiceSilenceMs
}
