'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { atomicWriteFileSync } = require('./atomic-writes')
const { isPathSafe } = require('./path-sandbox')

// Whitelist: solo campos seguros editables desde el renderer. claudePath/personaPath
// quedan fijados por el bridge para evitar RCE vía override desde un XSS.
const WA_SAFE_CONFIG_FIELDS = new Set([
  'autoReply',
  'authorizedNumbers',
  'ownerNumber',
  'maxHistory',
  'model',
  'effort',
  'handoverOnFromMe'
])

function registerWhatsappIpc({
  ipcMain,
  getClient,
  getClientLoadError,
  getReachable,
  getAllowedFsRoots,
  transcribeAudioFile,
  buildRuntimeEnv,
  WA_CONFIG_PATH,
  WA_MEDIA_DIR,
  TMP_DIR
}) {
  function requireWhatsapp() {
    const client = getClient()
    if (!client) {
      const err = getClientLoadError()
      const detail = err?.message ? ` (${err.message})` : ''
      throw new Error(`WhatsApp client no inicializado${detail}`)
    }
    return client
  }

  ipcMain.handle('whatsapp:status', async () => {
    const client = getClient()
    if (!client) {
      const err = getClientLoadError()
      return {
        connected: false,
        qrPresent: false,
        reachable: false,
        ownerNumber: '',
        authorizedNumbers: [],
        autoReply: false,
        error: err?.message || null
      }
    }
    try {
      const s = await client.getStatus()
      return { ...s, reachable: getReachable() }
    } catch (err) {
      return { connected: false, qrPresent: false, reachable: false, error: err?.message }
    }
  })

  ipcMain.handle('whatsapp:get-qr', async () => {
    const client = getClient()
    if (!client) return { qr: null }
    try { return await client.getQr() } catch (err) { return { qr: null, error: err?.message } }
  })

  ipcMain.handle('whatsapp:get-chats', () => {
    const client = getClient()
    if (!client) return []
    try { return client.getChats() } catch { return [] }
  })

  ipcMain.handle('whatsapp:get-history', (_e, jid, opts = {}) => {
    const client = getClient()
    if (!client) return []
    try { return client.getHistory(jid, opts || {}) } catch { return [] }
  })

  ipcMain.handle('whatsapp:send-text', async (_e, jid, text, opts) => {
    try { return await requireWhatsapp().sendText(jid, text, opts || {}) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  // Sandbox para envío de media: aceptamos data URL inline (base64 puro, no
  // toca FS) o filePath dentro de roots permitidos. Sin esto, un XSS podría
  // hacer "whatsapp:send-image('victima', '~/.ssh/id_rsa')".
  function isMediaInputSafe(input) {
    if (typeof input !== 'string' || !input) return false
    if (input.startsWith('data:')) return true
    return isPathSafe(input, getAllowedFsRoots())
  }

  ipcMain.handle('whatsapp:send-image', async (_e, jid, filePath, caption) => {
    if (!isMediaInputSafe(filePath)) return { ok: false, error: 'Path not allowed' }
    try { return await requireWhatsapp().sendMedia(jid, filePath, 'image', { caption: caption || '' }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:send-audio', async (_e, jid, filePath, ptt) => {
    if (!isMediaInputSafe(filePath)) return { ok: false, error: 'Path not allowed' }
    try { return await requireWhatsapp().sendMedia(jid, filePath, 'audio', { ptt: ptt !== false }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:send-document', async (_e, jid, filePath, caption) => {
    if (!isMediaInputSafe(filePath)) return { ok: false, error: 'Path not allowed' }
    try { return await requireWhatsapp().sendMedia(jid, filePath, 'document', { caption: caption || '' }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:request-phone', async (_e, jid) => {
    try { return await requireWhatsapp().requestPhone(jid, { changeModeToManual: true }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:set-mode', (_e, jid, mode) => {
    try { return requireWhatsapp().setMode(jid, mode) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:mark-read', (_e, jid) => {
    try { return requireWhatsapp().markRead(jid) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:get-config', () => {
    try { return requireWhatsapp().getConfig() }
    catch { try { return JSON.parse(fs.readFileSync(WA_CONFIG_PATH, 'utf-8')) } catch { return {} } }
  })

  ipcMain.handle('whatsapp:save-config', (_e, partial) => {
    try {
      const sanitized = {}
      if (partial && typeof partial === 'object') {
        for (const k of Object.keys(partial)) {
          if (WA_SAFE_CONFIG_FIELDS.has(k)) sanitized[k] = partial[k]
        }
      }
      return { ok: true, config: requireWhatsapp().updateConfig(sanitized) }
    } catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:transcribe-audio', async (_e, mediaPath) => {
    if (!mediaPath || !fs.existsSync(mediaPath)) return { ok: false, error: 'archivo no existe' }
    if (!isPathSafe(mediaPath, [WA_MEDIA_DIR, TMP_DIR])) return { ok: false, error: 'Path not allowed' }
    try {
      const text = await transcribeAudioFile(mediaPath, buildRuntimeEnv())
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('whatsapp:get-persona', () => {
    const personaPath = path.join(os.homedir(), '.claude', 'whatsapp-bridge', 'persona.md')
    const personaRoot = path.join(os.homedir(), '.claude', 'whatsapp-bridge')
    try {
      let resolved = personaPath
      try {
        const client = getClient()
        const cfg = client?.getConfig?.()
        if (cfg && typeof cfg.personaPath === 'string' && cfg.personaPath.trim()) {
          const candidate = cfg.personaPath.trim()
          if (isPathSafe(candidate, [personaRoot])) resolved = candidate
        }
      } catch {}
      if (!fs.existsSync(resolved)) {
        return { ok: false, error: `No existe: ${resolved}`, path: resolved }
      }
      const text = fs.readFileSync(resolved, 'utf-8')
      const stat = fs.statSync(resolved)
      return { ok: true, text, path: resolved, mtime: stat.mtimeMs }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), path: personaPath }
    }
  })

  ipcMain.handle('whatsapp:save-persona', (_e, text) => {
    const personaPath = path.join(os.homedir(), '.claude', 'whatsapp-bridge', 'persona.md')
    const personaRoot = path.join(os.homedir(), '.claude', 'whatsapp-bridge')
    try {
      let resolved = personaPath
      try {
        const client = getClient()
        const cfg = client?.getConfig?.()
        if (cfg && typeof cfg.personaPath === 'string' && cfg.personaPath.trim()) {
          const candidate = cfg.personaPath.trim()
          if (isPathSafe(candidate, [personaRoot])) resolved = candidate
        }
      } catch {}
      if (typeof text !== 'string') return { ok: false, error: 'Texto inválido' }
      atomicWriteFileSync(resolved, text, 'utf-8')
      const stat = fs.statSync(resolved)
      return { ok: true, path: resolved, mtime: stat.mtimeMs }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), path: personaPath }
    }
  })
}

module.exports = {
  registerWhatsappIpc,
  WA_SAFE_CONFIG_FIELDS
}
