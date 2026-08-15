const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const pty = require('node-pty')
const { WebSocketServer } = require('ws')
const { looksRemotePath } = require('./dir-helpers')
const { createLanSessionInvites } = require('./lan-session-invites')

const DEFAULT_LAN_WS_PORT = 9999
const MIN_LAN_PORT = 1024
const MAX_LAN_PORT = 65534
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 35
const SESSION_NEGOTIATION_TIMEOUT_MS = 180
const MAX_PREINIT_QUEUE = 64
const MAX_PREINIT_INPUT_BYTES = 128 * 1024
const SESSION_LOCK_TIMEOUT_MS = 9 * 1000
const SESSION_LOCK_SWEEP_MS = 1 * 1000
const MAX_REUSABLE_SESSIONS = 300
const MAX_FS_TREE_DEPTH = 4
const MAX_FS_LIST_ENTRIES = 2000
const MAX_FS_WATCH_SNAPSHOT_ENTRIES = 2500
const MAX_FS_WATCH_EVENT_PATHS = 64
const FS_WATCH_DEBOUNCE_MS = 220
const FS_WATCH_THROTTLE_MS = 900
const FS_WATCH_POLL_INTERVAL_MS = 2200
const AUTO_FS_WATCH_ID = '__auto__'

const MIN_FS_LIMIT_BYTES = 64 * 1024
const MAX_FS_LIMIT_BYTES = 32 * 1024 * 1024
const DEFAULT_FS_LIMITS = Object.freeze({
  maxReadBytes: 10 * 1024 * 1024,
  maxPreviewBytes: 10 * 1024 * 1024,
  maxTextPreviewBytes: 600 * 1024,
  maxUploadBytes: 20 * 1024 * 1024
})

const HANDSHAKE_TYPES = new Set(['handshake', 'session:handshake', 'session-handshake', 'hello', 'session:init'])
const CONTEXT_SYNC_TYPES = new Set([
  ...HANDSHAKE_TYPES,
  'session:context',
  'session-context',
  'context',
  'identity',
  'session:identity'
])

const CLAUDE_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const CODEX_EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh'])
const VALID_CLI_CHOICES = new Set(['claude', 'codex'])

const PERMISSION_KEYS = Object.freeze({
  PTY_EXECUTE: 'pty.execute',
  FS_READ: 'fs.read',
  FS_WRITE: 'fs.write',
  FS_LIST: 'fs.list',
  FS_DELETE: 'fs.delete',
  FS_RENAME: 'fs.rename',
  VIEWER_OPEN: 'viewer.open',
  AUTOMATIONS_MANAGE: 'automations.manage'
})

const DEFAULT_PERMISSIONS = Object.freeze({
  [PERMISSION_KEYS.PTY_EXECUTE]: true,
  [PERMISSION_KEYS.FS_READ]: true,
  [PERMISSION_KEYS.FS_WRITE]: true,
  [PERMISSION_KEYS.FS_LIST]: true,
  [PERMISSION_KEYS.FS_DELETE]: true,
  [PERMISSION_KEYS.FS_RENAME]: true,
  [PERMISSION_KEYS.VIEWER_OPEN]: true,
  [PERMISSION_KEYS.AUTOMATIONS_MANAGE]: false
})

const FS_DENIED_AUDIT_CODES = new Set([
  'PERMISSION_DENIED',
  'PATH_OUTSIDE_ALLOWED_ROOTS',
  'PATH_SYMLINK_ESCAPE',
  'READ_ONLY_ROOT',
  'REMOTE_PATH_UNSUPPORTED'
])

const IMAGE_MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
})

const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.xml', '.csv', '.tsv',
  '.ini', '.conf', '.cfg', '.toml', '.log', '.sql', '.py', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.svg',
  '.sh', '.bash', '.zsh', '.ps1', '.java', '.kt', '.go', '.rs', '.c', '.h', '.hpp', '.cpp'
])

const UPLOAD_ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.ini', '.cfg', '.toml', '.log',
  '.pdf', '.zip', '.gz', '.tgz', '.tar', '.7z', '.rar',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.avif', '.heic', '.heif',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm', '.mp4', '.mov', '.avi', '.mkv',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.sql', '.html', '.htm', '.css'
])

const MIME_EXTENSION_HINTS = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/json': '.json'
})

function clampLanPort(rawPort) {
  const n = Number.parseInt(String(rawPort || ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_LAN_WS_PORT
  if (n < MIN_LAN_PORT) return MIN_LAN_PORT
  if (n > MAX_LAN_PORT) return MAX_LAN_PORT
  return n
}

function normalizeRemoteIp(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (text.startsWith('::ffff:')) return text.slice(7)
  if (text === '::1') return '127.0.0.1'
  return text
}

function isPrivateIPv4(ip) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10))
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false
  if (parts[0] === 10) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return false
}

function pickLanIPv4() {
  const nets = os.networkInterfaces()
  const privateCandidates = []
  const publicCandidates = []
  for (const entries of Object.values(nets || {})) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue
      const addr = String(entry.address || '').trim()
      if (!addr) continue
      if (isPrivateIPv4(addr)) privateCandidates.push(addr)
      else publicCandidates.push(addr)
    }
  }
  return privateCandidates[0] || publicCandidates[0] || '127.0.0.1'
}

function parseJsonMessage(raw) {
  try {
    return JSON.parse(String(raw || ''))
  } catch {
    return null
  }
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== 1) return
  try { ws.send(JSON.stringify(payload)) } catch {}
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

function buildDefaultExec(bin, args = []) {
  const cmd = [shellQuote(bin), ...args.map(shellQuote)].join(' ')
  return `exec ${cmd}`
}

function trimToString(value, maxLen = 5000) {
  const text = String(value == null ? '' : value).trim()
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen)
}

function sanitizeModelName(raw, maxLen = 120) {
  const text = trimToString(raw, maxLen)
  if (!text) return ''
  if (!/^[a-zA-Z0-9._:/-]+$/.test(text)) return ''
  return text
}

function sanitizeEffortLevel(raw, cli = '') {
  const text = trimToString(raw, 40).toLowerCase()
  if (!text) return ''
  if (cli === 'codex') return CODEX_EFFORT_LEVELS.has(text) ? text : ''
  if (cli === 'claude') return CLAUDE_EFFORT_LEVELS.has(text) ? text : ''
  if (CODEX_EFFORT_LEVELS.has(text) || CLAUDE_EFFORT_LEVELS.has(text)) return text
  return ''
}

function sanitizeCliChoice(raw) {
  const text = trimToString(raw, 30).toLowerCase()
  if (!text) return ''
  return VALID_CLI_CHOICES.has(text) ? text : ''
}

function normalizeStringList(values, maxLen = 5000) {
  if (!Array.isArray(values)) return []
  const out = []
  const seen = new Set()
  for (const value of values) {
    const text = trimToString(value, maxLen)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function normalizeBoolean(raw, fallback = false) {
  if (raw === true || raw === false) return raw
  if (raw == null) return fallback
  const text = String(raw).trim().toLowerCase()
  if (!text) return fallback
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false
  return fallback
}

function clampLimitBytes(raw, fallback, min = MIN_FS_LIMIT_BYTES, max = MAX_FS_LIMIT_BYTES) {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

function normalizeFsLimits(rawLimits = {}, baseLimits = DEFAULT_FS_LIMITS) {
  const src = rawLimits && typeof rawLimits === 'object' ? rawLimits : {}
  const base = baseLimits && typeof baseLimits === 'object' ? baseLimits : DEFAULT_FS_LIMITS

  const maxReadBytes = clampLimitBytes(
    src.maxReadBytes ?? src.readBytes ?? src.maxRead ?? src.read,
    base.maxReadBytes
  )
  const maxPreviewBytes = clampLimitBytes(
    src.maxPreviewBytes ?? src.previewBytes ?? src.maxPreview ?? src.open,
    base.maxPreviewBytes
  )
  const maxTextPreviewBytes = Math.min(
    maxPreviewBytes,
    clampLimitBytes(
      src.maxTextPreviewBytes ?? src.textPreviewBytes ?? src.maxTextPreview ?? src.text,
      base.maxTextPreviewBytes,
      8 * 1024,
      maxPreviewBytes
    )
  )
  const maxUploadBytes = clampLimitBytes(
    src.maxUploadBytes ?? src.uploadBytes ?? src.maxUpload ?? src.upload,
    base.maxUploadBytes
  )

  return {
    maxReadBytes,
    maxPreviewBytes,
    maxTextPreviewBytes,
    maxUploadBytes
  }
}

function normalizeAbsolutePath(inputPath) {
  const value = trimToString(inputPath)
  if (!value) return ''
  if (value.includes('\u0000')) return ''
  try {
    return path.resolve(value)
  } catch {
    return ''
  }
}

function isUnderPath(child, parent) {
  if (!child || !parent) return false
  const c = path.resolve(child)
  const r = path.resolve(parent)
  return c === r || c.startsWith(r + path.sep)
}

function safeRealpathSync(targetPath) {
  try {
    if (typeof fs.realpathSync.native === 'function') return fs.realpathSync.native(targetPath)
    return fs.realpathSync(targetPath)
  } catch {
    return ''
  }
}

function readPermission(raw, dottedKey, fallbackValue) {
  if (!raw || typeof raw !== 'object') return fallbackValue
  if (Object.prototype.hasOwnProperty.call(raw, dottedKey)) return !!raw[dottedKey]
  const segments = dottedKey.split('.')
  let cursor = raw
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return fallbackValue
    }
    cursor = cursor[segment]
  }
  return !!cursor
}

function normalizePermissionMap(rawPermissions) {
  const out = {}
  for (const [key, fallback] of Object.entries(DEFAULT_PERMISSIONS)) {
    out[key] = readPermission(rawPermissions, key, fallback)
  }
  return out
}

function parseConnectionQuery(req) {
  try {
    const parsed = new URL(String(req?.url || '/'), 'ws://127.0.0.1')
    return parsed.searchParams
  } catch {
    return new URLSearchParams('')
  }
}

function firstNonEmpty(params, names = []) {
  for (const name of names) {
    const val = trimToString(params.get(name), 300)
    if (val) return val
  }
  return ''
}

function isTruthyText(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return false
  return text === '1' || text === 'true' || text === 'yes' || text === 'on' || text === 'selector' || text === 'manual' || text === 'select'
}

function extractSessionSelectorModeFromQuery(req) {
  const params = parseConnectionQuery(req)
  const mode = firstNonEmpty(params, ['lanSessionMode', 'sessionMode', 'sessionSelector'])
  return isTruthyText(mode)
}

function sanitizeResumeSessionId(raw) {
  const text = trimToString(raw, 220)
  if (!text) return ''
  if (!/^[a-zA-Z0-9._:-]+$/.test(text)) return ''
  return text
}

function sanitizeSessionRowCli(raw, fallback = 'claude') {
  const text = trimToString(raw, 40).toLowerCase()
  if (text === 'claude' || text === 'codex') return text
  return fallback === 'codex' ? 'codex' : 'claude'
}

function normalizeSessionListRows(rows, options = {}) {
  if (!Array.isArray(rows)) return []
  const out = []
  const seen = new Set()
  const cliFallback = sanitizeSessionRowCli(options?.cli || 'claude', 'claude')
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const id = sanitizeResumeSessionId(row.id || row.sessionId)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      cli: sanitizeSessionRowCli(row.cli, cliFallback),
      mtime: Number(row.mtime || row.mtimeMs || 0),
      size: Number(row.size || 0),
      msgCount: Number(row.msgCount || row.messages || 0),
      preview: trimToString(row.preview, 320),
      path: trimToString(row.path, 3000)
    })
    if (out.length >= MAX_REUSABLE_SESSIONS) break
  }
  return out
}

function extractRequestedContextFromQuery(req) {
  const params = parseConnectionQuery(req)
  const raw = Object.fromEntries(params.entries())
  // Nunca pasamos credenciales o capabilities de un enlace a la política de
  // sesión. El token Bearer y la invitación son secretos de transporte, no
  // contexto de operador.
  delete raw.token
  delete raw.auth
  delete raw.invite
  return {
    operatorId: firstNonEmpty(params, ['operatorId', 'operator', 'op', 'userId']),
    profileId: firstNonEmpty(params, ['profileId', 'profile', 'pf']),
    roleId: firstNonEmpty(params, ['roleId', 'role']),
    username: firstNonEmpty(params, ['username', 'user', 'login']),
    cli: sanitizeCliChoice(firstNonEmpty(params, ['cli', 'provider', 'engine'])),
    model: sanitizeModelName(firstNonEmpty(params, ['model', 'modelId', 'm'])),
    effort: sanitizeEffortLevel(firstNonEmpty(params, ['effort', 'reasoningEffort', 'reasoning', 'e'])),
    raw,
    source: 'query'
  }
}

function parseRequestedContextPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return null
  const acceptTypeLess = options.acceptTypeLess === true
  const expectedTypeSet = options.typeSet instanceof Set ? options.typeSet : CONTEXT_SYNC_TYPES
  const type = trimToString(payload.type, 100).toLowerCase()

  const nested = payload.context && typeof payload.context === 'object'
    ? payload.context
    : (payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : payload)

  const operatorId = trimToString(nested.operatorId || nested.operator || nested.op || nested.userId, 300)
  const profileId = trimToString(nested.profileId || nested.profile || nested.pf, 300)
  const roleId = trimToString(nested.roleId || nested.role, 300)
  const username = trimToString(nested.username || nested.user || nested.login, 300)
  const cli = sanitizeCliChoice(nested.cli || nested.provider || nested.engine)
  const model = sanitizeModelName(nested.model || nested.modelId || nested.m)
  const effort = sanitizeEffortLevel(nested.effort || nested.reasoningEffort || nested.reasoning || nested.e)

  const hasContextHints = !!(operatorId || profileId || roleId || username || cli || model || effort)
  if (!expectedTypeSet.has(type)) {
    if (!(acceptTypeLess && !type && hasContextHints)) return null
  }

  if (!hasContextHints) return null

  return {
    operatorId,
    profileId,
    roleId,
    username,
    cli,
    model,
    effort,
    raw: nested,
    source: HANDSHAKE_TYPES.has(type) ? 'handshake' : (type || 'context-sync')
  }
}

function mergeRequestedContext(base, patch) {
  const current = base && typeof base === 'object' ? base : {}
  const next = patch && typeof patch === 'object' ? patch : {}
  return {
    operatorId: trimToString(next.operatorId || current.operatorId, 300),
    profileId: trimToString(next.profileId || current.profileId, 300),
    roleId: trimToString(next.roleId || current.roleId, 300),
    username: trimToString(next.username || current.username, 300),
    cli: sanitizeCliChoice(next.cli || current.cli),
    model: sanitizeModelName(next.model || current.model),
    effort: sanitizeEffortLevel(next.effort || current.effort),
    raw: next.raw && typeof next.raw === 'object' ? next.raw : (current.raw || {}),
    source: next.source || current.source || 'none'
  }
}

function resolveExistingDir(candidatePath) {
  const resolved = normalizeAbsolutePath(candidatePath)
  if (!resolved) return ''
  // Defensa NAS/SMB: statSync síncrono sobre /Volumes/... no responsivo cuelga
  // main process. Rechazamos paths remotos a nivel de config de sesión LAN.
  if (looksRemotePath(resolved)) return ''
  try {
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) return ''
    return resolved
  } catch {
    return ''
  }
}

function normalizeRootEntries(rootList, fallbackRoots = []) {
  const candidates = Array.isArray(rootList) && rootList.length > 0 ? rootList : fallbackRoots
  const out = []
  const seen = new Set()
  for (const raw of candidates) {
    const resolved = resolveExistingDir(raw)
    if (!resolved || seen.has(resolved)) continue
    seen.add(resolved)
    out.push({
      normalized: resolved,
      real: safeRealpathSync(resolved) || resolved
    })
  }
  if (out.length) return out

  const fallback = resolveExistingDir(os.homedir())
  if (!fallback) return []
  return [{ normalized: fallback, real: safeRealpathSync(fallback) || fallback }]
}

function toPublicRootList(entries) {
  return Array.isArray(entries) ? entries.map((entry) => entry.normalized) : []
}

function normalizeResolvedSessionConfig(rawConfig, requestedContext, defaultFsLimits = DEFAULT_FS_LIMITS) {
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
  const cli = sanitizeCliChoice(raw.cli || requestedContext.cli) || 'claude'
  const cwd = resolveExistingDir(raw.cwd) || resolveExistingDir(os.homedir()) || os.homedir()
  const permissions = normalizePermissionMap(raw.permissions)

  const allowedRootEntries = normalizeRootEntries(raw.allowedRoots, [cwd])
  const readOnlyEntries = normalizeRootEntries(raw.readOnlyRoots, [])
    .filter((ro) => allowedRootEntries.some((root) => isUnderPath(ro.normalized, root.normalized)))

  const allowedMcpServers = normalizeStringList(
    Array.isArray(raw.allowedMcpServers) ? raw.allowedMcpServers : raw.mcpServers,
    1000
  )

  const operatorId = trimToString(raw.operatorId || requestedContext.operatorId, 300)
  const roleId = trimToString(raw.roleId || requestedContext.roleId, 300)
  const profileId = trimToString(raw.profileId || requestedContext.profileId, 300)
  const model = sanitizeModelName(raw.model || raw.cliModel || requestedContext.model)
  const effort = sanitizeEffortLevel(raw.effort || raw.cliEffort || requestedContext.effort, cli)
  const personaResolved = trimToString(raw.personaResolved, 30000)
  const personaSource = trimToString(raw.personaSource, 80) || (personaResolved ? 'operator-or-profile' : 'none')
  const bootstrapMessage = trimToString(raw.bootstrapMessage || '', 50000)
  const fsLimits = normalizeFsLimits(
    raw.fsLimits || raw.fs?.limits || {},
    defaultFsLimits
  )

  const enterpriseEnabled = !!(raw.enterpriseEnabled || raw.enterprise?.enabled)
  const mode = trimToString(raw.mode, 50) || (enterpriseEnabled ? 'enterprise' : 'legacy')

  return {
    cli,
    cwd,
    bin: trimToString(raw.bin, 1000),
    env: raw.env && typeof raw.env === 'object' ? raw.env : { ...process.env },
    args: Array.isArray(raw.args) ? raw.args : [],
    permissions,
    context: {
      mode,
      enterpriseEnabled,
      operatorId: operatorId || null,
      roleId: roleId || null,
      profileId: profileId || null,
      cli: cli || null,
      model: model || null,
      effort: effort || null,
      personaResolved: personaResolved || '',
      personaSource,
      allowedRoots: toPublicRootList(allowedRootEntries),
      readOnlyRoots: toPublicRootList(readOnlyEntries),
      allowedMcpServers,
      request: {
        operatorId: requestedContext.operatorId || null,
        profileId: requestedContext.profileId || null,
        roleId: requestedContext.roleId || null,
        username: requestedContext.username || null,
        cli: sanitizeCliChoice(requestedContext.cli) || null,
        model: sanitizeModelName(requestedContext.model) || null,
        effort: sanitizeEffortLevel(requestedContext.effort, cli) || null,
        source: requestedContext.source || 'none'
      }
    },
    pathPolicy: {
      allowedRoots: allowedRootEntries,
      readOnlyRoots: readOnlyEntries
    },
    fsLimits,
    bootstrapMessage
  }
}

function ensureSafeRequestedPath(session, rawPath, fallbackPath = '') {
  const input = trimToString(rawPath, 8000)
  const fallback = trimToString(fallbackPath, 8000)
  const finalInput = input || fallback
  if (!finalInput) throw createFsError('INVALID_PATH', 'Ruta vacía o inválida')
  if (finalInput.includes('\u0000')) throw createFsError('INVALID_PATH', 'Ruta inválida')

  // Defensa NAS/SMB: paths remotos (/Volumes/..., //host/share, \\host\share)
  // cuelgan statSync/readdirSync síncronos en main process. El cliente LAN no
  // tiene caso de uso legítimo para tocar mounts remotos del host vía sesión.
  if (looksRemotePath(finalInput)) {
    throw createFsError('REMOTE_PATH_UNSUPPORTED', 'Permiso denegado: ruta remota no soportada')
  }

  const base = resolveExistingDir(session.cwd) || os.homedir()
  const candidate = path.isAbsolute(finalInput)
    ? finalInput
    : path.join(base, finalInput)
  const resolved = normalizeAbsolutePath(candidate)
  if (!resolved) throw createFsError('INVALID_PATH', 'No se pudo normalizar la ruta')
  if (looksRemotePath(resolved)) {
    throw createFsError('REMOTE_PATH_UNSUPPORTED', 'Permiso denegado: ruta remota no soportada')
  }

  const matchedLexicalRoot = session.pathPolicy.allowedRoots.find((root) => isUnderPath(resolved, root.normalized))
  if (!matchedLexicalRoot) {
    throw createFsError('PATH_OUTSIDE_ALLOWED_ROOTS', 'Permiso denegado: ruta fuera de roots permitidas')
  }

  return {
    input: finalInput,
    absolutePath: resolved,
    matchedLexicalRoot
  }
}

function resolveNearestExistingAncestorRealpath(absPath) {
  let current = absPath
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current)) {
      return safeRealpathSync(current) || normalizeAbsolutePath(current)
    }
    current = path.dirname(current)
  }
  if (current && fs.existsSync(current)) {
    return safeRealpathSync(current) || normalizeAbsolutePath(current)
  }
  return ''
}

function assertPathAllowed(session, rawPath, options = {}) {
  const mustExist = options.mustExist !== false
  const expectDirectory = options.expectDirectory === true
  const expectFile = options.expectFile === true
  const forWrite = options.forWrite === true

  const checked = ensureSafeRequestedPath(session, rawPath, options.fallbackPath || '')
  const absPath = checked.absolutePath
  const exists = fs.existsSync(absPath)

  if (!exists && mustExist) {
    throw createFsError('NOT_FOUND', 'Ruta no existe')
  }

  let stat = null
  let realPath = ''
  if (exists) {
    try {
      stat = fs.lstatSync(absPath)
    } catch {
      throw createFsError('IO_ERROR', 'No se pudo inspeccionar la ruta')
    }

    realPath = safeRealpathSync(absPath)
    if (!realPath) throw createFsError('IO_ERROR', 'No se pudo resolver la ruta real')

    const matchesRealRoot = session.pathPolicy.allowedRoots.some((root) => isUnderPath(realPath, root.real))
    if (!matchesRealRoot) {
      throw createFsError('PATH_SYMLINK_ESCAPE', 'Permiso denegado: symlink fuera de roots permitidas')
    }
  } else {
    const parent = normalizeAbsolutePath(path.dirname(absPath))
    const parentReal = resolveNearestExistingAncestorRealpath(parent)
    if (!parentReal) throw createFsError('NOT_FOUND', 'Directorio padre no existe')

    const matchesParentRealRoot = session.pathPolicy.allowedRoots.some((root) => isUnderPath(parentReal, root.real))
    if (!matchesParentRealRoot) {
      throw createFsError('PATH_SYMLINK_ESCAPE', 'Permiso denegado: ancestro real fuera de roots permitidas')
    }
  }

  if (expectDirectory && stat && !stat.isDirectory()) {
    throw createFsError('NOT_DIRECTORY', 'Se esperaba un directorio')
  }

  if (expectFile && stat && !(stat.isFile() || stat.isSymbolicLink())) {
    throw createFsError('NOT_FILE', 'Se esperaba un archivo')
  }

  if (forWrite && isPathReadOnly(session, absPath, realPath)) {
    throw createFsError('READ_ONLY_ROOT', 'Permiso denegado: ruta en root de solo lectura')
  }

  return {
    input: checked.input,
    absolutePath: absPath,
    exists,
    stat,
    realPath
  }
}

function isPathReadOnly(session, absolutePath, realPath = '') {
  const roots = session.pathPolicy.readOnlyRoots
  if (!Array.isArray(roots) || roots.length === 0) return false
  const targetAbs = normalizeAbsolutePath(absolutePath)
  const targetReal = realPath || (targetAbs && fs.existsSync(targetAbs) ? safeRealpathSync(targetAbs) : '')
  return roots.some((root) => {
    if (targetReal && isUnderPath(targetReal, root.real)) return true
    return targetAbs ? isUnderPath(targetAbs, root.normalized) : false
  })
}

function createFsError(code, message, extra = {}) {
  const err = new Error(message)
  err.code = code
  err.extra = extra
  return err
}

function fsErrorToPayload(err, fallbackCode = 'IO_ERROR') {
  const code = trimToString(err?.code, 120) || fallbackCode
  const message = trimToString(err?.message, 2000) || 'Error de filesystem'
  const extra = err && typeof err.extra === 'object' ? err.extra : undefined
  return { code, message, ...(extra ? { extra } : {}) }
}

function extensionLower(filePath) {
  return String(path.extname(String(filePath || '')) || '').trim().toLowerCase()
}

function sanitizeMimeType(raw) {
  const text = trimToString(raw, 120).toLowerCase()
  if (!text) return ''
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(text)) return ''
  return text
}

function isLikelyTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return true
  const max = Math.min(buffer.length, 4096)
  let suspicious = 0
  for (let i = 0; i < max; i += 1) {
    const byte = buffer[i]
    if (byte === 0) return false
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1
  }
  return (suspicious / max) < 0.12
}

function classifyPreviewByPathAndBuffer(filePath, buffer) {
  const ext = extensionLower(filePath)
  if (IMAGE_MIME_BY_EXT[ext]) {
    return { type: 'image', mime: IMAGE_MIME_BY_EXT[ext], ext }
  }
  if (TEXT_PREVIEW_EXTENSIONS.has(ext) || isLikelyTextBuffer(buffer)) {
    return { type: 'text', mime: ext === '.svg' ? 'image/svg+xml' : 'text/plain; charset=utf-8', ext }
  }
  return { type: 'binary', mime: 'application/octet-stream', ext }
}

function decodeBase64Payload(raw, maxBytes) {
  const asText = trimToString(raw, Math.ceil((maxBytes * 4) / 3) + 1024)
  if (!asText) throw createFsError('INVALID_REQUEST', 'base64 vacío')
  const stripped = asText.replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '')
  if (!stripped) throw createFsError('INVALID_REQUEST', 'base64 vacío')
  if (!/^[a-z0-9+/=]+$/i.test(stripped) || (stripped.length % 4 !== 0)) {
    throw createFsError('INVALID_REQUEST', 'base64 inválido')
  }
  const approxBytes = Math.floor((stripped.length * 3) / 4)
  if (approxBytes > maxBytes) {
    throw createFsError('FILE_TOO_LARGE', `Archivo supera límite de ${maxBytes} bytes`, {
      limit: maxBytes,
      approxSize: approxBytes
    })
  }
  const buffer = Buffer.from(stripped, 'base64')
  if (!buffer.length) throw createFsError('INVALID_REQUEST', 'archivo vacío')
  if (buffer.length > maxBytes) {
    throw createFsError('FILE_TOO_LARGE', `Archivo supera límite de ${maxBytes} bytes`, {
      limit: maxBytes,
      size: buffer.length
    })
  }
  return buffer
}

function safeUploadBasename(rawName) {
  const fallback = `upload-${Date.now()}`
  const fromInput = trimToString(rawName, 800)
  const base = fromInput ? path.basename(fromInput) : fallback
  const clean = base
    .replace(/[\u0000-\u001f]+/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140)
  if (!clean) return fallback
  return clean
}

function applyMimeExtensionHint(filename, mime) {
  const ext = extensionLower(filename)
  if (ext) return filename
  const hintedExt = MIME_EXTENSION_HINTS[mime] || ''
  if (!hintedExt) return filename
  return `${filename}${hintedExt}`
}

function ensureAllowedUploadExtension(filePath) {
  const ext = extensionLower(filePath)
  if (!ext) return
  if (UPLOAD_ALLOWED_EXTENSIONS.has(ext)) return
  throw createFsError('UNSUPPORTED_FILE_TYPE', `Extensión no permitida para upload: ${ext}`)
}

function makeUniqueFilePath(targetDir, filename) {
  const ext = extensionLower(filename)
  const stem = ext ? filename.slice(0, -ext.length) : filename
  for (let i = 0; i < 2000; i += 1) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    const candidate = path.join(targetDir, `${stem}${suffix}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw createFsError('IO_ERROR', 'No se pudo reservar nombre de archivo para upload')
}

function trimPathForWire(targetPath) {
  return trimToString(targetPath, 2000)
}

function fileKindFromStat(stat) {
  if (!stat) return 'unknown'
  if (stat.isDirectory()) return 'dir'
  if (stat.isFile()) return 'file'
  if (stat.isSymbolicLink()) return 'symlink'
  return 'other'
}

function listDirectoryTree(session, dirPath, depth) {
  const maxDepth = Math.max(1, Math.min(Number.parseInt(depth, 10) || 1, MAX_FS_TREE_DEPTH))
  const counter = { count: 0, truncated: false }

  function walk(currentDir, currentDepth) {
    const rows = []
    let entries = []
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch (err) {
      throw createFsError('IO_ERROR', err?.message || 'No se pudo leer el directorio')
    }

    entries.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))

    for (const entry of entries) {
      if (counter.count >= MAX_FS_LIST_ENTRIES) {
        counter.truncated = true
        break
      }

      const name = String(entry?.name || '')
      if (!name) continue
      const abs = path.join(currentDir, name)

      let stat = null
      try {
        stat = fs.lstatSync(abs)
      } catch {
        continue
      }

      counter.count += 1
      const kind = fileKindFromStat(stat)
      const canRead = session.permissions[PERMISSION_KEYS.FS_READ] || session.permissions[PERMISSION_KEYS.VIEWER_OPEN]
      const canWrite = session.permissions[PERMISSION_KEYS.FS_WRITE] && !isPathReadOnly(session, abs)

      const row = {
        name,
        path: abs,
        kind,
        size: Number(stat.size || 0),
        mtimeMs: Number(stat.mtimeMs || 0),
        canRead,
        canWrite
      }

      if (kind === 'symlink') {
        const real = safeRealpathSync(abs)
        row.linkInside = !!(real && session.pathPolicy.allowedRoots.some((root) => isUnderPath(real, root.real)))
        rows.push(row)
        continue
      }

      if (kind === 'dir' && currentDepth < maxDepth) {
        const real = safeRealpathSync(abs)
        const insideRoots = !!(real && session.pathPolicy.allowedRoots.some((root) => isUnderPath(real, root.real)))
        if (insideRoots) {
          row.children = walk(abs, currentDepth + 1)
        } else {
          row.denied = true
        }
      }

      rows.push(row)
    }

    return rows
  }

  return {
    entries: walk(dirPath, 1),
    truncated: counter.truncated,
    limit: MAX_FS_LIST_ENTRIES,
    depth: maxDepth
  }
}

function buildWatchSnapshotDigest(rootPath, depth = MAX_FS_TREE_DEPTH, limit = MAX_FS_WATCH_SNAPSHOT_ENTRIES) {
  const maxDepth = Math.max(1, Math.min(Number.parseInt(depth, 10) || 1, MAX_FS_TREE_DEPTH))
  const maxEntries = Math.max(200, Math.min(Number.parseInt(limit, 10) || MAX_FS_WATCH_SNAPSHOT_ENTRIES, 10000))
  const counter = { count: 0, truncated: false }
  const chunks = []

  function walk(currentPath, currentDepth) {
    let entries = []
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true })
    } catch (err) {
      throw createFsError('IO_ERROR', err?.message || 'No se pudo leer directorio para watcher')
    }
    entries.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' }))

    for (const entry of entries) {
      if (counter.count >= maxEntries) {
        counter.truncated = true
        break
      }
      const name = String(entry?.name || '')
      if (!name) continue
      const abs = path.join(currentPath, name)

      let stat = null
      try {
        stat = fs.lstatSync(abs)
      } catch {
        continue
      }

      counter.count += 1
      const rel = path.relative(rootPath, abs) || '.'
      const kind = fileKindFromStat(stat)
      chunks.push(`${rel}|${kind}|${Number(stat.size || 0)}|${Number(stat.mtimeMs || 0)}`)

      if (kind === 'dir' && currentDepth < maxDepth) {
        walk(abs, currentDepth + 1)
      }
    }
  }

  walk(rootPath, 1)

  return {
    signature: crypto.createHash('sha1').update(chunks.join('\n')).digest('hex'),
    count: counter.count,
    truncated: counter.truncated,
    depth: maxDepth,
    limit: maxEntries
  }
}

function createLanWsServer(options = {}) {
  const getSessionConfig = typeof options.getSessionConfig === 'function'
    ? options.getSessionConfig
    : (() => ({ cli: 'claude', cwd: os.homedir(), bin: 'claude', env: { ...process.env }, args: [] }))
  const listReusableSessions = typeof options.listReusableSessions === 'function'
    ? options.listReusableSessions
    : (() => [])
  const listReusableProjects = typeof options.listReusableProjects === 'function'
    ? options.listReusableProjects
    : ((meta) => [{ cwd: meta?.cwd, label: path.basename(String(meta?.cwd || '')) || 'Proyecto actual' }])
  const resolveSessionContext = typeof options.resolveSessionContext === 'function' ? options.resolveSessionContext : null
  const transcribeAudio = typeof options.transcribeAudio === 'function' ? options.transcribeAudio : null
  const runSemanticChatTurn = typeof options.runSemanticChatTurn === 'function' ? options.runSemanticChatTurn : null
  const logger = typeof options.logger === 'function' ? options.logger : (() => {})
  const buildExecCommand = typeof options.buildExecCommand === 'function' ? options.buildExecCommand : buildDefaultExec
  const onAuditEvent = typeof options.onAuditEvent === 'function' ? options.onAuditEvent : null
  const defaultFsLimits = normalizeFsLimits(options.fsLimits || {}, DEFAULT_FS_LIMITS)
  const fsWatchOptions = options.fsWatch && typeof options.fsWatch === 'object' ? options.fsWatch : {}
  const fsWatchDebounceMs = Math.max(80, Math.min(Number.parseInt(fsWatchOptions.debounceMs, 10) || FS_WATCH_DEBOUNCE_MS, 3000))
  const fsWatchThrottleMs = Math.max(150, Math.min(Number.parseInt(fsWatchOptions.throttleMs, 10) || FS_WATCH_THROTTLE_MS, 10000))
  const fsWatchPollingIntervalMs = Math.max(600, Math.min(Number.parseInt(fsWatchOptions.pollMs, 10) || FS_WATCH_POLL_INTERVAL_MS, 15000))
  const fsWatchDepth = Math.max(1, Math.min(Number.parseInt(fsWatchOptions.depth, 10) || MAX_FS_TREE_DEPTH, MAX_FS_TREE_DEPTH))
  const sessionLockTimeoutMs = Math.max(4000, Math.min(Number.parseInt(options.sessionLockTimeoutMs, 10) || SESSION_LOCK_TIMEOUT_MS, 60000))
  const sessionLockSweepMs = Math.max(500, Math.min(Number.parseInt(options.sessionLockSweepMs, 10) || SESSION_LOCK_SWEEP_MS, sessionLockTimeoutMs))
  // SEC-C1: auth Bearer token. Si getAuthToken devuelve un string no vacío,
  // toda conexión WS y endpoint HTTP (excepto /lan-client.html público)
  // exige ?token= o Authorization: Bearer match.
  const getAuthToken = typeof options.getAuthToken === 'function'
    ? options.getAuthToken
    : () => ''
  const getPublicClientUrl = typeof options.getPublicClientUrl === 'function'
    ? options.getPublicClientUrl
    : () => ''
  const getPublicWsUrl = typeof options.getPublicWsUrl === 'function'
    ? options.getPublicWsUrl
    : () => ''
  function timingSafeStringEqual(a, b) {
    const A = String(a || '')
    const B = String(b || '')
    if (!A || !B || A.length !== B.length) return false
    try {
      return crypto.timingSafeEqual(Buffer.from(A), Buffer.from(B))
    } catch { return false }
  }
  function extractTokenFromReq(req) {
    try {
      const url = new URL(req?.url || '/', 'http://127.0.0.1')
      const q = url.searchParams.get('token') || url.searchParams.get('auth')
      if (q) return String(q)
    } catch {}
    try {
      const h = req?.headers?.authorization || req?.headers?.Authorization
      if (typeof h === 'string' && /^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim()
    } catch {}
    return ''
  }
  function isAuthorizedReq(req) {
    const expected = String(getAuthToken() || '')
    if (!expected) return true
    return timingSafeStringEqual(extractTokenFromReq(req), expected)
  }

  function hasValidSessionInvite(req) {
    const token = firstNonEmpty(parseConnectionQuery(req), ['invite'])
    return !!token && sessionInvites.has(token)
  }

  // Git por sesión (aislamiento por worktree). Se aceptan como getter o como
  // objeto directo: en main.js son `let` que se inicializan en onReady, después
  // de crear el servidor, así que la resolución perezosa evita capturar null.
  const getSessionGit = typeof options.sessionGit === 'function'
    ? options.sessionGit
    : () => options.sessionGit || null
  const getSessionGitMap = typeof options.sessionGitMap === 'function'
    ? options.sessionGitMap
    : () => options.sessionGitMap || null

  // Duplicado consciente del finalize de main.js (finalizeWorkspaceForSession):
  // la lógica de git es idéntica pero la notificación en LAN es console.warn +
  // frame `status` por WebSocket si el socket sigue abierto. Fire-and-forget.
  function finalizeSessionGitWorkspace(session) {
    const sessionGit = getSessionGit()
    const sessionGitMap = getSessionGitMap()
    const ws = session?.gitWorkspace
    if (!sessionGit || !ws) return
    session.gitWorkspace = null // anular al entrar evita doble finalize
    const sock = session.ws
    ;(async () => {
      const copied = sessionGit.copySessionsHome({ realCwd: ws.realCwd, workCwd: ws.workCwd })
      const r = await sessionGit.finalizeSessionWorkspace(ws)
      for (const sid of copied) { try { sessionGitMap?.markFinalized(sid) } catch {} }
      if (r && (r.outcome === 'conflict' || r.outcome === 'dirty-target' || r.outcome === 'error')) {
        console.warn(`[session-git] finalize LAN ${r.outcome}: ${ws.branch || ''}${r.detail ? ' — ' + r.detail : ''}`)
        try {
          safeSend(sock, {
            type: 'status',
            state: 'git-warning',
            branch: ws.branch || null,
            outcome: r.outcome,
            message: r.detail || r.outcome
          })
        } catch {}
      }
    })().catch((err) => console.warn('[session-git] finalize LAN:', err?.message || err))
  }

  // Antes de spawnear un PTY claude con --resume dentro de un worktree, copiar
  // el transcript .jsonl de la sesión al dir codificado del worktree: sin esto
  // Claude Code no encuentra el historial (vive bajo el cwd real). Espejo de
  // lo que hace main.js en resume-session. Fail-open: cualquier fallo → warn.
  function copyResumeTranscriptToWorktree(session, cliName, resumeSessionId) {
    if (!resumeSessionId || !session?.gitWorkspace) return
    if ((cliName || session?.cli || 'claude') === 'codex') return
    try {
      const sessionGit = getSessionGit()
      sessionGit?.copySessionToWorktree({
        claudeSessionId: resumeSessionId,
        realCwd: session.cwd,
        workCwd: session.gitWorkspace.workCwd
      })
    } catch (err) {
      logger(`[session-git] copySessionToWorktree LAN: ${err?.message || err}`)
    }
  }

  let wsServer = null
  let httpServer = null
  let running = false
  let port = DEFAULT_LAN_WS_PORT
  let httpPort = DEFAULT_LAN_WS_PORT + 1
  let lanIp = '127.0.0.1'
  let clientHtmlPath = options.clientHtmlPath || ''

  const sessions = new Map()
  const sessionLocks = new Map()
  const sessionInvites = createLanSessionInvites()
  let lockSweepTimer = null

  function emitAudit(action, details = {}) {
    if (!onAuditEvent) return
    try {
      onAuditEvent({ action, ts: Date.now(), source: 'lan-ws-server', ...details })
    } catch {}
  }

  function sessionLockKey(cwd, sessionId) {
    const normalizedCwd = normalizeAbsolutePath(cwd)
    const safeSessionId = sanitizeResumeSessionId(sessionId)
    if (!normalizedCwd || !safeSessionId) return ''
    return `${normalizedCwd}::${safeSessionId}`
  }

  function sessionLockOwnerLabel(session) {
    const context = session?.context || {}
    const requested = context?.request || session?.requestedContext || {}
    const label = trimToString(
      context.username ||
      requested.username ||
      context.operatorId ||
      requested.operatorId ||
      context.profileId ||
      session?.ip ||
      session?.id,
      120
    )
    if (label) return label
    const shortId = trimToString(session?.id, 80)
    return shortId ? `cliente-${shortId.slice(0, 8)}` : 'cliente'
  }

  function releaseSessionLockByKey(lockKey, reason = 'released') {
    const key = trimToString(lockKey, 4000)
    if (!key) return false
    const current = sessionLocks.get(key)
    if (!current) return false
    sessionLocks.delete(key)
    const owner = sessions.get(current.ownerSessionId)
    if (owner && owner.sessionLockKey === key) {
      owner.sessionLockKey = ''
      owner.selectedResumeSessionId = ''
    }
    emitAudit('lan_session_lock_released', {
      sessionId: current.ownerSessionId || '',
      lockSessionId: current.sessionId || '',
      cwd: current.cwd || '',
      reason
    })
    return true
  }

  function releaseSessionLock(session, reason = 'released') {
    const key = trimToString(session?.sessionLockKey, 4000)
    if (!key) return false
    const current = sessionLocks.get(key)
    if (!current || current.ownerSessionId !== session.id) {
      session.sessionLockKey = ''
      session.selectedResumeSessionId = ''
      return false
    }
    const released = releaseSessionLockByKey(key, reason)
    if (released) {
      session.sessionLockKey = ''
      session.selectedResumeSessionId = ''
    }
    return released
  }

  function pruneStaleSessionLocks(now = Date.now()) {
    for (const [key, lock] of sessionLocks.entries()) {
      if (!lock || Number(lock.expiresAt || 0) > now) continue
      releaseSessionLockByKey(key, 'stale-timeout')
    }
  }

  function touchSessionLock(session, now = Date.now()) {
    const key = trimToString(session?.sessionLockKey, 4000)
    if (!key) return false
    const lock = sessionLocks.get(key)
    if (!lock || lock.ownerSessionId !== session.id) {
      session.sessionLockKey = ''
      session.selectedResumeSessionId = ''
      return false
    }
    lock.lastHeartbeatAt = now
    lock.expiresAt = now + sessionLockTimeoutMs
    sessionLocks.set(key, lock)
    return true
  }

  function acquireSessionLock(session, cwd, sessionId) {
    const safeSessionId = sanitizeResumeSessionId(sessionId)
    if (!safeSessionId) {
      releaseSessionLock(session, 'switch-to-new-session')
      return { ok: true, acquired: false, sessionId: '' }
    }

    const safeCwd = normalizeAbsolutePath(cwd)
    const key = sessionLockKey(safeCwd, safeSessionId)
    if (!key) {
      return {
        ok: false,
        code: 'INVALID_SESSION_ID',
        message: 'ID de sesión inválido para reanudar.'
      }
    }

    pruneStaleSessionLocks(Date.now())

    const existing = sessionLocks.get(key)
    if (existing && existing.ownerSessionId !== session.id) {
      return {
        ok: false,
        code: 'SESSION_LOCKED',
        message: `La sesión está ocupada por ${existing.ownerLabel || 'otro cliente'}.`,
        owner: existing.ownerLabel || '',
        sessionId: safeSessionId
      }
    }

    if (session.sessionLockKey && session.sessionLockKey !== key) {
      releaseSessionLock(session, 'switch-session')
    }

    const now = Date.now()
    const nextLock = {
      key,
      sessionId: safeSessionId,
      cwd: safeCwd,
      ownerSessionId: session.id,
      ownerLabel: sessionLockOwnerLabel(session),
      acquiredAt: existing ? Number(existing.acquiredAt || now) : now,
      lastHeartbeatAt: now,
      expiresAt: now + sessionLockTimeoutMs
    }
    sessionLocks.set(key, nextLock)
    session.sessionLockKey = key
    session.selectedResumeSessionId = safeSessionId
    emitAudit('lan_session_lock_acquired', {
      sessionId: session.id,
      lockSessionId: safeSessionId,
      cwd: safeCwd,
      owner: nextLock.ownerLabel
    })
    return { ok: true, acquired: true, sessionId: safeSessionId }
  }

  async function listReusableSessionsForConnection(session, resolvedConfig, options = {}) {
    const resolved = resolvedConfig && typeof resolvedConfig === 'object' ? resolvedConfig : session.preparedResolvedConfig
    const cwd = resolveExistingDir(resolved?.cwd || session.cwd) || ''
    const requestedCli = sanitizeCliChoice(options?.cli)
    const cli = requestedCli || resolved?.cli || session.cli || 'claude'
    if (!cwd) {
      return { cwd: '', sessions: [], cli }
    }

    let rows = []
    try {
      rows = await listReusableSessions({
        cwd,
        cli,
        context: resolved?.context || session.context || {},
        requestedContext: session.requestedContext || {},
        connectionId: session.id,
        remoteIp: session.ip || ''
      })
    } catch (err) {
      logger(`[lan] reusable sessions error: ${err?.message || err}`)
      throw err
    }

    const normalized = normalizeSessionListRows(rows, { cli })
    pruneStaleSessionLocks(Date.now())
    const merged = normalized.map((row) => {
      const key = sessionLockKey(cwd, row.id)
      const lock = key ? sessionLocks.get(key) : null
      const lockActive = !!(lock && Number(lock.expiresAt || 0) > Date.now())
      return {
        ...row,
        status: lockActive ? 'occupied' : 'free',
        lock: lockActive
          ? {
              owner: lock.ownerLabel || '',
              ownerSessionId: lock.ownerSessionId || '',
              acquiredAt: Number(lock.acquiredAt || 0),
              lastHeartbeatAt: Number(lock.lastHeartbeatAt || 0),
              expiresAt: Number(lock.expiresAt || 0)
            }
          : null
      }
    })

    return { cwd, sessions: merged, cli }
  }

  function isProjectAllowedForResolvedConfig(cwd, resolvedConfig) {
    const candidate = resolveExistingDir(cwd)
    if (!candidate) return false
    const roots = Array.isArray(resolvedConfig?.context?.allowedRoots)
      ? resolvedConfig.context.allowedRoots
      : []
    if (!roots.length) return false
    return roots.some((root) => {
      const normalizedRoot = resolveExistingDir(root)
      return normalizedRoot && isUnderPath(candidate, normalizedRoot)
    })
  }

  async function listReusableProjectsForConnection(session, resolvedConfig, options = {}) {
    const resolved = resolvedConfig && typeof resolvedConfig === 'object' ? resolvedConfig : session.preparedResolvedConfig
    const currentCwd = resolveExistingDir(resolved?.cwd || session.projectCwd || session.cwd) || ''
    const inviteCwd = resolveExistingDir(session?.sessionInvite?.cwd)
    let rows = []
    try {
      rows = await listReusableProjects({
        cwd: currentCwd,
        allowedRoots: Array.isArray(resolved?.context?.allowedRoots) ? [...resolved.context.allowedRoots] : [],
        context: resolved?.context || session.context || {},
        requestedContext: session.requestedContext || {},
        connectionId: session.id,
        remoteIp: session.ip || '',
        invitedCwd: inviteCwd || ''
      })
    } catch (err) {
      logger(`[lan] reusable projects error: ${err?.message || err}`)
      throw err
    }

    const catalog = new Map()
    const projects = []
    const seen = new Set()
    const sourceRows = Array.isArray(rows) ? rows : []
    for (const row of sourceRows) {
      const cwd = resolveExistingDir(row?.cwd || row?.path)
      if (!cwd || seen.has(cwd) || !isProjectAllowedForResolvedConfig(cwd, resolved)) continue
      // Un enlace temporal comparte exactamente un proyecto: no se convierte
      // en una puerta para navegar por los recientes del host.
      if (inviteCwd && cwd !== inviteCwd) continue
      seen.add(cwd)
      const id = crypto.randomBytes(18).toString('base64url')
      const label = trimToString(row?.label || row?.name || path.basename(cwd) || cwd, 180)
      catalog.set(id, { cwd, label })
      projects.push({
        id,
        label: label || 'Proyecto',
        lastUsedAt: Number(row?.lastUsedAt || row?.mtime || 0)
      })
      if (projects.length >= 50) break
    }

    session.projectCatalog = catalog
    const selected = Array.from(catalog.entries()).find(([, entry]) => entry.cwd === (session.projectCwd || currentCwd))
    if (selected) session.projectCwd = selected[1].cwd
    return {
      projects,
      selectedProjectId: selected ? selected[0] : '',
      selectedProjectLabel: selected ? selected[1].label : ''
    }
  }

  async function sendReusableProjectList(session, payload = {}) {
    const requestId = trimToString(payload?.requestId || payload?.id, 200)
    try {
      const resolved = await ensureSessionPrepared(session, session.req, { force: payload?.forceRefresh === true })
      const listed = await listReusableProjectsForConnection(session, resolved, { forceRefresh: payload?.forceRefresh === true })
      safeSend(session.ws, {
        type: 'project:list',
        ok: true,
        requestId: requestId || null,
        projects: listed.projects,
        selectedProjectId: listed.selectedProjectId || '',
        selectedProjectLabel: listed.selectedProjectLabel || ''
      })
      return { ok: true, resolved, listed }
    } catch (err) {
      safeSend(session.ws, {
        type: 'project:list',
        ok: false,
        requestId: requestId || null,
        projects: [],
        error: {
          code: trimToString(err?.code, 120) || 'PROJECT_LIST_FAILED',
          message: err?.message || String(err || 'No se pudieron listar proyectos')
        }
      })
      return { ok: false, error: err }
    }
  }

  async function handleProjectSelectRequest(session, payload = {}) {
    const requestId = trimToString(payload?.requestId || payload?.id, 200)
    if (session.initialized || session.initInFlight) {
      safeSend(session.ws, {
        type: 'project:selected',
        ok: false,
        requestId: requestId || null,
        error: {
          code: 'PROJECT_SWITCH_REQUIRES_RECONNECT',
          message: 'Desconecta la sesión actual antes de cambiar de proyecto.'
        }
      })
      return
    }
    const projectId = trimToString(payload?.projectId || payload?.id, 200)
    const entry = session.projectCatalog?.get(projectId)
    if (!entry?.cwd) {
      safeSend(session.ws, {
        type: 'project:selected',
        ok: false,
        requestId: requestId || null,
        error: { code: 'PROJECT_NOT_FOUND', message: 'El proyecto ya no está disponible. Refresca la lista.' }
      })
      return
    }
    session.projectCwd = entry.cwd
    session.selectedResumeSessionId = ''
    releaseSessionLock(session, 'project-changed')
    invalidatePreparedSession(session, 'project-changed')
    safeSend(session.ws, {
      type: 'project:selected',
      ok: true,
      requestId: requestId || null,
      projectId,
      label: entry.label
    })
    await sendReusableSessionList(session, { requestId: requestId || null, forceRefresh: true })
  }

  function buildSessionCapabilities(session) {
    const perms = session.permissions || DEFAULT_PERMISSIONS
    return {
      pty: { execute: !!perms[PERMISSION_KEYS.PTY_EXECUTE] },
      fs: {
        list: !!perms[PERMISSION_KEYS.FS_LIST],
        read: !!perms[PERMISSION_KEYS.FS_READ],
        write: !!perms[PERMISSION_KEYS.FS_WRITE],
        rename: !!perms[PERMISSION_KEYS.FS_RENAME],
        delete: !!perms[PERMISSION_KEYS.FS_DELETE],
        watch: !!perms[PERMISSION_KEYS.FS_LIST],
        upload: !!perms[PERMISSION_KEYS.FS_WRITE]
      },
      viewer: { open: !!perms[PERMISSION_KEYS.VIEWER_OPEN] },
      automations: { manage: !!perms[PERMISSION_KEYS.AUTOMATIONS_MANAGE] },
      chat: { ask: !!runSemanticChatTurn },
      limits: {
        maxReadBytes: Number(session.fsLimits?.maxReadBytes || defaultFsLimits.maxReadBytes),
        maxPreviewBytes: Number(session.fsLimits?.maxPreviewBytes || defaultFsLimits.maxPreviewBytes),
        maxTextPreviewBytes: Number(session.fsLimits?.maxTextPreviewBytes || defaultFsLimits.maxTextPreviewBytes),
        maxUploadBytes: Number(session.fsLimits?.maxUploadBytes || defaultFsLimits.maxUploadBytes)
      },
      allowedRoots: Array.isArray(session.context?.allowedRoots) ? [...session.context.allowedRoots] : [],
      readOnlyRoots: Array.isArray(session.context?.readOnlyRoots) ? [...session.context.readOnlyRoots] : [],
      allowedMcpServers: Array.isArray(session.context?.allowedMcpServers) ? [...session.context.allowedMcpServers] : []
    }
  }

  function buildPublicSessionContext(session) {
    const context = session.context || {}
    return {
      mode: context.mode || 'legacy',
      enterpriseEnabled: !!context.enterpriseEnabled,
      operatorId: context.operatorId || null,
      roleId: context.roleId || null,
      profileId: context.profileId || null,
      cli: context.cli || null,
      model: context.model || null,
      effort: context.effort || null,
      personaResolved: context.personaResolved || '',
      personaSource: context.personaSource || 'none',
      allowedRoots: Array.isArray(context.allowedRoots) ? [...context.allowedRoots] : [],
      readOnlyRoots: Array.isArray(context.readOnlyRoots) ? [...context.readOnlyRoots] : [],
      allowedMcpServers: Array.isArray(context.allowedMcpServers) ? [...context.allowedMcpServers] : [],
      inviteLabel: trimToString(session?.sessionInvite?.label, 180) || null,
      request: context.request || {
        operatorId: null,
        profileId: null,
        roleId: null,
        username: null,
        cli: null,
        model: null,
        effort: null,
        source: 'none'
      }
    }
  }

  function listSessions() {
    return Array.from(sessions.values())
      .map((s) => ({
        id: s.id,
        ip: s.ip,
        cli: s.cli,
        cwd: s.cwd,
        connectedAt: s.connectedAt,
        context: buildPublicSessionContext(s),
        capabilities: buildSessionCapabilities(s)
      }))
      .sort((a, b) => a.connectedAt - b.connectedAt)
  }

  function killSessionPty(session) {
    if (!session?.ptyProcess) return
    try { session.ptyProcess._alive = false } catch {}
    try { session.ptyProcess.kill() } catch {}
    session.ptyProcess = null
  }

  function abortSessionChat(session, reason = 'session-closed') {
    if (!session) return
    const controller = session.chatAbortController
    session.chatAbortController = null
    session.chatBusy = false
    if (controller) {
      try { controller.abort(new Error(String(reason || 'session-closed'))) } catch {
        try { controller.abort() } catch {}
      }
    }
  }

  function closeSession(sessionId, reason = 'closed') {
    const session = sessions.get(String(sessionId || ''))
    if (!session) return false
    finalizeSessionGitWorkspace(session) // fire-and-forget; anula gitWorkspace al entrar
    releaseSessionLock(session, reason)
    sessions.delete(session.id)
    abortSessionChat(session, reason)
    closeAllFsWatchers(session, reason)
    killSessionPty(session)
    safeSend(session.ws, { type: 'status', state: reason, sessionId: session.id })
    try { session.ws.close(1000, reason) } catch {}
    logger(`[lan] session closed ${session.id} (${reason})`)
    return true
  }

  // Aviso cuando el túnel queda a medio configurar: con solo una de las dos
  // URLs públicas el enlace se degrada a la IP LAN, que desde fuera de casa da
  // un timeout sin ninguna pista. El renderer lo pinta; aquí solo se expone.
  function computePublicUrlWarning() {
    const publicClient = trimToString(getPublicClientUrl(), 1000)
    const publicWs = trimToString(getPublicWsUrl(), 1000)
    if (publicClient && !publicWs) {
      return 'Falta la URL pública del WebSocket: el enlace compartido sigue siendo el de la red local.'
    }
    if (!publicClient && publicWs) {
      return 'Falta la URL pública del cliente: el enlace compartido sigue siendo el de la red local.'
    }
    return null
  }

  function buildClientUrl(extra = {}) {
    const publicClient = trimToString(getPublicClientUrl(), 1000)
    const publicWs = trimToString(getPublicWsUrl(), 1000)
    const tk = String(getAuthToken() || '')
    let url
    // INVARIANTE: el Bearer permanente SOLO puede viajar en la URL LAN; jamás
    // en la pública, que es alcanzable desde internet (captura, portapapeles,
    // logs del túnel, historial del móvil del cliente = auth total y para
    // siempre). Por eso la URL pública se usa únicamente con invitación, que ya
    // es una capability temporal y acotada.
    // Corolario: sin invite devolvemos la URL LAN con token — un enlace público
    // sin credencial no serviría de nada. El cliente público y el WebSocket
    // deben estar configurados juntos; si falta uno, también caemos a la LAN
    // (ver computePublicUrlWarning) para no ofrecer un enlace que parece
    // exterior pero intentaría conectar al puerto 9999 público.
    if (publicClient && publicWs && extra.invite) {
      try {
        url = new URL(publicClient)
        url.searchParams.set('wsUrl', publicWs)
      } catch {
        url = null
      }
    }
    if (!url) {
      url = new URL(`http://${lanIp}:${httpPort}/lan-client.html`)
      url.searchParams.set('host', lanIp)
      url.searchParams.set('port', String(port))
      if (tk && !extra.invite) url.searchParams.set('token', tk)
    }
    for (const [key, value] of Object.entries(extra || {})) {
      if (value == null || value === '') continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  function createSessionInvite({ cwd, sessionId, cli, label, ttlMs, maxUses } = {}) {
    if (!running) throw new Error('Activa primero el servidor LAN.')
    const safeCwd = resolveExistingDir(cwd)
    const safeSessionId = sanitizeResumeSessionId(sessionId)
    const safeCli = sanitizeCliChoice(cli)
    if (!safeCwd) throw new Error('La carpeta de la sesión ya no existe o no es local.')
    if (!safeSessionId) throw new Error('La sesión actual aún no tiene un ID reutilizable.')
    if (!safeCli) throw new Error('El CLI de la sesión no es válido.')
    const created = sessionInvites.create({
      cwd: safeCwd,
      sessionId: safeSessionId,
      cli: safeCli,
      label,
      ttlMs,
      maxUses
    })
    emitAudit('lan_session_invite_created', {
      cwd: safeCwd,
      sessionId: safeSessionId,
      cli: safeCli,
      label: trimToString(label, 180)
    })
    return {
      ok: true,
      clientUrl: buildClientUrl({ invite: created.token, cli: safeCli }),
      expiresAt: created.expiresAt,
      maxUses: created.maxUses
    }
  }

  function closeAllSessions(reason = 'server-stopped') {
    for (const id of Array.from(sessions.keys())) {
      closeSession(id, reason)
    }
  }

  function ensureLockSweepTimer() {
    if (lockSweepTimer) return
    lockSweepTimer = setInterval(() => {
      pruneStaleSessionLocks(Date.now())
    }, sessionLockSweepMs)
    if (typeof lockSweepTimer.unref === 'function') lockSweepTimer.unref()
  }

  function clearLockSweepTimer() {
    if (!lockSweepTimer) return
    try { clearInterval(lockSweepTimer) } catch {}
    lockSweepTimer = null
  }

  async function handleAudioMessage(session, payload) {
    if (!session.permissions[PERMISSION_KEYS.PTY_EXECUTE]) {
      safeSend(session.ws, {
        type: 'status',
        state: 'error',
        sessionId: session.id,
        code: 'PERMISSION_DENIED',
        message: 'Permiso denegado: pty.execute'
      })
      return
    }

    const base64 = typeof payload?.data === 'string' ? payload.data.trim() : ''
    if (!base64) {
      safeSend(session.ws, { type: 'status', state: 'error', message: 'audio payload vacío', sessionId: session.id, code: 'INVALID_REQUEST' })
      return
    }
    if (!transcribeAudio) {
      safeSend(session.ws, { type: 'status', state: 'error', message: 'transcripción no disponible', sessionId: session.id, code: 'NOT_AVAILABLE' })
      return
    }

    const audioFilePath = path.join('/tmp', `wa-audio-${session.id}-${Date.now()}.webm`)
    safeSend(session.ws, { type: 'status', state: 'transcribing', sessionId: session.id })
    try {
      fs.writeFileSync(audioFilePath, Buffer.from(base64, 'base64'))
      const transcript = String(await transcribeAudio(audioFilePath)).trim()
      if (!transcript) throw new Error('Transcripción vacía')
      safeSend(session.ws, { type: 'transcript', text: transcript, sessionId: session.id })
      if (session.ptyProcess?._alive) {
        const toWrite = transcript.endsWith('\n') ? transcript : `${transcript}\n`
        session.ptyProcess.write(toWrite)
      }
    } catch (err) {
      safeSend(session.ws, {
        type: 'status',
        state: 'error',
        sessionId: session.id,
        code: 'AUDIO_ERROR',
        message: err?.message || String(err)
      })
    } finally {
      try { fs.unlinkSync(audioFilePath) } catch {}
    }
  }

  async function handleSemanticChatAsk(session, payload) {
    const requestId = trimToString(payload?.requestId, 160) || `chat-${Date.now()}`
    const prompt = trimToString(payload?.text ?? payload?.prompt, 100000)

    if (!runSemanticChatTurn) {
      safeSend(session.ws, {
        type: 'chat:result',
        requestId,
        ok: false,
        error: { code: 'NOT_AVAILABLE', message: 'chat semántico no disponible en este servidor' },
        sessionId: session.id
      })
      return
    }

    if (!session.permissions[PERMISSION_KEYS.PTY_EXECUTE]) {
      safeSend(session.ws, {
        type: 'chat:result',
        requestId,
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: 'Permiso denegado: pty.execute' },
        sessionId: session.id
      })
      return
    }

    if (!prompt) {
      safeSend(session.ws, {
        type: 'chat:result',
        requestId,
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'mensaje vacío' },
        sessionId: session.id
      })
      return
    }

    if (session.chatBusy) {
      safeSend(session.ws, {
        type: 'chat:result',
        requestId,
        ok: false,
        error: { code: 'CHAT_BUSY', message: 'ya hay una respuesta en curso' },
        sessionId: session.id
      })
      return
    }

    session.chatBusy = true
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    session.chatAbortController = controller
    safeSend(session.ws, { type: 'chat:status', state: 'started', requestId, sessionId: session.id })

    try {
      const result = await runSemanticChatTurn({
        session,
        prompt,
        requestId,
        signal: controller?.signal || undefined
      })
      const text = trimToString(result?.text, 500000)
      if (result?.sessionId) session.chatSessionId = trimToString(result.sessionId, 200)
      safeSend(session.ws, {
        type: 'chat:result',
        requestId,
        ok: true,
        text: text || '',
        chatSessionId: session.chatSessionId || null,
        sessionId: session.id
      })
    } catch (err) {
      const aborted = err?.name === 'AbortError'
      safeSend(session.ws, {
        type: 'chat:result',
        requestId,
        ok: false,
        error: {
          code: aborted ? 'ABORTED' : 'CHAT_FAILED',
          message: err?.message || String(err || 'Error en chat semántico')
        },
        sessionId: session.id
      })
    } finally {
      if (session.chatAbortController === controller) session.chatAbortController = null
      session.chatBusy = false
      safeSend(session.ws, { type: 'chat:status', state: 'idle', requestId, sessionId: session.id })
    }
  }

  function ensurePermission(session, permissionKey, detailOp) {
    if (session.permissions?.[permissionKey]) return
    throw createFsError('PERMISSION_DENIED', `Permiso denegado: ${detailOp || permissionKey}`, { permission: permissionKey })
  }

  function sendFsResult(session, requestId, op, payload) {
    safeSend(session.ws, {
      type: 'fs:result',
      sessionId: session.id,
      requestId: requestId || null,
      op,
      ...payload
    })
  }

  function auditFsDenied(session, op, targetPath, errorPayload) {
    emitAudit('empresa_permiso_denegado_fs', {
      sessionId: session.id,
      operatorId: session.context?.operatorId || null,
      roleId: session.context?.roleId || null,
      profileId: session.context?.profileId || null,
      op,
      path: trimToString(targetPath, 2000),
      code: errorPayload?.code || 'PERMISSION_DENIED',
      message: errorPayload?.message || ''
    })
  }

  function resolveFsPathPayload(payload) {
    return trimToString(payload?.path, 8000)
  }

  function auditActor(session) {
    return {
      sessionId: session.id,
      operatorId: session.context?.operatorId || null,
      roleId: session.context?.roleId || null,
      profileId: session.context?.profileId || null
    }
  }

  function sendFsEvent(session, payload = {}) {
    safeSend(session.ws, {
      type: 'fs:event',
      sessionId: session.id,
      ts: Date.now(),
      ...payload
    })
  }

  function closeFsWatcher(session, watchId, reason = 'unwatch', opts = {}) {
    const id = trimToString(watchId, 120)
    if (!id) return false
    const state = session.fsWatchers instanceof Map ? session.fsWatchers.get(id) : null
    if (!state) return false
    session.fsWatchers.delete(id)
    state.closed = true
    if (state.flushTimer) {
      try { clearTimeout(state.flushTimer) } catch {}
      state.flushTimer = null
    }
    if (state.pollTimer) {
      try { clearInterval(state.pollTimer) } catch {}
      state.pollTimer = null
    }
    if (state.watcher) {
      try { state.watcher.close() } catch {}
      state.watcher = null
    }
    if (opts.emitEvent === true) {
      sendFsEvent(session, {
        event: 'stopped',
        watchId: id,
        rootPath: state.rootPath,
        reason
      })
    }
    emitAudit('empresa_fs_watch_detenido', {
      ...auditActor(session),
      watchId: id,
      path: trimPathForWire(state.rootPath),
      reason,
      auto: state.auto === true
    })
    return true
  }

  function closeAllFsWatchers(session, reason = 'session-closed') {
    if (!(session.fsWatchers instanceof Map) || session.fsWatchers.size === 0) return 0
    let count = 0
    for (const id of Array.from(session.fsWatchers.keys())) {
      if (closeFsWatcher(session, id, reason, { emitEvent: false })) count += 1
    }
    return count
  }

  function pushWatchChangedPath(state, rawPath) {
    if (!state || state.closed) return
    const abs = normalizeAbsolutePath(rawPath)
    let rel = '*'
    if (abs && isUnderPath(abs, state.rootPath)) {
      const next = path.relative(state.rootPath, abs)
      rel = next || '.'
    }

    if (!state.pendingChangedPaths.has(rel) && state.pendingChangedPaths.size >= MAX_FS_WATCH_EVENT_PATHS) {
      state.pendingOverflow = true
      return
    }
    state.pendingChangedPaths.add(rel)
  }

  function flushWatchChanges(session, state) {
    if (!state || state.closed) return
    const now = Date.now()
    if (state.nextEmitAt > now) {
      if (state.flushTimer) return
      state.flushTimer = setTimeout(() => {
        state.flushTimer = null
        flushWatchChanges(session, state)
      }, state.nextEmitAt - now)
      return
    }

    const changedPaths = Array.from(state.pendingChangedPaths)
    const sourceList = Array.from(state.pendingSources)
    const truncated = state.pendingOverflow === true
    state.pendingChangedPaths.clear()
    state.pendingSources.clear()
    state.pendingOverflow = false

    if (!changedPaths.length) return
    state.nextEmitAt = Date.now() + fsWatchThrottleMs
    const source = sourceList.length > 1
      ? 'mixed'
      : (sourceList[0] || 'watch')

    sendFsEvent(session, {
      event: 'changed',
      watchId: state.id,
      rootPath: state.rootPath,
      source,
      changedPaths,
      truncated
    })
  }

  function scheduleWatchFlush(session, state) {
    if (!state || state.closed || state.flushTimer) return
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null
      flushWatchChanges(session, state)
    }, fsWatchDebounceMs)
  }

  function queueWatchChange(session, state, changedPath, source = 'watch') {
    if (!state || state.closed) return
    pushWatchChangedPath(state, changedPath)
    state.pendingSources.add(source)
    scheduleWatchFlush(session, state)
  }

  function notifyWatchersForPath(session, changedPath, source = 'fs-op') {
    if (!(session.fsWatchers instanceof Map) || session.fsWatchers.size === 0) return
    const abs = normalizeAbsolutePath(changedPath)
    if (!abs) return
    for (const state of session.fsWatchers.values()) {
      if (!state || state.closed) continue
      if (!isUnderPath(abs, state.rootPath)) continue
      queueWatchChange(session, state, abs, source)
    }
  }

  function computeWatchDigestForState(state) {
    const digest = buildWatchSnapshotDigest(state.rootPath, state.depth, MAX_FS_WATCH_SNAPSHOT_ENTRIES)
    return digest.signature
  }

  function pollWatchState(session, state) {
    if (!state || state.closed) return
    try {
      const digest = computeWatchDigestForState(state)
      if (state.lastDigest && state.lastDigest !== digest) {
        queueWatchChange(session, state, state.rootPath, 'poll')
      }
      state.lastDigest = digest
      state.lastPollErrorCode = ''
    } catch (err) {
      const payload = fsErrorToPayload(err, 'IO_ERROR')
      if (state.lastPollErrorCode === payload.code) return
      state.lastPollErrorCode = payload.code
      sendFsEvent(session, {
        event: 'error',
        watchId: state.id,
        rootPath: state.rootPath,
        code: payload.code,
        message: payload.message
      })
      emitAudit('empresa_fs_watch_error', {
        ...auditActor(session),
        watchId: state.id,
        path: trimPathForWire(state.rootPath),
        code: payload.code,
        message: payload.message
      })
    }
  }

  function normalizeWatchId(rawWatchId, fallback = '') {
    const text = trimToString(rawWatchId, 120)
    const clean = text
      .replace(/[^a-zA-Z0-9._:-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
    if (clean) return clean
    return fallback || `watch-${crypto.randomUUID()}`
  }

  function startFsWatchInternal(session, payload = {}, options = {}) {
    ensurePermission(session, PERMISSION_KEYS.FS_LIST, PERMISSION_KEYS.FS_LIST)
    const watchId = normalizeWatchId(payload?.watchId, options.auto ? AUTO_FS_WATCH_ID : '')
    const fallbackPath = session.context?.allowedRoots?.[0] || session.cwd
    const requestedPath = resolveFsPathPayload(payload) || fallbackPath
    const allowed = assertPathAllowed(session, requestedPath, { mustExist: true, expectDirectory: true })
    const recursiveRequested = normalizeBoolean(payload?.recursive, true)
    const watchDepth = Math.max(1, Math.min(Number.parseInt(payload?.depth, 10) || fsWatchDepth, MAX_FS_TREE_DEPTH))

    const existing = session.fsWatchers.get(watchId)
    if (existing && existing.rootPath === allowed.absolutePath && existing.depth === watchDepth && !existing.closed) {
      return {
        ok: true,
        watchId,
        path: allowed.absolutePath,
        recursive: !!existing.recursive,
        polling: true,
        auto: existing.auto === true,
        reused: true
      }
    }
    if (existing) closeFsWatcher(session, watchId, 'replaced', { emitEvent: false })

    const state = {
      id: watchId,
      rootPath: allowed.absolutePath,
      depth: watchDepth,
      recursive: false,
      auto: options.auto === true,
      watcher: null,
      pollTimer: null,
      flushTimer: null,
      pendingChangedPaths: new Set(),
      pendingSources: new Set(),
      pendingOverflow: false,
      nextEmitAt: 0,
      lastDigest: '',
      lastPollErrorCode: '',
      nativeFallbackReason: '',
      closed: false
    }

    try {
      state.lastDigest = computeWatchDigestForState(state)
    } catch (err) {
      const payloadErr = fsErrorToPayload(err, 'IO_ERROR')
      throw createFsError(payloadErr.code, payloadErr.message)
    }

    const onNativeChange = (_eventType, filename) => {
      if (state.closed) return
      const maybePath = filename ? path.join(state.rootPath, String(filename)) : state.rootPath
      queueWatchChange(session, state, maybePath, 'watch')
    }

    let attached = false
    if (recursiveRequested) {
      try {
        state.watcher = fs.watch(state.rootPath, { recursive: true, persistent: false }, onNativeChange)
        state.recursive = true
        attached = true
      } catch (err) {
        state.nativeFallbackReason = trimToString(err?.message, 300) || 'recursive-watch-not-supported'
      }
    }
    if (!attached) {
      try {
        state.watcher = fs.watch(state.rootPath, { persistent: false }, onNativeChange)
        state.recursive = false
        attached = true
      } catch (err) {
        state.nativeFallbackReason = trimToString(err?.message, 300) || state.nativeFallbackReason || 'watch-not-supported'
      }
    }

    if (state.watcher && typeof state.watcher.on === 'function') {
      state.watcher.on('error', (err) => {
        if (state.closed) return
        const payloadErr = fsErrorToPayload(err, 'IO_ERROR')
        state.nativeFallbackReason = trimToString(payloadErr.message, 300) || payloadErr.code
        sendFsEvent(session, {
          event: 'warning',
          watchId: state.id,
          rootPath: state.rootPath,
          message: `Watcher nativo degradado: ${payloadErr.message}`
        })
      })
    }

    state.pollTimer = setInterval(() => pollWatchState(session, state), fsWatchPollingIntervalMs)
    if (typeof state.pollTimer.unref === 'function') state.pollTimer.unref()

    session.fsWatchers.set(watchId, state)

    sendFsEvent(session, {
      event: 'ready',
      watchId: state.id,
      rootPath: state.rootPath,
      recursive: state.recursive,
      polling: true,
      pollMs: fsWatchPollingIntervalMs,
      debounceMs: fsWatchDebounceMs,
      throttleMs: fsWatchThrottleMs,
      auto: state.auto === true
    })

    emitAudit('empresa_fs_watch_iniciado', {
      ...auditActor(session),
      watchId: state.id,
      path: trimPathForWire(state.rootPath),
      recursiveRequested,
      recursiveApplied: state.recursive,
      polling: true,
      auto: state.auto === true,
      fallback: state.nativeFallbackReason || ''
    })

    return {
      ok: true,
      watchId: state.id,
      path: state.rootPath,
      recursive: state.recursive,
      polling: true,
      pollMs: fsWatchPollingIntervalMs,
      auto: state.auto === true,
      fallback: state.nativeFallbackReason || null
    }
  }

  function ensureAutoFsWatch(session, watchedPath, depth) {
    if (!(session.permissions?.[PERMISSION_KEYS.FS_LIST])) return
    const existing = session.fsWatchers.get(AUTO_FS_WATCH_ID)
    const normalizedPath = normalizeAbsolutePath(watchedPath)
    if (existing && existing.rootPath === normalizedPath && !existing.closed) return
    startFsWatchInternal(session, {
      watchId: AUTO_FS_WATCH_ID,
      path: normalizedPath,
      recursive: true,
      depth
    }, { auto: true })
  }

  function handleFsWatch(session, payload = {}) {
    return startFsWatchInternal(session, payload, { auto: false })
  }

  function handleFsUnwatch(session, payload = {}) {
    const requested = trimToString(payload?.watchId, 120)
    if (requested) {
      const removed = closeFsWatcher(session, requested, 'client-unwatch', { emitEvent: true })
      return { ok: true, removed: removed ? 1 : 0, watchId: requested }
    }
    const removed = closeAllFsWatchers(session, 'client-unwatch-all')
    return { ok: true, removed }
  }

  function pickWritableAllowedRoot(session) {
    const roots = Array.isArray(session.pathPolicy?.allowedRoots) ? session.pathPolicy.allowedRoots : []
    for (const root of roots) {
      if (!root || !root.normalized) continue
      if (isPathReadOnly(session, root.normalized, root.real)) continue
      return root.normalized
    }
    return ''
  }

  function resolveUploadTargetDir(session, payload = {}) {
    const requestedDir = trimToString(payload?.targetDir || payload?.dir || '', 8000)
    if (requestedDir) {
      const allowed = assertPathAllowed(session, requestedDir, { mustExist: true, expectDirectory: true, forWrite: true })
      return allowed.absolutePath
    }

    const writableRoot = pickWritableAllowedRoot(session)
    if (!writableRoot) {
      throw createFsError('READ_ONLY_ROOT', 'No hay roots escribibles para uploads remotos')
    }
    const rootAllowed = assertPathAllowed(session, writableRoot, { mustExist: true, expectDirectory: true, forWrite: true })
    const uploadDir = path.join(rootAllowed.absolutePath, '.lan-uploads', session.id)
    try {
      fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 })
    } catch (err) {
      throw createFsError('IO_ERROR', err?.message || 'No se pudo crear directorio temporal de upload')
    }
    const allowedUploadDir = assertPathAllowed(session, uploadDir, { mustExist: true, expectDirectory: true, forWrite: true })
    return allowedUploadDir.absolutePath
  }

  function handleFsUpload(session, payload = {}) {
    ensurePermission(session, PERMISSION_KEYS.FS_WRITE, PERMISSION_KEYS.FS_WRITE)

    const sourceBase64 = payload?.base64 ?? payload?.data ?? payload?.content
    const buffer = decodeBase64Payload(sourceBase64, Number(session.fsLimits?.maxUploadBytes || defaultFsLimits.maxUploadBytes))
    const mime = sanitizeMimeType(payload?.mime || payload?.mimeType || payload?.type) || 'application/octet-stream'
    let filename = safeUploadBasename(payload?.name || payload?.filename || payload?.fileName || '')
    filename = applyMimeExtensionHint(filename, mime)
    ensureAllowedUploadExtension(filename)

    const targetDir = resolveUploadTargetDir(session, payload)
    const fullPath = makeUniqueFilePath(targetDir, filename)
    const targetAllowed = assertPathAllowed(session, fullPath, { mustExist: false, forWrite: true })
    assertPathAllowed(session, path.dirname(targetAllowed.absolutePath), { mustExist: true, expectDirectory: true, forWrite: true })

    try {
      fs.writeFileSync(targetAllowed.absolutePath, buffer, { mode: 0o600, flag: 'wx' })
    } catch (err) {
      throw createFsError('IO_ERROR', err?.message || 'No se pudo guardar upload remoto')
    }

    let stat = null
    try {
      stat = fs.statSync(targetAllowed.absolutePath)
    } catch {}

    emitAudit('empresa_upload_remoto', {
      ...auditActor(session),
      path: trimPathForWire(targetAllowed.absolutePath),
      size: Number(stat?.size || buffer.length || 0),
      mime,
      ext: extensionLower(targetAllowed.absolutePath) || ''
    })
    notifyWatchersForPath(session, targetAllowed.absolutePath, 'upload')

    return {
      ok: true,
      path: targetAllowed.absolutePath,
      name: path.basename(targetAllowed.absolutePath),
      size: Number(stat?.size || buffer.length || 0),
      mtimeMs: Number(stat?.mtimeMs || Date.now()),
      mime,
      ptyReference: `@${targetAllowed.absolutePath}`
    }
  }

  function handleFsList(session, msgType, payload = {}) {
    ensurePermission(session, PERMISSION_KEYS.FS_LIST, PERMISSION_KEYS.FS_LIST)
    const depth = msgType === 'fs:tree'
      ? Math.max(1, Number.parseInt(payload?.depth, 10) || 2)
      : Math.max(1, Number.parseInt(payload?.depth, 10) || 1)
    const fallbackPath = session.context?.allowedRoots?.[0] || session.cwd
    const requestedPath = resolveFsPathPayload(payload) || fallbackPath
    const allowed = assertPathAllowed(session, requestedPath, { mustExist: true, expectDirectory: true })
    const tree = listDirectoryTree(session, allowed.absolutePath, depth)
    if (normalizeBoolean(payload?.watch, true)) {
      try {
        ensureAutoFsWatch(session, allowed.absolutePath, depth)
      } catch {}
    }
    return {
      ok: true,
      path: allowed.absolutePath,
      entries: tree.entries,
      depth: tree.depth,
      truncated: tree.truncated,
      limit: tree.limit
    }
  }

  function handleFsRead(session, msgType, payload = {}) {
    if (msgType === 'fs:open') {
      if (!session.permissions[PERMISSION_KEYS.VIEWER_OPEN] && !session.permissions[PERMISSION_KEYS.FS_READ]) {
        throw createFsError('PERMISSION_DENIED', `Permiso denegado: ${PERMISSION_KEYS.VIEWER_OPEN}`)
      }
    } else {
      ensurePermission(session, PERMISSION_KEYS.FS_READ, PERMISSION_KEYS.FS_READ)
    }

    const requestedPath = resolveFsPathPayload(payload)
    const allowed = assertPathAllowed(session, requestedPath, { mustExist: true, expectFile: true })

    let stat = null
    try {
      stat = fs.statSync(allowed.absolutePath)
    } catch {
      throw createFsError('NOT_FOUND', 'Archivo no encontrado')
    }

    if (!stat.isFile()) throw createFsError('NOT_FILE', 'Se esperaba un archivo')

    const size = Number(stat.size || 0)
    const mtimeMs = Number(stat.mtimeMs || 0)
    const limits = session.fsLimits || defaultFsLimits
    const readLimit = Number(limits.maxReadBytes || defaultFsLimits.maxReadBytes)
    const previewLimit = Number(limits.maxPreviewBytes || defaultFsLimits.maxPreviewBytes)
    const textPreviewLimit = Number(limits.maxTextPreviewBytes || defaultFsLimits.maxTextPreviewBytes)

    if (msgType === 'fs:open') {
      if (size > previewLimit) {
        return {
          ok: true,
          path: allowed.absolutePath,
          size,
          mtimeMs,
          previewType: 'binary',
          mime: 'application/octet-stream',
          supported: false,
          message: `Vista previa omitida: archivo demasiado grande (${size} bytes, límite ${previewLimit})`,
          limit: previewLimit
        }
      }

      let buffer = null
      try {
        buffer = fs.readFileSync(allowed.absolutePath)
      } catch (err) {
        throw createFsError('IO_ERROR', err?.message || 'No se pudo leer archivo')
      }

      const preview = classifyPreviewByPathAndBuffer(allowed.absolutePath, buffer)
      if (preview.type === 'image') {
        return {
          ok: true,
          path: allowed.absolutePath,
          size,
          mtimeMs,
          previewType: 'image',
          mime: preview.mime,
          encoding: 'base64',
          content: buffer.toString('base64')
        }
      }

      if (preview.type === 'text') {
        let text = ''
        let truncated = false
        if (buffer.length > textPreviewLimit) {
          text = buffer.slice(0, textPreviewLimit).toString('utf8')
          truncated = true
        } else {
          text = buffer.toString('utf8')
        }
        return {
          ok: true,
          path: allowed.absolutePath,
          size,
          mtimeMs,
          previewType: 'text',
          mime: preview.mime,
          encoding: 'utf8',
          truncated,
          content: text
        }
      }

      return {
        ok: true,
        path: allowed.absolutePath,
        size,
        mtimeMs,
        previewType: 'binary',
        mime: preview.mime || 'application/octet-stream',
        supported: false,
        message: `Vista previa no disponible para este tipo de archivo (${extensionLower(allowed.absolutePath) || 'binario'})`
      }
    }

    if (size > readLimit) {
      throw createFsError('FILE_TOO_LARGE', `Archivo supera límite de ${readLimit} bytes`, {
        size,
        limit: readLimit
      })
    }

    const encoding = trimToString(payload?.encoding, 50).toLowerCase() === 'base64' ? 'base64' : 'utf8'
    const content = encoding === 'base64'
      ? fs.readFileSync(allowed.absolutePath).toString('base64')
      : fs.readFileSync(allowed.absolutePath, 'utf8')

    return {
      ok: true,
      path: allowed.absolutePath,
      encoding,
      size,
      mtimeMs,
      content
    }
  }

  function handleFsWrite(session, payload = {}) {
    ensurePermission(session, PERMISSION_KEYS.FS_WRITE, PERMISSION_KEYS.FS_WRITE)

    const requestedPath = resolveFsPathPayload(payload)
    const allowed = assertPathAllowed(session, requestedPath, { mustExist: false, forWrite: true })
    const parentAllowed = assertPathAllowed(session, path.dirname(allowed.absolutePath), { mustExist: true, expectDirectory: true, forWrite: true })

    const encoding = trimToString(payload?.encoding, 50).toLowerCase() === 'base64' ? 'base64' : 'utf8'
    const rawContent = payload?.content
    if (typeof rawContent !== 'string') {
      throw createFsError('INVALID_REQUEST', 'content debe ser string')
    }

    const targetExists = fs.existsSync(allowed.absolutePath)
    if (targetExists) {
      const stat = fs.lstatSync(allowed.absolutePath)
      if (stat.isDirectory()) throw createFsError('NOT_FILE', 'No se puede sobrescribir un directorio')
    }

    try {
      if (encoding === 'base64') {
        fs.writeFileSync(allowed.absolutePath, Buffer.from(rawContent, 'base64'))
      } else {
        fs.writeFileSync(allowed.absolutePath, rawContent, 'utf8')
      }
    } catch (err) {
      throw createFsError('IO_ERROR', err?.message || 'No se pudo guardar el archivo')
    }

    let size = 0
    let mtimeMs = Date.now()
    try {
      const stat = fs.statSync(allowed.absolutePath)
      size = Number(stat.size || 0)
      mtimeMs = Number(stat.mtimeMs || mtimeMs)
    } catch {}

    notifyWatchersForPath(session, allowed.absolutePath, 'write')

    return {
      ok: true,
      path: allowed.absolutePath,
      parent: parentAllowed.absolutePath,
      size,
      mtimeMs
    }
  }

  function handleFsRename(session, payload = {}) {
    ensurePermission(session, PERMISSION_KEYS.FS_RENAME, PERMISSION_KEYS.FS_RENAME)

    const fromPath = trimToString(payload?.from, 8000)
    const toPath = trimToString(payload?.to, 8000)
    if (!fromPath || !toPath) throw createFsError('INVALID_REQUEST', 'from y to son obligatorios')

    const fromAllowed = assertPathAllowed(session, fromPath, { mustExist: true, forWrite: true })
    const toAllowed = assertPathAllowed(session, toPath, { mustExist: false, forWrite: true })
    assertPathAllowed(session, path.dirname(toAllowed.absolutePath), { mustExist: true, expectDirectory: true, forWrite: true })

    if (fs.existsSync(toAllowed.absolutePath)) {
      throw createFsError('ALREADY_EXISTS', 'La ruta destino ya existe')
    }

    try {
      fs.renameSync(fromAllowed.absolutePath, toAllowed.absolutePath)
    } catch (err) {
      throw createFsError('IO_ERROR', err?.message || 'No se pudo renombrar')
    }

    notifyWatchersForPath(session, fromAllowed.absolutePath, 'rename')
    notifyWatchersForPath(session, toAllowed.absolutePath, 'rename')

    return {
      ok: true,
      from: fromAllowed.absolutePath,
      to: toAllowed.absolutePath
    }
  }

  function handleFsDelete(session, payload = {}) {
    ensurePermission(session, PERMISSION_KEYS.FS_DELETE, PERMISSION_KEYS.FS_DELETE)

    const requestedPath = resolveFsPathPayload(payload)
    const allowed = assertPathAllowed(session, requestedPath, { mustExist: true, forWrite: true })
    const recursive = payload?.recursive === true

    try {
      if (allowed.stat?.isDirectory()) {
        if (recursive) {
          fs.rmSync(allowed.absolutePath, { recursive: true, force: false })
        } else {
          fs.rmdirSync(allowed.absolutePath)
        }
      } else {
        fs.unlinkSync(allowed.absolutePath)
      }
    } catch (err) {
      throw createFsError('IO_ERROR', err?.message || 'No se pudo borrar')
    }

    notifyWatchersForPath(session, allowed.absolutePath, 'delete')
    notifyWatchersForPath(session, path.dirname(allowed.absolutePath), 'delete')

    return {
      ok: true,
      path: allowed.absolutePath,
      recursive
    }
  }

  function handleFsMessage(session, msgType, payload = {}) {
    const requestId = trimToString(payload?.requestId || payload?.id, 200)
    const opMap = {
      'fs:list': 'list',
      'fs:tree': 'tree',
      'fs:read': 'read',
      'fs:open': 'open',
      'fs:write': 'write',
      'fs:save': 'save',
      'fs:rename': 'rename',
      'fs:delete': 'delete',
      'fs:watch': 'watch',
      'fs:unwatch': 'unwatch',
      'fs:upload': 'upload'
    }
    const op = opMap[msgType] || 'unknown'

    try {
      let result = null
      if (msgType === 'fs:list' || msgType === 'fs:tree') result = handleFsList(session, msgType, payload)
      else if (msgType === 'fs:read' || msgType === 'fs:open') result = handleFsRead(session, msgType, payload)
      else if (msgType === 'fs:write' || msgType === 'fs:save') result = handleFsWrite(session, payload)
      else if (msgType === 'fs:rename') result = handleFsRename(session, payload)
      else if (msgType === 'fs:delete') result = handleFsDelete(session, payload)
      else if (msgType === 'fs:watch') result = handleFsWatch(session, payload)
      else if (msgType === 'fs:unwatch') result = handleFsUnwatch(session, payload)
      else if (msgType === 'fs:upload') result = handleFsUpload(session, payload)
      else throw createFsError('INVALID_REQUEST', `operación FS no soportada: ${msgType}`)

      sendFsResult(session, requestId, op, result)
    } catch (err) {
      const errorPayload = fsErrorToPayload(err)
      if (FS_DENIED_AUDIT_CODES.has(errorPayload.code)) {
        const targetPath = trimToString(payload?.path || payload?.from || '', 2000)
        auditFsDenied(session, op, targetPath, errorPayload)
      }
      if (op === 'upload') {
        emitAudit('empresa_upload_remoto_denegado', {
          ...auditActor(session),
          code: errorPayload.code || 'IO_ERROR',
          message: errorPayload.message || '',
          name: trimToString(payload?.name || payload?.filename || '', 200),
          mime: sanitizeMimeType(payload?.mime || payload?.mimeType || payload?.type) || ''
        })
      }
      sendFsResult(session, requestId, op, {
        ok: false,
        error: errorPayload
      })
    }
  }

  function invalidatePreparedSession(session, reason = 'context-changed') {
    if (!session || session.initialized) return
    session.preparedResolvedConfig = null
    if (session.preparePromise) session.preparePromise = null
    if (session.sessionLockKey) {
      releaseSessionLock(session, reason)
    }
  }

  async function ensureSessionPrepared(session, req, options = {}) {
    if (!session) throw new Error('session-required')
    if (options.force === true) {
      invalidatePreparedSession(session, 'forced-refresh')
    }
    if (session.preparedResolvedConfig) return session.preparedResolvedConfig
    if (session.preparePromise) return session.preparePromise

    session.preparePromise = (async () => {
      const resolved = await resolveConfigForConnection({
        req,
        requestedContext: session.requestedContext,
        sessionInvite: session.sessionInvite,
        projectCwd: session.projectCwd
      })
      session.preparedResolvedConfig = resolved
      return resolved
    })()

    try {
      return await session.preparePromise
    } finally {
      session.preparePromise = null
    }
  }

  async function sendReusableSessionList(session, payload = {}) {
    const requestId = trimToString(payload?.requestId || payload?.id, 200)
    const requestedCli = sanitizeCliChoice(payload?.cli)
    try {
      const resolved = await ensureSessionPrepared(session, session.req, { force: payload?.forceRefresh === true })
      const listed = await listReusableSessionsForConnection(session, resolved, { cli: requestedCli })
      safeSend(session.ws, {
        type: 'session:list',
        ok: true,
        requestId: requestId || null,
        cwd: listed.cwd,
        cli: listed.cli || requestedCli || resolved?.cli || session.cli || 'claude',
        sessions: listed.sessions,
        selectedSessionId: session.selectedResumeSessionId || ''
      })
      return { ok: true, resolved, listed }
    } catch (err) {
      safeSend(session.ws, {
        type: 'session:list',
        ok: false,
        requestId: requestId || null,
        cli: requestedCli || session.cli || 'claude',
        error: {
          code: trimToString(err?.code, 120) || 'SESSION_LIST_FAILED',
          message: err?.message || String(err || 'No se pudieron listar sesiones')
        },
        selectedSessionId: session.selectedResumeSessionId || ''
      })
      return { ok: false, error: err }
    }
  }

  async function handleSessionStartRequest(session, payload = {}) {
    const requestId = trimToString(payload?.requestId || payload?.id, 200)
    const requestedCli = sanitizeCliChoice(payload?.cli)
    const requestedMode = trimToString(payload?.mode, 40).toLowerCase()
    const isHotSwitch = requestedMode === 'hot'

    if (session.initInFlight) {
      safeSend(session.ws, {
        type: 'session:start',
        ok: false,
        requestId: requestId || null,
        error: {
          code: 'INIT_IN_FLIGHT',
          message: 'Iniciando sesión en curso. Espera un momento.'
        }
      })
      return
    }

    if (session.initialized && !isHotSwitch) {
      safeSend(session.ws, {
        type: 'session:start',
        ok: false,
        requestId: requestId || null,
        error: {
          code: 'ALREADY_CONNECTED',
          message: 'Ya hay una sesión conectada. Usa modo "hot" para cambiar sin reconectar.'
        }
      })
      return
    }

    if (isHotSwitch && !session.initialized) {
      safeSend(session.ws, {
        type: 'session:start',
        ok: false,
        requestId: requestId || null,
        error: {
          code: 'HOT_SWITCH_NOT_INITIALIZED',
          message: 'No hay sesión activa que cambiar en caliente.'
        }
      })
      return
    }

    const startSessionId = sanitizeResumeSessionId(payload?.sessionId || payload?.resumeSessionId || payload?.resume || '')
    const prepared = await ensureSessionPrepared(session, session.req)
    const listed = await listReusableSessionsForConnection(session, prepared, { cli: requestedCli })

    if (startSessionId && !listed.sessions.some((row) => row.id === startSessionId)) {
      safeSend(session.ws, {
        type: 'session:start',
        ok: false,
        requestId: requestId || null,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: `La sesión ${startSessionId} no existe en esta carpeta.`
        }
      })
      await sendReusableSessionList(session, { requestId: requestId || null, cli: requestedCli })
      return
    }

    if (isHotSwitch) {
      await runHotSessionSwitch(session, {
        requestId,
        prepared,
        listed,
        startSessionId
      })
      return
    }

    const lockResult = acquireSessionLock(session, listed.cwd || prepared.cwd, startSessionId)
    if (!lockResult.ok) {
      safeSend(session.ws, {
        type: 'session:start',
        ok: false,
        requestId: requestId || null,
        error: {
          code: lockResult.code || 'SESSION_LOCK_FAILED',
          message: lockResult.message || 'No se pudo bloquear la sesión seleccionada.'
        },
        sessionId: startSessionId || null
      })
      safeSend(session.ws, {
        type: 'status',
        state: 'error',
        code: lockResult.code || 'SESSION_LOCK_FAILED',
        message: lockResult.message || 'No se pudo bloquear la sesión seleccionada.',
        sessionId: session.id
      })
      await sendReusableSessionList(session, { requestId: requestId || null, cli: requestedCli })
      return
    }

    safeSend(session.ws, {
      type: 'session:start',
      ok: true,
      requestId: requestId || null,
      sessionId: startSessionId || null,
      mode: 'fresh'
    })
    await initializeSession(session, session.req, {
      resolved: prepared,
      resumeSessionId: startSessionId || ''
    })
  }

  async function runHotSessionSwitch(session, { requestId, prepared, listed, startSessionId }) {
    const previousLockKey = trimToString(session.sessionLockKey, 4000)
    const previousResumeSessionId = sanitizeResumeSessionId(session.resumeSessionId || session.selectedResumeSessionId || '')

    const targetCwd = listed.cwd || prepared.cwd
    const targetKey = startSessionId ? sessionLockKey(targetCwd, startSessionId) : ''

    if (startSessionId && targetKey && targetKey !== previousLockKey) {
      const existing = sessionLocks.get(targetKey)
      if (existing && existing.ownerSessionId !== session.id) {
        safeSend(session.ws, {
          type: 'session:start',
          ok: false,
          requestId: requestId || null,
          error: {
            code: 'SESSION_LOCKED',
            message: `La sesión está ocupada por ${existing.ownerLabel || 'otro cliente'}.`
          },
          sessionId: startSessionId
        })
        await sendReusableSessionList(session, { requestId: requestId || null })
        return
      }
    }

    const lockResult = acquireSessionLock(session, targetCwd, startSessionId)
    if (!lockResult.ok) {
      safeSend(session.ws, {
        type: 'session:start',
        ok: false,
        requestId: requestId || null,
        error: {
          code: lockResult.code || 'SESSION_LOCK_FAILED',
          message: lockResult.message || 'No se pudo bloquear la sesión seleccionada.'
        },
        sessionId: startSessionId || null
      })
      await sendReusableSessionList(session, { requestId: requestId || null })
      return
    }

    const oldPty = session.ptyProcess
    session.ptyProcess = null
    if (oldPty) {
      try { oldPty._alive = false } catch {}
      try { oldPty.kill('SIGTERM') } catch {}
      const oldRef = oldPty
      setTimeout(() => {
        try {
          if (oldRef && oldRef._exited !== true) oldRef.kill('SIGKILL')
        } catch {}
      }, 2000)
    }

    let nextPty = null
    if (session.permissions[PERMISSION_KEYS.PTY_EXECUTE]) {
      try {
        copyResumeTranscriptToWorktree(session, prepared?.cli, startSessionId)
        nextPty = createPtyForSession(session, prepared, { resumeSessionId: startSessionId })
      } catch (err) {
        if (previousLockKey && previousLockKey !== session.sessionLockKey) {
          releaseSessionLock(session, 'hot-switch-pty-failed')
        }
        safeSend(session.ws, {
          type: 'session:start',
          ok: false,
          requestId: requestId || null,
          error: {
            code: 'PTY_START_FAILED',
            message: `no se pudo iniciar PTY remoto: ${err?.message || err}`
          },
          sessionId: startSessionId || null
        })
        safeSend(session.ws, {
          type: 'status',
          state: 'pty-exit',
          sessionId: session.id,
          previousResumeSessionId: previousResumeSessionId || null,
          reason: 'hot-switch-failed'
        })
        return
      }
    }

    session.ptyProcess = nextPty
    if (nextPty) {
      try { nextPty._alive = true } catch {}
    }
    session.resumeSessionId = startSessionId || ''
    session.selectedResumeSessionId = startSessionId || ''
    touchSessionLock(session, Date.now())

    safeSend(session.ws, {
      type: 'session:start',
      ok: true,
      requestId: requestId || null,
      sessionId: startSessionId || null,
      mode: 'hot',
      previousResumeSessionId: previousResumeSessionId || null
    })

    safeSend(session.ws, {
      type: 'status',
      state: 'connected',
      sessionId: session.id,
      cli: session.cli,
      cwd: session.cwd,
      connectedAt: session.connectedAt,
      resumeSessionId: session.resumeSessionId || null,
      mode: 'hot',
      previousResumeSessionId: previousResumeSessionId || null,
      context: buildPublicSessionContext(session),
      capabilities: buildSessionCapabilities(session)
    })

    if (nextPty) {
      nextPty.onData((data) => {
        if (!nextPty._alive) return
        safeSend(session.ws, { type: 'output', data: String(data), sessionId: session.id })
      })

      nextPty.onExit(({ exitCode, signal }) => {
        try { nextPty._exited = true } catch {}
        safeSend(session.ws, {
          type: 'status',
          state: 'pty-exit',
          sessionId: session.id,
          exitCode,
          signal
        })
        if (sessions.get(session.id)?.ptyProcess === nextPty) {
          sessions.get(session.id).ptyProcess = null
        }
      })

      const bootstrap = trimToString(prepared.bootstrapMessage || '', 50000)
      if (bootstrap) {
        setTimeout(() => {
          if (!nextPty?._alive) return
          if (sessions.get(session.id)?.ptyProcess !== nextPty) return
          const payload = bootstrap.endsWith('\n') ? bootstrap : `${bootstrap}\n`
          try { nextPty.write(payload) } catch {}
        }, 550)
      }
    }

    emitAudit('lan_session_hot_switched', {
      sessionId: session.id,
      previousResumeSessionId: previousResumeSessionId || null,
      nextResumeSessionId: startSessionId || null,
      cwd: targetCwd || null,
      cli: session.cli || null
    })
  }

  function onClientPayload(session, payload) {
    const msgType = trimToString(payload?.type, 100)
    const normalizedType = msgType.toLowerCase()

    if (msgType === 'session:heartbeat') {
      touchSessionLock(session, Date.now())
      safeSend(session.ws, {
        type: 'session:heartbeat',
        ok: true,
        sessionId: session.id,
        lockActive: !!session.sessionLockKey
      })
      return
    }

    if (msgType === 'session:list') {
      sendReusableSessionList(session, payload).catch(() => {})
      return
    }

    if (msgType === 'project:list') {
      sendReusableProjectList(session, payload).catch(() => {})
      return
    }

    if (msgType === 'project:select') {
      handleProjectSelectRequest(session, payload).catch((err) => {
        safeSend(session.ws, {
          type: 'project:selected',
          ok: false,
          requestId: trimToString(payload?.requestId || payload?.id, 200) || null,
          error: {
            code: trimToString(err?.code, 120) || 'PROJECT_SELECT_FAILED',
            message: err?.message || String(err || 'No se pudo seleccionar el proyecto')
          }
        })
      })
      return
    }

    if (msgType === 'session:start') {
      handleSessionStartRequest(session, payload).catch((err) => {
        safeSend(session.ws, {
          type: 'session:start',
          ok: false,
          requestId: trimToString(payload?.requestId || payload?.id, 200) || null,
          error: {
            code: trimToString(err?.code, 120) || 'SESSION_START_FAILED',
            message: err?.message || String(err || 'No se pudo iniciar la sesión')
          }
        })
      })
      return
    }

    const contextSync = parseRequestedContextPayload(payload, {
      acceptTypeLess: true,
      typeSet: CONTEXT_SYNC_TYPES
    })
    if (contextSync) {
      const previous = session.requestedContext
      session.requestedContext = mergeRequestedContext(session.requestedContext, contextSync)
      const changed = []
      if ((previous?.operatorId || '') !== (session.requestedContext?.operatorId || '')) changed.push('operatorId')
      if ((previous?.roleId || '') !== (session.requestedContext?.roleId || '')) changed.push('roleId')
      if ((previous?.profileId || '') !== (session.requestedContext?.profileId || '')) changed.push('profileId')
      if ((previous?.username || '') !== (session.requestedContext?.username || '')) changed.push('username')
      if ((previous?.cli || '') !== (session.requestedContext?.cli || '')) changed.push('cli')
      if ((previous?.model || '') !== (session.requestedContext?.model || '')) changed.push('model')
      if ((previous?.effort || '') !== (session.requestedContext?.effort || '')) changed.push('effort')
      if (changed.length > 0) invalidatePreparedSession(session, 'context-updated')
      emitAudit('empresa_handshake_contexto_actualizado', {
        ...auditActor(session),
        source: contextSync.source,
        changed: changed.join(',') || 'none',
        requestedOperatorId: session.requestedContext?.operatorId || null,
        requestedRoleId: session.requestedContext?.roleId || null,
        requestedProfileId: session.requestedContext?.profileId || null,
        usernameProvided: !!session.requestedContext?.username,
        requestedCli: session.requestedContext?.cli || null,
        requestedModel: session.requestedContext?.model || null,
        requestedEffort: session.requestedContext?.effort || null,
        late: session.initialized === true
      })
      if (!session.initialized && !session.manualSessionSelector && !session.initInFlight) {
        initializeSession(session, session.req).catch(() => {})
      }
      return
    }
    if (CONTEXT_SYNC_TYPES.has(normalizedType)) {
      return
    }

    if (msgType === 'input') {
      touchSessionLock(session, Date.now())
      if (!session.permissions[PERMISSION_KEYS.PTY_EXECUTE]) {
        safeSend(session.ws, {
          type: 'status',
          state: 'error',
          sessionId: session.id,
          code: 'PERMISSION_DENIED',
          message: 'Permiso denegado: pty.execute'
        })
        return
      }
      if (session.ptyProcess?._alive && typeof payload.data === 'string') {
        try { session.ptyProcess.write(payload.data) } catch {}
      }
      return
    }

    if (msgType === 'resize') {
      touchSessionLock(session, Date.now())
      const cols = Math.max(20, Number.parseInt(payload.cols, 10) || DEFAULT_COLS)
      const rows = Math.max(10, Number.parseInt(payload.rows, 10) || DEFAULT_ROWS)
      session.cols = cols
      session.rows = rows
      if (session.ptyProcess?._alive) {
        try { session.ptyProcess.resize(cols, rows) } catch {}
      }
      return
    }

    if (msgType === 'audio') {
      touchSessionLock(session, Date.now())
      session.audioQueue = (session.audioQueue || Promise.resolve())
        .then(() => handleAudioMessage(session, payload))
        .catch(() => {})
      return
    }

    if (msgType === 'chat:ask') {
      touchSessionLock(session, Date.now())
      handleSemanticChatAsk(session, payload).catch(() => {})
      return
    }

    if (msgType.startsWith('fs:')) {
      touchSessionLock(session, Date.now())
      handleFsMessage(session, msgType, payload)
      return
    }

    safeSend(session.ws, {
      type: 'status',
      state: 'error',
      sessionId: session.id,
      code: 'UNSUPPORTED_MESSAGE',
      message: `tipo no soportado: ${msgType}`
    })
  }

  function buildResumeArgsForCli(cli, resumeSessionId) {
    const safeSessionId = sanitizeResumeSessionId(resumeSessionId)
    if (!safeSessionId) return []
    if (cli === 'codex') return ['resume', safeSessionId]
    return ['--resume', safeSessionId]
  }

  function createPtyForSession(session, config, options = {}) {
    const bin = trimToString(config?.bin, 1000)
    if (!bin) throw new Error('No hay binario CLI configurado')
    const baseArgs = Array.isArray(config?.args) ? config.args : []
    const cliName = config?.cli || session?.cli
    const resumeArgs = buildResumeArgsForCli(cliName, options?.resumeSessionId || session?.selectedResumeSessionId || '')
    // Floor 'opus' para claude: sin --model resuelve al 1M (gate de créditos).
    const modelArgs = (cliName !== 'codex' && !baseArgs.includes('--model'))
      ? ['--model', config?.context?.model || 'opus']
      : []
    const args = [...modelArgs, ...resumeArgs, ...baseArgs]
    const execCommand = buildExecCommand(bin, args)
    return pty.spawn('/bin/bash', ['-c', execCommand], {
      name: 'xterm-256color',
      cols: session.cols,
      rows: session.rows,
      cwd: session.gitWorkspace?.workCwd || session.cwd,
      env: config?.env || { ...process.env }
    })
  }

  async function resolveConfigForConnection({ req, requestedContext, sessionInvite, projectCwd }) {
    const raw = requestedContext.raw && typeof requestedContext.raw === 'object'
      ? { ...requestedContext.raw }
      : {}
    // El cliente puede actualizar operador/modelo durante el handshake, pero
    // nunca puede sustituir la carpeta o sesión autorizadas por la invitación.
    // `lanProject` solo se añade desde el catálogo efímero del servidor; jamás
    // se acepta el valor homónimo enviado por un cliente.
    delete raw.lanProject
    if (sessionInvite) raw.lanInvite = { ...sessionInvite }
    else delete raw.lanInvite
    const trustedProjectCwd = resolveExistingDir(projectCwd)
    if (trustedProjectCwd) raw.lanProject = { cwd: trustedProjectCwd }
    const resolverInput = {
      req,
      requestedContext: {
        operatorId: requestedContext.operatorId || '',
        profileId: requestedContext.profileId || '',
        roleId: requestedContext.roleId || '',
        username: requestedContext.username || '',
        cli: requestedContext.cli || '',
        model: requestedContext.model || '',
        effort: requestedContext.effort || '',
        source: requestedContext.source || 'none',
        raw
      }
    }

    let resolved = null
    if (resolveSessionContext) {
      resolved = await resolveSessionContext(resolverInput)
      if (resolved && resolved.authorized === false) {
        resolved = null
      }
    }

    if (!resolved) {
      resolved = await getSessionConfig(resolverInput)
    }

    return normalizeResolvedSessionConfig(resolved || {}, requestedContext, defaultFsLimits)
  }

  async function initializeSession(session, req, options = {}) {
    if (session.initialized || session.initInFlight) return
    session.initInFlight = true
    if (session.initTimer) {
      try { clearTimeout(session.initTimer) } catch {}
      session.initTimer = null
    }

    let resolved = options?.resolved || null
    try {
      if (!resolved) resolved = await ensureSessionPrepared(session, req)
    } catch (err) {
      session.initInFlight = false
      releaseSessionLock(session, 'session-config-error')
      safeSend(session.ws, {
        type: 'status',
        state: 'error',
        message: err?.message || String(err),
        code: 'SESSION_CONFIG_ERROR'
      })
      try { session.ws.close(1011, 'session-config-error') } catch {}
      return
    }

    session.cli = resolved.cli
    session.cwd = resolved.cwd
    session.permissions = resolved.permissions
    session.context = resolved.context
    session.pathPolicy = resolved.pathPolicy
    session.fsLimits = resolved.fsLimits || defaultFsLimits

    // Git por sesión: aísla la sesión LAN en un worktree si el cwd es un repo git.
    // Fail-open: si sessionGit es null o prepare falla/devuelve null, corre en el
    // cwd real. La rotación/hot-switch NO pasa por aquí y reutiliza session.gitWorkspace.
    const sessionGitForPrepare = getSessionGit()
    if (sessionGitForPrepare && !session.gitWorkspace) {
      try {
        session.gitWorkspace = (await sessionGitForPrepare.prepareSessionWorkspace({ realCwd: session.cwd })) || null
      } catch (err) {
        logger(`[session-git] prepare LAN: ${err?.message || err}`)
        session.gitWorkspace = null
      }
    }

    emitAudit('empresa_contexto_resuelto', {
      ...auditActor(session),
      requestedOperatorId: session.requestedContext?.operatorId || null,
      requestedRoleId: session.requestedContext?.roleId || null,
      requestedProfileId: session.requestedContext?.profileId || null,
      usernameProvided: !!session.requestedContext?.username,
      requestedCli: session.requestedContext?.cli || null,
      requestedModel: session.requestedContext?.model || null,
      requestedEffort: session.requestedContext?.effort || null,
      requestSource: session.requestedContext?.source || 'none',
      mode: session.context?.mode || 'legacy',
      enterpriseEnabled: !!session.context?.enterpriseEnabled,
      appliedOperatorId: session.context?.operatorId || null,
      appliedRoleId: session.context?.roleId || null,
      appliedProfileId: session.context?.profileId || null,
      appliedCli: session.cli || null,
      appliedModel: session.context?.model || null,
      appliedEffort: session.context?.effort || null
    })

    let ptyProcess = null
    const resumeSessionId = sanitizeResumeSessionId(options?.resumeSessionId || session.selectedResumeSessionId || '')
    if (session.permissions[PERMISSION_KEYS.PTY_EXECUTE]) {
      try {
        copyResumeTranscriptToWorktree(session, resolved?.cli, resumeSessionId)
        ptyProcess = createPtyForSession(session, resolved, { resumeSessionId })
      } catch (err) {
        session.initInFlight = false
        releaseSessionLock(session, 'pty-start-failed')
        safeSend(session.ws, {
          type: 'status',
          state: 'error',
          message: `no se pudo iniciar PTY remoto: ${err?.message || err}`,
          code: 'PTY_START_FAILED'
        })
        try { session.ws.close(1011, 'pty-start-failed') } catch {}
        return
      }
    }

    session.ptyProcess = ptyProcess
    if (ptyProcess) {
      try { ptyProcess._alive = true } catch {}
    }

    sessions.set(session.id, session)
    session.initialized = true
    session.initInFlight = false
    session.resumeSessionId = resumeSessionId || ''
    touchSessionLock(session, Date.now())

    const connectedPayload = {
      type: 'status',
      state: 'connected',
      sessionId: session.id,
      cli: session.cli,
      cwd: session.cwd,
      connectedAt: session.connectedAt,
      resumeSessionId: session.resumeSessionId || null,
      context: buildPublicSessionContext(session),
      capabilities: buildSessionCapabilities(session)
    }
    safeSend(session.ws, connectedPayload)

    if (ptyProcess) {
      ptyProcess.onData((data) => {
        if (!ptyProcess._alive) return
        safeSend(session.ws, { type: 'output', data: String(data), sessionId: session.id })
      })

      ptyProcess.onExit(({ exitCode, signal }) => {
        safeSend(session.ws, {
          type: 'status',
          state: 'pty-exit',
          sessionId: session.id,
          exitCode,
          signal
        })
        if (sessions.get(session.id)?.ptyProcess === ptyProcess) {
          sessions.get(session.id).ptyProcess = null
        }
      })

      const bootstrap = trimToString(resolved.bootstrapMessage || '', 50000)
      if (bootstrap) {
        setTimeout(() => {
          if (!ptyProcess?._alive) return
          if (sessions.get(session.id)?.ptyProcess !== ptyProcess) return
          const payload = bootstrap.endsWith('\n') ? bootstrap : `${bootstrap}\n`
          try { ptyProcess.write(payload) } catch {}
        }, 550)
      }
    }

    emitAudit('empresa_sesion_iniciada', {
      sessionId: session.id,
      ip: session.ip,
      operatorId: session.context?.operatorId || null,
      roleId: session.context?.roleId || null,
      profileId: session.context?.profileId || null,
      cli: session.cli || null,
      model: session.context?.model || null,
      effort: session.context?.effort || null,
      mode: session.context?.mode || 'legacy',
      enterpriseEnabled: !!session.context?.enterpriseEnabled
    })

    logger(`[lan] session connected ${session.id} from ${session.ip || 'unknown'}`)

    if (Array.isArray(session.pendingPayloads) && session.pendingPayloads.length > 0) {
      const queued = session.pendingPayloads.splice(0, session.pendingPayloads.length)
      session.pendingInputBytes = 0
      for (const queuedPayload of queued) {
        onClientPayload(session, queuedPayload)
      }
    }
  }

  function queuePendingPayload(session, payload) {
    if (!Array.isArray(session.pendingPayloads)) session.pendingPayloads = []
    if (session.pendingPayloads.length >= MAX_PREINIT_QUEUE) {
      throw new Error('demasiados mensajes durante negociación inicial')
    }
    if (trimToString(payload?.type) === 'input' && typeof payload.data === 'string') {
      session.pendingInputBytes += Buffer.byteLength(payload.data)
      if (session.pendingInputBytes > MAX_PREINIT_INPUT_BYTES) {
        throw new Error('buffer de entrada excedido durante negociación inicial')
      }
    }
    session.pendingPayloads.push(payload)
  }

  function onWsConnection(ws, req) {
    // SEC-C1: verifyClient ya rechaza no-auth en handshake; defensa en profundidad por si bypaseo.
    if (!isAuthorizedReq(req) && !hasValidSessionInvite(req)) {
      try { ws.close(4401, 'unauthorized') } catch {}
      try { ws.terminate?.() } catch {}
      return
    }
    const inviteToken = firstNonEmpty(parseConnectionQuery(req), ['invite'])
    const sessionInvite = inviteToken ? sessionInvites.claim(inviteToken) : null
    if (inviteToken && !sessionInvite) {
      safeSend(ws, {
        type: 'status',
        state: 'error',
        code: 'SESSION_INVITE_INVALID',
        message: 'La invitación ha caducado o ya no admite más usos.'
      })
      try { ws.close(4403, 'session-invite-invalid') } catch {}
      return
    }
    const initialRequested = extractRequestedContextFromQuery(req)
    if (sessionInvite) {
      initialRequested.cli = sessionInvite.cli
      initialRequested.source = 'invite'
      initialRequested.raw = {
        ...initialRequested.raw,
        lanInvite: { ...sessionInvite }
      }
    }
    const manualSessionSelector = extractSessionSelectorModeFromQuery(req) || !!sessionInvite
    const session = {
      id: crypto.randomUUID(),
      ws,
      req,
      ip: normalizeRemoteIp(req?.socket?.remoteAddress),
      cli: 'claude',
      cwd: os.homedir(),
      connectedAt: Date.now(),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      ptyProcess: null,
      chatBusy: false,
      chatAbortController: null,
      chatSessionId: '',
      audioQueue: Promise.resolve(),
      initialized: false,
      initInFlight: false,
      initTimer: null,
      pendingPayloads: [],
      pendingInputBytes: 0,
      manualSessionSelector,
      sessionInvite,
      // Se resuelve a través del catálogo efímero `project:list`; nunca se
      // rellena directamente desde un cwd enviado por el navegador.
      projectCwd: resolveExistingDir(sessionInvite?.cwd) || '',
      projectCatalog: new Map(),
      preparedResolvedConfig: null,
      preparePromise: null,
      selectedResumeSessionId: sessionInvite?.sessionId || '',
      resumeSessionId: '',
      sessionLockKey: '',
      requestedContext: mergeRequestedContext({}, initialRequested),
      permissions: { ...DEFAULT_PERMISSIONS },
      fsLimits: { ...defaultFsLimits },
      fsWatchers: new Map(),
      context: {
        mode: 'legacy',
        enterpriseEnabled: false,
        operatorId: null,
        roleId: null,
        profileId: null,
        cli: null,
        model: null,
        effort: null,
        personaResolved: '',
        allowedRoots: [],
        readOnlyRoots: [],
        allowedMcpServers: [],
        request: {
          operatorId: initialRequested.operatorId || null,
          profileId: initialRequested.profileId || null,
          roleId: initialRequested.roleId || null,
          username: initialRequested.username || null,
          cli: initialRequested.cli || null,
          model: initialRequested.model || null,
          effort: initialRequested.effort || null,
          source: initialRequested.source || 'query'
        }
      },
      pathPolicy: {
        allowedRoots: normalizeRootEntries([os.homedir()], [os.homedir()]),
        readOnlyRoots: []
      }
    }

    const maybeStartSession = (source = 'auto') => {
      if (session.manualSessionSelector && source === 'auto') return
      if (session.initialized || session.initInFlight) return
      initializeSession(session, req).catch(() => {})
    }

    if (!session.manualSessionSelector) {
      if (
        session.requestedContext.operatorId ||
        session.requestedContext.profileId ||
        session.requestedContext.roleId ||
        session.requestedContext.username ||
        session.requestedContext.cli ||
        session.requestedContext.model ||
        session.requestedContext.effort
      ) {
        maybeStartSession('auto')
      } else {
        session.initTimer = setTimeout(() => {
          session.initTimer = null
          maybeStartSession('auto')
        }, SESSION_NEGOTIATION_TIMEOUT_MS)
      }
    }

    ws.on('message', (raw) => {
      if (!raw) return
      const payload = parseJsonMessage(raw)
      if (!payload || typeof payload !== 'object') {
        safeSend(ws, {
          type: 'status',
          state: 'error',
          sessionId: session.id,
          code: 'INVALID_REQUEST',
          message: 'mensaje inválido'
        })
        return
      }

      const msgType = trimToString(payload.type, 100).toLowerCase()

      if (!session.initialized) {
        if (msgType.startsWith('session:') || msgType.startsWith('project:')) {
          onClientPayload(session, payload)
          return
        }

        const contextSync = parseRequestedContextPayload(payload, {
          acceptTypeLess: true,
          typeSet: CONTEXT_SYNC_TYPES
        })
        if (contextSync) {
          const previous = session.requestedContext
          session.requestedContext = mergeRequestedContext(session.requestedContext, contextSync)
          const changed = []
          if ((previous?.operatorId || '') !== (session.requestedContext?.operatorId || '')) changed.push('operatorId')
          if ((previous?.roleId || '') !== (session.requestedContext?.roleId || '')) changed.push('roleId')
          if ((previous?.profileId || '') !== (session.requestedContext?.profileId || '')) changed.push('profileId')
          if ((previous?.username || '') !== (session.requestedContext?.username || '')) changed.push('username')
          if ((previous?.cli || '') !== (session.requestedContext?.cli || '')) changed.push('cli')
          if ((previous?.model || '') !== (session.requestedContext?.model || '')) changed.push('model')
          if ((previous?.effort || '') !== (session.requestedContext?.effort || '')) changed.push('effort')
          if (changed.length > 0) invalidatePreparedSession(session, 'context-updated')
          emitAudit('empresa_handshake_contexto_actualizado', {
            ...auditActor(session),
            source: contextSync.source,
            changed: changed.join(',') || 'none',
            requestedOperatorId: session.requestedContext?.operatorId || null,
            requestedRoleId: session.requestedContext?.roleId || null,
            requestedProfileId: session.requestedContext?.profileId || null,
            usernameProvided: !!session.requestedContext?.username,
            requestedCli: session.requestedContext?.cli || null,
            requestedModel: session.requestedContext?.model || null,
            requestedEffort: session.requestedContext?.effort || null,
            late: false
          })
          maybeStartSession('auto')
          return
        }
        if (CONTEXT_SYNC_TYPES.has(msgType)) {
          maybeStartSession('auto')
          return
        }

        if (msgType === 'resize') {
          session.cols = Math.max(20, Number.parseInt(payload.cols, 10) || DEFAULT_COLS)
          session.rows = Math.max(10, Number.parseInt(payload.rows, 10) || DEFAULT_ROWS)
          return
        }

        if (session.manualSessionSelector) {
          safeSend(ws, {
            type: 'status',
            state: 'error',
            sessionId: session.id,
            code: 'SESSION_NOT_STARTED',
            message: 'Selecciona una sesión y pulsa Entrar para iniciar.'
          })
          return
        }

        if (!session.initInFlight) maybeStartSession('auto')

        try {
          queuePendingPayload(session, payload)
        } catch (err) {
          safeSend(ws, {
            type: 'status',
            state: 'error',
            sessionId: session.id,
            code: 'SESSION_BUFFER_OVERFLOW',
            message: err?.message || 'Error en negociación inicial'
          })
          try { ws.close(1009, 'session-buffer-overflow') } catch {}
        }
        return
      }

      onClientPayload(session, payload)
    })

    ws.on('close', () => {
      if (session.initTimer) {
        try { clearTimeout(session.initTimer) } catch {}
        session.initTimer = null
      }
      finalizeSessionGitWorkspace(session) // idempotente: anula gitWorkspace al entrar
      releaseSessionLock(session, 'ws-close')
      if (!sessions.has(session.id)) return
      sessions.delete(session.id)
      abortSessionChat(session, 'ws-close')
      closeAllFsWatchers(session, 'ws-close')
      killSessionPty(session)
      logger(`[lan] session disconnected ${session.id}`)
    })

    ws.on('error', () => {
      if (session.initTimer) {
        try { clearTimeout(session.initTimer) } catch {}
        session.initTimer = null
      }
      finalizeSessionGitWorkspace(session) // idempotente: anula gitWorkspace al entrar
      releaseSessionLock(session, 'ws-error')
      if (!sessions.has(session.id)) return
      sessions.delete(session.id)
      abortSessionChat(session, 'ws-error')
      closeAllFsWatchers(session, 'ws-error')
      killSessionPty(session)
    })
  }

  function startHttpServer() {
    if (!clientHtmlPath || !fs.existsSync(clientHtmlPath)) {
      throw new Error(`Cliente LAN no encontrado: ${clientHtmlPath || '(vacío)'}`)
    }
    httpServer = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1')
      // SEC-C4: assets estáticos públicos de vendor/ (xterm) ANTES del gate de token.
      // El navegador pide <script src="vendor/..."> sin token (las sub-peticiones no heredan
      // el ?token= de la página), y son librerías públicas sin secretos. Sandbox: solo
      // /vendor/, sin traversal, bajo clientDir/vendor.
      if (u.pathname.startsWith('/vendor/')) {
        const safe = u.pathname.replace(/\/+/g, '/')
        if (safe.includes('..')) { res.writeHead(400); res.end('bad'); return }
        const rel = safe.slice('/vendor/'.length)
        const clientDir = path.dirname(clientHtmlPath)
        const abs = path.join(clientDir, 'vendor', rel)
        if (!abs.startsWith(path.join(clientDir, 'vendor') + path.sep)) {
          res.writeHead(403); res.end('forbidden'); return
        }
        try {
          const data = fs.readFileSync(abs)
          const ext = path.extname(abs).toLowerCase()
          const ctype = ext === '.js' ? 'application/javascript; charset=utf-8'
            : ext === '.css' ? 'text/css; charset=utf-8'
            : ext === '.map' ? 'application/json; charset=utf-8'
            : 'application/octet-stream'
          res.writeHead(200, { 'content-type': ctype, 'cache-control': 'public, max-age=86400' })
          res.end(data)
        } catch {
          res.writeHead(404); res.end('not found')
        }
        return
      }
      // SEC-C1: los endpoints HTTP requieren Bearer, salvo la página abierta
      // con una invitación temporal válida. /status nunca se abre con invite.
      const inviteAllowedPage = (u.pathname === '/' || u.pathname === '/lan-client.html') && hasValidSessionInvite(req)
      if (!isAuthorizedReq(req) && !inviteAllowedPage) {
        try { emitAudit('lan-http-auth-rejected', { ip: normalizeRemoteIp(req?.socket?.remoteAddress), path: u.pathname }) } catch {}
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'www-authenticate': 'Bearer realm="lan"' })
        res.end('unauthorized')
        return
      }
      if (u.pathname === '/' || u.pathname === '/lan-client.html') {
        try {
          const html = fs.readFileSync(clientHtmlPath, 'utf8')
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(html)
        } catch (err) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(err?.message || String(err))
        }
        return
      }
      if (u.pathname === '/status') {
        const body = JSON.stringify({ ok: true, running, port, httpPort, ip: lanIp, sessions: listSessions() })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
    })
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        httpServer?.off('error', onError)
        reject(err)
      }
      httpServer.once('error', onError)
      httpServer.listen(httpPort, '0.0.0.0', () => {
        httpServer?.off('error', onError)
        resolve()
      })
    })
  }

  async function start(opts = {}) {
    const nextPort = clampLanPort(opts?.port ?? port)
    const nextHtmlPath = String(opts?.clientHtmlPath || clientHtmlPath || '').trim()
    if (!nextHtmlPath) throw new Error('Ruta de cliente LAN no configurada')

    if (running) await stop()

    port = nextPort
    httpPort = port + 1
    clientHtmlPath = nextHtmlPath
    lanIp = pickLanIPv4()

    wsServer = new WebSocketServer({
      port,
      host: '0.0.0.0',
      // SEC-C1: rechazar handshake si el token no es válido (no abrir socket).
      verifyClient: (info, cb) => {
        const ok = isAuthorizedReq(info.req) || hasValidSessionInvite(info.req)
        if (!ok) {
          try { emitAudit('lan-ws-auth-rejected', { ip: normalizeRemoteIp(info.req?.socket?.remoteAddress) }) } catch {}
          return cb(false, 401, 'unauthorized')
        }
        return cb(true)
      }
    })
    wsServer.on('connection', onWsConnection)

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        wsServer?.off('error', onError)
        reject(err)
      }
      wsServer.once('error', onError)
      wsServer.once('listening', () => {
        wsServer?.off('error', onError)
        resolve()
      })
    })

    try {
      await startHttpServer()
    } catch (err) {
      try { wsServer.close() } catch {}
      wsServer = null
      throw err
    }

    running = true
    ensureLockSweepTimer()
    logger(`[lan] ws server started on ${lanIp}:${port}`)
    return {
      ok: true,
      running,
      ip: lanIp,
      port,
      httpPort,
      wsUrl: `ws://${lanIp}:${port}`,
      clientUrl: buildClientUrl()
    }
  }

  async function stop() {
    closeAllSessions('server-stopped')
    clearLockSweepTimer()

    const wsToClose = wsServer
    const httpToClose = httpServer
    wsServer = null
    httpServer = null

    await Promise.all([
      new Promise((resolve) => {
        if (!wsToClose) return resolve()
        try { wsToClose.close(() => resolve()) } catch { resolve() }
      }),
      new Promise((resolve) => {
        if (!httpToClose) return resolve()
        try { httpToClose.close(() => resolve()) } catch { resolve() }
      })
    ])

    running = false
    sessionLocks.clear()
    sessionInvites.clear()
    logger('[lan] ws server stopped')
    return { ok: true, running: false }
  }

  function getStatus() {
    return {
      running,
      ip: lanIp,
      port,
      httpPort,
      wsUrl: `ws://${lanIp}:${port}`,
      clientUrl: buildClientUrl(),
      publicUrlWarning: computePublicUrlWarning(),
      sessions: listSessions()
    }
  }

  return {
    start,
    stop,
    listSessions,
    closeSession,
    createSessionInvite,
    getStatus,
    isRunning: () => running
  }
}

module.exports = {
  createLanWsServer,
  clampLanPort,
  pickLanIPv4,
  DEFAULT_LAN_WS_PORT,
  // Exposed for tests only — defensa NAS/SMB
  __test__: {
    ensureSafeRequestedPath,
    resolveExistingDir,
    listDirectoryTree
  }
}
