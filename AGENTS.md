# POWER-AGENT — Runbook

App Electron de escritorio (Mac Intel, macOS 12) con terminal `node-pty` para los CLI `claude`/`codex`, dictado y modo voz, bridge Telegram/WhatsApp, tareas programadas y sesiones LAN. Path: `/Users/isabel/Desktop/LUISMI/claude-electron`. Este fichero es el runbook único para CUALQUIER agente (Claude Code lo lee como `CLAUDE.md`, que es un symlink a este fichero; Codex lo lee como `AGENTS.md`).

## Orden de lectura (siempre)

1. `.claude/memory/STATE.md` — estado vivo verificado (rama, último commit, tests, deploy, próximo paso). La ÚNICA foto fiable de hoy: si cualquier otro documento la contradice, manda STATE.md.
2. Este runbook — reglas vigentes y protocolo operativo.
3. Bajo demanda, el detalle por subsistema en `.claude/memory/` (índice: `.claude/memory/INDEX.md`). Los `docs/archive/handoffs/` son arqueología de mayo 2026 — no los leas por defecto.

## Contrato de capas de la memoria (dónde vive cada cosa)

- **Estado** → `.claude/memory/STATE.md`. Se SOBRESCRIBE al cierre. Nada de historia.
- **Reglas operativas vigentes y protocolos** → este runbook. Se PODA: al añadir una regla nueva, una línea con el porqué y enlace a su ficha; si una sección crece o caduca, se muda a ficha.
- **Detalle por subsistema** → `.claude/memory/tech/runbook_*.md` (operativo vivo movido del runbook) y `tech/tech_*.md`, `bugs/`, `decisions/` (fichas de sesión). Se AÑADE, no se reescribe-resume; lo caduco se archiva.
- **Índice de fichas** → `.claude/memory/INDEX.md`, una línea por ficha. Toda ficha nueva se registra ahí.
- **Crónica de sesiones** → memoria auto de Claude Code (`~/.claude/projects/<slug>/memory/`), fuera del repo, con respaldo git propio.
- Cada hecho vive en UN sitio; el resto son enlaces. Al cerrar sesión, `/wrap` aplica este contrato.

## Reglas duras vigentes (el detalle, en su ficha)

### Relay, sesiones y forks — `tech/runbook_relay_telegram.md`
- Fuente de verdad = transcript JSONL; jamás el TUI raspado. Fin de turno = último `assistant` no-sidechain con `stop_reason: 'end_turn'`.
- Todo write de prompt a un PTY de claude pasa por `writePromptThenEnter` (`main/pty-prompt-write.js`): el ENTER va en escritura APARTE o el turno queda escrito sin enviar.
- Lectura de transcripts SIEMPRE parcial (offset + stat); jamás `readFileSync` entero. Si el offset cae tras un `\n`, la primera línea del slice está completa: no descartarla.
- El `--resume` (interactivo o spawn) FORKEA el sessionId: el `.jsonl` viejo no crece jamás. Detección por prompt (`detectForkedRelayTranscript`) o vigía con tres guardas; todo fork nuevo debe registrar su sessionId o alguien lo adoptará.
- Un sessionId ADIVINADO no se persiste jamás en la sesión (bug `6956fd5`): lo escriben solo spawn, vigías o relay verificando por prompt. "Latest por mtime" vale para PINTAR, nunca para asignar.
- Un `baseOffset` de 0 sobre un transcript forkeado cierra el turno con la respuesta ANTERIOR: recalcular offset sobre el propio prompt (`safeForkOffset`) o pasar `minTimestampMs`.
- El transcript NO vive donde corre el proceso: localizar por sessionId (`findRelayTranscript`), jamás derivar del cwd. El headless resuelve cwd con `resolveResumeCwd`.
- La compactación "últimos 20 turnos" está RETIRADA (huérfanaba la conversación real) — NO reintroducirla; el headless resume SIEMPRE la sesión real.
- Chat con `binding.bound` cuyo relay PTY falla → error claro; PROHIBIDO fallback headless.
- Todo texto que entra por un canal (Telegram/WhatsApp/notify) pasa por `sanitizeChannelText` (`main/untrusted-input.js`) antes de tocar un PTY; canal nuevo = pasarlo por ahí y documentar su política.
- Avisos de automatizaciones → SIEMPRE por el notify bot si está configurado (`notifyBotToken`/`notifyChatId` con fallback), sin tocar `rememberRunForChat`/pool como efecto colateral.

### Git por sesión y spawns — `tech/runbook_git_por_sesion.md`
- Todo spawn de PTY nuevo decide EXPLÍCITAMENTE si pasa por `ensureSessionWorkspace` (aislado en worktree) o queda excluido — y se documenta en esa ficha. `session.cwd` muestra siempre el path real.
- Conflicto en el finalize → la rama `poweragent/session-<key>` queda viva y se avisa; revisar y mergear a mano.
- `.gitignore`: patrones sin barra final para lo que pueda aparecer como symlink; jamás symlinkar `node_modules` dentro de un worktree.
- Todo spawn claude nuevo pasa `--model` o reaparece el gate 1M (`bug_claude_1m_credits`).

### Modo voz — `tech/runbook_modo_voz.md`
- Motor Apple Speech en SERVIDOR; no "optimizar" a on-device (medido: RTF>1 en este i7). Sin `setVoiceProcessingEnabled` (4 canales rompen SFSpeech + ducking global).
- El micro se cierra mientras habla Y mientras piensa (se auto-interrumpía con su propia voz). El helper maneja UNA frase a la vez: encolar desde Node (`voice-speech-queue`).
- Synth a fichero: el fin lo marca `didFinish` del delegate (el buffer frameLength 0 no llega en macOS 12); el callback de `write()` se ejecuta en línea en MAIN thread.
- Solo `claude` (codex no delimita fin de turno). El helper se firma y empaqueta en `scripts/deploy.sh` — no tocar a mano.

### Sesiones codex — `tech/runbook_codex_sesiones.md`
- `session_id` es UUIDv7 (la fecha va dentro); atribución por `ptyStartedAt`, sin él no se adivina. El id adivinado no se persiste (también en codex).
- El TUI de codex sin ANSI queda SIN ESPACIOS (comparar normalizado) y un chunk puede cortar una secuencia ANSI a la mitad (guardar cola).
- Índices con datos derivados validan `INDEX_VERSION` al cargar. Codex no admite dos escritores en la misma conversación (`already has an active writer`).

### Tests y calidad — `tech/runbook_hermes_robos.md` (§ profesionalización)
- Puertos de tests JAMÁS en el rango efímero del SO (49152–65535); banda propia por fichero en 12000–19900.
- Regex de saneado: clases Unicode con escapes `\uXXXX` (nunca invisibles literales); nada de `.test()` sobre regex `/g`.
- Batching IPC solo en `main/pty-data-batcher.js`. Índices con `flush()` en before-quit. `atomicWriteJsonSync` 0o600 para secretos. Allowlists `SAFE_CLI`/`SAFE_TELEGRAM`/`SAFE_LAN` en save-app-config. LAN con Bearer. `looksRemotePath` antes de statSync.
- `package.json` `build.files` es WHITELIST — todo `.js`/`.html` nuevo en raíz se añade a mano.
- Los `<script>` sueltos del renderer comparten ámbito global: un `const` duplicado mata la página entera y los tests no lo ven (`bugs/bug_scripts_renderer_ambito_global.md`); la lógica de renderer que importe se extrae a módulo testeable.
- Tras Write/Edit, verificar en el filesystem antes de afirmar que está guardado. Los deploys se verifican por CONTENIDO/timestamp del asar, no por haber lanzado el script.

## Regla crítica WhatsApp (OBLIGATORIA)

- Nunca enviar mensajes a números locales ambiguos (ej. `653765305`) sin prefijo internacional confirmado. Si el usuario no indica país/código, preguntar SIEMPRE antes de enviar: "¿Qué país/código uso para este número?".
- Solo se permite enviar cuando el número llega en formato internacional (`+...` o `00...`) o el usuario confirma explícitamente el código de país. PROHIBIDO asumir `+34` (o cualquier otro) por defecto. Ante duda de formato/destino: bloquear envío y pedir confirmación.
- Sin orden explícita de Luismi en ese momento, no se envía NADA por WhatsApp: ni pruebas, ni confirmaciones, ni contenido inofensivo. Nunca llamar al bridge (`127.0.0.1:3031`) sin el header `X-Auth-Token` (`whatsapp/whatsapp-auth.js`).

## Protocolo de despliegue y prueba

**Regla de oro**: después de cualquier cambio de código, probar SIEMPRE en modo dev antes de empaquetar.

⚠️ `pkill -f "POWER-AGENT.app"` NO mata la app empaquetada. Dev y empaquetada NUNCA conviven (mismo `userData` → mismo `SingletonLock`; la segunda instancia se suicida EN SILENCIO).

```bash
# 1. Matar cualquier instancia previa (dev Y empaquetada)
osascript -e 'quit app "POWER-AGENT"' 2>/dev/null          # empaquetada: cierre ordenado (dispara before-quit)
pkill -9 -f "claude-electron/node_modules/electron" 2>/dev/null   # dev
sleep 3

# 2. Si murió a lo bruto, limpiar el lock huérfano (si no, el siguiente arranque se suicida sin mensaje)
UD="$HOME/Library/Application Support/CLAUDE-NOVAK"
[ -e "$UD/SingletonLock" ] && ! pgrep -f "claude-electron/node_modules/electron" >/dev/null \
  && rm -f "$UD/SingletonLock" "$UD/SingletonSocket" "$UD/SingletonCookie"

# 3. Lanzar en la sesión gráfica del usuario vía osascript (Claude Code no tiene WindowServer)
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

Verificaciones:
```bash
# Corre el dev (no el empaquetado):
ps aux | grep electron | grep -v grep | head -2   # debe mostrar node_modules/electron/... --app-path=.../claude-electron
# Y tiene VENTANA:
ps aux | grep "claude-electron/node_modules/electron" | grep -v grep | grep -o "\-\-type=[a-z-]*" | sort | uniq -c
# Debe aparecer --type=renderer; solo gpu-process+utility = arrancó sin ventana (lock huérfano típico)
```

Checklist post-cambio: `node --check main.js` y `node --check renderer.js` → matar instancias → dev por osascript → verificar con ps → probar la feature → solo si OK, `npm run deploy`.

**Deploy a /Applications**: `npm run deploy` (mata instancias, build x64, copia a `/Applications/POWER-AGENT.app`, `xattr -cr`, abre vía Finder). Mac Intel → usar SIEMPRE `dist/mac/POWER-AGENT.app` (arm64 sería el binario equivocado sin avisar). Verificar el deploy por contenido/timestamp del asar.

## Comandos estándar

- Dev: `npm run start` · Build: `npm run dist` (DMG+ZIP) / `npm run build:zip` · Diagnóstico: `npm run doctor` · Estado roto al arrancar: `npm run reset:state`
- Tests: `npm test` (= `node --test tests/*.test.js`). Requiere Node `20.18.0` (`nvm use 20.18.0`; el Mac tiene 24 de sistema). Deben salir 0 fail.
- Pre-commit hook: `scripts/install-git-hooks.sh` (node --check de staged + suite completa; bypass puntual `--no-verify`). OJO: jamás `git commit | tail &&` — el pipe se come el exit del hook.
- CI: `.github/workflows/test.yml` (push/PR a main, macos-latest, Node 20.18.0).
- Rollback de emergencia: `git reset --hard pre-ola2-2026-05-22` (vuelve a 1.2.0/Electron 20).
- Electron **43.2.0** (Chromium 150) — la última que soporta macOS 12 Monterey; la 44 exige Ventura. Trampas de APIs: `ELECTRON-43-UPGRADE-NOTES.md`. Firma/notarización: `SIGNING-NOTARIZE-SETUP.md`. WhatsApp auth: `HARDENING-WA-AUTH.md`. Checklist manual del modo voz: `CHECKLIST-VOZ-MANUAL.md`.

## Dónde está el resto

- Detalle por subsistema: `.claude/memory/tech/runbook_relay_telegram.md` (relay, forks, badge de modelo, auto-update CLI), `runbook_git_por_sesion.md`, `runbook_modo_voz.md`, `runbook_codex_sesiones.md`, `runbook_telegram_bridge.md` (comandos del bot, notas de voz, bot de avisos, configuración), `runbook_hermes_robos.md` (pairing, saneado, doctor, panel 📈), `runbook_incidentes_2026_05.md` (crash de arranque de mayo y fixes).
- Índice completo de fichas: `.claude/memory/INDEX.md`. Historia de sesiones: memoria auto (`MEMORY.md`). Arqueología: `docs/archive/handoffs/INDICE.md`. Instalación cliente: `INSTALACION_CLIENTE.md`.

_Última revisión: 2026-08-09 (dieta del runbook: 65 KB → este fichero). Si algo de aquí contradice a STATE.md, manda STATE.md._
