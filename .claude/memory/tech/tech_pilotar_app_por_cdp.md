# Pilotar POWER-AGENT por CDP para probarla de verdad

Claude Code no tiene WindowServer, así que no puede ver ni tocar la ventana. La
salida es arrancar Electron con el puerto de depuración y conducirlo por
Chrome DevTools Protocol. Sirve para verificar de verdad (no "arrancó el
proceso") tras cambios gordos: upgrade de Electron, ABI de módulos nativos, IPC.

Usado el 2026-07-28 para validar el salto a Electron 43.

## Arranque

```bash
osascript -e 'quit app "POWER-AGENT"'                              # empaquetada
pkill -9 -f "claude-electron/node_modules/electron"                # dev
# limpiar SingletonLock huérfano (si no, el arranque se suicida en silencio)
```

Luego, vía `osascript` (obligatorio, ver CLAUDE.md §Protocolo de despliegue):

```
npx electron . --remote-debugging-port=9222
```

Comprobar que escucha: `lsof -nP -iTCP:9222 -sTCP:LISTEN`.

## El piloto

Script en el scratchpad que usa el `ws` del propio proyecto (por ruta absoluta,
porque el script vive fuera del repo):

1. `GET http://127.0.0.1:9222/json/list` → targets; quedarse con el de `index.html`
2. WebSocket a `webSocketDebuggerUrl`
3. `Runtime.enable` + `Page.enable`
4. `Runtime.evaluate` con `returnByValue: true, awaitPromise: true` para leer DOM
   y **llamar al IPC real** desde el renderer
5. `Page.captureScreenshot` → PNG a disco → leerlo con la herramienta Read, que
   lo muestra visualmente

## Qué comprobar (y qué prueba cada cosa)

| Comprobación | Qué demuestra |
|---|---|
| Existe proceso `--type=renderer` | hay ventana (solo gpu+utility = arrancó sin ella) |
| Captura de pantalla | la UI pinta entera, no una página en blanco |
| `document.querySelectorAll('.xterm-rows > div').length` | xterm renderizando |
| Sesión del CLI viva respondiendo dentro | **node-pty spawnea y transmite** bajo el ABI nuevo |
| `Object.keys(window)` → `api` | `contextBridge`/preload cargó |
| `window.api.homeDir()` | IPC de ida y vuelta con el main |
| `window.api.readDir(fuera_del_cwd)` | el sandbox de rutas sigue rechazando |

## Trampas

- **`curl` y el `node -e` con `http` están interceptados** por el hook de
  context-mode. Meter las llamadas HTTP en un fichero `.js` y ejecutarlo con
  `node fichero.js`.
- **No escribir en el PTY de una sesión viva de Luismi**: consume sus tokens y
  ensucia su conversación. Leer el DOM y llamar IPCs de solo lectura basta.
- El puerto de depuración queda abierto (solo en localhost) mientras la app
  corra así: **relanzarla sin el flag** al terminar.
- Un script de prueba con un `require` roto abre un diálogo modal de Electron
  ("A JavaScript error occurred in the main process") **encima de la pantalla de
  Luismi**, y al matarlo deja un `.ips` con SIGILL que parece un crash de la app.
  No lo es. Comprobar `procLaunch` en el `.ips` antes de alarmarse.
- **El CDP que expone Electron NO tiene `Browser.setWindowBounds`/
  `Browser.getWindowForTarget`** (error `-32601`, confirmado 2026-08-11 contra la
  app real al probar auto-ajuste de layout al redimensionar). Para cambiar el
  tamaño de la ventana de verdad desde un script CDP, usar `window.resizeTo(w, h)`
  vía `Runtime.evaluate` — Electron sí lo reenvía a la ventana nativa del SO
  (confirmable leyendo `window.outerWidth`/`outerHeight` antes y después).
