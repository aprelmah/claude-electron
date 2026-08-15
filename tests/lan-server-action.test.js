const test = require('node:test')
const assert = require('node:assert')

const { decideLanServerAction } = require('../main/lan-server-action')

// Por qué existe este fichero: la decisión de reiniciar el servidor LAN vivía
// dentro del ipcMain.handle('save-app-config'), así que solo se podía probar
// arrancando Electron y nadie la cubría. El bug era grave: CUALQUIER guardado
// que incluyera el bloque lanServer reiniciaba el servidor, y start() para
// antes de rebindear, con lo que cerraba las sesiones remotas vivas y vaciaba
// los invites repartidos. Editar una URL del túnel tumbaba al cliente que
// estuviera en mitad de una conversación.

test('servidor parado y el usuario lo activa → arrancar', () => {
  const d = decideLanServerAction({ enabled: true, running: false, previousPort: 9999, nextPort: 9999 })
  assert.strictEqual(d.action, 'start')
})

test('servidor corriendo y el usuario lo desactiva → parar', () => {
  const d = decideLanServerAction({ enabled: false, running: true, previousPort: 9999, nextPort: 9999 })
  assert.strictEqual(d.action, 'stop')
})

test('servidor ya parado y sigue desactivado → no tocar nada', () => {
  const d = decideLanServerAction({ enabled: false, running: false, previousPort: 9999, nextPort: 9999 })
  assert.strictEqual(d.action, 'none')
})

test('EL FIX: corriendo, activo y mismo puerto → NO reiniciar', () => {
  // Este es el caso de "el operador cambia una URL pública y pulsa Guardar".
  // Cualquier cosa distinta de 'none' vuelve a cerrar las sesiones remotas.
  const d = decideLanServerAction({ enabled: true, running: true, previousPort: 9999, nextPort: 9999 })
  assert.strictEqual(d.action, 'none',
    'Guardar sin cambiar puerto NO debe reiniciar: mata las sesiones remotas vivas e invalida los invites')
})

test('cambiar de puerto sí exige reiniciar', () => {
  const d = decideLanServerAction({ enabled: true, running: true, previousPort: 9999, nextPort: 10500 })
  assert.strictEqual(d.action, 'start')
  assert.match(d.reason, /puerto/i)
})

test('el puerto se compara por valor, no por tipo', () => {
  // El renderer manda el puerto como texto cuando viene de un <input>.
  const d = decideLanServerAction({ enabled: true, running: true, previousPort: 9999, nextPort: '9999' })
  assert.strictEqual(d.action, 'none', 'un "9999" de un input no puede provocar un reinicio fantasma')
})

test('activo pero caído (arranque previo fallido) → reintentar arranque', () => {
  const d = decideLanServerAction({ enabled: true, running: false, previousPort: 9999, nextPort: 9999 })
  assert.strictEqual(d.action, 'start')
})

test('cada decisión explica su motivo', () => {
  const casos = [
    { enabled: true, running: false, previousPort: 9999, nextPort: 9999 },
    { enabled: false, running: true, previousPort: 9999, nextPort: 9999 },
    { enabled: false, running: false, previousPort: 9999, nextPort: 9999 },
    { enabled: true, running: true, previousPort: 9999, nextPort: 9999 },
    { enabled: true, running: true, previousPort: 9999, nextPort: 10500 }
  ]
  for (const c of casos) {
    const d = decideLanServerAction(c)
    assert.ok(['none', 'start', 'stop'].includes(d.action), `acción inesperada: ${d.action}`)
    assert.ok(typeof d.reason === 'string' && d.reason.length > 0, 'toda decisión lleva motivo')
  }
})

test('entradas basura no provocan un reinicio por accidente', () => {
  assert.strictEqual(decideLanServerAction().action, 'none')
  assert.strictEqual(decideLanServerAction(null).action, 'none')
  // enabled ausente = no activo: nunca arrancar por omisión.
  assert.strictEqual(decideLanServerAction({ running: false }).action, 'none')
})

test('un puerto ilegible no se toma por un cambio de puerto', () => {
  const d = decideLanServerAction({ enabled: true, running: true, previousPort: 9999, nextPort: NaN })
  assert.strictEqual(d.action, 'none', 'sin un puerto nuevo válido, se deja el servidor en paz')
})
