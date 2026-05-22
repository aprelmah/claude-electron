'use strict'

// Polling de /tmp/poweragent-proposal-*.json y emisión a renderers.
// Las funciones de este módulo no conocen Electron; reciben:
//   - emitToRenderers(payload) → manda 'proposal:new' a las ventanas vivas.
//   - broadcastCleared({id,state}) → manda 'proposal:cleared'.

const fs = require('fs')
const path = require('path')

function createAgentProposalWatcher({
  baseDir,
  filePrefix,
  fileSuffix,
  pollMs,
  emitToRenderers,
  broadcastCleared
}) {
  let pendingProposal = null
  let pollId = null

  function sanitizeProposalIdForFilename(id) {
    const cleaned = String(id || '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 140)
    if (cleaned) return cleaned
    return `proposal-${Date.now()}`
  }

  function guessProposalIdFromFile(filePath) {
    const name = path.basename(String(filePath || ''))
    if (!name.startsWith(filePrefix) || !name.endsWith(fileSuffix)) return ''
    return name
      .slice(filePrefix.length, name.length - fileSuffix.length)
      .trim()
  }

  function buildProposalMarkerPath(id, state) {
    const suffix = state === 'approved' ? 'approved' : 'rejected'
    return path.join(baseDir, `${filePrefix}${sanitizeProposalIdForFilename(id)}-${suffix}`)
  }

  function serializeForRenderer(proposal) {
    if (!proposal) return null
    return {
      id: String(proposal.id || '').trim(),
      title: String(proposal.title || '').trim(),
      description: String(proposal.description || '').trim(),
      command: String(proposal.command || '').trim(),
      script_path: String(proposal.script_path || '').trim(),
      script_preview: typeof proposal.script_preview === 'string' ? proposal.script_preview : ''
    }
  }

  function normalizeProposalPayload(raw, sourcePath = '') {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'payload inválido' }
    const id = String(raw.id || guessProposalIdFromFile(sourcePath) || '').trim()
    const title = String(raw.title || '').trim()
    const description = String(raw.description || '').trim()
    const command = String(raw.command || '').trim()
    const scriptPath = String(raw.script_path || '').trim()
    const scriptPreview = typeof raw.script_preview === 'string' ? raw.script_preview : ''
    if (!id) return { ok: false, error: 'id requerido' }
    if (!command) return { ok: false, error: 'command requerido' }
    return {
      ok: true,
      proposal: {
        id,
        title: title || 'Propuesta pendiente',
        description,
        command,
        script_path: scriptPath,
        script_preview: scriptPreview.slice(0, 200000)
      }
    }
  }

  function pickNextProposalFile() {
    let names = []
    try { names = fs.readdirSync(baseDir) } catch { return null }
    const files = []
    for (const name of names) {
      if (!name.startsWith(filePrefix) || !name.endsWith(fileSuffix)) continue
      const full = path.join(baseDir, name)
      let stat = null
      try { stat = fs.statSync(full) } catch { continue }
      if (!stat || !stat.isFile()) continue
      files.push({ full, mtimeMs: Number(stat.mtimeMs || 0), name })
    }
    if (!files.length) return null
    files.sort((a, b) => (a.mtimeMs - b.mtimeMs) || a.name.localeCompare(b.name))
    return files[0].full
  }

  function pause() {
    if (!pollId) return
    try { clearInterval(pollId) } catch {}
    pollId = null
  }

  function detect() {
    if (pendingProposal) return
    const filePath = pickNextProposalFile()
    if (!filePath) return

    let raw = null
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (err) {
      console.warn('[proposal] invalid JSON:', filePath, err?.message || err)
      const markerPath = buildProposalMarkerPath(guessProposalIdFromFile(filePath), 'rejected')
      try { fs.writeFileSync(markerPath, '') } catch {}
      try { fs.unlinkSync(filePath) } catch {}
      return
    }

    const normalized = normalizeProposalPayload(raw, filePath)
    if (!normalized.ok) {
      console.warn('[proposal] malformed payload:', filePath, normalized.error)
      const markerPath = buildProposalMarkerPath(raw?.id || guessProposalIdFromFile(filePath), 'rejected')
      try { fs.writeFileSync(markerPath, '') } catch {}
      try { fs.unlinkSync(filePath) } catch {}
      return
    }

    pendingProposal = {
      ...normalized.proposal,
      filePath,
      detectedAt: Date.now()
    }
    pause()
    try { emitToRenderers(serializeForRenderer(pendingProposal)) } catch {}
  }

  function start() {
    if (pollId || pendingProposal) return
    pollId = setInterval(() => {
      try { detect() } catch (err) {
        console.error('[proposal] poll failed:', err?.message || err)
      }
    }, pollMs)
    pollId.unref?.()
    detect()
  }

  function resume() {
    if (pendingProposal) return
    start()
  }

  function finalize(state) {
    if (!pendingProposal) return { ok: false, error: 'No hay propuesta pendiente' }
    const current = pendingProposal
    const markerPath = buildProposalMarkerPath(current.id, state)
    try { fs.writeFileSync(markerPath, '') } catch (err) {
      console.error('[proposal] marker write failed:', err?.message || err)
    }
    if (current.filePath) {
      try { fs.unlinkSync(current.filePath) } catch {}
    }
    pendingProposal = null
    try { broadcastCleared({ id: current.id, state }) } catch {}
    resume()
    return { ok: true, markerPath }
  }

  function getPending() { return pendingProposal }
  function setPending(value) { pendingProposal = value }

  function syncToWindow(win) {
    if (!pendingProposal || !win || win.isDestroyed?.()) return
    try {
      win.webContents.send('proposal:new', serializeForRenderer(pendingProposal))
    } catch {}
  }

  return {
    start,
    pause,
    resume,
    detect,
    finalize,
    getPending,
    setPending,
    syncToWindow,
    serializeForRenderer,
    sanitizeProposalIdForFilename,
    guessProposalIdFromFile,
    buildProposalMarkerPath
  }
}

module.exports = { createAgentProposalWatcher }
