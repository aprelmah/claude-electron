# STATE — claude-electron (POWER-AGENT)

> Estado vivo del proyecto. Lo lee el arranque (Claude y Codex) y lo actualiza el cierre (`/wrap`).
> Única fuente de "lo último que pasó". No acumular handoffs por fecha: sobrescribir aquí.
> El detalle histórico vive en `.claude/memory/` (handoffs, `bugs/`, `tech/`) y en la auto-memory del harness.

_Última actualización: 2026-08-02, mañana (verificado contra git, los tests y la app desplegada)._

## Estado de entrega (verificado)

- Rama activa: **`main`**, sincronizada con `origin`. Código en HEAD **`12aae16`** (+ commit de memoria de este cierre).
- Commits de la sesión pusheados: **`870e658`** (fix headless resume + fork del relay) y **`12aae16`** (feat picker `/proyecto` + `/sesiones`).
- `main` lleva: git automático por sesión, sub-chat desechable, **Electron 43**, auto-update de codex, relay de Telegram por transcript **con detección de fork**, headless que localiza el cwd por sessionId, y **elección de proyecto/sesión desde Telegram**.
- **Electron 43.2.0** (Chromium 150.0.7871.129, Node interno 24.18.0, ABI 148). electron-builder 26.15.3, @electron/rebuild 4.2.0, node-pty 1.1.0.
- Tests: **579 (573 pass / 0 fail / 6 skip pre-existentes)**. 3 suites nuevas: `telegram-headless-resume-cwd`, `relay-fork-detection`, `telegram-project-session-picker`.
- Deploy: `/Applications/POWER-AGENT.app` es el build del **2026-08-02 10:25**, corriendo con ventana y bridge activo. Validado por Luismi en Telegram real.
- CLI: **codex 0.145.0**, **claude 2.1.220**.

## Última sesión (2026-08-02, mañana) — Telegram: "Error CLI", fork del resume y picker

### Bug 1 — "Error CLI" al escribir al bot sin sesión abierta (`870e658`)

- Mensaje directo al bot → headless `--resume <sid>` con cwd = homedir (la app recién arrancada no tiene sesión primaria; `lastPrimarySnapshot` nace en `os.homedir()`) → `No conversation found`. Antes "funcionaba" por accidente: una instancia zombie llevaba semanas viva con `turbo e` de primaria.
- Arreglo: `resolveResumeCwd(sessionId)` en `main/relay-transcript-helpers.js` — barre `~/.claude/projects` por `<sessionId>.jsonl` y saca de las líneas del JSONL el cwd **que codifica al directorio contenedor Y existe** (no vale "el primero": una sesión nacida en worktree mezcla cwds muertos). Si la sesión es huérfana → conversación nueva en vez de error eterno.
- El "pendiente conocido" del headless con `getCwdSync()` queda **CERRADO**.

### Bug 2 — RelayEmpty al enviar a Telegram una sesión resumida (`870e658`)

- **Regla dura nueva: el `--resume` interactivo del TUI FORKEA a un sessionId nuevo.** El fichero viejo queda intacto y los turnos van al forkeado (caso real: enlace a `d5173326…`, turno en `e95bc91e…`). El relay vigilaba el viejo → 45 s → RelayEmpty.
- Arreglo: `detectForkedRelayTranscript()` — snapshot de los `.jsonl` candidatos pre-write; si el transcript esperado no crece (~2 s), adopta el fichero nuevo/crecido **que contenga el prompt del turno** (exigido, para no secuestrar sesiones concurrentes del mismo proyecto) y actualiza el sessionId en sesión y chat.
- ⚠️ El **pool de PTYs ocultos** y las **task-sessions** NO tienen aún esta detección: mismo bug latente si resumen sesiones.

### Feature — elegir proyecto y sesión desde Telegram (`12aae16`)

- `/proyecto` → botones inline con los cwds recientes; fija el proyecto del chat. `/sesiones` → conversaciones previas del proyecto (fecha + preview) + "Nueva sesión". Elegir sesión desengancha el relay PTY del chat.
- `telegram-sessions.json` guarda ahora también `cwd` por chat; viaja como `chatCwd` al enrutado. `/reset` conserva el proyecto; `/status` muestra el proyecto del chat.
- Enrutado de Telegram, 4 niveles: binding PTY > sessionId persistida (headless en su cwd real) > sesión primaria abierta > headless nuevo en `chatCwd`.

## Próximo paso

1. **Añadir detección de fork al pool de PTYs ocultos y task-sessions** (mismo patrón que el relay: `detectForkedRelayTranscript`).
2. **Elegir modelo de codex.** Quedó en `model = "codex-auto-review"`. En el selector `/model`, opción **1 `gpt-5.6-sol`**.
3. **Probar el picker de sesiones con codex** (el listado se sirve, el flujo real no se validó).
4. **Decisión de Luismi: actualizar macOS.** Monterey (12) y Electron 43 es la última rama que lo soporta; la 44 exige Ventura.
5. **Comprobar el fallback de notificaciones en la app empaquetada** (conflicto de git por sesión → ¿sale el diálogo?). En dev no se reproduce.
6. **Prueba manual del sub-chat**: contexto heredado en el fork, ✕ deja el principal intacto, `/exit` sin procesos `claude` huérfanos.
7. Renovar certificado Apple y firmar/notarizar. Riesgo conocido sin cerrar: LAN en HTTP plano, Bearer en claro.

## Notas operativas

- ⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app.** Usar `osascript -e 'quit app "POWER-AGENT"'` (empaquetada) o `pkill -9 -f "claude-electron/node_modules/electron"` (dev). Y **`open` sobre una instancia zombie tampoco relanza nada**: solo "activa" el proceso muerto — cerrar primero, abrir después.
- ⚠️ Al morir a lo bruto queda un **`SingletonLock` huérfano** en `userData`: el siguiente arranque se suicida **en silencio**. Si la app "no arranca", borrar `SingletonLock`/`SingletonSocket`/`SingletonCookie`.
- Dev y empaquetada comparten `userData` (`CLAUDE-NOVAK`) → comparten ese lock y **nunca pueden convivir**.
- Comprobar que hay ventana: debe existir un proceso `--type=renderer`.
- **Para depurar el relay o el main**: dev con `npm start 2>&1 | tee /tmp/poweragent-relay.log` vía `osascript` y leer el log. Instrumentar antes de teorizar.
- El ruido `EGL ... Bad attribute` es cosmético (8/s, medido). Sin arreglo desde nuestro código.
- Dev/deploy requieren `osascript` (sin WindowServer). Mac Intel → `dist/mac/POWER-AGENT.app`.
- CI usa Node 20.18.0; el Mac corre Node 24 (tests pasan en ambos).
