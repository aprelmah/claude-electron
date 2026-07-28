# Upgrade Electron 32 → 43 (2026-07-28)

Cierra **SEC-C3**, abierto desde la auditoría de mayo. Electron 32 estaba EOL desde
~marzo 2025: ~16 meses de CVEs de Chromium sin parchear.

## Qué se movió

| Paquete | Antes | Ahora |
|---|---|---|
| `electron` | 32.3.3 | **43.2.0** |
| `electron-builder` | 24.13.3 | **26.15.3** |
| `@electron/rebuild` | 3.7.1 | **4.2.0** |
| `node-pty` | 1.1.0 | 1.1.0 (sin cambio; recompilado) |

Runtime resultante: **Chromium 150.0.7871.129**, Node interno **24.18.0**, ABI `MODULES=148`.

`engines.node` pasa de `>=20.18.0 <23` a `>=20.18.0`: el tope superior ya no tiene
sentido (Electron 43 embebe Node 24) y provocaba `EBADENGINE` en cada `npm install`
del Mac de Luismi, que corre Node 24.

## Techo de macOS — IMPORTANTE

**Electron 43 es la última rama que soporta macOS 12 Monterey.** El README de `main`
(futura 44) ya declara *"macOS (Ventura and up)"*. Verificado rama a rama:

- 38-x-y → Big Sur and up
- 40, 41, 42, **43** → **Monterey and up**
- main (44) → Ventura and up

Este Mac es Monterey (Darwin 21.6). Para seguir recibiendo parches más allá de la 43
hay que **actualizar macOS a Ventura o superior**. La 43 sale de soporte cuando llegue
la 46 (~2 majors × 8 semanas).

## Trampas encontradas (y cómo se resolvieron)

### 1. Notificaciones nativas: exigen app firmada (E42)

Electron 42 migró de `NSUserNotification` a `UNNotification`, que **requiere que la app
esté firmada**. Sin firma la notificación no se muestra y emite `failed` sobre el objeto
`Notification`. Esta app **no está firmada** (certificados Apple expirados).

Había 2 usos, uno importante: el aviso de conflicto de git-por-sesión — la única vía por
la que te enteras de que una rama quedó sin integrar.

Solución: `main/native-notify.js`, un helper con detección en runtime. Intenta la vía
nativa, escucha `failed`, y a la primera degradación marca el canal como roto (no
reintenta, no repite el log) y llama al `fallback` del llamante:

- conflicto de git → `dialog.showMessageBox` (evento raro, modal aceptable)
- mensaje de WhatsApp → rebote del Dock (nada intrusivo por mensaje)

Es correcto tanto si las notificaciones funcionan como si no, así que **no depende de
resolver la duda de la firma**. Nota: en modo dev NO se reproduce el fallo, porque el
`Electron.app` de `node_modules` sí viene firmado; solo se manifiesta en la empaquetada.

Si algún día se firma la app, el fallback se vuelve inerte solo.

### 2. `electron` ya no se descarga en `postinstall` (E42)

Por seguridad de cadena de suministro, el binario se descarga en el primer `npx electron`
en vez de en el `postinstall`. Consecuencias prácticas:

- `npm install` es mucho más rápido y ya no baja ~200 MB.
- Un entorno limpio (CI, clon nuevo) **no tiene binario hasta el primer arranque**.
- Para forzar la descarga: `node node_modules/electron/install.js` (o `npx install-electron`).
- Ahora se puede instalar con `--ignore-scripts`.

El `postinstall` del repo (`electron-rebuild -f -w node-pty`) sigue funcionando: usa la
versión declarada en `node_modules/electron/package.json` para bajar los headers, no
necesita el binario.

### 3. Módulos nativos requieren C++20 (E33)

`node-pty` 1.1.0 compila sin cambios contra Electron 43. Verificado con un spawn real
bajo el runtime nuevo, no solo con el `require`. **No hay versión estable de node-pty
por encima de 1.1.0** (las 1.2.0 son beta) — no tocar.

### 4. Los diálogos abren en Descargas si no fijas `defaultPath` (E43)

Afectaba a los dos selectores de carpeta (`fs-pick-folder`, `tasks:pick-folder`), que
no pasaban `defaultPath` → elegir proyecto habría empezado en `~/Descargas`.

Solución: `pickerStartDir(candidate, homedir)` en `main/dir-helpers.js`. Acepta un
`startPath` opcional desde el renderer (retrocompatible: si no llega, cae al home) y
valida que sea un directorio existente reutilizando `resolveExistingDir`, que ya evita
`statSync` sobre rutas remotas (NAS/SMB).

## Cambios revisados y descartados

De 55 secciones de breaking changes entre la 33 y la 43, solo 2 tocaban este código
(cruce automático de las APIs citadas contra los ficheros del repo). El resto no aplica
porque la app ya estaba en las formas modernas:

- `protocol.handle` en vez de `registerFileProtocol` (ya migrado en el salto a la 32)
- `contextIsolation: true` + `nodeIntegration: false` en las 4 ventanas
- sin `BrowserView` (eliminado en las 3x): el visor usa `BrowserWindow` propia
- Windows/Linux: irrelevantes, la app es Mac-only

## Verificación realizada

- `npm test` → 525 tests, 519 pass, 0 fail, 6 skip (los 6 skip son pre-existentes)
- `npm audit --omit=dev` → **0 vulnerabilidades**
- Arranque en dev con ventana (`--type=renderer` presente)
- `node-pty` spawn real bajo Electron 43 → OK
- `electron-builder --mac --x64 --dir` → exit 0, bundle con Chrome/150.0.7871.129
