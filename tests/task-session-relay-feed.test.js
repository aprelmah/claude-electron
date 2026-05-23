'use strict'

// Regresión: cuando un task-session oculto (pool de Telegram) está enlazado
// como relay PTY, el handler proc.onData del task-session DEBE invocar
// st.relayListener con cada chunk. Sin esto, relayThroughPty nunca ve output
// del PTY y devuelve "falló la lectura de respuesta del PTY".
//
// Reproducimos el patrón del handler en main.js:startTaskSessionPty para
// asegurar el contrato.

const test = require('node:test')
const assert = require('node:assert/strict')

function makeTaskState(initialRelayListener = null) {
  return {
    pty: { _alive: true },
    win: { isDestroyed: () => false, webContents: { sent: [], send(ch, d) { this.sent.push({ ch, d }) } } },
    relayListener: initialRelayListener,
    relayCancel: null,
    relayActive: false
  }
}

// Réplica de la lógica del onData del task-session.
function taskOnDataHandler(getState, proc) {
  return (data) => {
    if (!proc._alive) return
    const st = getState()
    if (!st) return
    const text = typeof data === 'string' ? data : data.toString('utf8')
    if (st.relayListener) {
      try { st.relayListener(text) } catch {}
    }
    if (!st.win || st.win.isDestroyed()) return
    st.win.webContents.send('task-session:data', text)
  }
}

test('task-session onData alimenta a relayListener cuando hay relay activo', () => {
  const received = []
  const state = makeTaskState((chunk) => received.push(chunk))
  state.relayActive = true
  const proc = { _alive: true }
  const onData = taskOnDataHandler(() => state, proc)

  onData('hola desde claude\n')
  onData(Buffer.from('respuesta turno actual'))

  assert.deepEqual(received, ['hola desde claude\n', 'respuesta turno actual'])
  // Espejo a la ventana también funciona en paralelo.
  assert.equal(state.win.webContents.sent.length, 2)
})

test('task-session onData no rompe cuando relayListener es null', () => {
  const state = makeTaskState(null)
  const proc = { _alive: true }
  const onData = taskOnDataHandler(() => state, proc)

  assert.doesNotThrow(() => onData('algo'))
  assert.equal(state.win.webContents.sent.length, 1)
})

test('task-session onData absorbe errores del relayListener sin tirar el handler', () => {
  const state = makeTaskState(() => { throw new Error('listener boom') })
  const proc = { _alive: true }
  const onData = taskOnDataHandler(() => state, proc)

  assert.doesNotThrow(() => onData('data'))
  // El espejo a la ventana sigue funcionando.
  assert.equal(state.win.webContents.sent.length, 1)
})

test('task-session onData ignora chunks tras proc._alive=false', () => {
  const received = []
  const state = makeTaskState((c) => received.push(c))
  const proc = { _alive: true }
  const onData = taskOnDataHandler(() => state, proc)

  onData('antes')
  proc._alive = false
  onData('después')

  assert.deepEqual(received, ['antes'])
})

test('task-session sigue espejando a la ventana aunque no haya listener (modo aislado)', () => {
  const state = makeTaskState(null)
  const proc = { _alive: true }
  const onData = taskOnDataHandler(() => state, proc)

  onData('solo ventana')

  assert.equal(state.win.webContents.sent[0].d, 'solo ventana')
})
