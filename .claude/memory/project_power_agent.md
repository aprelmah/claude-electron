---
name: project-power-agent
description: POWER-AGENT (ex CLAUDE-NOVAK) Electron app - terminal Claude/Codex + voz + bridge Telegram headless
metadata: 
  node_type: memory
  type: project
  originSessionId: b1371455-b105-4349-890c-01f33c479faf
---

# POWER-AGENT — Electron GUI para Claude Code / Codex
*(ex CLAUDE-NOVAK — rebranded 2026-05-15)*

## Qué es
App Electron que embebe los CLIs `claude` y `codex` en una interfaz con:
- Terminal xterm.js (PTY del CLI activo, soporta `--resume`, `--continue`)
- Dictado por voz (Whisper Spanish local)
- Explorador de archivos con viewer en **ventana independiente** (BrowserWindow propia, multi-instancia, encajada en el área del terminal al abrir)
- Gestor de sesiones por directorio
- **Bridge Telegram headless** (móvil ↔ Claude/Codex, sesión independiente de la UI)

## Rebranding 2026-05-15 (commit `1cfcc36`)
- `productName` y `build.productName` → `POWER-AGENT` (renombra `.app`).
- **Bundle ID intacto**: `com.luismi.claude-novak` (preserva TCC micrófono + saved state).
- **userData pinned**: `main.js` hace `app.setPath('userData', '~/Library/Application Support/CLAUDE-NOVAK/')` para no perder config Telegram (token, allowedUsers, CLI defaults) tras el rebrand. NO renombrar esa carpeta sin migrar contenido.
- Symlink nuevo: `~/Desktop/POWER-AGENT` → `dist/mac/POWER-AGENT.app`. El viejo `~/Desktop/CLAUDE-NOVAK` borrado.
- ARM64 build viejo en `dist/mac-arm64/CLAUDE-NOVAK.app` apartado a `/tmp/_old_mac-arm64_backup_*` (LaunchServices lo resolvía antes que el nuevo). Si necesitas ARM64, re-builda con `npm run dist`.
- Tras rebrand: `lsregister -kill -r` para refrescar registro macOS.

## Path real verificado (2026-05-16)
`/Users/isabel/Desktop/LUISMI/claude-electron/` — movido dentro de LUISMI/. Repo GitHub sigue `aprelmah/claude-electron` (NO renombrado).

## Tech stack
- **Electron 20** (Node 16 interno — incompatibilidad con `@anthropic-ai/claude-agent-sdk` que pide Node ≥18, por eso bridge usa subprocess directo)
- **node-pty** para PTY del CLI
- **xterm.js** + addons (fit, web-links)
- **MediaRecorder** API + **whisper.cpp** (`/usr/local/bin/whisper-cli`, modelo `~/.cache/whisper-cpp/ggml-base-q5_1.bin`) — antes openai/whisper Python pero 10x más lento (2026-05-15)
- **electron-builder** para empaquetado

## Distribución (decisión 2026-05-14)
- **NO se instala en /Applications**. Decisión por problemas con launchd (rlimits + TCC distintos vs ejecución desde directorio de usuario, aunque el bundle sea idéntico SHA256).
- App vive en `dist/mac/POWER-AGENT.app` (build x64 Intel).
- Acceso directo: symlink en `~/Desktop/POWER-AGENT` → `dist/mac/POWER-AGENT.app`.
- `npm run deploy` (script `scripts/deploy.sh`): mata instancias (POWER-AGENT y CLAUDE-NOVAK por compat) → build x64 → abre la app. Sustituye al flujo manual de `npm run dist` + copia a /Applications.

## Bridge Telegram (refactor 2026-05-14, commit `6cae455`)
- **Arquitectura headless** — ver [[tech_telegram_bridge_headless]] para el patrón completo.
- Cada mensaje Telegram lanza un proceso nuevo `claude -p --output-format stream-json` o `codex exec --json`. **Sin PTY**, sin eco.
- Sesión Telegram **independiente** de la sesión PTY de la UI (trade-off aceptado — para "control remoto compartido" haría falta Plan B: PTY + lectura de transcript JSONL).
- Persistencia por `chat_id` en `/tmp/claude-electron/telegram-sessions.json`. Reanudación con `--resume` (Claude) / `codex exec resume` (Codex).
- Streaming a Telegram: edición progresiva del mismo mensaje con throttle dual (1.5s / 80 chars), overflow >3800 chars → mensaje nuevo.
- Comandos: `/help`, `/status`, `/cwd`, `/reset` (limpia sesión del chat), `/cancel` (aborta query en curso), `/cli claude|codex`.
- Voz: nota de voz → Whisper → transcripción → mismo flujo headless.

## Configuración por modelo (UI → Configuración → Telegram)
- Selector modelo Claude: Default / Haiku / Sonnet / Opus
- Selector esfuerzo Claude: Default / Low / Medium / High / Xhigh / Max
- Selector modelo Codex: Default (gpt-5.4-mini) / gpt-5.4 / gpt-5.4-mini / o3-mini / o3
- Selector esfuerzo Codex: Default / Low / Medium / High
- Default por defecto en Claude headless: **Opus 4.7 (1M ctx)** — caro. Para uso normal por Telegram, configurar Sonnet+Medium.

## Fix de file descriptors (commit `6cae455`)
Apps Electron lanzadas por launchd reciben soft limit de fds bajo (~8192 efectivo). Claude CLI lo agota fácil en carpetas grandes (`.claude/` con miles de jsonl) y crashea con "low max file descriptors". Solución implementada: bash wrapper antes de spawn de claude/codex (PTY y headless). Detalle: [[tech_electron_launchd_fdlimit]].

## Codex CLI gotchas
- Stdin debe estar cerrado (`stdio: ['ignore', 'pipe', 'pipe']`) o se cuelga.
- Requiere `--skip-git-repo-check` para correr fuera de git.
- `--json` da JSONL parseable con `thread.started`, `item.completed` (type=agent_message), `turn.completed`.
- Reasoning effort: `-c model_reasoning_effort=low|medium|high`.
- Resume: `codex exec resume <SESSION_ID> [OPTIONS] [PROMPT]`.
- Detalle: [[tech_codex_cli_quirks]].

## Features de la app (UI)
- Atajo global `Cmd+Shift+Space` toggle ventana.
- **`Cmd+N` nueva ventana, `Cmd+W` cierra la enfocada** (multi-ventana, 2026-05-15).
- `Cmd+Shift+M` graba voz.
- Terminal PTY del CLI seleccionado (Claude/Codex), botón cambiar CLI — independiente por ventana.
- Explorador árbol izquierdo con viewer integrado (texto monospace editable, imagen, binario). Auto-reload con `fs.watch` + firma anti-parpadeo.
- Sesiones por cwd con `list-sessions` / `resume-session` (lee `~/.claude/projects/<cwd>/<id>.jsonl`).
- Tema dark/light persistido (global).
- Pin "siempre encima" (`📌`) — independiente por ventana.

## Comandos npm
```bash
npm start           # dev (electron .)
npm run deploy      # mata + build x64 + abre desde dist/mac
npm run dist        # build completo (DMG + ZIP, x64 + arm64)
npm run build:zip   # solo ZIP, x64 + arm64
npm run doctor      # diagnóstico
npm run reset:state # borra estado guardado macOS si crashea al arrancar
```

## Cómo continuar
1. Leer este archivo.
2. `cd /Users/isabel/Desktop/LUISMI/claude-electron && git log --oneline -10`.
3. Para cambios: editar → `npm run deploy` → probar.
4. Para commit/push: hacer commit normal en main, push a `origin/main` (repo `aprelmah/claude-electron`).

## Estado actual (2026-05-16)

### Nueva capa: Tareas programadas + Automatizaciones del sistema

Sesión 2026-05-15/16 añadió un **sistema completo de automatizaciones** dentro de POWER-AGENT. Cmd+Shift+T abre la ventana singleton "Programación" con 2 pestañas:

**Tab 1 — Tareas programadas**:
- Scheduler interno Electron con `node-cron`.
- Cada disparo lanza un prompt al LLM (Claude o Codex) en headless.
- UI con **selector humano de frecuencia** (Cada día / Días concretos / Cada mes / Una sola vez / Avanzado cron). El usuario NUNCA ve cron salvo en modo Avanzado.
- Output configurable: log app / notif macOS / Telegram.
- Útil para tareas que requieren razonamiento cada vez (resumen de emails, vigilancia con criterio, etc.).

**Tab 2 — Automatizaciones del sistema**:
- El usuario describe en cristiano → Claude Opus headless genera **script bash + plist launchd**.
- Una sola generación, ejecución eterna sin LLM ni POWER-AGENT corriendo (todo lo gestiona launchd).
- Scripts en `~/Library/PowerAgent/automations/<slug>.sh`, plists en `~/Library/LaunchAgents/com.luismi.poweragent.<slug>.plist`, logs en `~/Library/PowerAgent/automations/logs/<slug>.log`.
- **Validación pre-install con shellcheck** (si está `brew install shellcheck`) con retry automático (3 intentos al LLM con feedback).
- **Chat con el agente** por automation (botón 💬): sesión Claude persistente con `--resume`. Selector provider Claude/Codex + model + effort. Bloqueo de provider al primer mensaje, modal explícito para cambiar con resumen automático (últimos 6 msgs). Fallback: si Claude falla → 3 botones (reintentar / cambiar a Codex / empezar de cero).
- Útil para tareas deterministas que no necesitan razonamiento cada vez (backups, syncs, limpiezas, monitorización).

### Módulos backend añadidos

- `scheduler/` — TaskScheduler class, executor, persistence, sinks, cron-presets.
- `automations/` — AutomationManager, generator, installer, validator (shellcheck), chat (sesión persistente), persistence, sinks, slug, schedule-to-cron, system-prompt.
- `headless-runners.js` — extraído de main.js como módulo independiente (`runClaudeHeadless`, `runCodexHeadless`). Factory con inyección de dependencias.

### UI añadida

- `tasks-manager.html` + renderer + preload (singleton).
- `automation-chat.html` + renderer + preload (una por automation activa).
- Botón ⏰ en header de POWER-AGENT y atajo Cmd+Shift+T.

### Skill nueva

- `~/.claude/skills/luismi/automation-builder/SKILL.md` + `patterns.md`. Patrones específicos para macOS (bash 3.2, rsync 2.6.9, jq, launchctl moderno, Keychain NAS, Telegram via config) más checklist obligatorio de auto-revisión que el LLM debe pasar antes de devolver el script.

### Dependencias nuevas

- `node-cron`, `cron-parser` en package.json.

### Bugs/pendientes al cerrar 2026-05-16

- ⚠️ **UI "Parar ejecución" no refresca spinner**: el proceso se mata bien (`launchctl kill SIGTERM` funciona) pero el polling de `runningAutomationIds` (cada 5s) no actualiza el visual. Workaround: cambiar tab y volver, o cerrar/reabrir la ventana de Programación. Fix pendiente: forzar refresh inmediato tras `stopRun` en vez de esperar al próximo tick.
- ⚠️ **El chat del agente PUEDE destruir el script si aplica un fix mal generado** (visto el 2026-05-16: el chat reemplazó un script entero por `...` de 3 bytes). Mitigación pendiente: validar tamaño mínimo + shebang antes de instalar tras un `applyAndReinstall`.
- ⚠️ **shellcheck no instalado** en el Mac actual. Recomendado: `brew install shellcheck` para activar la validación automática.

### Patrones técnicos documentados en esta sesión

- [[tech_macos_bash_rsync_landmines]] — bash 3.2 + rsync 2.6.9 + utilidades macOS.
- [[tech_launchctl_modern]] — launchctl bootstrap/bootout/kickstart.
- [[tech_llm_plist_truncation]] — LLM corta `</plist>`, fix con repairPlist.

### Backup NAS V2

Ver [[project_backup_nas_v2]]. Reconstruido como Automation del sistema, programado a las 03:00 diario.

---

## Estado anterior (2026-05-15)
- Commits recientes:
  - `0dfa36a`: whisper.cpp + dictado nativo macOS dentro del xterm.
  - `02e3a4b`: auto-reload sidebar tree (fs.watch recursivo + focus trigger).
  - `b4d810d` (merge `feat/multi-window`): **multi-ventana + anti-flicker sidebar**. Cmd+N abre nueva ventana, Cmd+W cierra. PTY/sidebar/CLI activo independientes por ventana. Bridge Telegram sigue único, opera contra la ventana primaria (último focus) con snapshot fallback. Detalle: [[tech_electron_multi_window]].
  - `2240c99`: fix UI — `term.reset()+clear()` antes de respawn al cambiar Claude↔Codex (elimina banner residual y `^[[I` del PTY viejo) + debounce 140ms en `window.resize` para no floodear SIGWINCH al arrastrar bordes.
  - `88e7e82`: **viewer de archivos como BrowserWindow independiente** (multi-instancia). Cada archivo abierto desde el árbol abre su propia ventana frameless arrastrable fuera de la app, redimensionable. Botones header: enviar `@path` al CLI activo, guardar, minimizar, cerrar (con confirmación si dirty). IPC: `viewer-open`, `viewer-init`, `viewer-inject-to-active`, `viewer-close-self`, `viewer-minimize-self`, `inject-path`. Lee tema de `localStorage` compartido. Archivos: `viewer.html`, `viewer-renderer.js`, `viewer-preload.js`. Mismo commit: app arranca con `alwaysOnTop=false` y pin sin `active` (antes nacía fijado).
  - `1cfcc36`: **rebrand POWER-AGENT** (visual, bundle id intacto, userData pinned). Título de header reducido a 10px con ellipsis. **Viewer encajado** en el área del terminal: renderer envía `getBoundingClientRect()` de `#terminal-wrap` como hint, main suma `primary.getBounds()` para colocar el viewer dentro del CLI respetando el sidebar (no encima). Fallback al cálculo viejo si falta hint.
- App funcional desde `dist/mac/POWER-AGENT.app`. NO desde /Applications.

## Audio / dictado (2026-05-15)
- **Dictado nativo macOS dentro del terminal xterm.js**: funciona con Control-Control / Fn-Fn gracias a override CSS de `.xterm-helper-textarea` (posición visible 2x2 px). Patrón completo: [[tech_xterm_dictation_macos]].
- **Whisper.cpp** para el botón micro de la app y para notas de voz de Telegram. Pipeline: ffmpeg (loudnorm EBU R128) → wav 16kHz mono → whisper-cli (`-l es -nt -sns -nth 0.3 --prompt "Transcripción en castellano."`).
- **Anti-alucinaciones**: pre-check `mean_volume < -50 dB` → error "Sin audio reconocible". Post-filter regex contra frases típicas (Iglesia/Amara/[MÚSICA]/"Gracias por ver"/"Suscríbete"...). Patrón: [[tech_whisper_anti_hallucinations]].
- **Permiso micro**: `session.setPermissionRequestHandler` + `systemPreferences.askForMediaAccess('microphone')` en `app.whenReady()`. Sin esto, getUserMedia en Electron devuelve stream silencioso (−91 dB) sin disparar popup TCC.
- **Gotcha dev vs empaquetada**: `npm run start` usa bundle ID `com.github.Electron` (TCC negaba silenciosamente). La app empaquetada `com.luismi.claude-novak` sí dispara el popup nativo. Para forzar reset: `tccutil reset Microphone com.github.Electron`.
