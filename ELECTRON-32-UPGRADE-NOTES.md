# Electron 20 → 32 LTS — Upgrade Notes

Fecha: 2026-05-22

## Versiones finales

| Componente           | Antes      | Después       |
|----------------------|------------|---------------|
| electron             | `20.x`     | `^32.3.3`     |
| @electron/rebuild    | `^3.6.0`   | `^3.7.1` (3.7.2 resuelto) |
| electron-builder     | `^24.13.3` | `^24.13.3` (sin cambio) |
| node-pty             | `^1.0.0`   | `^1.0.0` (1.1.0 resuelto) |
| engines.node         | `>=16.20.2 <21` | `>=20.18.0 <23` |
| .nvmrc               | `16.20.2`  | `20.18.0`     |

Notas:
- Electron 32 es la última LTS estable. Trae Chromium 128, V8 12.8, Node 20.18 interno.
- node-pty 1.1.0 ya estaba marcado como `^1.0.0`; el rebuild contra Electron 32 ABI 128 funciona out-of-the-box. No hizo falta forzar versión nueva.
- electron-builder 24.13.3 soporta Electron 32 sin cambios.

## APIs deprecated arregladas

### `protocol.registerFileProtocol` → `protocol.handle`
- **Archivo**: `main.js` (líneas ~3247 y ~93-103 nuevos).
- Deprecated desde Electron 25, planificada su eliminación.
- Migración a la API moderna basada en `Response`/`net.fetch`:
  - Se añadió `protocol.registerSchemesAsPrivileged([{ scheme: 'wa-media', privileges: { standard, secure, supportFetchAPI, stream, bypassCSP } }])` antes de `app.ready`. Imprescindible para que `protocol.handle` se comporte como standard scheme (el viejo registerFileProtocol no lo requería).
  - Se importa `net` desde `electron` y se sirve el archivo con `net.fetch('file://' + path)`.
  - Sin cambio funcional: misma resolución `basename(name) + WA_MEDIA_DIR`, mismo error 404 ante URLs inválidas.

## Breaking changes Electron 21-32 descartados (no aplican)

Auditados y descartados porque la app NO usa estas APIs:

- `app.runningUnderRosettaTranslation` → no usado (la app no detecta Rosetta).
- `app.allowRendererProcessReuse` → no usado.
- `desktopCapturer.getSources` en renderer → no usado (sin pantalla compartida).
- `BrowserView` → no usado (todas las ventanas son `BrowserWindow`).
- `Tray.setHighlightMode` → no usado (sin Tray icon).
- `crashReporter.start` deprecated args → no usado.
- `enableRemoteModule` / `@electron/remote` → no usado (preload + contextBridge).
- `webContents.openDevTools` con args removed → no se invoca con flags obsoletos.
- `nativeImage.createFromBuffer` cambio de firma → no usado.
- `protocol.registerStringProtocol`/`Buffer`/`Stream`/`Http`Protocol → no usados.
- `session.flushStorageData` → no usado.

## Configuración de seguridad ya conforme

- `contextIsolation: true` en TODAS las webPreferences (main.js:2115, 2221, 2280, 2324, 2640, 2718, 4596, 4648, 4688).
- `nodeIntegration: false` en TODAS las webPreferences.
- `sandbox` no explícito (default Electron 20+ es `false`, no cambia en 32). El proyecto usa preload + contextBridge sin nodeIntegration, modelo aceptable.

## Archivos modificados

| Archivo                           | LOC delta | Motivo |
|-----------------------------------|-----------|--------|
| `package.json`                    | +3 / -3   | Bump electron, @electron/rebuild, engines.node, postinstall tolerante |
| `.nvmrc`                          | +1 / -1   | Node 16.20.2 → 20.18.0 |
| `package-lock.json`               | (regen)   | npm install limpio con E32 |
| `main.js`                         | +19 / -4  | registerSchemesAsPrivileged + migración protocol.handle |
| `ELECTRON-32-UPGRADE-NOTES.md`    | nuevo     | Este documento |

## Verificaciones realizadas

1. `npm install` limpio (`rm -rf node_modules package-lock.json && npm install`) → 409 paquetes, `electron-rebuild -f -w node-pty` OK.
2. `node --check` en `main.js`, `renderer.js`, `preload.js`, todos los `main/*.js` → OK.
3. `npm test` → 101 / 95 pass / 0 fail / 6 skip (idéntico a baseline pre-upgrade).
4. Smoke test node-pty bajo Electron 32 (`ELECTRON_RUN_AS_NODE=1 electron -e "...pty.spawn..."`) → output esperado, exit limpio.
5. Binario electron resuelve a v32.3.3.

## Riesgos conocidos / pendientes

- **No probado en runtime gráfico**: el agente no puede lanzar la app con WindowServer (sandbox de Claude Code). Hay que ejecutar `npm start` manualmente vía `osascript /tmp/launch_poweragent.scpt` para confirmar que la UI arranca limpia con Electron 32.
- **Empaquetado no validado**: `npm run dist` / `build:zip` NO se ha ejecutado en esta sesión (toma 5-10 min y depende de hdiutil/codesign). Recomendado correr `npm run build:zip` antes de promocionar a `main`.
- **macOS antiguo**: Electron 32 requiere macOS 10.15 (Catalina) mínimo. Electron 20 admitía 10.13 (High Sierra). No debería afectar al Mac Intel del usuario actual.
- **WhatsApp `wa-media://` scheme**: el cambio a `protocol.handle` añadió `registerSchemesAsPrivileged`. En Electron 32 los schemes registrados como privileged ya no se pueden re-registrar — al hot-reload de dev habrá que reiniciar el proceso (no hay HMR en main).
- **Helpers de Electron**: tras el upgrade, los Helpers viejos (Electron 20) en caché siguen sin invalidar hasta reiniciar. Si se ve comportamiento extraño tras `npm start`, `pkill -9 -f "POWER-AGENT Helper"` y reintentar.
- **Node 24 del sistema**: el dev local usa Node 24, fuera del rango `>=20.18.0 <23`. `npm install` emitió `EBADENGINE` warning pero no bloqueó. Si el cliente quiere alinear, recomendado `nvm use` con `.nvmrc` (20.18.0).

## Commits creados

- `5f6154d` chore(deps): bump electron 20.x -> 32.3.3 LTS + node 20
- `c7ad8f6` refactor(main): migrate protocol.registerFileProtocol -> protocol.handle
