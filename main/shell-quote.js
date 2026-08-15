'use strict'

// Único quoting de shell de la app. main.js y main/ws-server.js alimentan
// `bash -c` con esto: cualquier corrección de quoting debe aplicar a las dos
// rutas a la vez (antes vivía duplicado en ambos ficheros).
function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

module.exports = { shellQuote }
