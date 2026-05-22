'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { isPathSafe } = require('./path-sandbox')
const { computeProjectGraph } = require('./graph-builder')

function registerViewerGraphIpc({
  ipcMain,
  BrowserWindow,
  rootDir,
  getSessionByEvent,
  getCwdSync,
  getPrimaryWin,
  getAllowedFsRoots,
  openViewerWindow
}) {
  let graphWindowData = null

  ipcMain.handle('graph-window:open', (event, payload = {}) => {
    const {
      nodes, edges, dirs, mode, activeTypes, forces, ui, structureActiveTypes,
      selfFetch, rootPath
    } = payload || {}
    let cwd = null
    const payloadRoot = (typeof rootPath === 'string' && rootPath.trim()) ? rootPath.trim() : null
    if (payloadRoot) {
      cwd = payloadRoot
    } else {
      try {
        const s = getSessionByEvent(event)
        cwd = s ? s.cwd : null
      } catch { cwd = null }
      if (!cwd) cwd = getCwdSync() || os.homedir()
    }
    try {
      if (!cwd || !fs.existsSync(cwd)) cwd = getCwdSync() || os.homedir()
    } catch {
      cwd = getCwdSync() || os.homedir()
    }
    if (selfFetch) {
      graphWindowData = {
        nodes: [], edges: [], dirs: [],
        mode: mode || 'refs',
        activeTypes: activeTypes || null,
        structureActiveTypes: structureActiveTypes || null,
        forces: forces || null,
        ui: ui || null,
        cwd: cwd || '',
        selfFetch: true
      }
    } else {
      graphWindowData = {
        nodes: nodes || [], edges: edges || [], dirs: dirs || [],
        mode: mode || 'refs',
        activeTypes: activeTypes || null,
        structureActiveTypes: structureActiveTypes || null,
        forces: forces || null,
        ui: ui || null,
        cwd: cwd || '',
        selfFetch: false
      }
    }
    const win = new BrowserWindow({
      width: 1200, height: 800,
      frame: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 13 },
      backgroundColor: '#1a1a1f',
      resizable: true, minimizable: true,
      title: 'POWER-AGENT — Grafo',
      webPreferences: {
        preload: path.join(rootDir, 'graph-window-preload.js'),
        contextIsolation: true, nodeIntegration: false
      }
    })
    win.loadFile('graph-window.html')
    win.on('closed', () => { graphWindowData = null })
    return true
  })

  ipcMain.handle('graph-window:get-data', () => graphWindowData || { nodes: [], edges: [], dirs: [] })

  ipcMain.handle('graph-window:fetch-graph', (_event, rootPathArg) => {
    let root = (typeof rootPathArg === 'string' && rootPathArg) ? rootPathArg : null
    if (!root) root = getCwdSync() || null
    if (!root) return { ok: false, error: 'No hay carpeta activa para calcular el grafo' }
    try {
      if (!fs.existsSync(root)) return { ok: false, error: `La ruta no existe: ${root}` }
    } catch (err) { return { ok: false, error: err.message } }
    try {
      const result = computeProjectGraph(root)
      if (result && result.ok) result.cwd = root
      return result
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('viewer-open', (_event, arg) => {
    const filePath = typeof arg === 'string' ? arg : arg?.path
    const hint = (arg && typeof arg === 'object') ? arg.hint : null
    if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'Invalid path' }
    if (!isPathSafe(filePath, getAllowedFsRoots())) return { ok: false, error: 'Path not allowed' }
    openViewerWindow(filePath, hint)
    return { ok: true }
  })

  ipcMain.on('viewer-inject-to-active', (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return
    const primaryWin = getPrimaryWin?.()
    if (!primaryWin || primaryWin.isDestroyed()) return
    primaryWin.webContents.send('inject-path', filePath)
  })

  ipcMain.on('viewer-close-self', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.close()
  })

  ipcMain.on('viewer-minimize-self', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.minimize()
  })
}

module.exports = { registerViewerGraphIpc }
