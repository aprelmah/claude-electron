'use strict'

// Decisión pura "¿qué pestañas se ven con el conocimiento apagado?". Vive
// fuera de kb-panel.js porque la suite corre sin Electron y lo que decide un
// script de renderer no lo cubre nadie. El fallo que evita: apagar el
// conocimiento mientras estás EN Casos/Fichas y quedarte mirando una pestaña
// que ya no existe.
//
// Doble carga: `window.KbTabsState` en el navegador, `module.exports` en tests.
// Mismo patrón que voice-ui-state.js.

const KB_TABS = ['casos', 'fichas']

function decideKbTabs({ enabled, activeTab } = {}) {
  const on = enabled !== false
  const current = typeof activeTab === 'string' && activeTab ? activeTab : 'chat'
  const mustLeave = !on && KB_TABS.includes(current)
  return {
    showCasos: on,
    showFichas: on,
    showApply: on,
    nextTab: mustLeave ? 'chat' : current,
    tabChanged: mustLeave
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decideKbTabs, KB_TABS }
}
if (typeof window !== 'undefined') {
  window.KbTabsState = { decideKbTabs, KB_TABS }
}
