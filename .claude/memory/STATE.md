# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-07-28 (verificado contra git, GitHub y npm audit en el cierre)._

## Estado de entrega (verificado)

- Rama activa: **`feat/git-auto-por-sesion`**, working tree **limpio**, **sincronizada con `origin`** (ya no está sin push). Último commit de código: `b94d6b4`; encima van solo los commits de documentación de este cierre.
- **PR #2 abierto** → https://github.com/aprelmah/claude-electron/pull/2 — `MERGEABLE`, **CI en verde** (macOS, Node 20.18.0, 53s). 33 ficheros, +4.943 / −191, 32 commits sobre `main`.
- Lleva DOS features completas: git automático por sesión + sub-chat desechable.
- Tests: **511 (505 pass / 0 fail / 6 skip pre-existentes)**.
- **`npm audit --omit=dev`: 0 vulnerabilidades.** Quedan ~30 en herramientas de build (1 crítica en `tar` vía electron-builder) sin impacto en runtime.
- Deploy: `/Applications/POWER-AGENT.app` es el build del **2026-07-25 09:34** — lleva git-por-sesión y sub-chat, pero NO los arreglos del 26-28. Redeploy pendiente tras el merge.
- Worktrees y ramas de sesión: **limpios** (0 ramas `poweragent/session-*`, solo el worktree del dir real).

## Última sesión (2026-07-26 → 28)

- **Saneado del repo**: symlink `node_modules` fuera del índice + `.gitignore` con patrones sin barra (`6b06600`); commit rescatado por cherry-pick de una rama de conflicto (`86de38f`); 2 worktrees y 3 ramas huérfanas eliminados.
- **Bug del pre-commit hook** (`c0aad58`): git exporta `GIT_DIR`/`GIT_INDEX_FILE` a los hooks; los tests que crean repos temporales los heredaban y operaban sobre este repo. Fallaban **solo al commitear**. El hook además no estaba ni instalado.
- **Bug de worktrees huérfanos** (`16a4ab9`): `recordActive()` solo se llama cuando el poll detecta un `claudeSessionId`, así que una sesión sin turnos —o un `pkill`— dejaba worktrees invisibles para el barrido. Nuevo `discoverUnregisteredWorkspaces()` que escanea el disco al arrancar. 6 tests + verificación end-to-end contra la app real.
- **Dependencias** (`32c2b9e`, `b94d6b4`): `ws` a 8.21.1 (DoS por fragmentos, y es la librería del servidor LAN) y node-cron 3 → 4.6.0 (sin dependencias, se lleva el `uuid` vulnerable). La migración de node-cron se cubrió antes con 6 tests de ciclo de vida, incluido disparo real de un job.
- **Auditoría del proyecto** (a petición de Luismi): 41.221 líneas propias, 47 módulos en `main/`, 54 ficheros de test, 9 deps de producción. Hardening de Electron correcto (`contextIsolation`, `nodeIntegration: false` en todas las ventanas).

## Próximo paso

1. **Prueba manual del sub-chat** (lo único del PR sin validar por un humano): contexto heredado en el fork, ✕ deja el principal intacto, y sobre todo `/exit` en la madre **sin dejar procesos `claude` huérfanos** en `ps`.
2. Merge del PR #2 → `npm run deploy`.
3. **Sesión dedicada: subir Electron 32 → 43** (SEC-C3). Es el trabajo grande: 10 versiones mayores, rompe APIs, obliga a recompilar `node-pty` y toca el empaquetado. Cierra de paso las vulnerabilidades de build y el ruido EGL de la consola.
4. Renovar certificado Apple y firmar/notarizar (trámite, no ingeniería). Bloquea distribuir a terceros.
5. Riesgo conocido sin cerrar: el servidor LAN va en **HTTP plano**, así que el Bearer token viaja en claro por la red.

## Notas operativas

- ⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app.** Usar `osascript -e 'quit app "POWER-AGENT"'` (empaquetada) o `pkill -9 -f "claude-electron/node_modules/electron"` (dev). Ver CLAUDE.md §Protocolo de despliegue.
- ⚠️ Al morir a lo bruto queda un **`SingletonLock` huérfano** en `userData`: el siguiente arranque se suicida **en silencio**, sin error. Si la app "no arranca", borrar `SingletonLock`/`SingletonSocket`/`SingletonCookie`.
- Dev y empaquetada comparten `userData` (`app.setPath` a `CLAUDE-NOVAK` en main.js:154) → comparten ese lock y **nunca pueden convivir**.
- Comprobar que hay ventana: debe existir un proceso `--type=renderer`. Solo `gpu-process` + `utility` = arrancó sin ventana.
- El ruido `EGL ... Bad attribute` de la consola es cosmético y está medido: 8/s indefinidos. `--use-angle=metal` los elimina pero **mata el proceso GPU**; `--use-angle=gl` solo baja a 3/s. No hay arreglo desde nuestro código: se cierra con Electron 43.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan en ambos, verificado en el CI del PR #2).
