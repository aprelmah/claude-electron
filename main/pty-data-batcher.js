'use strict'

// PERF-H6: batcher de pty-data hacia el renderer IPC.
// Acumula chunks pequeños y los envía cuando supera FLUSH_BYTES o pasa
// FLUSH_MS desde el primer chunk encolado. El estado vive en una propiedad
// `_ptyBuf` del objeto sesión que se pase.

const DEFAULT_FLUSH_BYTES = 8 * 1024
const DEFAULT_FLUSH_MS = 16

function createPtyDataBatcher(opts = {}) {
  const flushBytes = Number.isFinite(opts.flushBytes) && opts.flushBytes > 0
    ? opts.flushBytes
    : DEFAULT_FLUSH_BYTES
  const flushMs = Number.isFinite(opts.flushMs) && opts.flushMs > 0
    ? opts.flushMs
    : DEFAULT_FLUSH_MS
  const setTimeoutFn = typeof opts.setTimeoutFn === 'function' ? opts.setTimeoutFn : setTimeout
  const clearTimeoutFn = typeof opts.clearTimeoutFn === 'function' ? opts.clearTimeoutFn : clearTimeout
  const sendFn = typeof opts.sendFn === 'function' ? opts.sendFn : null
  // sendFn(session, payload) — null = usa session.win.webContents.send('pty-data', payload)

  function dispatch(session, payload) {
    if (sendFn) { sendFn(session, payload); return }
    try {
      if (session?.win && !session.win.isDestroyed?.()) {
        session.win.webContents.send('pty-data', payload)
      }
    } catch {}
  }

  function enqueue(session, data) {
    if (!session) return
    if (session.win && session.win.isDestroyed?.()) return
    const text = typeof data === 'string' ? data : (data?.toString?.('utf8') || '')
    if (!text) return
    if (!session._ptyBuf) {
      session._ptyBuf = { parts: [], bytes: 0, timer: null }
    }
    const buf = session._ptyBuf
    buf.parts.push(text)
    buf.bytes += text.length
    if (buf.bytes >= flushBytes) {
      flush(session)
      return
    }
    if (!buf.timer) {
      buf.timer = setTimeoutFn(() => flush(session), flushMs)
      try { buf.timer.unref?.() } catch {}
    }
  }

  function flush(session) {
    const buf = session?._ptyBuf
    if (!buf) return
    if (buf.timer) { try { clearTimeoutFn(buf.timer) } catch {} ; buf.timer = null }
    if (!buf.parts.length) return
    const payload = buf.parts.join('')
    buf.parts = []
    buf.bytes = 0
    dispatch(session, payload)
  }

  return { enqueue, flush, flushBytes, flushMs }
}

module.exports = { createPtyDataBatcher, DEFAULT_FLUSH_BYTES, DEFAULT_FLUSH_MS }
