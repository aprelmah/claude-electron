'use strict'

const crypto = require('crypto')
const os = require('os')
const path = require('path')

// SEC-H5: hardening de scriptText antes de instalar como launchd job.
// El renderer puede llamar a `automations:update-draft` con scriptText
// arbitrario. Sin esta validación, cualquier XSS = RCE persistente.

const MAX_SCRIPT_BYTES = 64 * 1024

// Shebangs aceptados (línea EXACTA, sin args extra).
const SHEBANG_ALLOWLIST = new Set([
  '#!/bin/bash',
  '#!/bin/sh',
  '#!/usr/bin/env bash',
  '#!/usr/bin/env zsh',
  '#!/usr/bin/env node',
  '#!/usr/bin/env python3'
])

// Patrones peligrosos en el cuerpo del script.
const DANGEROUS_PATTERNS = [
  // curl / wget piped a shell
  { re: /\bcurl\b[^\n|]*\|\s*(bash|sh|zsh)\b/i, label: 'curl|sh pipeline' },
  { re: /\bwget\b[^\n|]*\|\s*(bash|sh|zsh)\b/i, label: 'wget|sh pipeline' },
  // eval con interpolación
  { re: /\beval\s+["'`]?\$/i, label: 'eval con expansión' },
  { re: /\beval\s+\$\(/, label: 'eval $(...)' },
  // sh -c / bash -c con expansión variable o subshell. Detecta $VAR, ${VAR}, $(...)
  { re: /\b(bash|sh|zsh)\s+-c\s+["'][^"']*\$(\{|\(|[A-Za-z_])/i, label: 'sh -c con interpolación' },
  // Descarga remota a archivo ejecutable
  { re: /\bcurl\b[^\n]*\s-o\s+[^\n]*\.(sh|bash|command)\b/i, label: 'curl -o a script' },
  // Borrado masivo
  { re: /\brm\s+-rf\s+\/(\s|$)/, label: 'rm -rf /' },
  { re: /\brm\s+-rf\s+\$HOME(\s|$)/, label: 'rm -rf $HOME' },
  { re: /\brm\s+-rf\s+~(\/|\s|$)/, label: 'rm -rf ~' },
  // chmod a setuid/setgid
  { re: /\bchmod\s+[ug]?\+s\b/, label: 'chmod +s (setuid/setgid)' },
  { re: /\bchmod\s+[0-7]?[2-7][0-7]{3}\b/, label: 'chmod setuid bits' }
]

// Paths que el script NUNCA debe modificar (escritura/append/cp/mv/rm).
// Cubre persistencia (LaunchAgents/Daemons), sistema, paths protegidos.
const DENY_WRITE_ROOTS = [
  path.join(os.homedir(), 'Library', 'LaunchAgents'),
  path.join(os.homedir(), 'Library', 'LaunchDaemons'),
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), 'Library', 'Keychains'),
  '/Library/LaunchAgents',
  '/Library/LaunchDaemons',
  '/System',
  '/etc',
  '/usr/bin',
  '/usr/sbin',
  '/bin',
  '/sbin',
  '/private/etc'
]

// Operadores de escritura sobre paths absolutos / ~/...
// Capturamos:
//   > /path   >> /path   > ~/path   >> ~/path
//   cp ... /path   mv ... /path   rm /path   tee /path   install /path
const WRITE_OP_PATTERNS = [
  // redirección de output a archivo
  /(^|[^&|])>{1,2}\s*("([^"]+)"|'([^']+)'|(~\/[^\s;|&]+|\/[^\s;|&]+))/g,
  // tee
  /\btee\s+(-[a-zA-Z]+\s+)*("([^"]+)"|'([^']+)'|(~\/[^\s;|&]+|\/[^\s;|&]+))/g,
  // cp / mv / install destino al final
  /\b(cp|mv|install|ln)\s+(-[a-zA-Z]+\s+)*[^\n;|&]+?\s+("([^"]+)"|'([^']+)'|(~\/[^\s;|&]+|\/[^\s;|&]+))(\s|$|;|\||&)/g,
  // rm directo
  /\brm\s+(-[a-zA-Z]+\s+)*("([^"]+)"|'([^']+)'|(~\/[^\s;|&]+|\/[^\s;|&]+))/g
]

function extractShebang(scriptText) {
  if (typeof scriptText !== 'string') return null
  const firstLine = scriptText.split('\n', 1)[0]
  if (!firstLine || !firstLine.startsWith('#!')) return null
  return firstLine.trim()
}

function expandTilde(p) {
  if (!p) return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

function isUnderRoot(child, root) {
  if (!child || !root) return false
  try {
    const c = path.resolve(child)
    const r = path.resolve(root)
    return c === r || c.startsWith(r + path.sep)
  } catch {
    return false
  }
}

function findForbiddenWriteTarget(scriptText) {
  // Saca los targets candidatos del script y revisa contra DENY_WRITE_ROOTS.
  const found = []
  for (const re of WRITE_OP_PATTERNS) {
    // Importante: clonar regex porque tienen flag /g.
    const r = new RegExp(re.source, re.flags)
    let m
    while ((m = r.exec(scriptText)) !== null) {
      // El target es el primer grupo no-vacío de los grupos 3,4,5 / 4,5,6 según patrón.
      const candidate = m[3] || m[4] || m[5] || m[6] || m[7] || ''
      if (!candidate) continue
      const expanded = expandTilde(candidate)
      if (!path.isAbsolute(expanded)) continue
      for (const denied of DENY_WRITE_ROOTS) {
        if (isUnderRoot(expanded, denied)) {
          found.push({ target: candidate, denied })
        }
      }
    }
  }
  return found
}

function sha256Prefix(scriptText) {
  return crypto
    .createHash('sha256')
    .update(String(scriptText || '').slice(0, 200))
    .digest('hex')
}

/**
 * Valida un scriptText antes de persistirlo o instalarlo.
 * Devuelve { ok, error?, shebang, length, hash }.
 */
function validateAutomationScript(scriptText) {
  if (scriptText === null || scriptText === undefined) {
    return { ok: false, error: 'scriptText vacío', shebang: null, length: 0, hash: null }
  }
  if (typeof scriptText !== 'string') {
    return { ok: false, error: 'scriptText debe ser string', shebang: null, length: 0, hash: null }
  }
  const length = Buffer.byteLength(scriptText, 'utf8')
  if (length === 0) {
    return { ok: false, error: 'scriptText vacío', shebang: null, length: 0, hash: null }
  }
  if (length > MAX_SCRIPT_BYTES) {
    return {
      ok: false,
      error: `scriptText excede el límite: ${length} > ${MAX_SCRIPT_BYTES} bytes`,
      shebang: null,
      length,
      hash: null
    }
  }

  const shebang = extractShebang(scriptText)
  if (!shebang) {
    return {
      ok: false,
      error: 'scriptText debe empezar con un shebang permitido (ej. #!/bin/bash)',
      shebang: null,
      length,
      hash: null
    }
  }
  if (!SHEBANG_ALLOWLIST.has(shebang)) {
    return {
      ok: false,
      error: `Shebang no permitido: ${shebang}. Permitidos: ${[...SHEBANG_ALLOWLIST].join(', ')}`,
      shebang,
      length,
      hash: null
    }
  }

  for (const { re, label } of DANGEROUS_PATTERNS) {
    if (re.test(scriptText)) {
      return {
        ok: false,
        error: `Patrón peligroso detectado: ${label}`,
        shebang,
        length,
        hash: null
      }
    }
  }

  const forbidden = findForbiddenWriteTarget(scriptText)
  if (forbidden.length > 0) {
    const first = forbidden[0]
    return {
      ok: false,
      error: `Escritura prohibida hacia ${first.target} (bajo ${first.denied})`,
      shebang,
      length,
      hash: null
    }
  }

  const hash = sha256Prefix(scriptText)
  return { ok: true, shebang, length, hash }
}

module.exports = {
  validateAutomationScript,
  MAX_SCRIPT_BYTES,
  SHEBANG_ALLOWLIST,
  DENY_WRITE_ROOTS,
  _internals: { extractShebang, findForbiddenWriteTarget, sha256Prefix }
}
