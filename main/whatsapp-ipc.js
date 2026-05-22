'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
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

const WA_BRIDGE_LABEL = 'com.luismi.whatsapp-bridge'
const WA_BRIDGE_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${WA_BRIDGE_LABEL}.plist`)

function launchctlExec(args) {
  const run = spawnSync('launchctl', args, { encoding: 'utf8' })
  return {
    ok: !run.error && run.status === 0,
    status: Number(run.status ?? -1),
    stdout: String(run.stdout || ''),
    stderr: String(run.stderr || ''),
    error: run.error ? (run.error.message || String(run.error)) : ''
  }
}

function parseLaunchctlListLine(line) {
  const parts = String(line || '').trim().split(/\s+/g)
  if (parts.length < 3) return null
  const label = parts[parts.length - 1]
  const pidToken = parts[0]
  const statusToken = parts[1]
  const pid = /^\d+$/.test(pidToken) ? Number(pidToken) : 0
  const lastExit = /^-?\d+$/.test(statusToken) ? Number(statusToken) : null
  return { label, pid, lastExit }
}

function getBridgeServiceStatus() {
  const run = launchctlExec(['list'])
  if (!run.ok) {
    const detail = run.error || run.stderr || `launchctl exit ${run.status}`
    return {
      ok: false,
      label: WA_BRIDGE_LABEL,
      loaded: false,
      running: false,
      pid: 0,
      lastExit: null,
      detail: String(detail || '').slice(0, 240)
    }
  }

  const line = run.stdout
    .split('\n')
    .map((v) => v.trim())
    .find((v) => v.endsWith(` ${WA_BRIDGE_LABEL}`) || v.endsWith(`\t${WA_BRIDGE_LABEL}`))

  if (!line) {
    return {
      ok: true,
      label: WA_BRIDGE_LABEL,
      loaded: false,
      running: false,
      pid: 0,
      lastExit: null,
      detail: 'Servicio no cargado en launchd'
    }
  }

  const parsed = parseLaunchctlListLine(line)
  const pid = parsed?.pid || 0
  const lastExit = parsed?.lastExit ?? null
  return {
    ok: true,
    label: WA_BRIDGE_LABEL,
    loaded: true,
    running: pid > 0,
    pid,
    lastExit,
    detail: pid > 0 ? `PID ${pid}` : `Cargado (exit ${lastExit == null ? '-' : lastExit})`
  }
}

function isBenignBootoutFailure(message) {
  const s = String(message || '').toLowerCase()
  return s.includes('could not find') || s.includes('no such process') || s.includes('not loaded')
}

function isBenignBootstrapFailure(message) {
  const s = String(message || '').toLowerCase()
  return s.includes('already') || s.includes('in progress') || s.includes('input/output error')
}

function mediaFileNameFromUrl(mediaUrl) {
  const raw = String(mediaUrl || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'wa-media:') return ''
    const name = decodeURIComponent(u.hostname || u.pathname.replace(/^\/+/, ''))
    return path.basename(name || '')
  } catch {
    if (!raw.toLowerCase().startsWith('wa-media://')) return ''
    const stripped = raw.replace(/^wa-media:\/\//i, '').split(/[?#]/)[0] || ''
    try { return path.basename(decodeURIComponent(stripped)) } catch { return path.basename(stripped) }
  }
}

function registerWhatsappIpc({
  ipcMain,
  dialog,
  winFromEvent,
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

  ipcMain.handle('whatsapp:bridge-status', async () => {
    return getBridgeServiceStatus()
  })

  ipcMain.handle('whatsapp:bridge-control', async (_e, actionRaw) => {
    const action = String(actionRaw || '').trim().toLowerCase()
    if (!['start', 'stop', 'restart'].includes(action)) {
      return { ok: false, error: 'Acción inválida', bridge: getBridgeServiceStatus() }
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0
    const domain = `gui/${uid}`
    const serviceTarget = `${domain}/${WA_BRIDGE_LABEL}`
    const client = getClient()

    function stopClientSafe() {
      try { client?.stop?.() } catch {}
    }
    function startClientSafe() {
      try { client?.start?.() } catch {}
    }

    function stopService() {
      stopClientSafe()
      const byLabel = launchctlExec(['bootout', serviceTarget])
      if (byLabel.ok) return { ok: true, step: 'bootout-label', run: byLabel }
      const msg1 = `${byLabel.error || ''} ${byLabel.stderr || ''}`.trim()
      if (isBenignBootoutFailure(msg1)) return { ok: true, step: 'bootout-label-benign', run: byLabel }
      const byPlist = launchctlExec(['bootout', domain, WA_BRIDGE_PLIST])
      if (byPlist.ok) return { ok: true, step: 'bootout-plist', run: byPlist }
      const msg2 = `${byPlist.error || ''} ${byPlist.stderr || ''}`.trim()
      if (isBenignBootoutFailure(msg2)) return { ok: true, step: 'bootout-plist-benign', run: byPlist }
      return { ok: false, step: 'bootout-failed', run: byPlist, error: msg2 || msg1 || 'bootout failed' }
    }

    function startService() {
      const bootstrap = launchctlExec(['bootstrap', domain, WA_BRIDGE_PLIST])
      const bootstrapMsg = `${bootstrap.error || ''} ${bootstrap.stderr || ''}`.trim()
      if (!bootstrap.ok && !isBenignBootstrapFailure(bootstrapMsg)) {
        return { ok: false, step: 'bootstrap-failed', run: bootstrap, error: bootstrapMsg || 'bootstrap failed' }
      }
      const kickstart = launchctlExec(['kickstart', '-k', serviceTarget])
      if (!kickstart.ok) {
        const msg = `${kickstart.error || ''} ${kickstart.stderr || ''}`.trim()
        return { ok: false, step: 'kickstart-failed', run: kickstart, error: msg || 'kickstart failed' }
      }
      startClientSafe()
      return { ok: true, step: 'kickstart', run: kickstart }
    }

    try {
      let op = null
      if (action === 'stop') op = stopService()
      else if (action === 'start') op = startService()
      else {
        const stopped = stopService()
        if (!stopped.ok) op = stopped
        else op = startService()
      }
      const bridge = getBridgeServiceStatus()
      if (!op || !op.ok) {
        return { ok: false, error: op?.error || 'Operación fallida', step: op?.step || '', bridge }
      }
      return { ok: true, action, step: op.step, bridge }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), bridge: getBridgeServiceStatus() }
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

  ipcMain.handle('whatsapp:save-media-as', async (event, mediaUrl, suggestedName) => {
    try {
      if (!dialog || typeof dialog.showSaveDialog !== 'function') {
        return { ok: false, error: 'Save dialog no disponible' }
      }
      const baseName = mediaFileNameFromUrl(mediaUrl)
      if (!baseName) return { ok: false, error: 'URL de media inválida' }
      const sourcePath = path.join(WA_MEDIA_DIR, baseName)
      if (!fs.existsSync(sourcePath)) return { ok: false, error: `Media no encontrada: ${baseName}` }

      const sourceExt = path.extname(baseName)
      let desired = path.basename(String(suggestedName || '').trim())
      if (!desired) desired = baseName
      if (!path.extname(desired) && sourceExt) desired += sourceExt
      const defaultPath = path.join(os.homedir(), 'Downloads', desired)

      const save = await dialog.showSaveDialog(winFromEvent ? winFromEvent(event) : undefined, {
        defaultPath,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (save.canceled || !save.filePath) return { ok: false, canceled: true }

      fs.copyFileSync(sourcePath, save.filePath)
      return { ok: true, path: save.filePath, name: path.basename(save.filePath) }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('whatsapp:request-phone', async (_e, jid) => {
    try { return await requireWhatsapp().requestPhone(jid, { changeModeToManual: true }) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:set-mode', (_e, jid, mode) => {
    try { return requireWhatsapp().setMode(jid, mode) }
    catch (err) { return { ok: false, error: err?.message || String(err) } }
  })

  ipcMain.handle('whatsapp:set-mode-all-auto', () => {
    try { return requireWhatsapp().setAllIndividualChatsAuto() }
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
