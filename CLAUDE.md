# POWER-AGENT Runbook

## Latest Handoff
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
6. Versión actual: **1.3.0**. Electron 32.3.3 LTS. Node 20.18.0. `main.js` ya modularizado en 34 archivos `main/*.js`.
7. Rollback de emergencia: `git reset --hard pre-ola2-2026-05-22` (vuelve a 1.2.0/Electron 20).

## Scope
- Project path: `/Users/isabel/Desktop/claude-electron`
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
```bash
# 1. Matar cualquier instancia previa (dev O empaquetada)
pkill -f "POWER-AGENT.app" 2>/dev/null
pkill -f "electron \." 2>/dev/null
sleep 1

# 2. Lanzar en la sesión gráfica del usuario vía osascript
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
