const { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, dialog } = require('electron')
const pty = require('node-pty')
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { TelegramBridge } = require('./telegram-bridge')

const USER_LOCAL_BIN = path.join(os.homedir(), '.local/bin')
const PYTHON39_BIN = path.join(os.homedir(), 'Library/Python/3.9/bin')
const TMP_DIR = '/tmp/claude-electron'
const CONFIG_FILENAME = 'claude-novak.config.json'

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

let win
let ptyProcess = null
let currentCwd = os.homedir()
let activeCLI = 'claude'
let lastPtyCols = 120
let lastPtyRows = 35
let telegramBridge = null

const DEFAULT_CONFIG = Object.freeze({
  cli: {
    defaultCli: 'claude',
    claudeBin: '',
    codexBin: '',
    whisperBin: ''
  },
  telegram: {
    enabled: false,
    botToken: '',
    allowedUsers: [],
    claudeModel: '',
    claudeEffort: '',
    codexModel: '',
    codexEffort: ''
  }
})

let appConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))

function resolveCommand(candidates) {
  for (const cmd of candidates) {
    if (!cmd) continue
    if (!cmd.includes('/')) return cmd
    if (fs.existsSync(cmd)) return cmd
  }
  return candidates.find(Boolean) || ''
}

const FALLBACK_CLAUDE_BIN = resolveCommand([
  process.env.CLAUDE_BIN,
  path.join(USER_LOCAL_BIN, 'claude'),
  'claude'
])

const FALLBACK_CODEX_BIN = resolveCommand([
  process.env.CODEX_BIN,
  path.join(USER_LOCAL_BIN, 'codex'),
  path.join(os.homedir(), '.nvm/versions/node/v24.15.0/bin/codex'),
  'codex'
])

const FALLBACK_WHISPER_BIN = resolveCommand([
  process.env.WHISPER_BIN,
  path.join(PYTHON39_BIN, 'whisper'),
  'whisper'
])

function normalizeAppConfig(raw) {
  const cli = raw?.cli || {}
  const telegram = raw?.telegram || {}

  const normalized = {
    cli: {
      defaultCli: cli.defaultCli === 'codex' ? 'codex' : 'claude',
      claudeBin: typeof cli.claudeBin === 'string' ? cli.claudeBin.trim() : '',
      codexBin: typeof cli.codexBin === 'string' ? cli.codexBin.trim() : '',
      whisperBin: typeof cli.whisperBin === 'string' ? cli.whisperBin.trim() : ''
    },
    telegram: {
      enabled: Boolean(telegram.enabled),
      botToken: typeof telegram.botToken === 'string' ? telegram.botToken.trim() : '',
      allowedUsers: [],
      claudeModel: typeof telegram.claudeModel === 'string' ? telegram.claudeModel.trim() : '',
      claudeEffort: typeof telegram.claudeEffort === 'string' ? telegram.claudeEffort.trim() : '',
      codexModel: typeof telegram.codexModel === 'string' ? telegram.codexModel.trim() : '',
      codexEffort: typeof telegram.codexEffort === 'string' ? telegram.codexEffort.trim() : ''
    }
  }

  if (Array.isArray(telegram.allowedUsers)) {
    normalized.telegram.allowedUsers = telegram.allowedUsers.map((u) => String(u).trim()).filter(Boolean)
  } else if (typeof telegram.allowedUsers === 'string') {
    normalized.telegram.allowedUsers = telegram.allowedUsers.split(/[,\s]+/g).map((u) => u.trim()).filter(Boolean)
  }
  normalized.telegram.allowedUsers = Array.from(new Set(normalized.telegram.allowedUsers))

  return normalized
}

function configFilePath() {
  return path.join(app.getPath('userData'), CONFIG_FILENAME)
}

function loadAppConfig() {
  try {
    const p = configFilePath()
    if (!fs.existsSync(p)) return normalizeAppConfig(DEFAULT_CONFIG)
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return normalizeAppConfig(raw)
  } catch {
    return normalizeAppConfig(DEFAULT_CONFIG)
  }
}

function saveAppConfig(nextConfig) {
  const normalized = normalizeAppConfig(nextConfig)
  const p = configFilePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(normalized, null, 2), 'utf-8')
  appConfig = normalized
  return normalized
}

function getConfiguredBin(cli) {
  if (cli === 'codex') return appConfig.cli.codexBin || FALLBACK_CODEX_BIN
  return appConfig.cli.claudeBin || FALLBACK_CLAUDE_BIN
}

function getConfiguredWhisperBin() {
  return appConfig.cli.whisperBin || FALLBACK_WHISPER_BIN
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

function buildFdLimitCommand(bin, args = []) {
  const parts = [shellQuote(bin), ...args.map(shellQuote)]
  const log = '/tmp/claude-novak-fd.log'
  return `echo "[$(date +%H:%M:%S)] before ulimit=$(ulimit -n) hard=$(ulimit -Hn) bin=${shellQuote(bin)}" >> ${log} 2>/dev/null; ulimit -n 65536 2>/dev/null || true; echo "[$(date +%H:%M:%S)] after  ulimit=$(ulimit -n)" >> ${log} 2>/dev/null; exec ${parts.join(' ')}`
}

function buildRuntimeEnv() {
  const extraPaths = [USER_LOCAL_BIN, PYTHON39_BIN, '/usr/local/bin']
  for (const candidate of [appConfig.cli.claudeBin, appConfig.cli.codexBin, appConfig.cli.whisperBin]) {
    if (candidate && candidate.includes('/')) extraPaths.push(path.dirname(candidate))
  }
  const mergedPath = Array.from(new Set([...extraPaths, process.env.PATH || ''])).join(':')
  return {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: process.env.LANG || 'en_US.UTF-8',
    PATH: mergedPath
  }
}

function commandExists(command, env) {
  if (!command) return false
  if (command.includes('/')) return fs.existsSync(command)
  const probe = spawnSync('/bin/bash', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], { env })
  return probe.status === 0
}

function cliMeta(cli = activeCLI) {
  if (cli === 'codex') return { name: 'Codex', bin: getConfiguredBin('codex'), envVar: 'CODEX_BIN' }
  return { name: 'Claude', bin: getConfiguredBin('claude'), envVar: 'CLAUDE_BIN' }
}

function notifyPtyError(message) {
  win?.webContents.send('pty-error', message)
}

function notifyTelegramStatus() {
  win?.webContents.send('telegram-status', telegramBridge?.getStatus() || null)
}

function ensureCliAvailable(cli = activeCLI) {
  const meta = cliMeta(cli)
  const env = buildRuntimeEnv()
  if (!commandExists(meta.bin, env)) {
    return {
      ok: false,
      error: `${meta.name} no está disponible (${meta.bin}). Ajusta ${meta.envVar} o instala el comando en PATH.`
    }
  }
  return { ok: true, ...meta, env }
}

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
  win.webContents.on('did-finish-load', () => {
    notifyTelegramStatus()
  })
  win.on('closed', () => {
    win = null
    if (ptyProcess) { ptyProcess.kill(); ptyProcess = null }
  })
}

function startPty(cols, rows, cwd, args = []) {
  if (ptyProcess) return ptyProcess
  if (cols && rows) {
    lastPtyCols = cols
    lastPtyRows = rows
  }
  if (cwd && fs.existsSync(cwd)) currentCwd = cwd
  const cliCheck = ensureCliAvailable(activeCLI)
  if (!cliCheck.ok) {
    notifyPtyError(cliCheck.error)
    throw new Error(cliCheck.error)
  }

  try {
    ptyProcess = pty.spawn('/bin/bash', ['-c', buildFdLimitCommand(cliCheck.bin, args)], {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 35,
      cwd: currentCwd,
      env: cliCheck.env
    })
  } catch (err) {
    const msg = `No se pudo iniciar ${cliCheck.name}: ${err.message || err}`
    notifyPtyError(msg)
    throw new Error(msg)
  }

  ptyProcess._alive = true
  const myProc = ptyProcess

  myProc.onData((data) => {
    if (myProc._alive) {
      win?.webContents.send('pty-data', data)
    }
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

function setActiveCli(cli) {
  if (cli !== 'claude' && cli !== 'codex') return { ok: false, error: 'Invalid CLI' }
  const check = ensureCliAvailable(cli)
  if (!check.ok) return { ok: false, error: check.error }
  if (activeCLI === cli) return { ok: true }
  activeCLI = cli
  killPty()
  return { ok: true }
}

const TG_HISTORY_THRESHOLD = 30
const TG_HISTORY_KEEP = 20

function extractTurnText(obj) {
  if (!obj?.message?.content) return ''
  const content = obj.message.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block?.type === 'text' && typeof block.text === 'string') return block.text
        return ''
      })
      .join(' ')
      .trim()
  }
  return ''
}

function compactClaudeSessionIfNeeded({ sessionId, prompt }) {
  if (!sessionId) return { sessionId, prompt }
  const transcriptPath = path.join(projectDirFor(currentCwd), `${sessionId}.jsonl`)
  if (!fs.existsSync(transcriptPath)) return { sessionId: null, prompt }

  let raw
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8')
  } catch {
    return { sessionId, prompt }
  }

  const turns = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj?.type !== 'user' && obj?.type !== 'assistant') continue
    const text = extractTurnText(obj)
    if (!text) continue
    turns.push({ role: obj.type, text })
  }

  if (turns.length <= TG_HISTORY_THRESHOLD) return { sessionId, prompt }

  const recent = turns.slice(-TG_HISTORY_KEEP)
  const transcript = recent
    .map((t) => `${t.role === 'user' ? 'Usuario' : 'Asistente'}: ${t.text}`)
    .join('\n\n')

  const compactedPrompt =
    `[Contexto: conversación previa, últimos ${recent.length} turnos]\n\n` +
    transcript +
    `\n\n[Nuevo mensaje del usuario]\n${prompt}`

  return { sessionId: null, prompt: compactedPrompt }
}

function runClaudeHeadless({ prompt, sessionId, signal, onText, onToolUse, onSessionId, model, effort }) {
  const meta = cliMeta('claude')
  const env = buildRuntimeEnv()
  if (!commandExists(meta.bin, env)) {
    return Promise.reject(new Error(`Claude no disponible (${meta.bin}). Configura ${meta.envVar}.`))
  }

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions'
  ]
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  if (sessionId) args.push('--resume', sessionId)

  return new Promise((resolve, reject) => {
    let killed = false
    let child
    try {
      child = spawn('/bin/bash', ['-c', buildFdLimitCommand(meta.bin, args)], {
        cwd: currentCwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      return reject(err)
    }

    const abortHandler = () => {
      killed = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
    }
    if (signal) {
      if (signal.aborted) return abortHandler()
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    let buffer = ''
    let stderrBuf = ''
    let finalSessionId = null
    let finalText = ''
    let resultError = null

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (!obj || typeof obj !== 'object') continue

        if (obj.type === 'assistant' && obj.message?.content) {
          for (const block of obj.message.content) {
            if (block?.type === 'text' && typeof block.text === 'string') {
              onText?.(block.text)
            } else if (block?.type === 'tool_use' && block.name) {
              onToolUse?.(block.name)
            }
          }
        } else if (obj.type === 'result') {
          if (typeof obj.result === 'string') finalText = obj.result
          if (obj.is_error) resultError = obj.result || 'CLI devolvió error'
          if (obj.session_id) {
            finalSessionId = obj.session_id
            onSessionId?.(obj.session_id)
          }
        }
      }
    })

    child.stderr.on('data', (d) => { stderrBuf += d.toString() })
    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', abortHandler)
      reject(err)
    })
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abortHandler)
      if (killed) {
        const err = new Error('Cancelado')
        err.name = 'AbortError'
        return reject(err)
      }
      if (resultError) return reject(new Error(String(resultError)))
      if (code !== 0) {
        return reject(new Error(`claude exit ${code}: ${stderrBuf.slice(-500).trim() || 'sin stderr'}`))
      }
      resolve({ sessionId: finalSessionId, text: finalText })
    })
  })
}

function runCodexHeadless({ prompt, sessionId, signal, onText, onSessionId, model, effort }) {
  const meta = cliMeta('codex')
  const env = buildRuntimeEnv()
  if (!commandExists(meta.bin, env)) {
    return Promise.reject(new Error(`Codex no disponible (${meta.bin}). Configura ${meta.envVar}.`))
  }

  const baseFlags = ['--skip-git-repo-check', '--json']
  if (model) baseFlags.push('-m', model)
  if (effort) baseFlags.push('-c', `model_reasoning_effort=${effort}`)

  const args = sessionId
    ? ['exec', 'resume', sessionId, ...baseFlags, prompt]
    : ['exec', ...baseFlags, prompt]

  return new Promise((resolve, reject) => {
    let killed = false
    let child
    try {
      child = spawn('/bin/bash', ['-c', buildFdLimitCommand(meta.bin, args)], {
        cwd: currentCwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      return reject(err)
    }

    const abortHandler = () => {
      killed = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
    }
    if (signal) {
      if (signal.aborted) return abortHandler()
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    let buffer = ''
    let stderrBuf = ''
    let finalSessionId = null
    let finalText = ''

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (!obj || typeof obj !== 'object') continue

        if (obj.type === 'thread.started' && obj.thread_id) {
          finalSessionId = obj.thread_id
          onSessionId?.(obj.thread_id)
        } else if (obj.type === 'item.completed' && obj.item?.type === 'agent_message' && typeof obj.item.text === 'string') {
          finalText = obj.item.text
          onText?.(obj.item.text)
        }
      }
    })

    child.stderr.on('data', (d) => { stderrBuf += d.toString() })
    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', abortHandler)
      reject(err)
    })
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', abortHandler)
      if (killed) {
        const err = new Error('Cancelado')
        err.name = 'AbortError'
        return reject(err)
      }
      if (code !== 0) {
        return reject(new Error(`codex exit ${code}: ${stderrBuf.slice(-500).trim() || 'sin stderr'}`))
      }
      resolve({ sessionId: finalSessionId, text: finalText })
    })
  })
}

app.whenReady().then(() => {
  appConfig = loadAppConfig()
  activeCLI = appConfig.cli.defaultCli === 'codex' ? 'codex' : 'claude'

  telegramBridge = new TelegramBridge({
    tmpDir: TMP_DIR,
    onTranscribeFile: async (filePath) => {
      const whisperBin = getConfiguredWhisperBin()
      const whisperReady = commandExists(whisperBin, buildRuntimeEnv())
      if (!whisperReady) {
        throw new Error(`Whisper no disponible (${whisperBin}).`)
      }
      const outBase = path.basename(filePath).replace(/\.[^.]+$/, '')
      return new Promise((resolve, reject) => {
        const proc = spawn(whisperBin, [
          filePath,
          '--language', 'Spanish',
          '--model', 'small',
          '--output_format', 'txt',
          '--output_dir', TMP_DIR,
          '--fp16', 'False'
        ], {
          env: { ...process.env, PATH: `${process.env.PATH || ''}:${PYTHON39_BIN}` }
        })
        let stderr = ''
        proc.stderr.on('data', (d) => { stderr += d.toString() })
        proc.on('error', (err) => reject(err))
        proc.on('close', (code) => {
          if (code !== 0) return reject(new Error(`whisper exit ${code}: ${stderr}`))
          const txtPath = path.join(TMP_DIR, `${outBase}.txt`)
          try {
            const text = fs.readFileSync(txtPath, 'utf-8').trim()
            try { fs.unlinkSync(txtPath) } catch {}
            resolve(text)
          } catch (err) {
            reject(err)
          }
        })
      })
    },
    onRunQuery: async (opts) => {
      const tg = appConfig.telegram || {}
      if (opts?.cli === 'codex') {
        return runCodexHeadless({ ...opts, model: tg.codexModel || '', effort: tg.codexEffort || '' })
      }
      const compacted = compactClaudeSessionIfNeeded({ sessionId: opts?.sessionId, prompt: opts?.prompt })
      return runClaudeHeadless({ ...opts, ...compacted, model: tg.claudeModel || '', effort: tg.claudeEffort || '' })
    },
    onGetActiveCli: async () => activeCLI,
    onGetCwd: async () => currentCwd,
    onSetCli: async (cli) => setActiveCli(cli),
    onStatus: notifyTelegramStatus
  })

  createWindow()
  telegramBridge.applyConfig(appConfig.telegram).catch((err) => {
    notifyPtyError(`Error iniciando Telegram bridge: ${err?.message || err}`)
  })

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!win) return createWindow()
    win.isVisible() ? win.hide() : win.show()
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  killPty()
  telegramBridge?.stop()
  app.quit()
})

// ── PTY ──
ipcMain.handle('pty-start', (event, { cols, rows, cwd }) => { startPty(cols, rows, cwd); return currentCwd })
ipcMain.on('pty-input', (event, data) => { ptyProcess?.write(data) })
ipcMain.on('pty-resize', (event, { cols, rows }) => {
  if (cols && rows) {
    lastPtyCols = cols
    lastPtyRows = rows
  }
  try { ptyProcess?.resize(cols, rows) } catch {}
})
ipcMain.handle('pty-restart', (event, { cwd, cols, rows } = {}) => {
  killPty()
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        startPty(cols, rows, cwd)
        resolve(currentCwd)
      } catch (err) {
        reject(err)
      }
    }, 200)
  })
})
ipcMain.handle('pty-cwd', () => currentCwd)

// ── Audio: guarda buffer y transcribe con whisper ──
ipcMain.handle('transcribe-audio', async (event, arrayBuffer) => {
  const whisperBin = getConfiguredWhisperBin()
  const whisperReady = commandExists(whisperBin, buildRuntimeEnv())
  if (!whisperReady) {
    throw new Error(`Whisper no disponible (${whisperBin}). Revisa WHISPER_BIN o tu PATH.`)
  }
  const ts = Date.now()
  const webmPath = path.join(TMP_DIR, `audio-${ts}.webm`)
  fs.writeFileSync(webmPath, Buffer.from(arrayBuffer))

  return new Promise((resolve, reject) => {
    const proc = spawn(whisperBin, [
      webmPath,
      '--language', 'Spanish',
      '--model', 'small',
      '--output_format', 'txt',
      '--output_dir', TMP_DIR,
      '--fp16', 'False'
    ], {
      env: { ...process.env, PATH: `${process.env.PATH || ''}:${PYTHON39_BIN}` }
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
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        startPty(cols, rows, cwd, ['--resume', sessionId])
        resolve(currentCwd)
      } catch (err) {
        reject(err)
      }
    }, 200)
  })
})

ipcMain.handle('get-system-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

ipcMain.handle('get-active-cli', () => activeCLI)

ipcMain.handle('set-active-cli', (event, cli) => {
  return setActiveCli(cli)
})

ipcMain.handle('get-app-config', () => ({ ...appConfig }))

ipcMain.handle('save-app-config', async (event, partialConfig) => {
  const merged = normalizeAppConfig({
    ...appConfig,
    ...partialConfig,
    cli: { ...appConfig.cli, ...(partialConfig?.cli || {}) },
    telegram: { ...appConfig.telegram, ...(partialConfig?.telegram || {}) }
  })
  saveAppConfig(merged)
  const warnings = []

  // Si cambia CLI por defecto, se aplica de inmediato.
  if (activeCLI !== appConfig.cli.defaultCli) {
    const switchResult = setActiveCli(appConfig.cli.defaultCli)
    if (!switchResult.ok) {
      warnings.push(`Config guardada pero no pude aplicar default CLI: ${switchResult.error}`)
    }
  }

  let telegramResult = { ok: true, running: false }
  if (telegramBridge) telegramResult = await telegramBridge.applyConfig(appConfig.telegram)
  notifyTelegramStatus()
  return { ok: telegramResult.ok, telegram: telegramResult, warnings, config: appConfig }
})

ipcMain.handle('get-telegram-status', () => telegramBridge?.getStatus() || null)

ipcMain.on('window-close', () => win?.hide())
ipcMain.on('window-minimize', () => win?.minimize())
ipcMain.on('window-toggle-pin', () => {
  if (!win) return
  win.setAlwaysOnTop(!win.isAlwaysOnTop())
})
ipcMain.handle('is-pinned', () => win?.isAlwaysOnTop() ?? false)
