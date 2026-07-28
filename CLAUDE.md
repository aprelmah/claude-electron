# POWER-AGENT Runbook

## Latest Handoff
- **UPGRADE ELECTRON 2026-07-28 (rama `chore/electron-43`)** — Electron **32.3.3 → 43.2.0** (Chromium 128 → 150, Node interno 24.18.0, ABI 148), electron-builder 24 → 26.15.3, @electron/rebuild 3 → 4.2.0. Cierra **SEC-C3**, pendiente desde mayo: la 32 llevaba EOL desde ~marzo 2025. Tests 525 (519 pass / 0 fail / 6 skip). `npm audit --omit=dev`: 0 vulnerabilidades. Notas y trampas: `ELECTRON-43-UPGRADE-NOTES.md`. **Techo: Electron 43 es la última que soporta macOS 12 Monterey; la 44 exige Ventura.**
- **AUDITORÍA 2026-05-24 (commit `9f7f06a`, PR #1, rama `audit-fixes-2026-05-24`)** — 27 hallazgos cerrados (5 CRITICAL + 18 HIGH + 4 mejoras). Tests **254 → 418, 0 fail, 10 runs estables**. Detalle: `.claude/memory/audit_2026_05_24.md` + informes en `/tmp/audit-poweragent-2026-05-24/`. Nuevos módulos: `main/dir-helpers.js`, `main/pty-data-batcher.js`, `main/telegram-open-task-session.js`, `automations/security.js`, `vendor/xterm/*`. CI/CD añadido (`.github/workflows/test.yml`). Deployado a `/Applications/POWER-AGENT.app` 21:56. **SEC-C3 upgrade Electron sigue pendiente** (breaking, sesión humana). Reglas técnicas nuevas en MEMORY.md (LAN Bearer, `looksRemotePath`, `atomic-writes` 0o600, allowlist `save-app-config`, pool `notifyPtyExit`/`touchHiddenPty`/`chatId`, headless `origin`, índices con `flush()`, `vendor/`, batcher único).
- **`HANDOFF-CLAUDE-2026-05-23-TELEGRAM-HIDDEN-PTY-POOL.md`** — sesión 23 may (noche): C+ pool de PTYs ocultos para enlace universal Mac→Telegram. Nuevo `main/telegram-hidden-pty-pool.js` (TTL 15min, LRU max 3, sweep 60s, deps inyectables). Sink Telegram spawnea PTY oculto cuando run.status=ok+claude+sessionId → binding queda en `telegramRelayByChat` → onRunQuery enruta directo a relay PTY sin headless. Adaptaciones: `openTaskSessionWindow` acepta `hidden:true`, taskState ahora tiene `activeCli/claudeSessionId/relayActive` (drop-in para `relayThroughPty`), `getRelayBindingForChat` mira también `taskSessionStateByWc` vía `getTaskSessionByWcId`. `/abrir` desde Telegram consulta primero el pool: si la ventana ya estaba oculta, la muestra; si no, spawna normal. Codex sigue por headless (relay PTY no delimita bien fin de turno). 22 tests nuevos (213 pass / 0 fail). Sin commit.
- **`HANDOFF-CLAUDE-2026-05-23-FASE-B-LISTADO-EFICIENTE.md`** — sesión 23 may (tarde): Fase B listado eficiente. Stream JSONL Claude + cache persistente keyed por mtime+size (`userData/claude-sessions-index.json`). Índice persistente Codex por cwd con watcher fs incremental (`userData/codex-sessions-index.json`). Paginación 50+ en sidebar y picker. 2 agentes general-purpose en paralelo + integración + paginación. 33 tests nuevos. Commits e6caa1d+4c506ed+6600f97+f6a570f+625a33d+05f3dcc. Tests 171/0. **REGLA NUEVA:** `createSessionListing` usa late binding (getter) para índices porque main.js los crea después de top-level; siempre mantener fallback al walk si índice vacío.
- `HANDOFF-CLAUDE-2026-05-23-CWD-FIRST-STARTUP.md` — sesión 23 may (mañana): arranque cwd-first. App no spawn-ea PTY auto al boot. Overlay "Elige proyecto" → vista "Elige sesión" (toggle Claude|Codex) → spawn. Multi-PTY (+ topbar). `main/recent-cwds.js`, `main/last-context.js`, `project-picker.js`. Bugs arreglados: resume-session codex, TCC EACCES en recientes, asar whitelist en package.json. Commits 889c613+0f97dd8+ef1c470+581cefd. Tests 138/0. **REGLA CRÍTICA NUEVA:** `package.json` `build.files` es whitelist — todo `.js`/`.html` nuevo en raíz debe añadirse a mano.
- `HANDOFF-CLAUDE-2026-05-22-NIGHT-TASKS-AGENT-FIRST-ROLLBACK.md` — sesión tarde/noche 22 may: refactor Tareas a agente-first → revertido a form clásico + botón 📌 "Programar este prompt" en topbar + auto WaitForMcpServers en scheduler. Fix Telegram sink (Set/Array). Fix cwd default a $HOME. Bandeja 🔔, popup PTY task-session, vista detalle + RUNS sidebar. Borrados: task-agent-pty.\*, task-chat.\* (burbujas), botón "+ Asistente", `#session-info-block`. Empezar por aquí si tocas Tareas/scheduler.
- **`HANDOFF-CODEX-2026-05-22-WHATSAPP-GRUPOS-AUTO-GLOBAL.md`** — cierre de continuidad: grupos forzados a MANUAL (backend+UI) y botón `AUTO TODO` para forzar AUTO masivo en chats individuales.
- **`HANDOFF-CODEX-2026-05-22-WHATSAPP-PANEL-CONTINUIDAD-FINAL.md`** — continuidad final WhatsApp (STOP/START bridge estable sin refresh manual, QR modal con polling+reintento, descarga de media desde visor y fix de race: auto-reply global OFF invalida colas pendientes + apaga typing UI).
- **`HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md`** — RELEASE ACTUAL (1.3.0). Ola 1 + Ola 2 + post-fixes: Electron 32 LTS, main.js modularizado a 34 módulos en `main/`, WhatsApp bridge con auth token, sesiones Codex en LAN, hot session switch, drag&drop con webUtils. Tag `release-1.3.0-2026-05-22`. Empezar SIEMPRE por este archivo.
- `HANDOFF-CODEX-2026-05-21-REMOTE-SESSION-CONTINUIDAD-CHAT-FIRST.md` (continuidad final de sesión remota LAN: flujo cámara/archivo chat-first, fixes de ACL read-only, despliegue y pendientes de rediseño/refactor UX).
- `HANDOFF-CODEX-2026-05-21-CONTINUIDAD-POST-PRUEBAS.md` (continuidad exacta tras modo empresa: estado, commits, incidencias reales de Luis, backlog móvil/visor/upload y prompt para nuevo Codex).
- `HANDOFF-CODEX-2026-05-21-ENTERPRISE-MULTIOPERADOR.md` (modo empresa multioperador: modelo, ACL FS, persona por sesión, MCP policy básica y auditoría).
- `HANDOFF-CLAUDE-2026-05-18.md` (estado final Telegram relay PTY, sesiones, lupa y grafo cerebro).
- `HANDOFF-CLAUDE-2026-05-18-FINAL-REACTOR.md` (estado final actual: root reactor x3, despliegue limpio de una sola app).

## Para CUALQUIER agente nuevo (Claude o Codex)
1. Leer **`HANDOFF-CODEX-2026-05-22-WHATSAPP-PANEL-CONTINUIDAD-FINAL.md` ENTERO** antes de tocar WhatsApp/panel bridge.
2. Leer **`HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md` ENTERO** antes de tocar arquitectura general.
3. Leer también `HARDENING-WA-AUTH.md` si vas a tocar WhatsApp.
4. Leer `ELECTRON-32-UPGRADE-NOTES.md` si vas a tocar APIs de Electron o `protocol.*`.
5. Leer `SIGNING-NOTARIZE-SETUP.md` solo si tocas firma/distribución.
6. Versión actual: **1.3.0**. Electron **43.2.0** (Chromium 150). Node de desarrollo `>=20.18.0`. `main.js` ya modularizado en 34 archivos `main/*.js`.
7. Rollback de emergencia: `git reset --hard pre-ola2-2026-05-22` (vuelve a 1.2.0/Electron 20).

## Scope
- Project path: `/Users/isabel/Desktop/LUISMI/claude-electron`
- App type: Electron desktop app with `node-pty` terminal + Whisper dictation.
- Client install checklist: `INSTALACION_CLIENTE.md`

## Regla critica WhatsApp (OBLIGATORIA)
- Nunca enviar mensajes a numeros locales ambiguos (ej. `653765305`) sin prefijo internacional confirmado.
- Si el usuario no indica pais/codigo, preguntar siempre antes de enviar: `¿Que pais/codigo uso para este numero?`.
- Solo se permite enviar cuando:
  - el numero llega en formato internacional (`+...` o `00...`), o
  - el usuario confirma explicitamente el codigo de pais (ej. `--cc 34`).
- Queda prohibido asumir `+34` (o cualquier otro pais) por defecto.
- Ante duda de formato/destino: bloquear envio y pedir confirmacion.

## Git automático por sesión

- **Qué hace**: cada sesión (ventana local o sesión LAN) con `cwd` dentro de un repo git local trabaja en su propio `git worktree` + rama `poweragent/session-<key>`, no en el directorio real. `session.cwd` sigue mostrando el path real (UI/recientes intactos). Al cerrar la sesión: commit automático → sin cambios se limpia en silencio → con cambios se intenta merge a la rama del dir real (solo si está limpio) → merge limpio borra rama/worktree y hace `push` si hay upstream.
- **Toggle**: `cli.gitSessionIsolation` (Configuración → "Aislamiento git por sesión"), default ON. Escape hatch total: en OFF, o si el cwd no es repo git, o es path remoto (NAS/SMB), o falla cualquier comando git → fail-open al flujo de siempre, sin bloquear el spawn.
- **Ramas de conflicto**: si el merge da conflicto o el dir real está sucio, la rama `poweragent/session-<key>` queda viva con los cambios (no se borra) y se avisa: `Notification` de macOS en ventana local, `console.warn` + frame `status` por WebSocket en LAN. Revisar y mergear a mano esas ramas.
- **Ubicaciones**: worktrees en `userData/worktrees/<repoSlug>-<sessionKey>/`; registro de sesiones en `userData/session-git-map.json` (mapea `claudeSessionId → { realCwd, branch, worktreePath, active }`, atomic writes, flush en `before-quit`). Sweep de huérfanos al arrancar (`git worktree prune` + finalize de entradas `active: true` sin PTY vivo). El registro **solo se escribe cuando la sesión llega a generar un `claudeSessionId`**, así que el arranque completa el barrido con `discoverUnregisteredWorkspaces()`: escanea `userData/worktrees/`, y todo worktree que no esté en el registro se trata como huérfano (al arrancar no hay ningún PTY vivo y la app es single-instance). Se recupera igual que los registrados: commit → merge → limpieza.
- **Qué NO está aislado**: automation PTY (`startAgentPty`) y task-sessions/pool oculto de Telegram (`startTaskSessionPty`) siguen con `--resume` sobre el cwd original. Pendiente integrarlos cuando esto esté validado en uso real. El sub-chat desechable (`main/subchat-pty.js`) tampoco pasa por `ensureSessionWorkspace`: hereda el `workCwd` del worktree de su sesión madre (mismo aislamiento que ella, sin worktree propio). Es un hilo de consulta; si edita archivos, los cambios caen en la rama de la madre.
- **Regla para spawns nuevos**: cualquier spawn de PTY nuevo debe decidir explícitamente si pasa por `ensureSessionWorkspace`/`prepareSessionWorkspace` (aislado) o queda excluido — y documentarlo aquí. No dejarlo implícito. `respawnAfterCliUpdate` (reinicio tras auto-update del CLI) **no** vuelve a llamar a `ensureSessionWorkspace`: reutiliza el `session.gitWorkspace` ya creado, así que sigue en el mismo worktree y la misma rama.
- **Limitaciones documentadas**: (0) el `add -A` del finalize commitea artefactos que el `.gitignore` NO matchea por usar patrón con barra final — caso real: un symlink `node_modules` creado en el worktree para correr tests acabó commiteado (`node_modules/` solo matchea directorios, no symlinks). Usar patrones sin barra para lo que pueda aparecer como symlink, y nunca symlinkar `node_modules` dentro de un worktree; (1) archivos gitignored creados durante la sesión se pierden al finalizar (`worktree remove --force`; `add -A` respeta el gitignore); (2) sesiones CODEX nacidas en worktree no aparecen en el historial del proyecto (el índice codex bucketiza por cwd del rollout) — limitación v1 consciente; (3) el operador LAN no ve el aviso de conflicto si el socket ya cerró (el dueño del Mac conserva la rama y el `console.warn`).
- Módulos: `main/session-git.js` (lógica git + registro), `main/session-git-map.js` (persistencia). Detalle de diseño: `docs/superpowers/specs/2026-07-24-git-auto-por-sesion-design.md`.

## Auto-update de los CLI dentro del PTY

- **PATH del PTY**: en `main/cli-resolver.js` `buildRuntimeEnv()`, el bin de nvm va **antes** de `/usr/local/bin`. Si gana el node de `/usr/local`, su prefix global es `/usr/local/lib/node_modules` (no escribible) y el `npm install -g @openai/codex` del auto-update de codex ("1. Update now") muere con **EACCES**. Cubierto por `tests/cli-env-path.test.js`. No reordenar sin leer ese test.
- **Reinicio**: codex se cierra tras actualizarse ("Please restart Codex"). `main/cli-update-watch.js` detecta `Update ran successfully` en la salida del PTY (tolera el marcador partido entre chunks) y `main.js` relanza la sesión con los mismos args (`session.lastPtyArgs`) en vez de emitir `pty-exit` — sin eso, el renderer daba la sesión por terminada y abría el picker. Máx. 1 reinicio automático por ventana de 10 min.
- El renderer recibe `pty-restarting` (no `pty-exit`): escribe el aviso, mantiene `has-pty` y no toca el picker.

## Incident history
- Date: **2026-05-14**
- Symptom 1: app crash on startup (`SIGABRT`, stack in `_RegisterApplication` / `NSApplication`).
- Symptom 2: packaged app crash with secure-restorable-state warning behavior.
- Symptom 3: `.dmg` build failure from constrained environments.

## Root cause summary
- Startup crash was tied to macOS saved application state + missing explicit secure restorable-state opt-in.
- DMG build failure was environment-level: `hdiutil` cannot run in sandboxed sessions (`Cannot start hdiejectd because app is sandboxed`).

## Permanent fixes applied
1. `package.json` now includes:
   - `build.mac.extendInfo.NSApplicationSupportsSecureRestorableState = true`
2. New recovery script:
   - `npm run reset:state`
   - Backs up these folders if present:
     - `~/Library/Saved Application State/com.github.Electron.savedState`
     - `~/Library/Saved Application State/com.luismi.claude-electron.savedState`
     - `~/Library/Saved Application State/com.luismi.claude-novak.savedState`
3. New diagnostics script:
   - `npm run doctor`
4. More robust CLI resolution in `main.js`:
   - Uses env vars / `~/.local/bin` / PATH fallback for `claude`, `codex`, `whisper`.
5. PTY hardening in main/renderer:
   - Validates active CLI before spawn.
   - Emits `pty-error` to UI with explicit message instead of silent failure.
   - Restart/session resume paths now reject properly on spawn errors.
   - CLI switch includes rollback to previous CLI if restart fails.

## Protocolo de despliegue y prueba

### Regla de oro
Después de cualquier cambio de código, probar SIEMPRE en **modo dev** antes de empaquetar.

### Cómo lanzar en modo dev (desde Claude Code / agente)

⚠️ **`pkill -f "POWER-AGENT.app"` NO mata la app** (verificado 2026-07-28: la instancia sobrevive y sigue creando helpers). Usar el cierre ordenado de macOS para la empaquetada y `pkill -9` para la de dev.

```bash
# 1. Matar cualquier instancia previa (dev Y empaquetada)
osascript -e 'quit app "POWER-AGENT"' 2>/dev/null          # empaquetada: cierre ordenado (dispara before-quit)
pkill -9 -f "claude-electron/node_modules/electron" 2>/dev/null   # dev
sleep 3

# 2. Si la app murió a lo bruto, limpiar el lock huérfano (si no, el siguiente
#    arranque se suicida EN SILENCIO, sin ningún mensaje de error)
UD="$HOME/Library/Application Support/CLAUDE-NOVAK"
[ -e "$UD/SingletonLock" ] && ! pgrep -f "claude-electron/node_modules/electron" >/dev/null \
  && rm -f "$UD/SingletonLock" "$UD/SingletonSocket" "$UD/SingletonCookie"

# 3. Lanzar en la sesión gráfica del usuario vía osascript
osascript /tmp/launch_poweragent.scpt
# Si el script no existe, créalo primero:
cat > /tmp/launch_poweragent.scpt << 'EOF'
set projectPath to "/Users/isabel/Desktop/LUISMI/claude-electron"
set cmd to "cd " & quoted form of projectPath & " && npm start"
tell application "Terminal"
    activate
    do script cmd
end tell
EOF
osascript /tmp/launch_poweragent.scpt
```

### Por qué osascript y no Bash directo
Claude Code corre en un subprocess sin acceso al WindowServer de macOS. Electron necesita el WindowServer para abrir ventanas. `osascript` delega el lanzamiento a la sesión gráfica del usuario, donde sí tiene acceso.

### Verificar que está corriendo el modo dev (no el empaquetado)
```bash
ps aux | grep electron | grep -v grep | head -2
# Debe mostrar: node_modules/electron/dist/Electron.app ... --app-path=/Users/isabel/Desktop/LUISMI/claude-electron
# NO debe mostrar: dist/mac/POWER-AGENT.app
```

### Verificar que además tiene VENTANA
```bash
ps aux | grep "claude-electron/node_modules/electron" | grep -v grep | grep -o "\-\-type=[a-z-]*" | sort | uniq -c
# Debe aparecer --type=renderer. Si solo hay gpu-process + utility, la app
# arrancó sin ventana (típico del lock huérfano: el main nuevo se suicidó y
# quedaron helpers sueltos de la instancia vieja).
```

**Dev y empaquetada nunca conviven**: ambas usan el mismo `userData` (`app.setPath('userData', .../CLAUDE-NOVAK)` en `main.js`), luego comparten `SingletonLock`. Si una está viva, la otra arranca y se cierra sola sin avisar.

### Cómo empaquetar (solo cuando el modo dev funciona)
```bash
npm run build:zip   # ZIP para distribución rápida
npm run dist        # DMG + ZIP ambas arquitecturas
```

### Desplegar en /Applications para abrir con doble clic
```bash
npm run deploy
```
Hace todo en secuencia:
1. Mata instancias activas
2. Compila build x64 (`dist/mac/POWER-AGENT.app`)
3. Copia a `/Applications/POWER-AGENT.app` y quita cuarentena (`xattr -cr`)
4. Abre la app via Finder (necesario porque Claude Code no tiene WindowServer)

**IMPORTANTE — Mac Intel (x86_64):** usar `dist/mac/POWER-AGENT.app`  
**Mac Apple Silicon (arm64):** usar `dist/mac-arm64/POWER-AGENT.app`  
Este Mac es Intel → el script usa x64.

**Por qué `xattr -cr`:** macOS bloquea apps descargadas/compiladas localmente sin firma. `xattr -cr` elimina el flag de cuarentena. Sin esto aparece el icono de "no compatible" aunque la arquitectura sea correcta.

**Por qué no `open` directo:** Claude Code corre en subprocess sin WindowServer. Hay que abrir vía `osascript` o Finder.

### Checklist post-cambio
1. `node --check main.js` → sin errores
2. `node --check renderer.js` → sin errores
3. Matar instancias previas
4. Lanzar modo dev con osascript
5. Verificar con `ps aux` que corre el dev, no el empaquetado
6. Si todo OK → `npm run deploy` para instalar en /Applications
6. Probar la feature en la app
7. Solo si OK → empaquetar

## Standard commands
- Dev run: `npm run start`
- Full build: `npm run dist`
- ZIP only: `npm run build:zip`
- DMG only: `npm run build:dmg`
- Diagnostics: `npm run doctor`
- Reset saved state: `npm run reset:state`

## Configuracion (desde la app)
- Boton `Configuracion` (icono engranaje en barra superior).
- Seccion CLI:
  - `CLI por defecto` (`claude` o `codex`).
  - `CLAUDE_BIN`, `CODEX_BIN`, `WHISPER_BIN` (opcional, override local).
- Seccion Telegram:
  - `Activar puente Telegram`.
  - `Bot token`.
  - `Allowed users` (IDs numericos de Telegram separados por coma).
- Al guardar:
  - Persiste en `~/Library/Application Support/CLAUDE-NOVAK/claude-novak.config.json` (ruta `userData` de Electron).
  - Reaplica CLI y reinicia terminal.
  - Reinicia bridge Telegram si esta activado.

## Telegram bridge (movil -> Mac)
- Arquitectura: gateway local (long polling) Telegram -> PTY local -> respuesta Telegram.
- Seguridad:
  - Acceso solo para `allowed users`.
  - Si usuario no autorizado escribe, recibe rechazo.
- Comandos soportados:
  - `/help`
  - `/status`
  - `/cwd`
  - `/restart`
  - `/cli claude|codex`
- Mensajes de voz:
  - Descarga audio de Telegram, transcribe con Whisper local y lo inyecta al terminal.

## Operational notes
- If app starts crashing again:
  1. `npm run doctor`
  2. `npm run reset:state`
  3. Rebuild (`npm run build:zip` or `npm run dist`)
- If `npm run start` fails only in restricted/sandboxed execution runners:
  - Verify again in a normal local terminal session (outside sandbox).
  - This specific crash signature can be environment-related (`SIGABRT` before app JS loads).
- If DMG fails with `hdiutil`/`hdiejectd` sandbox errors:
  - Run DMG build outside sandbox/restricted session.
- ZIP artifacts are usually reliable even when DMG fails in constrained environments.

## Build artifacts
- Output folder: `dist/`
- Intel app: `dist/mac/POWER-AGENT.app`
- Apple Silicon app: `dist/mac-arm64/POWER-AGENT.app`
- Intel DMG: `dist/POWER-AGENT-1.0.0.dmg`
- ARM64 DMG: `dist/POWER-AGENT-1.0.0-arm64.dmg`

## CI/CD

### Tests en local
```bash
node --test tests/*.test.js
```
- Atajo equivalente: `npm test`.
- Requiere Node `20.18.0` (rango `>=20.18.0 <23` declarado en `package.json` engines).
- El Mac de Luismi tiene Node 24 como sistema → antes de `npm install` / `npm test`:
  ```bash
  nvm use 20.18.0
  ```
  Si no está instalada: `nvm install 20.18.0`. El `.nvmrc` del repo ayuda a fijarla.

### Pre-commit hook
```bash
scripts/install-git-hooks.sh
```
- Copia symlink relativo a `.git/hooks/pre-commit` apuntando a `scripts/pre-commit.sh`.
- En cada commit corre:
  - `node --check` sobre los `.js` staged (excluye `node_modules/`, `dist/`, `build/`, `out/`, `automations/`).
  - `node --test tests/*.test.js` (timeout 5min, override con `PRE_COMMIT_TEST_TIMEOUT=secs`).
- Bypass puntual: `git commit --no-verify`.
- Desinstalar: `rm .git/hooks/pre-commit`.

### CI (GitHub Actions)
- Workflow: `.github/workflows/test.yml`.
- Triggers: push a `main` y PRs hacia `main`.
- Runner: `macos-latest` (la app es Mac-only).
- Node: `20.18.0` (cache npm).
- Steps: `npm ci` + `node --test tests/*.test.js`.
- Timeout: 10min. Permisos: `contents: read` (solo lectura, sin deploys ni releases).
