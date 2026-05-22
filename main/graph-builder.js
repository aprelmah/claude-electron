'use strict'

// Builds the project-wide reference graph used by the sidebar/grafo view.
// Walks the tree, parses imports/links for .js/.ts/.py/.php/.go/.md and
// returns { nodes, edges, dirs } with hierarchical metadata.

const fs = require('fs')
const path = require('path')

function computeProjectGraph(rootPath) {
  if (!rootPath) return { ok: false, error: 'no rootPath' }

  const SKIP = new Set(['.DS_Store', '.git', 'node_modules', '.next', '.cache',
    '__pycache__', '.venv', 'venv', 'dist', 'build', '.idea', '.vscode', 'coverage'])
  const BIN_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.dmg', '.app', '.zip', '.tar', '.gz', '.pdf', '.ttf', '.woff', '.woff2',
    '.eot', '.mp3', '.mp4', '.wav', '.ogg', '.db', '.sqlite'])

  const MAX_GRAPH_FILES = 20000
  const MAX_GRAPH_DIRS = 12000
  const allFiles = []
  const allDirs = []
  const dirSet = new Set()
  const fileMtime = new Map()

  function addDir(p) {
    if (!p || dirSet.has(p)) return
    dirSet.add(p)
    allDirs.push(p)
  }

  function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (allFiles.length > MAX_GRAPH_FILES || allDirs.length > MAX_GRAPH_DIRS) return
      if (SKIP.has(e.name) || e.name.startsWith('._')) continue
      if (typeof e.isSymbolicLink === 'function' && e.isSymbolicLink()) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        addDir(full)
        walk(full)
      } else if (e.isFile()) {
        allFiles.push(full)
        try { fileMtime.set(full, fs.statSync(full).mtimeMs || 0) } catch { fileMtime.set(full, 0) }
      }
    }
  }

  addDir(rootPath)
  walk(rootPath)

  if (allFiles.length > MAX_GRAPH_FILES) {
    return { ok: false, error: `Proyecto demasiado grande: ${allFiles.length} archivos (máx ${MAX_GRAPH_FILES})` }
  }
  if (allDirs.length > MAX_GRAPH_DIRS) {
    return { ok: false, error: `Proyecto demasiado grande: ${allDirs.length} carpetas (máx ${MAX_GRAPH_DIRS})` }
  }

  const fileByBasename = new Map()
  const fileByBasenameMany = new Map()
  const fileByRelNoExt = new Map()
  const goDirAnyFile = new Map()
  const goDirsByBase = new Map()
  for (const f of allFiles) {
    const base = path.basename(f, path.extname(f)).toLowerCase()
    if (!fileByBasename.has(base)) fileByBasename.set(base, f)
    if (!fileByBasenameMany.has(base)) fileByBasenameMany.set(base, [])
    fileByBasenameMany.get(base).push(f)
    const rel = path.relative(rootPath, f).replace(/\\/g, '/')
    const relNoExt = rel.replace(/\.[^/.]+$/, '').toLowerCase()
    if (!fileByRelNoExt.has(relNoExt)) fileByRelNoExt.set(relNoExt, f)
    if (relNoExt.endsWith('/__init__')) {
      const asPkg = relNoExt.slice(0, -'/__init__'.length)
      if (asPkg && !fileByRelNoExt.has(asPkg)) fileByRelNoExt.set(asPkg, f)
    }
    if (path.extname(f).toLowerCase() === '.go') {
      const dir = path.dirname(f)
      if (!goDirAnyFile.has(dir)) goDirAnyFile.set(dir, f)
      const baseDir = path.basename(dir).toLowerCase()
      if (!goDirsByBase.has(baseDir)) goDirsByBase.set(baseDir, [])
      goDirsByBase.get(baseDir).push(dir)
    }
  }

  const allFilesSet = new Set(allFiles)
  const edges = []

  const pickFirstByExt = (arr, preferred = []) => {
    if (!Array.isArray(arr) || arr.length === 0) return null
    for (const ext of preferred) {
      const hit = arr.find((p) => path.extname(p).toLowerCase() === ext)
      if (hit) return hit
    }
    return arr[0]
  }

  const resolveModuleLike = (name, preferredExt = []) => {
    const raw = String(name || '').trim()
    if (!raw) return null
    const asPath = raw.replace(/\./g, '/').toLowerCase()
    if (fileByRelNoExt.has(asPath)) return fileByRelNoExt.get(asPath)
    const relHit = fileByRelNoExt.get(raw.toLowerCase())
    if (relHit) return relHit
    const tail = asPath.split('/').pop()
    return pickFirstByExt(fileByBasenameMany.get(tail), preferredExt)
  }

  const addEdge = (source, target) => {
    if (!source || !target || source === target) return
    if (!allFilesSet.has(source) || !allFilesSet.has(target)) return
    edges.push({ source, target })
  }

  let goModuleName = ''
  try {
    const goModPath = path.join(rootPath, 'go.mod')
    if (fs.existsSync(goModPath)) {
      const goMod = fs.readFileSync(goModPath, 'utf8')
      const mm = goMod.match(/^\s*module\s+([^\s]+)\s*$/m)
      if (mm && mm[1]) goModuleName = mm[1].trim()
    }
  } catch {}

  const resolveGoImportPath = (sourcePath, importPath) => {
    const imp = String(importPath || '').trim()
    if (!imp) return null
    if (imp.startsWith('.')) {
      const rel = path.resolve(path.dirname(sourcePath), imp)
      const goFile = goDirAnyFile.get(rel)
      if (goFile) return goFile
      const base = path.basename(rel).toLowerCase()
      const dirs = goDirsByBase.get(base)
      return dirs && dirs.length ? goDirAnyFile.get(dirs[0]) : null
    }
    if (goModuleName && (imp === goModuleName || imp.startsWith(`${goModuleName}/`))) {
      const tail = imp === goModuleName ? '' : imp.slice(goModuleName.length + 1)
      const localDir = path.join(rootPath, tail)
      const goFile = goDirAnyFile.get(localDir)
      if (goFile) return goFile
      const base = path.basename(localDir).toLowerCase()
      const dirs = goDirsByBase.get(base)
      return dirs && dirs.length ? goDirAnyFile.get(dirs[0]) : null
    }
    const tail = imp.split('/').pop()?.toLowerCase()
    if (!tail) return null
    const dirs = goDirsByBase.get(tail)
    if (!dirs || !dirs.length) return null
    return goDirAnyFile.get(dirs[0]) || null
  }

  for (const filePath of allFiles) {
    let content
    try { if (fs.statSync(filePath).size > 2 * 1024 * 1024) continue } catch { continue }
    const ext = path.extname(filePath).toLowerCase()
    if (BIN_EXTS.has(ext)) continue
    try { content = fs.readFileSync(filePath, 'utf8') } catch { continue }

    if (ext === '.md') {
      const re = /\[\[([^\]|#]+?)(?:[|#][^\]]+)?\]\]/g
      let m
      while ((m = re.exec(content)) !== null) {
        const target = m[1].trim().toLowerCase()
        const targetFile = fileByBasename.get(target) ||
          fileByBasename.get(target.split('/').pop())
        if (targetFile && targetFile !== filePath) {
          addEdge(filePath, targetFile)
        }
      }
    }

    if (['.js', '.ts', '.mjs', '.cjs'].includes(ext)) {
      const re = /(?:import\s+(?:[^'"]+?\s+from\s+)?|require\s*\(\s*)['"](\.[^'"]+)['"]/g
      let m
      while ((m = re.exec(content)) !== null) {
        let targetFile = path.resolve(path.dirname(filePath), m[1])
        if (!path.extname(targetFile)) {
          for (const tryExt of ['.js', '.ts', '.mjs', '/index.js', '/index.ts']) {
            if (allFilesSet.has(targetFile + tryExt)) {
              targetFile = targetFile + tryExt
              break
            }
          }
        }
        if (allFilesSet.has(targetFile) && targetFile !== filePath) {
          addEdge(filePath, targetFile)
        }
      }
    }

    if (ext === '.py') {
      const relDir = path.dirname(path.relative(rootPath, filePath)).replace(/\\/g, '/')
      const relParts = relDir === '.' ? [] : relDir.split('/').filter(Boolean)

      const resolvePyImport = (specRaw) => {
        const spec = String(specRaw || '').trim()
        if (!spec) return null
        const dm = spec.match(/^(\.+)(.*)$/)
        if (!dm) return resolveModuleLike(spec, ['.py'])
        const dots = dm[1].length
        const rest = (dm[2] || '').replace(/^\./, '')
        const up = Math.max(0, dots - 1)
        const base = relParts.slice(0, Math.max(0, relParts.length - up))
        const restParts = rest ? rest.split('.').filter(Boolean) : []
        const relNoExt = [...base, ...restParts].join('/').toLowerCase()
        if (!relNoExt) return null
        return fileByRelNoExt.get(relNoExt) || resolveModuleLike(relNoExt, ['.py'])
      }

      const reFrom = /^\s*from\s+([A-Za-z_][\w\.]*|\.+[\w\.]*)\s+import\s+([A-Za-z_][\w\s,.*]*)/gm
      let mFrom
      while ((mFrom = reFrom.exec(content)) !== null) {
        const fromSpec = mFrom[1].trim()
        const imported = mFrom[2]
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/i)[0].trim())
          .filter(Boolean)

        const direct = resolvePyImport(fromSpec)
        if (direct) addEdge(filePath, direct)
        for (const name of imported) {
          if (name === '*') continue
          const combo = `${fromSpec}.${name}`
          const target = resolvePyImport(combo)
          if (target) addEdge(filePath, target)
        }
      }

      const reImport = /^\s*import\s+([A-Za-z_][\w\.\s,]*)/gm
      let mImport
      while ((mImport = reImport.exec(content)) !== null) {
        const mods = mImport[1]
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/i)[0].trim())
          .filter(Boolean)
        for (const mod of mods) {
          const target = resolveModuleLike(mod, ['.py'])
          if (target) addEdge(filePath, target)
        }
      }
    }

    if (ext === '.php') {
      const tryResolvePhpPath = (rawTarget) => {
        let p = String(rawTarget || '').trim()
        if (!p) return null
        p = p.replace(/^__DIR__\s*\.\s*/, '').replace(/^dirname\(__FILE__\)\s*\.\s*/, '')
        p = p.replace(/^['"]|['"]$/g, '')
        if (!p) return null
        let candidate = p.startsWith('/')
          ? path.resolve(rootPath, `.${p}`)
          : path.resolve(path.dirname(filePath), p)
        if (allFilesSet.has(candidate)) return candidate
        if (!path.extname(candidate)) {
          for (const extra of ['.php', '.inc.php', '/index.php']) {
            if (allFilesSet.has(candidate + extra)) return candidate + extra
          }
        }
        const tail = path.basename(candidate, path.extname(candidate)).toLowerCase()
        return pickFirstByExt(fileByBasenameMany.get(tail), ['.php'])
      }

      const reIncQuoted = /\b(?:include|include_once|require|require_once)\s*(?:\(\s*)?["']([^"']+)["']/gi
      let mi
      while ((mi = reIncQuoted.exec(content)) !== null) {
        const target = tryResolvePhpPath(mi[1])
        if (target) addEdge(filePath, target)
      }
      const reIncDir = /\b(?:include|include_once|require|require_once)\s*(?:\(\s*)?(?:__DIR__|dirname\(__FILE__\))\s*\.\s*["']([^"']+)["']/gi
      while ((mi = reIncDir.exec(content)) !== null) {
        const target = tryResolvePhpPath(mi[1])
        if (target) addEdge(filePath, target)
      }
    }

    if (ext === '.go') {
      const parseImportChunk = (chunk) => {
        const reQ = /"([^"]+)"/g
        let mq
        while ((mq = reQ.exec(chunk)) !== null) {
          const imp = mq[1]
          const target = resolveGoImportPath(filePath, imp)
          if (target) addEdge(filePath, target)
        }
      }

      const reBlock = /\bimport\s*\(([\s\S]*?)\)/gm
      let mb
      while ((mb = reBlock.exec(content)) !== null) parseImportChunk(mb[1] || '')

      const reSingle = /^\s*import\s+(?:[._A-Za-z][\w]*\s+)?"([^"]+)"/gm
      let ms
      while ((ms = reSingle.exec(content)) !== null) {
        const target = resolveGoImportPath(filePath, ms[1])
        if (target) addEdge(filePath, target)
      }
    }
  }

  const edgeSet = new Set()
  const uniqueEdges = edges.filter(e => {
    const key = [e.source, e.target].sort().join('|||')
    if (edgeSet.has(key)) return false
    edgeSet.add(key)
    return true
  })
  for (const e of uniqueEdges) e.kind = 'reference'

  const connectionCount = new Map(allFiles.map(f => [f, 0]))
  for (const e of uniqueEdges) {
    connectionCount.set(e.source, (connectionCount.get(e.source) || 0) + 1)
    connectionCount.set(e.target, (connectionCount.get(e.target) || 0) + 1)
  }

  const computeHier = (p, isRoot) => {
    if (isRoot || p === rootPath) return { parentId: null, depth: 0 }
    const parent = path.dirname(p)
    const parentId = dirSet.has(parent) ? parent : null
    let depth = 1
    if (rootPath && p.startsWith(rootPath + path.sep)) {
      const rel = p.slice(rootPath.length + 1)
      depth = rel.split(path.sep).length
    }
    return { parentId, depth }
  }

  const nodes = allFiles.map(f => {
    const { parentId, depth } = computeHier(f, false)
    return {
      id: f,
      label: path.basename(f),
      path: f,
      connections: connectionCount.get(f) || 0,
      mtimeMs: Number(fileMtime.get(f) || 0),
      parentId,
      depth
    }
  })

  const dirs = allDirs.map((d) => {
    const isRoot = d === rootPath
    const { parentId, depth } = computeHier(d, isRoot)
    return {
      id: d,
      label: path.basename(d) || d,
      path: d,
      type: 'folder',
      connections: 0,
      parentId,
      depth
    }
  })

  return { ok: true, nodes, edges: uniqueEdges, dirs }
}

function normalizeGraphRootPath(rootPath) {
  const raw = String(rootPath || '').trim()
  if (!raw) return ''
  try { return path.resolve(raw) } catch { return raw }
}

module.exports = {
  computeProjectGraph,
  normalizeGraphRootPath
}
