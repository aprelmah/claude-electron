'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { atomicWriteFileSync } = require('./atomic-writes')

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

  ipcMain.handle('fs-pick-folder', async (event) => {
    const result = await dialog.showOpenDialog(winFromEvent(event), {
      properties: ['openDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('fs-home', () => os.homedir())

  safeIpcHandle('file-info', async (event, p) => {
    assertSafeFsPath(p)
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
