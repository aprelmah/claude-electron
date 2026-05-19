const path = require('path')
const os = require('os')

const HOME = os.homedir()
const DENY_ROOTS = [
  path.join(HOME, '.ssh'),
  path.join(HOME, 'Library', 'Keychains'),
  path.join(HOME, 'Library', 'Application Support', 'com.apple.idleassetsd'),
  path.join(HOME, 'Library', 'Cookies')
]

function resolveSafe(p) {
  if (typeof p !== 'string' || !p) return null
  try {
    return path.resolve(p)
  } catch {
    return null
  }
}

function isUnder(child, parent) {
  if (!child || !parent) return false
  const c = path.resolve(child)
  const r = path.resolve(parent)
  return c === r || c.startsWith(r + path.sep)
}

function isPathSafe(p, allowedRoots) {
  const resolved = resolveSafe(p)
  if (!resolved) return false
  for (const denied of DENY_ROOTS) {
    if (isUnder(resolved, denied)) return false
  }
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false
  return allowedRoots.some((root) => {
    const r = resolveSafe(root)
    return r ? isUnder(resolved, r) : false
  })
}

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function isValidSessionId(id) {
  return typeof id === 'string' && UUID_RE.test(id)
}

module.exports = { isPathSafe, isValidSessionId, DENY_ROOTS }
