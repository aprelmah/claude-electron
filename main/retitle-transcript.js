'use strict'

// Reescritura del transcript JSONL al renombrar una sesión: localizar el
// PRIMER turno user real (saltando Caveat y turnos que solo son bloques <...>)
// y sustituir su texto por el título nuevo, preservando el resto de la línea
// y el trailing newline del fichero. Extraído del ipcMain.handle
// 'update-session-title' para que CI lo cubra (la suite corre sin Electron).

const { extractTurnText } = require('./session-helpers')

function retitleTranscript(raw, nextTitle) {
  const hadTrailingNl = raw.endsWith('\n')
  const lines = raw.split('\n')
  let updated = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj?.type !== 'user' || !obj?.message) continue

    const currentText = extractTurnText(obj).replace(/<[^>]+>/g, '').trim()
    if (!currentText || currentText.startsWith('Caveat:')) continue

    const content = obj.message.content
    if (typeof content === 'string') {
      obj.message.content = nextTitle
    } else if (Array.isArray(content)) {
      let replaced = false
      const nextContent = content.map((block) => {
        if (!replaced && block && typeof block === 'object' && block.type === 'text') {
          replaced = true
          return { ...block, text: nextTitle }
        }
        return block
      })
      if (!replaced) nextContent.unshift({ type: 'text', text: nextTitle })
      obj.message.content = nextContent
    } else {
      obj.message.content = nextTitle
    }

    lines[i] = JSON.stringify(obj)
    updated = true
    break
  }

  if (!updated) return { updated: false, text: null }
  const out = lines.join('\n')
  const text = hadTrailingNl ? (out.endsWith('\n') ? out : `${out}\n`) : out
  return { updated: true, text }
}

module.exports = { retitleTranscript }
