'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function registerBitacoraIpc({
  ipcMain,
  dialog,
  semanticLogger,
  winFromEvent,
  getBitacoraWin,
  openBitacoraWindow
}) {
  ipcMain.handle('bitacora:open', async () => {
    const win = await openBitacoraWindow()
    return { ok: !!win }
  })

  ipcMain.handle('bitacora:list', (_event, payload = {}) => {
    const limit = Number(payload?.limit) || 500
    const entries = semanticLogger.readRecent({ limit: Math.max(1, Math.min(limit, 5000)) })
    return { ok: true, entries, filePath: semanticLogger.filePath }
  })

  ipcMain.handle('bitacora:export-csv', async (event, payload = {}) => {
    try {
      const fallbackEntries = semanticLogger.readRecent({ limit: 500 })
      const entries = Array.isArray(payload?.entries) ? payload.entries : fallbackEntries
      const csv = semanticLogger.toCsv(entries)
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const suggested = payload?.name ? String(payload.name) : `power-agent-log-${stamp}.csv`
      const parent = winFromEvent(event) || getBitacoraWin() || undefined
      const save = await dialog.showSaveDialog(parent, {
        title: 'Exportar Bitácora CSV',
        defaultPath: path.join(os.homedir(), suggested),
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (save.canceled || !save.filePath) return { ok: false, cancelled: true }
      fs.writeFileSync(save.filePath, csv, 'utf-8')
      return { ok: true, path: save.filePath, count: entries.length }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerBitacoraIpc }
