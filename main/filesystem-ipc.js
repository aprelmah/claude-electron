'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { atomicWriteFileSync } = require('./atomic-writes')
const { looksRemotePath, pickerStartDir } = require('./dir-helpers')

// Defensa NAS/SMB: paths remotos (/Volumes/..., //host/share, \\host\share)
// cuelgan main process en statSync/readdirSync/readFileSync síncronos.
// Wrapper async con timeout para lectura puntual de archivos remotos.
const REMOTE_FS_TIMEOUT_MS = 3000

function withTimeout(promise, timeoutMs, label) {
  let timer = null
  const timeoutP = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label || 'fs'} timeout (${timeoutMs}ms) sobre ruta remota`)
      err.code = 'EREMOTE_TIMEOUT'
      reject(err)
    }, timeoutMs)
  })
  return Promise.race([promise, timeoutP]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '.next', '.cache', '__pycache__', '.venv', 'venv', 'dist', 'build', '.idea', '.vscode'])
const TEXT_EXTS = new Set([
  'md','txt','json','yaml','yml','js','ts','tsx','jsx','py','sh','bash','zsh',
  'html','htm','css','scss','sass','less','xml','svg','csv','tsv','log','ini',
  'toml','env','gitignore','rs','go','java','c','cpp','h','hpp','rb','php','lua',
  'sql','vue','svelte','dockerfile','makefile','conf','plist'
])
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg'])

function fileKind(p) {
  const base = path.basename(p).toLowerCase()
  const ext = base.includes('.') ? base.split('.').pop() : base
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (TEXT_EXTS.has(ext)) return 'text'
  try {
    const fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(4096)
    const n = fs.readSync(fd, buf, 0, 4096, 0)
    fs.closeSync(fd)
    for (let i = 0; i < n; i++) if (buf[i] === 0) return 'binary'
    return 'text'
  } catch {
    return 'binary'
  }
}

function registerFilesystemIpc({
  ipcMain,
  dialog,
  safeIpcHandle,
  winFromEvent,
  assertSafeFsPath,
  markGraphCacheDirtyByPath
}) {
  ipcMain.handle('pick-image', async (event) => {
    const result = await dialog.showOpenDialog(winFromEvent(event), {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('pick-file', async (event) => {
    const result = await dialog.showOpenDialog(winFromEvent(event), {
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths
  })

  safeIpcHandle('fs-read-dir', async (event, dirPath) => {
    assertSafeFsPath(dirPath)
    // Defensa NAS: listado completo + per-entry statSync sobre SMB no responsivo
    // cuelga main process. Rechazo claro al renderer.
    if (looksRemotePath(dirPath)) {
      return { ok: false, error: 'remote-path-unsupported' }
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const result = entries
      .filter(e => !IGNORE_NAMES.has(e.name) && !e.name.startsWith('._'))
      .map(e => {
        const full = path.join(dirPath, e.name)
        let size = 0
        try { if (e.isFile()) size = fs.statSync(full).size } catch {}
        return { name: e.name, path: full, isDir: e.isDirectory(), size }
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
      })
    return { ok: true, entries: result }
  })

  ipcMain.handle('fs-pick-folder', async (event, startPath) => {
    // Electron 43 abre los diálogos en Descargas si no se fija defaultPath.
    const result = await dialog.showOpenDialog(winFromEvent(event), {
      properties: ['openDirectory'],
      defaultPath: pickerStartDir(startPath)
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('fs-home', () => os.homedir())

  safeIpcHandle('file-info', async (event, p) => {
    assertSafeFsPath(p)
    // Defensa NAS: lectura puntual con async + timeout 3s.
    if (looksRemotePath(p)) {
      try {
        const stat = await withTimeout(fs.promises.stat(p), REMOTE_FS_TIMEOUT_MS, 'file-info')
        if (stat.isDirectory()) return { ok: false, error: 'es una carpeta' }
        return {
          ok: true,
          path: p,
          size: stat.size,
          mtime: stat.mtime.getTime(),
          kind: 'binary',
          name: path.basename(p)
        }
      } catch (err) {
        if (err && err.code === 'EREMOTE_TIMEOUT') {
          return { ok: false, error: 'remote-path-timeout' }
        }
        return { ok: false, error: err?.message || 'remote-path-error' }
      }
    }
    const stat = fs.statSync(p)
    if (stat.isDirectory()) return { ok: false, error: 'es una carpeta' }
    return {
      ok: true,
      path: p,
      size: stat.size,
      mtime: stat.mtime.getTime(),
      kind: fileKind(p),
      name: path.basename(p)
    }
  })

  safeIpcHandle('file-read', async (event, p) => {
    assertSafeFsPath(p)
    // Defensa NAS: lectura puntual con async + timeout 3s.
    // fileKind() hace openSync/readSync sobre el archivo → NAS hang, así que
    // sobre paths remotos saltamos la detección de kind y tratamos como binary.
    if (looksRemotePath(p)) {
      try {
        const stat = await withTimeout(fs.promises.stat(p), REMOTE_FS_TIMEOUT_MS, 'file-read:stat')
        if (stat.size > 5 * 1024 * 1024) return { ok: false, error: 'Archivo demasiado grande (>5MB)' }
        const data = await withTimeout(fs.promises.readFile(p), REMOTE_FS_TIMEOUT_MS, 'file-read:data')
        return { ok: true, kind: 'binary', base64: data.toString('base64'), size: data.length }
      } catch (err) {
        if (err && err.code === 'EREMOTE_TIMEOUT') {
          return { ok: false, error: 'remote-path-timeout' }
        }
        return { ok: false, error: err?.message || 'remote-path-error' }
      }
    }
    const kind = fileKind(p)
    if (kind === 'image' || kind === 'binary') {
      const data = fs.readFileSync(p)
      return { ok: true, kind, base64: data.toString('base64'), size: data.length }
    }
    const stat = fs.statSync(p)
    if (stat.size > 5 * 1024 * 1024) return { ok: false, error: 'Archivo demasiado grande (>5MB)' }
    const text = fs.readFileSync(p, 'utf-8')
    return { ok: true, kind, text }
  })

  safeIpcHandle('file-write', async (event, { path: p, text }) => {
    assertSafeFsPath(p)
    if (typeof text !== 'string') throw new Error('text must be string')
    atomicWriteFileSync(p, text, 'utf-8')
    markGraphCacheDirtyByPath(p)
    event.sender.send('graph:file-active', p)
    return { ok: true }
  })
}

module.exports = {
  registerFilesystemIpc,
  fileKind,
  IGNORE_NAMES,
  TEXT_EXTS,
  IMAGE_EXTS
}
