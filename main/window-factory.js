'use strict'

const fs = require('fs')
const path = require('path')
const { atomicWriteJsonSync } = require('./atomic-writes')

function createWindowFactory({
  BrowserWindow,
  nativeTheme,
  app,
  getPrimaryWin,
  getRootDir
}) {
  const rootDir = getRootDir ? getRootDir() : __dirname
  const viewerWindows = new Set()
  let tasksManagerWin = null
  let bitacoraWin = null
  let whatsappWindow = null
  const WA_WIN_BOUNDS_FILE = path.join(app.getPath('userData'), 'whatsapp-window-bounds.json')

  async function readInitialTheme() {
    let initialTheme = ''
    try {
      const primary = getPrimaryWin?.()
      if (primary && !primary.isDestroyed()) {
        const t = await primary.webContents.executeJavaScript(
          `localStorage.getItem('claude-electron-theme') || ''`, true
        )
        if (t === 'light' || t === 'dark') initialTheme = t
      }
    } catch {}
    if (initialTheme !== 'light' && initialTheme !== 'dark') {
      initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    }
    return initialTheme
  }

  function openViewerWindow(filePath, hint) {
    const primary = getPrimaryWin?.()
    let bounds = { width: 700, height: 600, x: undefined, y: undefined }
    if (primary && !primary.isDestroyed()) {
      const b = primary.getBounds()
      const offset = viewerWindows.size * 24
      if (hint && Number.isFinite(hint.x) && Number.isFinite(hint.y) && hint.width > 0 && hint.height > 0) {
        const inset = 6
        bounds = {
          width: Math.max(380, Math.round(hint.width) - inset * 2),
          height: Math.max(280, Math.round(hint.height) - inset * 2),
          x: b.x + Math.round(hint.x) + inset + offset,
          y: b.y + Math.round(hint.y) + inset + offset
        }
      } else {
        const inset = 50
        bounds = {
          width: Math.max(420, b.width - inset * 2),
          height: Math.max(320, b.height - inset * 2),
          x: b.x + inset + offset,
          y: b.y + inset + offset
        }
      }
    }
    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      resizable: true,
      minimizable: true,
      alwaysOnTop: false,
      title: path.basename(filePath),
      webPreferences: {
        preload: path.join(rootDir, 'viewer-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    viewerWindows.add(win)
    win.on('closed', () => viewerWindows.delete(win))
    win.loadFile('viewer.html')
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send('viewer-init', { path: filePath })
    })
    return win
  }

  async function openTasksManager() {
    if (tasksManagerWin && !tasksManagerWin.isDestroyed()) {
      if (tasksManagerWin.isMinimized()) tasksManagerWin.restore()
      tasksManagerWin.show()
      tasksManagerWin.focus()
      return tasksManagerWin
    }

    const initialTheme = await readInitialTheme()

    tasksManagerWin = new BrowserWindow({
      width: 1000,
      height: 720,
      minWidth: 760,
      minHeight: 520,
      title: 'POWER-AGENT — Tareas programadas',
      frame: false,
      titleBarStyle: 'hiddenInset',
      backgroundColor: initialTheme === 'light' ? '#fafafd' : '#111',
      show: false,
      webPreferences: {
        preload: path.join(rootDir, 'tasks-manager-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    tasksManagerWin.loadFile('tasks-manager.html', { query: { theme: initialTheme } })
    tasksManagerWin.once('ready-to-show', () => {
      if (tasksManagerWin && !tasksManagerWin.isDestroyed()) tasksManagerWin.show()
    })
    tasksManagerWin.on('closed', () => { tasksManagerWin = null })
    return tasksManagerWin
  }

  async function openBitacoraWindow() {
    if (bitacoraWin && !bitacoraWin.isDestroyed()) {
      if (bitacoraWin.isMinimized()) bitacoraWin.restore()
      bitacoraWin.show()
      bitacoraWin.focus()
      return bitacoraWin
    }

    const initialTheme = await readInitialTheme()

    bitacoraWin = new BrowserWindow({
      width: 1040,
      height: 720,
      minWidth: 780,
      minHeight: 500,
      title: 'POWER-AGENT — Bitácora',
      show: false,
      backgroundColor: initialTheme === 'light' ? '#f7f7fb' : '#13131a',
      webPreferences: {
        preload: path.join(rootDir, 'bitacora-window-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    bitacoraWin.loadFile('bitacora-window.html', { query: { theme: initialTheme } })
    bitacoraWin.once('ready-to-show', () => {
      if (bitacoraWin && !bitacoraWin.isDestroyed()) bitacoraWin.show()
    })
    bitacoraWin.on('closed', () => { bitacoraWin = null })
    return bitacoraWin
  }

  function loadWhatsappBounds() {
    try {
      const raw = fs.readFileSync(WA_WIN_BOUNDS_FILE, 'utf-8')
      const b = JSON.parse(raw)
      if (b && Number.isFinite(b.width) && Number.isFinite(b.height)) return b
    } catch {}
    return null
  }

  function saveWhatsappBounds(win) {
    if (!win || win.isDestroyed()) return
    try {
      const b = win.getBounds()
      atomicWriteJsonSync(WA_WIN_BOUNDS_FILE, { x: b.x, y: b.y, width: b.width, height: b.height })
    } catch {}
  }

  function openWhatsappWindow() {
    if (whatsappWindow && !whatsappWindow.isDestroyed()) {
      if (whatsappWindow.isMinimized()) whatsappWindow.restore()
      whatsappWindow.show()
      whatsappWindow.focus()
      return { ok: true, reused: true }
    }
    const saved = loadWhatsappBounds()
    const opts = {
      width: (saved && saved.width) || 980,
      height: (saved && saved.height) || 720,
      minWidth: 640,
      minHeight: 480,
      resizable: true,
      frame: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 13 },
      title: 'POWER-AGENT — WhatsApp',
      backgroundColor: '#1a1a1f',
      webPreferences: {
        preload: path.join(rootDir, 'whatsapp-window-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      opts.x = saved.x
      opts.y = saved.y
    }
    whatsappWindow = new BrowserWindow(opts)
    whatsappWindow.loadFile('whatsapp-window.html')
    const flush = () => saveWhatsappBounds(whatsappWindow)
    whatsappWindow.on('resize', flush)
    whatsappWindow.on('move', flush)
    whatsappWindow.on('close', flush)
    whatsappWindow.on('closed', () => { whatsappWindow = null })
    return { ok: true, reused: false }
  }

  function getWhatsappWindow() { return whatsappWindow }
  function getTasksManagerWin() { return tasksManagerWin }
  function getBitacoraWin() { return bitacoraWin }

  return {
    openViewerWindow,
    openTasksManager,
    openBitacoraWindow,
    openWhatsappWindow,
    getWhatsappWindow,
    getTasksManagerWin,
    getBitacoraWin
  }
}

module.exports = { createWindowFactory }
