const { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, dialog } = require('electron')
const pty = require('node-pty')
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const USER_LOCAL_BIN = path.join(os.homedir(), '.local/bin')
const PYTHON39_BIN = path.join(os.homedir(), 'Library/Python/3.9/bin')
const TMP_DIR = '/tmp/claude-electron'

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

let win
let ptyProcess = null
let currentCwd = os.homedir()
let activeCLI = 'claude'

function resolveCommand(candidates) {
  for (const cmd of candidates) {
    if (!cmd) continue
    if (!cmd.includes('/')) return cmd
    if (fs.existsSync(cmd)) return cmd
  }
  return candidates.find(Boolean) || ''
}

const CLAUDE_BIN = resolveCommand([
  process.env.CLAUDE_BIN,
  path.join(USER_LOCAL_BIN, 'claude'),
  'claude'
])

const CODEX_BIN = resolveCommand([
  process.env.CODEX_BIN,
  path.join(USER_LOCAL_BIN, 'codex'),
  path.join(os.homedir(), '.nvm/versions/node/v24.15.0/bin/codex'),
  'codex'
])

const WHISPER_BIN = resolveCommand([
  process.env.WHISPER_BIN,
  path.join(PYTHON39_BIN, 'whisper'),
  'whisper'
])

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile('index.html')
  win.on('closed', () => {
    win = null
    if (ptyProcess) { ptyProcess.kill(); ptyProcess = null }
  })
}

function getBin() {
  return activeCLI === 'codex' ? CODEX_BIN : CLAUDE_BIN
}

function startPty(cols, rows, cwd, args = []) {
  if (ptyProcess) return ptyProcess
  if (cwd && fs.existsSync(cwd)) currentCwd = cwd

  ptyProcess = pty.spawn(getBin(), args, {
    name: 'xterm-256color',
    cols: cols || 120,
    rows: rows || 35,
    cwd: currentCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
      PATH: `${USER_LOCAL_BIN}:${process.env.PATH}:${PYTHON39_BIN}:/usr/local/bin`
    }
  })

  ptyProcess._alive = true
  const myProc = ptyProcess

  myProc.onData((data) => {
    if (myProc._alive) win?.webContents.send('pty-data', data)
  })

  myProc.onExit(() => {
    if (myProc._alive) win?.webContents.send('pty-exit')
    if (ptyProcess === myProc) ptyProcess = null
  })

  return ptyProcess
}

function killPty() {
  if (!ptyProcess) return
  ptyProcess._alive = false
  try { ptyProcess.kill() } catch {}
  ptyProcess = null
}

app.whenReady().then(() => {
  createWindow()
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!win) return createWindow()
    win.isVisible() ? win.hide() : win.show()
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  killPty()
  app.quit()
})

// ── PTY ──
ipcMain.handle('pty-start', (event, { cols, rows, cwd }) => { startPty(cols, rows, cwd); return currentCwd })
ipcMain.on('pty-input', (event, data) => { ptyProcess?.write(data) })
ipcMain.on('pty-resize', (event, { cols, rows }) => { try { ptyProcess?.resize(cols, rows) } catch {} })
ipcMain.handle('pty-restart', (event, { cwd, cols, rows } = {}) => {
  killPty()
  return new Promise((resolve) => {
    setTimeout(() => {
      startPty(cols, rows, cwd)
      resolve(currentCwd)
    }, 200)
  })
})
ipcMain.handle('pty-cwd', () => currentCwd)

// ── Audio: guarda buffer y transcribe con whisper ──
ipcMain.handle('transcribe-audio', async (event, arrayBuffer) => {
  const ts = Date.now()
  const webmPath = path.join(TMP_DIR, `audio-${ts}.webm`)
  fs.writeFileSync(webmPath, Buffer.from(arrayBuffer))

  return new Promise((resolve, reject) => {
    const proc = spawn(WHISPER_BIN, [
      webmPath,
      '--language', 'Spanish',
      '--model', 'small',
      '--output_format', 'txt',
      '--output_dir', TMP_DIR,
      '--fp16', 'False'
    ], {
      env: { ...process.env, PATH: `${process.env.PATH}:${PYTHON39_BIN}` }
    })

    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`whisper exit ${code}: ${stderr}`))
      const txtPath = path.join(TMP_DIR, `audio-${ts}.txt`)
      try {
        const text = fs.readFileSync(txtPath, 'utf-8').trim()
        try { fs.unlinkSync(webmPath); fs.unlinkSync(txtPath) } catch {}
        resolve(text)
      } catch (e) {
        reject(e)
      }
    })
  })
})

// ── Image picker ──
ipcMain.handle('pick-image', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: 'Todos', extensions: ['*'] }
    ]
  })
  if (result.canceled) return []
  return result.filePaths
})

// ── File picker (cualquier archivo) ──
ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled) return []
  return result.filePaths
})

// ── Filesystem (sidebar) ──
const IGNORE_NAMES = new Set(['.DS_Store', '.git', 'node_modules', '.next', '.cache', '__pycache__', '.venv', 'venv', 'dist', 'build', '.idea', '.vscode'])

ipcMain.handle('fs-read-dir', async (event, dirPath) => {
  try {
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
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs-pick-folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('fs-home', () => os.homedir())

// ── Viewer de archivos ──
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
  // detect by sniff
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

ipcMain.handle('file-info', async (event, p) => {
  try {
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
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-read', async (event, p) => {
  try {
    const kind = fileKind(p)
    if (kind === 'image' || kind === 'binary') {
      const data = fs.readFileSync(p)
      return { ok: true, kind, base64: data.toString('base64'), size: data.length }
    }
    const stat = fs.statSync(p)
    if (stat.size > 5 * 1024 * 1024) return { ok: false, error: 'Archivo demasiado grande (>5MB)' }
    const text = fs.readFileSync(p, 'utf-8')
    return { ok: true, kind, text }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file-write', async (event, { path: p, text }) => {
  try {
    fs.writeFileSync(p, text, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Sesiones de Claude ──
function encodeProjectPath(p) {
  return p.replace(/\/$/, '').replace(/[\/\s]/g, '-')
}

function projectDirFor(cwd) {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(cwd))
}

ipcMain.handle('list-sessions', async (event, cwd) => {
  const dir = projectDirFor(cwd)
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))

  return files.map(f => {
    const id = f.replace(/\.jsonl$/, '')
    const fullPath = path.join(dir, f)
    let mtime = 0, size = 0, preview = '', msgCount = 0
    try {
      const stat = fs.statSync(fullPath)
      mtime = stat.mtime.getTime()
      size = stat.size
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      msgCount = lines.length
      for (const line of lines) {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user' && obj.message?.content) {
            const c = obj.message.content
            let text = ''
            if (typeof c === 'string') text = c
            else if (Array.isArray(c)) text = c.map(x => x.text || '').join(' ')
            text = text.replace(/<[^>]+>/g, '').trim()
            if (text && !text.startsWith('Caveat:')) {
              preview = text.slice(0, 160)
              break
            }
          }
        } catch {}
      }
    } catch {}
    return { id, mtime, size, preview: preview || '(sin contenido)', msgCount }
  }).sort((a, b) => b.mtime - a.mtime)
})

ipcMain.handle('delete-session', async (event, { cwd, sessionId }) => {
  const dir = projectDirFor(cwd)
  const file = path.join(dir, `${sessionId}.jsonl`)
  if (fs.existsSync(file)) { fs.unlinkSync(file); return true }
  return false
})

ipcMain.handle('resume-session', async (event, { sessionId, cwd, cols, rows }) => {
  killPty()
  return new Promise((resolve) => {
    setTimeout(() => {
      startPty(cols, rows, cwd, ['--resume', sessionId])
      resolve(currentCwd)
    }, 200)
  })
})

ipcMain.handle('get-system-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

ipcMain.handle('get-active-cli', () => activeCLI)

ipcMain.handle('set-active-cli', (event, cli) => {
  if (cli !== 'claude' && cli !== 'codex') return { ok: false, error: 'Invalid CLI' }
  if (activeCLI === cli) return { ok: true }
  activeCLI = cli
  killPty()
  return { ok: true }
})

ipcMain.on('window-close', () => win?.hide())
ipcMain.on('window-minimize', () => win?.minimize())
ipcMain.on('window-toggle-pin', () => {
  if (!win) return
  win.setAlwaysOnTop(!win.isAlwaysOnTop())
})
ipcMain.handle('is-pinned', () => win?.isAlwaysOnTop() ?? false)
