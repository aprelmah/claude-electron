'use strict'

// Detecta que un CLI acaba de autoactualizarse dentro del PTY.
//
// Codex, al elegir "1. Update now", corre `npm install -g @openai/codex`,
// imprime "Update ran successfully! Please restart Codex." y se cierra. Sin
// esto el PTY muere y la app manda al picker de sesión, como si el usuario
// hubiera salido. Con esto, main.js relanza la misma sesión.

const UPDATE_DONE_MARKERS = [
  /Update ran successfully/i
]

// Solape entre chunks: el marcador puede llegar partido en dos `onData`.
const TAIL_CHARS = 256
const PENDING_WINDOW_MS = 5 * 60 * 1000
const RESTART_WINDOW_MS = 10 * 60 * 1000

function createCliUpdateWatcher({
  now = Date.now,
  pendingWindowMs = PENDING_WINDOW_MS,
  restartWindowMs = RESTART_WINDOW_MS,
  maxRestarts = 1
} = {}) {
  const byKey = new Map()

  function entry(key) {
    let st = byKey.get(key)
    if (!st) {
      st = { tail: '', pendingAt: 0, restarts: [] }
      byKey.set(key, st)
    }
    return st
  }

  // Devuelve true la primera vez que ve el marcador de update completado.
  function observe(key, data) {
    if (key === undefined || key === null || !data) return false
    const st = entry(key)
    const text = st.tail + String(data)
    st.tail = text.slice(-TAIL_CHARS)
    if (!UPDATE_DONE_MARKERS.some((re) => re.test(text))) return false
    const already = st.pendingAt > 0
    st.pendingAt = now()
    return !already
  }

  // Consume el aviso: true si el PTY debe relanzarse en vez de dar por
  // terminada la sesión. Limita reinicios para no entrar en bucle si el CLI
  // muere una y otra vez tras actualizarse.
  function takeRestart(key) {
    const st = byKey.get(key)
    if (!st || !st.pendingAt) return false
    const t = now()
    const fresh = (t - st.pendingAt) <= pendingWindowMs
    st.pendingAt = 0
    if (!fresh) return false
    st.restarts = st.restarts.filter((ts) => (t - ts) <= restartWindowMs)
    if (st.restarts.length >= maxRestarts) return false
    st.restarts.push(t)
    return true
  }

  function forget(key) {
    byKey.delete(key)
  }

  return { observe, takeRestart, forget }
}

module.exports = { createCliUpdateWatcher, UPDATE_DONE_MARKERS }
