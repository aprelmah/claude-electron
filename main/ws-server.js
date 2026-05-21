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
const MAX_FS_READ_BYTES = 2 * 1024 * 1024

const HANDSHAKE_TYPES = new Set(['handshake', 'session:handshake', 'session-handshake', 'hello', 'session:init'])

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

function extractRequestedContextFromHandshake(payload) {
  if (!payload || typeof payload !== 'object') return null
  const type = trimToString(payload.type, 100).toLowerCase()
  if (!HANDSHAKE_TYPES.has(type)) return null

  const nested = payload.context && typeof payload.context === 'object'
    ? payload.context
    : (payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : payload)

  return {
    operatorId: trimToString(nested.operatorId || nested.operator || nested.op || nested.userId, 300),
    profileId: trimToString(nested.profileId || nested.profile || nested.pf, 300),
    roleId: trimToString(nested.roleId || nested.role, 300),
    username: trimToString(nested.username || nested.user || nested.login, 300),
    raw: nested,
    source: 'handshake'
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

function normalizeResolvedSessionConfig(rawConfig, requestedContext) {
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

function createLanWsServer(options = {}) {
  const getSessionConfig = typeof options.getSessionConfig === 'function'
    ? options.getSessionConfig
    : (() => ({ cli: 'claude', cwd: os.homedir(), bin: 'claude', env: { ...process.env }, args: [] }))
  const resolveSessionContext = typeof options.resolveSessionContext === 'function' ? options.resolveSessionContext : null
  const transcribeAudio = typeof options.transcribeAudio === 'function' ? options.transcribeAudio : null
  const logger = typeof options.logger === 'function' ? options.logger : (() => {})
  const buildExecCommand = typeof options.buildExecCommand === 'function' ? options.buildExecCommand : buildDefaultExec
  const onAuditEvent = typeof options.onAuditEvent === 'function' ? options.onAuditEvent : null

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
        delete: !!perms[PERMISSION_KEYS.FS_DELETE]
      },
      viewer: { open: !!perms[PERMISSION_KEYS.VIEWER_OPEN] },
      automations: { manage: !!perms[PERMISSION_KEYS.AUTOMATIONS_MANAGE] },
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

  function handleFsList(session, msgType, payload = {}) {
    ensurePermission(session, PERMISSION_KEYS.FS_LIST, PERMISSION_KEYS.FS_LIST)
    const depth = msgType === 'fs:tree'
      ? Math.max(1, Number.parseInt(payload?.depth, 10) || 2)
      : Math.max(1, Number.parseInt(payload?.depth, 10) || 1)
    const fallbackPath = session.context?.allowedRoots?.[0] || session.cwd
    const requestedPath = resolveFsPathPayload(payload) || fallbackPath
    const allowed = assertPathAllowed(session, requestedPath, { mustExist: true, expectDirectory: true })
    const tree = listDirectoryTree(session, allowed.absolutePath, depth)
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
    if (stat.size > MAX_FS_READ_BYTES) {
      throw createFsError('FILE_TOO_LARGE', `Archivo supera límite de ${MAX_FS_READ_BYTES} bytes`)
    }

    const encoding = trimToString(payload?.encoding, 50).toLowerCase() === 'base64' ? 'base64' : 'utf8'
    const content = encoding === 'base64'
      ? fs.readFileSync(allowed.absolutePath).toString('base64')
      : fs.readFileSync(allowed.absolutePath, 'utf8')

    return {
      ok: true,
      path: allowed.absolutePath,
      encoding,
      size: Number(stat.size || 0),
      mtimeMs: Number(stat.mtimeMs || 0),
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
      'fs:delete': 'delete'
    }
    const op = opMap[msgType] || 'unknown'

    try {
      let result = null
      if (msgType === 'fs:list' || msgType === 'fs:tree') result = handleFsList(session, msgType, payload)
      else if (msgType === 'fs:read' || msgType === 'fs:open') result = handleFsRead(session, msgType, payload)
      else if (msgType === 'fs:write' || msgType === 'fs:save') result = handleFsWrite(session, payload)
      else if (msgType === 'fs:rename') result = handleFsRename(session, payload)
      else if (msgType === 'fs:delete') result = handleFsDelete(session, payload)
      else throw createFsError('INVALID_REQUEST', `operación FS no soportada: ${msgType}`)

      sendFsResult(session, requestId, op, result)
    } catch (err) {
      const errorPayload = fsErrorToPayload(err)
      if (FS_DENIED_AUDIT_CODES.has(errorPayload.code)) {
        const targetPath = trimToString(payload?.path || payload?.from || '', 2000)
        auditFsDenied(session, op, targetPath, errorPayload)
      }
      sendFsResult(session, requestId, op, {
        ok: false,
        error: errorPayload
      })
    }
  }

  function onClientPayload(session, payload) {
    const msgType = trimToString(payload?.type, 100)
    const normalizedMsgType = msgType.toLowerCase()

    // El cliente puede reenviar handshake tras abrir socket.
    // Si la sesión ya está inicializada, lo aceptamos como no-op
    // para evitar ruido de "UNSUPPORTED_MESSAGE" en UI.
    if (HANDSHAKE_TYPES.has(normalizedMsgType)) {
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

    return normalizeResolvedSessionConfig(resolved || {}, requestedContext)
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

    if (session.requestedContext.operatorId || session.requestedContext.profileId || session.requestedContext.roleId) {
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
        const handshakeContext = extractRequestedContextFromHandshake(payload)
        if (handshakeContext) {
          session.requestedContext = mergeRequestedContext(session.requestedContext, handshakeContext)
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
