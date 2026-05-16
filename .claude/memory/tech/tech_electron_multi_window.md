---
name: tech-electron-multi-window
description: "Patrón para convertir app Electron mono-ventana a multi-ventana sin romper PTY, watchers, localStorage ni bridges singleton (Cmd+N, sesiones per-window, ventana primaria para singletons)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3d1c25af-facb-4ff2-8a10-bc4d521cc23e
---

# Electron multi-ventana sin romper PTY ni singletons

Aprendido refactorizando CLAUDE-NOVAK de 1 ventana a N ventanas (2026-05-15).
Aplica a cualquier app Electron con: PTY per-window, watchers per-window, bridge/servidor singleton, localStorage compartido.

## Modelo: Map de WindowSession por webContents.id

```js
const sessions = new Map()  // key = webContents.id
// WindowSession = { win, wcId, ordinal, pty, cols, rows, cwd, activeCli,
//                   treeWatcher, treeWatcherPath, treeWatchDebounce }
let primaryWcId = null
let lastPrimarySnapshot = { cwd: $HOME, activeCli: 'claude' }
let nextOrdinal = 0
```

Helpers obligatorios:
- `getSessionByEvent(event)` → `sessions.get(event.sender.id)`
- `winFromEvent(event)` → `BrowserWindow.fromWebContents(event.sender)`
- `destroySession(wcId)` cierra pty, watcher, debounce; reasigna primary; congela snapshot.

**Cada IPC handler empieza con `const s = getSessionByEvent(event); if (!s) return ...`**. Las emisiones (`pty-data`, `pty-exit`, `pty-error`, `tree-changed`) van a `s.win.webContents.send(...)`, **NUNCA** a un `win` global.

## Singletons (bridge Telegram, servidores) → ventana primaria + snapshot

El bridge sigue siendo único. Lee `cwd`/`cli activo` de la **ventana primaria** = última que recibió `focus`. Si no hay ninguna, usa `lastPrimarySnapshot` (último estado conocido).

```js
function getCwdSync() {
  return sessions.get(primaryWcId)?.cwd ?? lastPrimarySnapshot.cwd
}
```

Reemplaza referencias a `currentCwd` global. `win.on('focus', () => { primaryWcId = s.wcId; updatePrimarySnapshot() })`. En `destroySession` congelar snapshot antes de reasignar primary.

Eventos de broadcast (ej. telegram-status) → iterar `sessions.values()` y enviar a cada `win.webContents`.

## localStorage: keyado por wid via query string

Dos ventanas en `file://` comparten localStorage → se pisan claves como root path. Solución:

```js
// main.js
win.loadFile('index.html', { query: { wid: String(ordinal) } })

// renderer.js
const WID = new URLSearchParams(location.search).get('wid') || '0'
const ROOT_KEY = `app-root:${WID}`
```

`nextOrdinal` global empieza en 0, se incrementa por ventana, no se resetea mientras la app esté viva. Así la "primera ventana" siempre recupera su root al relanzarla. Theme y otros que quieras globales se quedan sin sufijo.

## Cmd+N: menú nativo, NO globalShortcut

`globalShortcut.register('CmdOrCtrl+N')` captura el atajo aunque la app no tenga foco → mal vecino. Usa `Menu` nativo con accelerator:

```js
const template = [
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { label: 'File', submenu: [
    { label: 'Nueva ventana', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
    { label: 'Cerrar', accelerator: 'CmdOrCtrl+W', click: () => BrowserWindow.getFocusedWindow()?.close() },
  ]},
  { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
]
Menu.setApplicationMenu(Menu.buildFromTemplate(template))
```

## singleInstanceLock + macOS lifecycle

```js
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit(); return }
app.on('second-instance', () => createWindow())  // doble click .app → ventana extra

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
  // en darwin: app sigue viva con bridge corriendo
})
app.on('activate', () => { if (sessions.size === 0) createWindow() })
```

## Watcher per-session sin parpadeo

Cada ventana tiene su `fs.watch` recursivo. Problema en macOS (especialmente SMB/NAS): eventos espurios constantes → flicker. Tres capas para eliminarlo:

1. **Filtro recursivo de noise en main**: si CUALQUIER componente del path empieza por `.` o coincide con patrón ruido (`.DS_Store`, `.fseventsd`, `._*`, `*.swp`, `*~`, `*.tmp`), descartar.

   ```js
   fs.watch(dir, { recursive: true }, (_, filename) => {
     if (!filename) { notify(); return }
     for (const part of filename.split('/')) {
       if (IGNORE_NAMES.has(part) || isNoiseFile(part)) return
     }
     notify()
   })
   ```

2. **Debounce diferenciado**: 800 ms para fs events, 200 ms para focus.

3. **Firma de contenido en renderer**: antes de repintar, calcular firma del árbol visible (top-level + cada sub expandido) y compararla con la anterior. Si igual → return sin tocar DOM.

   ```js
   async function computeTreeSignature() {
     const dirs = ['__root__:' + rootPath]
     // ...recolectar dirs expandidos del DOM...
     const parts = []
     for (const key of dirs) {
       const res = await window.api.readDir(dir)
       parts.push(`${key}=` + res.entries.map(e => `${e.name}|${e.isDir?1:0}|${e.size}`).join(','))
     }
     return parts.join('||')
   }
   ```

   `setRoot` debe inicializar `lastTreeSignature` para no repintar al primer focus.

## Casos límite que SÍ hay que cubrir

- `pty.onData`/`onExit` callbacks tras cerrar ventana → guard con `s.pty._alive` flag (bajar en `destroySession`) y `!s.win.isDestroyed()`.
- `fs.watch` callback tras `destroySession` → guard con `sessions.has(s.wcId)`.
- `dialog.showOpenDialog(...)` antes recibía `win` global; ahora `winFromEvent(event)` para que el sheet aparezca anclado a la ventana correcta.
- `globalShortcut Cmd+Shift+Space`: si no hay foco pero hay ventanas, alternar `BrowserWindow.getFocusedWindow() ?? sessions.values().next().value.win`. Si no hay → `createWindow()`.
- `app.on('before-quit')`: matar todos los PTYs y parar el bridge explícitamente; complemento de `window-all-closed`.

## Orden de implementación seguro

Hacerlo en dos fases con commit entre medias y `node --check` cada vez:

**Fase 1 — sigue uni-ventana pero per-session por debajo**: Map de sesiones, migrar IPC handlers uno a uno, PTY y watcher per-session, bridge usa primary+snapshot+broadcast. App debe seguir funcionando idéntica con 1 ventana.

**Fase 2 — habilitar multi-ventana**: query wid + localStorage keyado, menú con Cmd+N/Cmd+W, singleInstanceLock+second-instance, lifecycle macOS.

Worktree (`git worktree add -b feat/multi-window /tmp/...`) para aislar y poder hacer build de prueba sin tocar el repo principal hasta que Luismi valide.
