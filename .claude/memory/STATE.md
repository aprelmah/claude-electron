# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-07-28, tarde (verificado contra git, GitHub, la app corriendo y el bundle desplegado)._

## Estado de entrega (verificado)

- Rama activa: **`main`**, working tree limpio, sincronizada con `origin`. HEAD: `e900819`.
- **PR #2 y PR #3 mergeados** el 2026-07-28. No queda nada abierto.
- `main` lleva ya TRES bloques: git automático por sesión, sub-chat desechable y **Electron 43**.
- **Electron 43.2.0** (Chromium 150.0.7871.129, Node interno 24.18.0, ABI 148). electron-builder 26.15.3, @electron/rebuild 4.2.0, node-pty 1.1.0.
- Tests: **525 (519 pass / 0 fail / 6 skip pre-existentes)**.
- **`npm audit --omit=dev`: 0 vulnerabilidades.**
- Deploy: `/Applications/POWER-AGENT.app` es el build del **2026-07-28 19:04**, con Electron 43 dentro (verificado en el binario del Framework), sin cuarentena y arrancado con ventana.
- Ramas `feat/git-auto-por-sesion` y `chore/electron-43`: **borradas** en local y en `origin` tras verificar 0 commits fuera de `main`. Siguen vivas otras ya mergeadas sin limpiar (`backup-2026-05-14-main`, `backup-pre-graph-revert`, `worktree-task-*`, y cuatro `worktree-agent-*` con worktree activo — estas hay que mirarlas antes de tocarlas).

## Última sesión (2026-07-28, tarde) — Electron 32 → 43, SEC-C3 cerrado

- **Merge del PR #2** (git por sesión + sub-chat) y acto seguido el upgrade en `chore/electron-43` → **PR #3**, CI verde, mergeado. 4 commits troceados.
- **Electron 32.3.3 → 43.2.0.** La 32 llevaba EOL desde ~marzo 2025: unos 16 meses de CVEs de Chromium sin parchear.
- **El salto salió barato porque el código ya estaba modernizado**: de 55 secciones de breaking changes entre la 33 y la 43, solo 2 tocaban este repo. La app ya usaba `protocol.handle`, `contextIsolation` en las 4 ventanas y ninguna `BrowserView`. El cruce se hizo automático: extraer las APIs citadas en los breaking changes y grepearlas contra los ficheros del repo.
- **Tres arreglos que sí exigió el salto:**
  1. `main/native-notify.js` — E42 migró a `UNNotification`, que **exige app firmada**; esta no lo está, así que los avisos nativos habrían dejado de verse **en silencio**, incluido el de conflicto de git por sesión. Detección en runtime del evento `failed` + fallback (diálogo para git, rebote del Dock para WhatsApp). **No se reproduce en dev**: el `Electron.app` de `node_modules` sí viene firmado.
  2. `pickerStartDir()` en `main/dir-helpers.js` — E43 abre los diálogos en `~/Descargas` si no se fija `defaultPath`; afectaba a los dos selectores de carpeta.
  3. `engines.node` pierde el tope `<23` (Electron 43 embebe Node 24; el tope solo daba `EBADENGINE`).
- **Prueba en la app real, conducida por CDP** (`--remote-debugging-port=9222` + WebSocket): ventana, xterm con 30 filas, sesión de Claude Code viva respondiendo dentro del PTY, `contextBridge` expuesto, IPC de ida y vuelta (`homeDir`) y sandbox de rutas rechazando fuera del cwd de sesión. Es la verificación fuerte de que `node-pty` funciona bajo el ABI nuevo.
- Notas del upgrade y sus trampas: **`ELECTRON-43-UPGRADE-NOTES.md`**.

## Sesión previa (2026-07-26 → 28)

- **Saneado del repo**: symlink `node_modules` fuera del índice + `.gitignore` con patrones sin barra (`6b06600`); commit rescatado por cherry-pick de una rama de conflicto (`86de38f`); 2 worktrees y 3 ramas huérfanas eliminados.
- **Bug del pre-commit hook** (`c0aad58`): git exporta `GIT_DIR`/`GIT_INDEX_FILE` a los hooks; los tests que crean repos temporales los heredaban y operaban sobre este repo. Fallaban **solo al commitear**. El hook además no estaba ni instalado.
- **Bug de worktrees huérfanos** (`16a4ab9`): `recordActive()` solo se llama cuando el poll detecta un `claudeSessionId`, así que una sesión sin turnos —o un `pkill`— dejaba worktrees invisibles para el barrido. Nuevo `discoverUnregisteredWorkspaces()` que escanea el disco al arrancar. 6 tests + verificación end-to-end contra la app real.
- **Dependencias** (`32c2b9e`, `b94d6b4`): `ws` a 8.21.1 (DoS por fragmentos, y es la librería del servidor LAN) y node-cron 3 → 4.6.0 (sin dependencias, se lleva el `uuid` vulnerable). La migración de node-cron se cubrió antes con 6 tests de ciclo de vida, incluido disparo real de un job.
- **Auditoría del proyecto** (a petición de Luismi): 41.221 líneas propias, 47 módulos en `main/`, 54 ficheros de test, 9 deps de producción. Hardening de Electron correcto (`contextIsolation`, `nodeIntegration: false` en todas las ventanas).

## Próximo paso

1. **Decisión de Luismi: actualizar macOS.** Este Mac es Monterey (12) y **Electron 43 es la última rama que lo soporta**; la 44 exige Ventura. Verificado rama a rama en los README de Electron. Sin actualizar macOS, en ~2 majors (unas 16 semanas) se vuelve a estar fuera de soporte. El Mac es Intel: si es de 2017 o posterior, Ventura le entra.
2. **Comprobar el fallback de notificaciones en la app empaquetada** (la de `/Applications`, que es la que no está firmada): provocar un conflicto de git por sesión y ver si sale el diálogo. En dev no se puede probar. Si sale el diálogo → `UNNotification` está fallando como se preveía; si sale la notificación nativa de siempre → una firma no era necesaria y el fallback queda inerte, sin daño.
3. **Prueba manual del sub-chat**, que sigue sin validar por un humano: contexto heredado en el fork, ✕ deja el principal intacto, y sobre todo `/exit` en la madre **sin dejar procesos `claude` huérfanos** en `ps`.
4. Limpieza opcional de ramas viejas ya mergeadas (`backup-*`, `worktree-task-*`). Las `worktree-agent-*` tienen worktree activo: revisar antes de borrar.
5. Renovar certificado Apple y firmar/notarizar (trámite, no ingeniería). Bloquea distribuir a terceros — y ahora además desactivaría el fallback de notificaciones.
6. Riesgo conocido sin cerrar: el servidor LAN va en **HTTP plano**, así que el Bearer token viaja en claro por la red.

## Notas operativas

- ⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app.** Usar `osascript -e 'quit app "POWER-AGENT"'` (empaquetada) o `pkill -9 -f "claude-electron/node_modules/electron"` (dev). Ver CLAUDE.md §Protocolo de despliegue.
- ⚠️ Al morir a lo bruto queda un **`SingletonLock` huérfano** en `userData`: el siguiente arranque se suicida **en silencio**, sin error. Si la app "no arranca", borrar `SingletonLock`/`SingletonSocket`/`SingletonCookie`.
- Dev y empaquetada comparten `userData` (`app.setPath` a `CLAUDE-NOVAK` en main.js:154) → comparten ese lock y **nunca pueden convivir**.
- Comprobar que hay ventana: debe existir un proceso `--type=renderer`. Solo `gpu-process` + `utility` = arrancó sin ventana.
- El ruido `EGL ... Bad attribute` de la consola es cosmético y está medido: 8/s indefinidos. `--use-angle=metal` los elimina pero **mata el proceso GPU**; `--use-angle=gl` solo baja a 3/s. No hay arreglo desde nuestro código: se cierra con Electron 43.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan en ambos, verificado en el CI del PR #2).
