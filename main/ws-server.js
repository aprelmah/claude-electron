const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const pty = require('node-pty')
const { WebSocketServer } = require('ws')

const DEFAULT_LAN_WS_PORT = 9999
const MIN_LAN_PORT = 1024
const MAX_LAN_PORT = 65534
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 35
const SESSION_NEGOTIATION_TIMEOUT_MS = 180
const MAX_PREINIT_QUEUE = 64
const MAX_PREINIT_INPUT_BYTES = 128 * 1024
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
  'READ_ONLY_ROOT'
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

function extractRequestedContextFromQuery(req) {
  const params = parseConnectionQuery(req)
  return {
    operatorId: firstNonEmpty(params, ['operatorId', 'operator', 'op', 'userId']),
    profileId: firstNonEmpty(params, ['profileId', 'profile', 'pf']),
    roleId: firstNonEmpty(params, ['roleId', 'role']),
    username: firstNonEmpty(params, ['username', 'user', 'login']),
    raw: Object.fromEntries(params.entries()),
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

  const hasContextHints = !!(operatorId || profileId || roleId || username)
  if (!expectedTypeSet.has(type)) {
    if (!(acceptTypeLess && !type && hasContextHints)) return null
  }

  if (!hasContextHints) return null

  return {
    operatorId,
    profileId,
    roleId,
    username,
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
    raw: next.raw && typeof next.raw === 'object' ? next.raw : (current.raw || {}),
    source: next.source || current.source || 'none'
  }
}

function resolveExistingDir(candidatePath) {
  const resolved = normalizeAbsolutePath(candidatePath)
  if (!resolved) return ''
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
  const cli = raw.cli === 'codex' ? 'codex' : 'claude'
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

  const base = resolveExistingDir(session.cwd) || os.homedir()
  const candidate = path.isAbsolute(finalInput)
    ? finalInput
    : path.join(base, finalInput)
  const resolved = normalizeAbsolutePath(candidate)
  if (!resolved) throw createFsError('INVALID_PATH', 'No se pudo normalizar la ruta')

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
  const resolveSessionContext = typeof options.resolveSessionContext === 'function' ? options.resolveSessionContext : null
  const transcribeAudio = typeof options.transcribeAudio === 'function' ? options.transcribeAudio : null
  const logger = typeof options.logger === 'function' ? options.logger : (() => {})
  const buildExecCommand = typeof options.buildExecCommand === 'function' ? options.buildExecCommand : buildDefaultExec
  const onAuditEvent = typeof options.onAuditEvent === 'function' ? options.onAuditEvent : null
  const defaultFsLimits = normalizeFsLimits(options.fsLimits || {}, DEFAULT_FS_LIMITS)
  const fsWatchOptions = options.fsWatch && typeof options.fsWatch === 'object' ? options.fsWatch : {}
  const fsWatchDebounceMs = Math.max(80, Math.min(Number.parseInt(fsWatchOptions.debounceMs, 10) || FS_WATCH_DEBOUNCE_MS, 3000))
  const fsWatchThrottleMs = Math.max(150, Math.min(Number.parseInt(fsWatchOptions.throttleMs, 10) || FS_WATCH_THROTTLE_MS, 10000))
  const fsWatchPollingIntervalMs = Math.max(600, Math.min(Number.parseInt(fsWatchOptions.pollMs, 10) || FS_WATCH_POLL_INTERVAL_MS, 15000))
  const fsWatchDepth = Math.max(1, Math.min(Number.parseInt(fsWatchOptions.depth, 10) || MAX_FS_TREE_DEPTH, MAX_FS_TREE_DEPTH))

  let wsServer = null
  let httpServer = null
  let running = false
  let port = DEFAULT_LAN_WS_PORT
  let httpPort = DEFAULT_LAN_WS_PORT + 1
  let lanIp = '127.0.0.1'
  let clientHtmlPath = options.clientHtmlPath || ''

  const sessions = new Map()

  function emitAudit(action, details = {}) {
    if (!onAuditEvent) return
    try {
      onAuditEvent({ action, ts: Date.now(), source: 'lan-ws-server', ...details })
    } catch {}
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
      personaResolved: context.personaResolved || '',
      personaSource: context.personaSource || 'none',
      allowedRoots: Array.isArray(context.allowedRoots) ? [...context.allowedRoots] : [],
      readOnlyRoots: Array.isArray(context.readOnlyRoots) ? [...context.readOnlyRoots] : [],
      allowedMcpServers: Array.isArray(context.allowedMcpServers) ? [...context.allowedMcpServers] : [],
      request: context.request || {
        operatorId: null,
        profileId: null,
        roleId: null,
        username: null,
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

  function closeSession(sessionId, reason = 'closed') {
    const session = sessions.get(String(sessionId || ''))
    if (!session) return false
    sessions.delete(session.id)
    closeAllFsWatchers(session, reason)
    killSessionPty(session)
    safeSend(session.ws, { type: 'status', state: reason, sessionId: session.id })
    try { session.ws.close(1000, reason) } catch {}
    logger(`[lan] session closed ${session.id} (${reason})`)
    return true
  }

  function closeAllSessions(reason = 'server-stopped') {
    for (const id of Array.from(sessions.keys())) {
      closeSession(id, reason)
    }
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

  function onClientPayload(session, payload) {
    const msgType = trimToString(payload?.type, 100)
    const normalizedType = msgType.toLowerCase()

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
      emitAudit('empresa_handshake_contexto_actualizado', {
        ...auditActor(session),
        source: contextSync.source,
        changed: changed.join(',') || 'none',
        requestedOperatorId: session.requestedContext?.operatorId || null,
        requestedRoleId: session.requestedContext?.roleId || null,
        requestedProfileId: session.requestedContext?.profileId || null,
        usernameProvided: !!session.requestedContext?.username,
        late: session.initialized === true
      })
      return
    }
    if (CONTEXT_SYNC_TYPES.has(normalizedType)) {
      return
    }

    if (msgType === 'input') {
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
      session.audioQueue = (session.audioQueue || Promise.resolve())
        .then(() => handleAudioMessage(session, payload))
        .catch(() => {})
      return
    }

    if (msgType.startsWith('fs:')) {
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

  function createPtyForSession(session, config) {
    const bin = trimToString(config?.bin, 1000)
    if (!bin) throw new Error('No hay binario CLI configurado')
    const args = Array.isArray(config?.args) ? config.args : []
    const execCommand = buildExecCommand(bin, args)
    return pty.spawn('/bin/bash', ['-c', execCommand], {
      name: 'xterm-256color',
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      env: config?.env || { ...process.env }
    })
  }

  async function resolveConfigForConnection({ req, requestedContext }) {
    const resolverInput = {
      req,
      requestedContext: {
        operatorId: requestedContext.operatorId || '',
        profileId: requestedContext.profileId || '',
        roleId: requestedContext.roleId || '',
        username: requestedContext.username || '',
        source: requestedContext.source || 'none',
        raw: requestedContext.raw || {}
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

  async function initializeSession(session, req) {
    if (session.initialized || session.initInFlight) return
    session.initInFlight = true
    if (session.initTimer) {
      try { clearTimeout(session.initTimer) } catch {}
      session.initTimer = null
    }

    let resolved = null
    try {
      resolved = await resolveConfigForConnection({ req, requestedContext: session.requestedContext })
    } catch (err) {
      session.initInFlight = false
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

    emitAudit('empresa_contexto_resuelto', {
      ...auditActor(session),
      requestedOperatorId: session.requestedContext?.operatorId || null,
      requestedRoleId: session.requestedContext?.roleId || null,
      requestedProfileId: session.requestedContext?.profileId || null,
      usernameProvided: !!session.requestedContext?.username,
      requestSource: session.requestedContext?.source || 'none',
      mode: session.context?.mode || 'legacy',
      enterpriseEnabled: !!session.context?.enterpriseEnabled,
      appliedOperatorId: session.context?.operatorId || null,
      appliedRoleId: session.context?.roleId || null,
      appliedProfileId: session.context?.profileId || null
    })

    let ptyProcess = null
    if (session.permissions[PERMISSION_KEYS.PTY_EXECUTE]) {
      try {
        ptyProcess = createPtyForSession(session, resolved)
      } catch (err) {
        session.initInFlight = false
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

    const connectedPayload = {
      type: 'status',
      state: 'connected',
      sessionId: session.id,
      cli: session.cli,
      cwd: session.cwd,
      connectedAt: session.connectedAt,
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
    const initialRequested = extractRequestedContextFromQuery(req)
    const session = {
      id: crypto.randomUUID(),
      ws,
      ip: normalizeRemoteIp(req?.socket?.remoteAddress),
      cli: 'claude',
      cwd: os.homedir(),
      connectedAt: Date.now(),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      ptyProcess: null,
      audioQueue: Promise.resolve(),
      initialized: false,
      initInFlight: false,
      initTimer: null,
      pendingPayloads: [],
      pendingInputBytes: 0,
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
        personaResolved: '',
        allowedRoots: [],
        readOnlyRoots: [],
        allowedMcpServers: [],
        request: {
          operatorId: initialRequested.operatorId || null,
          profileId: initialRequested.profileId || null,
          roleId: initialRequested.roleId || null,
          username: initialRequested.username || null,
          source: initialRequested.source || 'query'
        }
      },
      pathPolicy: {
        allowedRoots: normalizeRootEntries([os.homedir()], [os.homedir()]),
        readOnlyRoots: []
      }
    }

    const maybeStartSession = () => {
      if (session.initialized || session.initInFlight) return
      initializeSession(session, req)
    }

    if (
      session.requestedContext.operatorId ||
      session.requestedContext.profileId ||
      session.requestedContext.roleId ||
      session.requestedContext.username
    ) {
      maybeStartSession()
    } else {
      session.initTimer = setTimeout(() => {
        session.initTimer = null
        maybeStartSession()
      }, SESSION_NEGOTIATION_TIMEOUT_MS)
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
          emitAudit('empresa_handshake_contexto_actualizado', {
            ...auditActor(session),
            source: contextSync.source,
            changed: changed.join(',') || 'none',
            requestedOperatorId: session.requestedContext?.operatorId || null,
            requestedRoleId: session.requestedContext?.roleId || null,
            requestedProfileId: session.requestedContext?.profileId || null,
            usernameProvided: !!session.requestedContext?.username,
            late: false
          })
          maybeStartSession()
          return
        }
        if (CONTEXT_SYNC_TYPES.has(msgType)) {
          maybeStartSession()
          return
        }

        if (msgType === 'resize') {
          session.cols = Math.max(20, Number.parseInt(payload.cols, 10) || DEFAULT_COLS)
          session.rows = Math.max(10, Number.parseInt(payload.rows, 10) || DEFAULT_ROWS)
          return
        }

        if (!session.initInFlight) maybeStartSession()

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
      if (!sessions.has(session.id)) return
      sessions.delete(session.id)
      closeAllFsWatchers(session, 'ws-close')
      killSessionPty(session)
      logger(`[lan] session disconnected ${session.id}`)
    })

    ws.on('error', () => {
      if (session.initTimer) {
        try { clearTimeout(session.initTimer) } catch {}
        session.initTimer = null
      }
      if (!sessions.has(session.id)) return
      sessions.delete(session.id)
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

    wsServer = new WebSocketServer({ port, host: '0.0.0.0' })
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
    logger(`[lan] ws server started on ${lanIp}:${port}`)
    return {
      ok: true,
      running,
      ip: lanIp,
      port,
      httpPort,
      clientUrl: `http://${lanIp}:${httpPort}/lan-client.html?host=${encodeURIComponent(lanIp)}&port=${port}`
    }
  }

  async function stop() {
    closeAllSessions('server-stopped')

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
    logger('[lan] ws server stopped')
    return { ok: true, running: false }
  }

  function getStatus() {
    return {
      running,
      ip: lanIp,
      port,
      httpPort,
      clientUrl: `http://${lanIp}:${httpPort}/lan-client.html?host=${encodeURIComponent(lanIp)}&port=${port}`,
      sessions: listSessions()
    }
  }

  return {
    start,
    stop,
    listSessions,
    closeSession,
    getStatus,
    isRunning: () => running
  }
}

module.exports = {
  createLanWsServer,
  clampLanPort,
  pickLanIPv4,
  DEFAULT_LAN_WS_PORT
}
