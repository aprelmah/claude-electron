'use strict'

function registerWindowControlsIpc({
  ipcMain,
  winFromEvent,
  getSessions,
  createWindow
}) {
  ipcMain.on('window-close', (event) => {
    const w = winFromEvent(event)
    if (!w) return
    // decision: hide solo si es la única ventana (preserva comportamiento previo); con múltiples, close.
    if (getSessions().size > 1) w.close()
    else w.hide()
  })

  ipcMain.on('window-minimize', (event) => {
    winFromEvent(event)?.minimize()
  })

  ipcMain.on('window-toggle-maximize', (event) => {
    const w = winFromEvent(event)
    if (!w) return
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })

  ipcMain.on('window-toggle-pin', (event) => {
    const w = winFromEvent(event)
    if (!w) return
    w.setAlwaysOnTop(!w.isAlwaysOnTop())
  })

  ipcMain.handle('is-pinned', (event) => {
    return winFromEvent(event)?.isAlwaysOnTop() ?? false
  })

  ipcMain.on('window-new', () => {
    createWindow()
  })
}

module.exports = { registerWindowControlsIpc }
