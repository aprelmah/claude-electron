'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { atomicWriteFileSync } = require('./atomic-writes')
const { isPathSafe } = require('./path-sandbox')
const { normalizeBridgeAction, runBridgeControl } = require('./whatsapp-bridge-control')
const waKb = require('../whatsapp/whatsapp-kb')

// Directorio de fichas de la base de conocimiento. Los ids se validan con regex
// y el path se construye SIEMPRE aquí (nunca del renderer): sin traversal posible.
const WA_KB_DIR = path.join(os.homedir(), '.claude', 'whatsapp-bridge', 'kb')

// Whitelist: solo campos seguros editables desde el renderer. claudePath/personaPath
// quedan fijados por el bridge para evitar RCE vía override desde un XSS.
const WA_SAFE_CONFIG_FIELDS = new Set([
  'autoReply',
  'authorizedNumbers',
  'ownerNumber',
  'maxHistory',
  'model',
  'effort',
  'handoverOnFromMe',
  'kbMode',
  'kbAnswerModel',
  'kbEscalateText'
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
    // La decisión (escalera + clasificación benigno/error) vive en
    // whatsapp-bridge-control.js, que sí cubre CI; aquí solo se ejecuta.
    const action = normalizeBridgeAction(actionRaw)
    if (!action) {
      return { ok: false, error: 'Acción inválida', bridge: getBridgeServiceStatus() }
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0
    const domain = `gui/${uid}`
    const serviceTarget = `${domain}/${WA_BRIDGE_LABEL}`
    const client = getClient()

    try {
      const op = runBridgeControl({
        action,
        exec: launchctlExec,
        domain,
        serviceTarget,
        plistPath: WA_BRIDGE_PLIST,
        stopClient: () => { client?.stop?.() },
        startClient: () => { client?.start?.() }
      })
      const bridge = getBridgeServiceStatus()
      // El warning (enable/disable de launchd que falló) NO invalida la
      // operación, pero jamás se queda mudo: sin él el usuario cree que el
      // bridge quedó apagado para siempre y reaparece en el próximo login.
      const warn = op?.warning ? { warning: op.warning } : {}
      if (!op || !op.ok) {
        return { ok: false, error: op?.error || 'Operación fallida', step: op?.step || '', bridge, ...warn }
      }
      return { ok: true, action, step: op.step, bridge, ...warn }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), bridge: getBridgeServiceStatus() }
    }
  })

  ipcMain.handle('whatsapp:get-qr', async () => {
    const client = getClient()
    if (!client) return { qr: null }
    try { return await client.getQr() } catch (err) { return { qr: null, error: err?.message } }
  })

  // ── Base de conocimiento (fichas) ──
  ipcMain.handle('whatsapp:kb-list', () => {
    try {
      return { ok: true, fichas: waKb.loadKbIndex(WA_KB_DIR) }
    } catch (err) {
      return { ok: false, error: err?.message || String(err), fichas: [] }
    }
  })

  ipcMain.handle('whatsapp:kb-get', (_e, id) => {
    try {
      const card = waKb.getKbCard(WA_KB_DIR, id)
      if (!card) return { ok: false, error: 'Ficha no encontrada' }
      return { ok: true, card, sections: waKb.parseCardSections(card.body) }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('whatsapp:kb-save', (_e, payload) => {
    try {
      const p = payload && typeof payload === 'object' ? payload : {}
      let id = String(p.id || '').trim().toLowerCase()
      // Alta (sin id) → el id sale del título y NO puede pisar una ficha ya
      // existente. Edición (con id) → sobrescribir es justo lo que se pide.
      const isNew = !id
      if (isNew) id = waKb.slugifyId(p.titulo)
      if (!waKb.KB_ID_RE.test(id)) return { ok: false, error: 'Título/id no válido' }
      // El editor solo modela Problema + Solución N. Al reconstruir el cuerpo hay
      // que arrastrar las secciones que no sabe pintar (notas internas, avisos,
      // preámbulo) leyéndolas de la ficha que ya está en disco; si no, guardar
      // sin tocar nada las borraba.
      let extra = ''
      if (!isNew) {
        try {
          const prev = waKb.getKbCard(WA_KB_DIR, id)
          if (prev) extra = waKb.parseCardSections(prev.body).extra || ''
        } catch {}
      }
      const body = typeof p.body === 'string' && p.body.trim()
        ? p.body
        : waKb.buildCardBody({ problema: p.problema, soluciones: p.soluciones, extra })
      const saved = waKb.saveKbCard(WA_KB_DIR, {
        id,
        titulo: String(p.titulo || ''),
        sintomas: String(p.sintomas || ''),
        body
      }, { overwrite: !isNew })
      return { ok: true, id: saved.id }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('whatsapp:kb-delete', (_e, id) => {
    try {
      waKb.deleteKbCard(WA_KB_DIR, id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
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
      // Defensa en profundidad: aunque mediaFileNameFromUrl ya aplica
      // path.basename, validamos que sourcePath quede DENTRO de WA_MEDIA_DIR
      // antes de tocar el FS. Si baseName tras decode contiene caracteres
      // raros que escapen del join, isPathSafe lo bloquea.
      const sourcePath = path.join(WA_MEDIA_DIR, baseName)
      if (!isPathSafe(sourcePath, [WA_MEDIA_DIR])) {
        return { ok: false, error: 'Path not allowed' }
      }
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
    // Validar PRIMERO el path: ni siquiera tocamos el FS con un path
    // potencialmente malicioso (evita TOCTOU y side-channels de existsSync).
    // Roots intencionalmente más estrictos que allowedFsRoots(): el audio
    // legítimo siempre vive en WA_MEDIA_DIR o TMP_DIR.
    if (typeof mediaPath !== 'string' || !mediaPath) {
      return { ok: false, error: 'Path inválido' }
    }
    if (!isPathSafe(mediaPath, [WA_MEDIA_DIR, TMP_DIR])) {
      return { ok: false, error: 'Path not allowed' }
    }
    if (!fs.existsSync(mediaPath)) return { ok: false, error: 'archivo no existe' }
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
