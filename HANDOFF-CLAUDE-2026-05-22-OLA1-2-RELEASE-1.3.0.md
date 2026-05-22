# HANDOFF · 2026-05-22 · POWER-AGENT 1.3.0 — Ola 1 + Ola 2 + post-fixes

Sesión cerrada. App desplegada y empujada a `origin/main`. Este documento permite que cualquier equipo (humano o agentes) retome el trabajo mañana sin contexto previo.

---

## 0) Estado al cerrar

- **Rama:** `main`
- **Tag remoto:** `release-1.3.0-2026-05-22`
- **Tags de rollback:** `pre-merge-ola1-2026-05-22`, `pre-ola2-2026-05-22`
- **Última commit:** `c395d0a` (`fix(drag-drop): use webUtils.getPathForFile for Electron 32 compat`)
- **`git status`** limpio salvo `.claude/worktrees/` (worktrees temporales de los agentes — ignorables, se limpian solas).
- **App desplegada:** `/Applications/POWER-AGENT.app` (app.asar 2026-05-22 12:00+, versión 1.3.0).
- **Bridge WhatsApp:** corriendo via launchd `com.luismi.whatsapp-bridge`, token activo en `~/.claude/whatsapp-bridge/.auth-token`.
- **Tests:** `npm test` → 101 totales / 95 pass / 0 fail / 6 skip.
- **Versión:** 1.2.0 → **1.3.0**.

---

## 1) Resumen ejecutivo de la sesión

Sesión maratón de hardening + upgrade + modularización. **Dos olas de 3 agentes Opus paralelos cada una** + 4 fixes en directo. Detalle:

### Ola 1 — 1.1.0 → 1.2.0 (mañana 2026-05-22)
3 agentes Opus en worktrees aisladas. Mergeados todos sin conflicto real:

1. **MAIN-MODULAR-FASE1** — `main.js` 6494 → 5589 LOC. 8 dominios extraídos a `main/*.js`.
2. **WA-HARDENING** — token compartido bridge ↔ cliente WhatsApp, rate limit, sandbox FS en `send-image/audio/document`. **Parcheado bug XSS** (envío de `~/.ssh/id_rsa` como adjunto).
3. **LAN-CODEX** — sesiones Codex en selector LAN (parser `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) + hot session switch sin reconectar WS.

### Ola 2 — 1.2.0 → 1.3.0 (mediodía 2026-05-22)
3 agentes Opus en worktrees. 2 conflictos manuales mínimos en merge:

4. **MAIN-MODULAR-FASE2** — `main.js` 5589 → 3155 LOC. 21 módulos más. Total `main/`: 34 archivos.
5. **ELECTRON-UPGRADE** — Electron 20.x → **32.3.3 LTS**, Node 16 → 20.18.0. node-pty 1.1.0 rebuild. Migración `protocol.registerFileProtocol` → `protocol.handle`.
6. **NOTARIZE-CONFIG** — `build/entitlements.mac.plist`, `build/notarize.js`, scripts `dist:signed`/`dist:unsigned`, guía completa en `SIGNING-NOTARIZE-SETUP.md`.

### Post-fixes (Luismi probó en vivo)
- **WA Salud HTTP 401** → faltaba `X-Auth-Token` en `collectWhatsappBridgeHealth` + `pingBridge`. Commit `f091221`.
- **`pty-start ReferenceError: projectDirFor`** → import huérfano post-Fase 2. Commit `41ea7f1`.
- **`automationsNotReady` undef** → llamada huérfana post-Fase 2. Misma commit `41ea7f1`. Inlineado.
- **LAN selector CLI inicial muestra cli equivocado** → race entre primer `session:list` (con dropdown default) y `status:connected` (con CLI real del enterprise). Commit `c7b7a33`. Fix: cuando el `activeCli` recibido difiere del que generó la lista, dispara refresh silencioso.
- **Selector LAN visible antes de conectar + Codex era default** → ocultado vía CSS `body:not([data-connected="true"]) .session-dock { display: none; }` + invertido orden de `<option>` en `provider-id`. Commit `023eb7f`.
- **Drag & drop devuelve `@undefined`** → Electron 32 removió `File.path` en renderer. Solución: `webUtils.getPathForFile` expuesto vía `contextBridge` en `preload.js` (nuevo `window.api.getPathForFile`). Commit `c395d0a`.

---

## 2) Commits subidos a `origin/main` (orden cronológico)

```
c395d0a fix(drag-drop): use webUtils.getPathForFile for Electron 32 compat
023eb7f ui(lan-client): hide session selector until connected + Claude default provider
c7b7a33 fix(lan-client): refresh session list when server CLI overrides dropdown
41ea7f1 fix(main): wire projectDirFor import + inline automationsNotReady leak
9752473 chore(release): bump to 1.3.0
5ca79c9 merge: phase 2 modularization (21 modules, main.js 5601 -> 3140)
5d029f6 merge: bump Electron 20.x -> 32.3.3 LTS + Node 20
c5aa5e3 merge: macOS signing + notarization config
2a95e50 feat(notarize): add macOS signing + notarization config (conditional on env vars)
+ 21 commits internos de la fase 2 (refactor(main): extract <dominio> a main/<file>.js)
+ 3 commits internos del electron upgrade
f091221 fix(wa): pass X-Auth-Token in bridge health check and pingBridge
5f825d4 chore(release): bump version to 1.2.0
ad391a9 merge: WhatsApp bridge shared auth token + rate limit + media path sandbox
6382d2e merge: LAN Codex sessions + hot session switch + test race fix
a11cd17 merge: extract 8 main.js domains into main/* modules
8865593 wa(hardening): shared auth token + rate limit + media path sandbox
c5d9faa LAN: sesiones Codex en listado + hot session switch sin reconectar WS
+ 8 commits internos de la fase 1
```

---

## 3) Reglas duras nuevas — LEER ANTES DE TOCAR NADA

### 3.1 Electron 32 + Node 20

- **`.nvmrc`** ahora es `20.18.0`. `engines.node` `>=20.18.0 <23`.
- **`File.path` está MUERTO** en renderer. Usa `window.api.getPathForFile(file)` (expuesto en `preload.js` vía `webUtils`).
- **`protocol.registerFileProtocol` está deprecated**. Usar `protocol.handle` + `protocol.registerSchemesAsPrivileged` (ya migrado para `wa-media://`).
- **node-pty**: solo funciona con la versión recompilada en `node_modules/node-pty/bin/darwin-x64-128/` (ABI 128 = Electron 32). Si rebuild falla → `rm -rf node_modules package-lock.json && npm install`.
- **Si vuelve a fallar al desplegar**: `pkill -9 -f "POWER-AGENT.app"` + `pkill -9 -f "POWER-AGENT Helper"` + `npm run deploy`.

### 3.2 WhatsApp bridge auth (token)

- **TODO endpoint HTTP del bridge requiere header `X-Auth-Token: <hex>`** (excepto `/healthz` si lo añades en el futuro).
- Token en `~/.claude/whatsapp-bridge/.auth-token` (`-rw-------`). Auto-generado al primer arranque del bridge nuevo.
- Cliente Node lee el token vía `whatsapp/whatsapp-auth.js` → `readToken(defaultTokenPath())`.
- Si añades una llamada HTTP NUEVA al bridge (port 3031) desde main.js/módulos, **AÑADE el header** o falla con 401.
  - Patrón:
    ```js
    const waAuth = require('./whatsapp/whatsapp-auth')
    const token = waAuth.readToken(waAuth.defaultTokenPath())
    if (token) headers[waAuth.HEADER_NAME] = token
    ```
- Rate limit: `/send/*` 30 req/min, `/messages` 600 req/min, otros 60 req/min. Si excede: 429.
- Cliente: si recibe 401 → relee token + reintenta 1 vez. Si vuelve a fallar → emite `whatsapp:bridge-auth-error` y desactiva auto-reply.
- **Bridge externo en `~/.claude/whatsapp-bridge/`**: NO es repo git. Cambios manuales con snapshot `.bak.YYYYMMDD-HHMMSS`. Recargar con `launchctl kickstart -k gui/$(id -u)/com.luismi.whatsapp-bridge`.

### 3.3 Sandbox FS de media WhatsApp

- `whatsapp:send-image`, `whatsapp:send-audio`, `whatsapp:send-document` ahora pasan por `isMediaInputSafe()` (ver `main.js`).
- **Bug previo crítico** (parcheado en `8865593`): cualquier XSS en panel WA podía exfiltrar `~/.ssh/id_rsa` adjuntándolo. No revertir.

### 3.4 Modularización `main.js`

- **34 módulos** en `main/`. Ver `main/` para inventario.
- Cada módulo expone una función `register*Ipc({ deps })` o `create*({ deps })`.
- Estado global compartido (`sessions Map`, `appConfig`, `telegramBridge`, `whatsappClient`, `lanWsServer`) sigue viviendo en `main.js`. Los módulos lo reciben por DI (parámetros del constructor/registro).
- **Reglas de extracción para Fase 3** (si se hace):
  - Antes de extraer `startPty`/`killPty`/`createWindow`/`relayThroughPty`/`initTelegramBridge`: hay que crear `SessionStore` (encapsular `sessions Map` con eventos `changed`/`removed`/`pty-data`). Sin eso, las extracciones rompen tests.
  - Detalle de bloqueos en el reporte del agente MAIN-MODULAR-FASE2 (también en este handoff sección 7).
- **NUNCA borres una función "muerta" que veas en `main.js`**. Mueve, no limpies.

### 3.5 LAN cliente — selector CLI

- **Dropdown CLI default = Claude** (orden `<option>` en `lan-client.html` línea 1452).
- **Proveedor default avanzado = Claude** (línea 1423, intercambiado en commit `023eb7f`).
- **`session-dock` solo visible cuando `data-connected="true"`** (CSS línea 368).
- Al recibir `status:connected` con `cli` distinto al que el cliente usó para la primera petición → dispara `requestReusableSessions({forceRefresh: true, silent: true, cli: activeCli})`. Evita el race del primer load.

### 3.6 LAN sesiones — Codex + hot switch

- Codex sessions parseadas de `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<UUID>.jsonl`. Primera línea es `type:"session_meta"` con `payload.cwd`. Filtro estricto por cwd.
- Cada item devuelto al cliente lleva `cli: 'claude'|'codex'`.
- Hot session switch: `session:start` con `mode: 'hot'` cuando `initialized=true`. Adquiere lock nuevo → mata PTY actual (`SIGTERM` + fallback `SIGKILL` 2s) → spawnea nuevo en mismo socket. Si lock falla: `SESSION_LOCKED`, sesión previa intacta.
- Test de session-lock en baseline tenía race; el agente LAN-CODEX lo arregló con buffer perpetuo en `waitForMessage`. **No revertir.**

### 3.7 Firma / notarización macOS

- Config en `package.json` activa pero **condicional**: si no hay env vars Apple, `npm run dist` y `npm run build:zip` siguen produciendo apps sin firmar (como antes).
- Para firmar + notarizar cuando haya Apple Developer ID:
  ```bash
  export CSC_LINK="$HOME/path/to/cert.p12"
  export CSC_KEY_PASSWORD="..."
  export APPLE_ID="lmah200176@gmail.com"  # o el que sea
  export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
  export APPLE_TEAM_ID="XXXXXXXXXX"
  npm run dist:signed
  ```
- Forzar build sin firma: `npm run dist:unsigned`.
- Detalle paso a paso en `SIGNING-NOTARIZE-SETUP.md`.

---

## 4) Cómo redesplegar / recompilar limpio

```bash
# Matar procesos huérfanos
pkill -9 -f "POWER-AGENT.app/Contents/MacOS/POWER-AGENT"
pkill -9 -f "POWER-AGENT Helper"
sleep 2

# Si vienes de versiones viejas de Electron, rebuild limpio:
rm -rf node_modules package-lock.json
npm install   # rebuild node-pty para ABI 128

# Deploy
npm run deploy
```

Verificar versión instalada:
```bash
defaults read /Applications/POWER-AGENT.app/Contents/Info.plist CFBundleShortVersionString
# debería decir 1.3.0
```

Verificar Electron 32:
```bash
strings /Applications/POWER-AGENT.app/Contents/Frameworks/Electron\ Framework.framework/Electron\ Framework | grep -E "Chrome/[0-9]+" | head -1
# debería decir Chrome/128.0.6613.186
```

Verificar bridge WA:
```bash
launchctl list | grep whatsapp        # debería listar com.luismi.whatsapp-bridge
TOKEN=$(cat ~/.claude/whatsapp-bridge/.auth-token)
curl -s -H "X-Auth-Token: $TOKEN" http://127.0.0.1:3031/status | head
# debería responder JSON 200, NO 401
```

---

## 5) Rollback de emergencia

Si algo se rompe en producción y hay que volver al estado pre-1.3.0:
```bash
git reset --hard pre-ola2-2026-05-22   # vuelve a 1.2.0 con Electron 20
# o más atrás:
git reset --hard pre-merge-ola1-2026-05-22   # vuelve a 1.1.0
git push origin main --force   # CUIDADO, destructivo para colaboradores
npm install   # rebuild node-pty para la versión de Electron correcta
npm run deploy
```

Si solo se quiere probar localmente sin tirar de main:
```bash
git checkout pre-ola2-2026-05-22
npm install && npm run deploy
# cuando estés listo: git checkout main
```

---

## 6) Lo pendiente real (orden recomendado)

### 6.1 Validación funcional completa
Antes de cualquier nuevo cambio grande, **probar en directo**:
- [ ] Drag & drop de imágenes al PTY (fix de `webUtils` post `c395d0a`).
- [ ] WhatsApp: recibir mensaje → auto-reply Claude funcional.
- [ ] WhatsApp: panel envía texto/imagen/audio/documento sin errores.
- [ ] Telegram: relay PTY funciona con chat enlazado.
- [ ] LAN remoto: conectar desde móvil/tablet, listar sesiones Claude y Codex.
- [ ] Hot session switch en LAN: cambiar sesión sin desconectar el socket.
- [ ] Agente PTY: crear/aprobar/rechazar propuesta de automatización (handlers tocados en `main/proposal-ipc.js`).
- [ ] Grafo del cerebro: abrir embebido y standalone, búsqueda, modal de archivo.
- [ ] Sesión enterprise: cambio de perfil/operador, MCP allowlist.
- [ ] Salud del sistema (widget): los 5 indicadores en verde.

### 6.2 Fase 3 modularización — bloqueada por arquitectura
El agente MAIN-MODULAR-FASE2 dejó documentado por qué `main.js` no bajó de 3155 LOC. Bloqueos:

1. **`startPty`/`killPty`/`createWindow`/`destroySession`/`setActiveCli`** (~1000 LOC) tocan `sessions Map`, `primaryWcId`, watchers, claudeSessionId polling, proposalDir. Mover requiere primero crear `SessionStore` con eventos.
2. **`relayThroughPty`** (~220 LOC) lógica reactiva con timers, ECHO_SKIP, capture buffers — necesita refactor coordinado con SessionStore.
3. **LAN server lifecycle** (~200 LOC: `resolveLanSessionConfig`, `runLanSemanticChatTurn`, `ensureLanWsServer`, etc.) acopla `appConfig`, `cliResolver`, `compactClaudeSessionIfNeeded`, headless runners.
4. **`initTelegramBridge`** + `compactClaudeSessionIfNeeded`: wiring de callbacks de comandos Telegram con relay PTY.
5. **Agent PTY system** (~640 LOC): `buildAgentBootstrapPrompt`, `startAgentPty`, `openAutomationPtyWindow`, `openAutomationChatWindow` + handlers `automation-pty:*`. Necesita `AgentPtyManager` con `agentPtySessions` encapsulado.
6. **`app.whenReady` bootstrap** (~270 LOC): solo es plomería pero acopla todo lo anterior.

**Recomendación Fase 3** (orden):
1. Extraer `SessionStore` (clase + EventEmitter sobre `sessions Map` + `primaryWcId`).
2. Construir `PtyManager` + `AgentPtyManager` sobre `SessionStore`.
3. Crear `LanServerManager` que envuelva el lifecycle del LAN.
4. Crear `TelegramBridgeService` con `compactClaudeSessionIfNeeded` movido a `main/telegram-headless.js`.
5. Por último, `bootstrap.js` con instanciación + cierre limpio.

Esto bajaría `main.js` a ~600-800 LOC. **No empezar Fase 3 sin antes validar 6.1 a fondo en producción.**

### 6.3 Apple Developer ID
- Si Luismi decide pagar 99€/año a Apple Developer, todo está listo. Solo setear env vars (ver sección 3.7) y `npm run dist:signed`.
- Sin Apple Developer: la app sigue funcionando, pero al distribuirla a otros Macs requieren `xattr -cr /Applications/POWER-AGENT.app` la primera vez (Gatekeeper).

### 6.4 Vigilancia tras el upgrade Electron 32
- macOS mínimo subió a 10.15+. Verificar en el Mac Intel del usuario (10.x → comprobar).
- Si aparecen logs raros sobre Helpers o sandbox tras varios días de uso, probable causa: secure restorable state. Ejecutar `npm run reset:state`.
- Node sistema del Mac es 24.x (> rango engines `<23`). Da warning `EBADENGINE` al `npm install` pero no bloquea. Idealmente `nvm install 20.18.0`.

---

## 7) Estructura final del repo (post-sesión)

```
main.js (3155 LOC) — bootstrap + handlers no extraídos (PTY directo, automation-pty:*, lan lifecycle)
main/                                                # 34 módulos
├── agent-proposal-watcher.js     # watcher fs de propuestas Agent PTY
├── agent-pty-proposal.js         # parser de propuestas
├── atomic-writes.js              # writes atómicos (.tmp + rename)
├── automation-chat-ipc.js
├── automations-ipc.js
├── bitacora-ipc.js
├── claude-session-cache.js       # cache de títulos
├── claude-session-listing.js     # listClaude/CodexSessionsForCwd
├── cli-resolver.js               # resolución claude/codex/whisper bin
├── codex-session-reader.js
├── config-crud.js                # CRUD profiles/enterprise
├── config-store.js               # load/save app config
├── enterprise-policy.js          # policies modo empresa
├── filesystem-ipc.js             # file-*, fs-*, viewer-open
├── graph-builder.js              # construcción grafo dependencias
├── health-collectors.js          # widget Salud
├── lan-audit.js
├── lan-helpers.js
├── path-sandbox.js               # isPathSafe + allowed/deny roots
├── profiles-enterprise-ipc.js
├── proposal-ipc.js               # handlers proposal:*
├── relay-transcript-helpers.js
├── semantic-logger.js
├── session-helpers.js
├── tasks-ipc.js
├── telegram-relay-bindings.js
├── telegram-session-link-ipc.js
├── viewer-graph-ipc.js
├── whatsapp-ipc.js               # handlers whatsapp:* (no toda la lógica)
├── whisper-transcribe.js
├── window-controls-ipc.js
├── window-factory.js             # openViewerWindow, openTasksManager, etc.
├── ws-server.js                  # WebSocket LAN server (legacy)
└── ws-server-ipc.js              # handlers IPC sobre ws-server

whatsapp/
├── whatsapp-auth.js              # NUEVO: shared auth module
├── whatsapp-auto-reply.js
├── whatsapp-client.js
└── whatsapp-panel.js

build/                            # NUEVO
├── entitlements.mac.plist        # 8 entitlements mínimos
└── notarize.js                   # afterSign hook condicional

renderer.js (4164 LOC)             # frontend xterm (no se ha tocado en esta sesión salvo drag&drop fix)
preload.js                        # bridge contextBridge — añadido getPathForFile (commit c395d0a)
lan-client.html                   # cliente LAN remoto

HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md   # este archivo
HARDENING-WA-AUTH.md                                 # modelo amenaza WA + verificación curl
SIGNING-NOTARIZE-SETUP.md                            # guía firma + notarización
ELECTRON-32-UPGRADE-NOTES.md                         # notas del upgrade
```

---

## 8) Versiones finales

| Componente | Versión |
|---|---|
| POWER-AGENT | 1.3.0 |
| Electron | 32.3.3 LTS |
| Node target (`engines.node`) | >=20.18.0 <23 |
| `.nvmrc` | 20.18.0 |
| electron-builder | ^24.13.3 |
| @electron/rebuild | ^3.7.1 |
| @electron/notarize | ^3.1.1 (devDep nueva) |
| node-pty | ^1.0.0 (instalado 1.1.0) |
| Chromium (vía Electron) | 128.0.6613.186 |

---

## 9) Decisión tomada hoy que merece la pena anotar

- **WhatsApp bridge auth**: token compartido en disco (no JWT, no OAuth). Razón: bridge es local, único proceso de confianza, simplicidad mata sobre-ingeniería.
- **`hardenedRuntime: true` con app sin firmar**: aceptado. Electron-builder respeta el flag. Si en el futuro aparecen issues por esto, revertir a `false` solo en builds sin Apple Developer.
- **Fase 2 modularización no llega <2000 LOC**: aceptado como bloqueador arquitectónico, no como fracaso. Documentado en este handoff y en el reporte del agente.
- **Sin push hasta validación de Luismi en cada paso**: el flujo de hoy fue tag de seguridad → merge local → tests verdes → deploy local → Luismi prueba → si OK push. Mantener este flujo en futuras releases grandes.

---

## 10) Cómo retomar mañana — checklist mínimo

1. `cd /Users/isabel/Desktop/LUISMI/claude-electron`
2. `git fetch && git log --oneline -10` (ver últimos commits)
3. Leer este handoff (`HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md`)
4. Leer `MEMORY.md` (resumen rápido)
5. Verificar app funciona: abrir `/Applications/POWER-AGENT.app` y dar una vuelta por las features clave (sección 6.1).
6. Si todo OK → priorizar Fase 3 o tareas nuevas que aparezcan.

Fin.
