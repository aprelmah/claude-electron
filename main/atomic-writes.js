const fs = require('fs')
const path = require('path')

function tmpName(target) {
  return `${target}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
}

// SEC-H1: opts.mode permite forzar permisos 0o600 para archivos con secretos
// (config con tokens Telegram, claves, etc.). Sin opts, mantiene comportamiento.
function atomicWriteFileSync(target, data, encoding, opts) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = tmpName(target)
  const writeOpts = {}
  if (encoding) writeOpts.encoding = encoding
  if (opts && typeof opts === 'object' && typeof opts.mode === 'number') writeOpts.mode = opts.mode
  if (Object.keys(writeOpts).length === 0) {
    fs.writeFileSync(tmp, data)
  } else if (writeOpts.encoding && writeOpts.mode !== undefined) {
    fs.writeFileSync(tmp, data, writeOpts)
  } else if (writeOpts.encoding) {
    fs.writeFileSync(tmp, data, writeOpts.encoding)
  } else {
    fs.writeFileSync(tmp, data, writeOpts)
  }
  try {
    fs.renameSync(tmp, target)
    // rename preserva mode del tmp; aún así re-chmod por seguridad si está pedido.
    if (opts && typeof opts.mode === 'number') {
      try { fs.chmodSync(target, opts.mode) } catch {}
    }
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch {}
    throw err
  }
}

function atomicWriteJsonSync(target, obj, opts) {
  atomicWriteFileSync(target, JSON.stringify(obj, null, 2), 'utf-8', opts)
}

// PERF-H8: versión async para no bloquear main process en archivos grandes
// (ej. transcripts JSONL multi-MB). Misma semántica que la sync (tmp + rename).
async function atomicWriteFileAsync(target, data, encoding, opts) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  const tmp = tmpName(target)
  const writeOpts = {}
  if (encoding) writeOpts.encoding = encoding
  if (opts && typeof opts === 'object' && typeof opts.mode === 'number') writeOpts.mode = opts.mode
  try {
    await fs.promises.writeFile(tmp, data, Object.keys(writeOpts).length ? writeOpts : undefined)
    await fs.promises.rename(tmp, target)
    if (opts && typeof opts.mode === 'number') {
      try { await fs.promises.chmod(target, opts.mode) } catch {}
    }
  } catch (err) {
    try { await fs.promises.unlink(tmp) } catch {}
    throw err
  }
}

async function atomicWriteJsonAsync(target, obj, opts) {
  await atomicWriteFileAsync(target, JSON.stringify(obj, null, 2), 'utf-8', opts)
}

module.exports = {
  atomicWriteFileSync,
  atomicWriteJsonSync,
  atomicWriteFileAsync,
  atomicWriteJsonAsync
}
