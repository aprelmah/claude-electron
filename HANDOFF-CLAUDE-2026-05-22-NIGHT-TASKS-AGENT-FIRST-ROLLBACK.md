# HANDOFF — Sesión tarde/noche 2026-05-22

**Estado al cierre**: deployado y empujado a `origin/main` en `c173c56`. App corriendo en `/Applications/POWER-AGENT.app`. 125 tests · 119 pass · 0 fail · 6 skip.

## Resumen de UNA línea
Refactorizamos el panel de Tareas a **agente-first**, probamos, **NO funcionó como esperado**, y lo simplificamos a un flujo más pragmático: form clásico + nuevo botón **📌 "Programar este prompt"** en topbar de ventana principal + `WaitForMcpServers` automático en el scheduler.

---

## QUÉ HACE LA APP AHORA (estado funcional final)

### Panel de Tareas programadas
- **+ Nueva**: abre el form clásico (nombre, cron, prompt, model, effort, cwd, resume, sinks). Como toda la vida.
- **Click en tarea existente**: muestra vista detalle bonita (nombre, cuándo, cron, cli, model, sessionId, output sinks, prompt) + columna derecha **RUNS EN VIVO** + 4 botones abajo: `▶ Ejecutar ahora`, `⏸ Pausar`, `💬 Hablar con el agente` (resume sesión en ventana PTY), `Eliminar`.
- **`<details>` "✎ Editar a mano"** colapsable bajo la vista detalle → expande el form para editar campos a pelo.

### Panel principal (ventana POWER-AGENT)
- **🔔 Bandeja de respuestas** en topbar (badge numérico = runs no leídas). Click → dropdown con respuestas pendientes. Click en item → abre ventana PTY (`task-session.html`) con `claude --resume <sessionId>` para iterar la sesión.
- **📌 Botón Programar este prompt** en topbar (al lado de Tareas). Click → modal mini con:
  - **Nombre** (default: "Tarea sin nombre")
  - **Frecuencia** (presets: Cada día 09:00, Cada 4h (9-21), Cada hora, Cada lunes 09:00, Personalizado cron)
  - **Prompt** (textarea prerellenado con `lastUserPromptFromTerm` — heurística que captura lo último que escribió el usuario en xterm; soporta backspace y bracketed paste, ignora secuencias ESC).
  - Guardar → invoca IPC `tasks:create-from-prompt` → upsert al scheduler con defaults `model:'haiku' resume:true sinks:{logApp:true, notifyMacOS:true, telegram:true}`.
- **🔗 icono** en la lista de sesiones cuando una sesión Claude está enlazada a una tarea programada (o Telegram/WhatsApp en el futuro). Tooltip indica con cuál. Si intentas borrar una sesión enlazada → `confirm()` dura.

### Auto-prepend WaitForMcpServers (transparente al usuario)
- Cada vez que el scheduler dispara una tarea con `cli === 'claude'`, **prefija invisible** el prompt del usuario con:
  ```
  PASO 0 (no menciones esto en tu respuesta final, es solo preparación interna):
  Si vas a usar algún MCP local (cualquiera cuyo nombre NO empiece por "claude.ai"),
  invoca primero la tool WaitForMcpServers con servers=[...lista...] y
  timeoutMs=10000 para asegurar que estén conectados antes de continuar.
  ---
  <prompt original del usuario>
  ```
- La lista de MCPs locales se lee de `~/.claude.json` → `mcpServers`, filtrando los que NO empiezan por `claude.ai`. Cache 5 min. Si `~/.claude.json` no existe/falla parsing → no prefija nada y deja el prompt tal cual.
- El usuario NO ve este prefix en el cuadro de PROMPT del editor. Solo llega al claude headless.

### Bug histórico de cwd en tareas — fix
- Si la tarea tiene `cwd: ""`, el executor pasa `os.homedir()` (antes pasaba `undefined`, que hacía que claude heredara el cwd del proceso main de Electron — inconsistente entre runs).
- Resultado: la sesión Claude vive siempre en `~/.claude/projects/-Users-isabel/` y los `--resume` siempre la encuentran.

### Bug Telegram sink — fix
- `bridge.config.allowedUsers` es un `Set`, no array. Antes: `Array.isArray(Set) === false` → `chatId = null` → no enviaba.
- Ahora: handle `Set || Array || object` → extrae el primero. Telegram entrega.
- También: `bridge.sendMessageTo()` (era `sendMessage()`, método inexistente, silenciado por try/catch).

---

## QUÉ SE QUITÓ HOY (cosas muertas)

Borrados completamente del repo:
- `task-agent-pty.html` + renderer + preload
- `main/task-agent-ipc.js`
- `task-chat.html` + renderer + preload (era la versión "burbujas")
- `tasks/chat.js` (lógica del chat burbujas)
- `main/task-chat-ipc.js`
- Botón "+ Asistente" en panel Tareas
- Bloque `#session-info-block` con `[▶ Abrir]` y `[↺ Resetear]` del editor (la sesión ahora vive en "Hablar con el agente")
- IPC: todos los `task-agent:*`, `task-agent-pty:*`, `task-chat:*`

**Vivos pero descontinuados** (código aún presente, sin botón visible):
- `automation-chat.html` + renderer + preload + `automations/chat.js`. Es el chat de burbujas legacy de automatizaciones. No se invoca desde ningún botón UI. Si queda tiempo, borrar.

---

## ARQUITECTURA DEL SCHEDULER (refresco rápido)

```
node-cron (en main process)
  ↓
TaskScheduler.runNow(taskId)   ← scheduler/index.js
  ↓
executor(task)                  ← scheduler/executor.js
  · prepende WaitForMcpServers si cli=claude
  · resuelve cwd a $HOME si vacío
  ↓
runClaudeHeadless({prompt, cwd, sessionId, model, effort})  ← headless-runners.js
  · spawn: claude -p "<prompt>" --resume <sid> --model haiku
           --output-format stream-json --verbose
           --permission-mode bypassPermissions
  ↓
parsea stream-json, captura sessionId rotado, texto final
  ↓
appendRun({runId, taskId, output, status, durationMs, ...})
  ↓
dispara sinks: notifyMacOS, telegram, inbox
  · inbox.appendUnread(item) → broadcast 'tasks:inbox-updated'
  · telegram: bridge.sendMessageTo(chatId, head+body)
  · notifyMacOS: new Notification({title, body}).show()
```

**Tarea con `resume: true`** (default): 1 sesión continua. Claude rota `sessionId` en cada `--resume`. Executor captura el nuevo y lo persiste en la tarea. Próxima run usa el nuevo.

**Tarea con `resume: false`**: cada run sesión nueva desde cero.

**Automatizaciones**: cero Claude en runtime. launchd dispara script bash. Claude solo se usó al CREAR el script vía `automation-pty` (agente vivo).

---

## FICHEROS CLAVE (mapa mental)

| Fichero | Para qué |
|---|---|
| `main.js` (~4200 LOC) | proceso principal Electron, IPC, ventanas, scheduler init |
| `renderer.js` (~5300 LOC) | UI ventana principal, xterm, sesiones, bandeja 🔔, modal 📌 |
| `tasks-manager.html` + renderer + preload | panel Tareas/Automatizaciones, ventana aparte |
| `scheduler/index.js` | `TaskScheduler` clase (node-cron, runNow, sinks) |
| `scheduler/executor.js` | `createExecutor`, prepend WaitForMcpServers, resolve cwd |
| `scheduler/sinks.js` | createSinks (notifyMacOS, telegram, logApp) + createInboxSink |
| `scheduler/persistence.js` | leer/escribir `scheduled-tasks.json` y `scheduled-tasks-runs.json` |
| `scheduler/cron-presets.js` | presets cron legibles |
| `main/tasks-inbox.js` | bandeja persistente `tasks-inbox.json` (creado hoy) |
| `main/session-links.js` | helper "¿esta sesión está enlazada a tarea/telegram/wa?" |
| `main/tasks-ipc.js` | todos los IPC `tasks:*` (incluido `tasks:create-from-prompt` nuevo) |
| `task-session.html` + renderer + preload | ventana popup PTY para `claude --resume <sid>` (botón "Hablar con el agente" y bandeja 🔔) |
| `headless-runners.js` | spawn de `claude -p` y `codex` headless con stream-json |
| `telegram-bridge.js` | TelegramBridge clase (Baileys-like polling, sendMessageTo) |

## PERSISTENCIA

| Ruta | Qué |
|---|---|
| `~/Library/Application Support/CLAUDE-NOVAK/scheduled-tasks.json` | definiciones de tareas |
| `~/Library/Application Support/CLAUDE-NOVAK/scheduled-tasks-runs.json` | historial de runs |
| `~/Library/Application Support/CLAUDE-NOVAK/tasks-inbox.json` | bandeja 🔔 (runs no leídas) |
| `~/Library/Application Support/CLAUDE-NOVAK/claude-novak.config.json` | config app (telegram token, CLI defaults, etc.) |
| `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` | sesión Claude (incluye las de tareas) |
| `~/.claude.json` | `mcpServers` (leído por executor para WaitForMcpServers) |

---

## TAREAS EXISTENTES AHORA MISMO

```json
[
  {
    "id": "a570a47b-4d26-4a0f-bad9-861409a8364d",
    "name": "Revisión correo cada 3h (9-21)",
    "cron": "0 9-21/3 * * *",
    "cli": "claude",
    "model": "haiku",
    "resume": true,
    "sessionId": "f10b316a-b338-…",
    "prompt": "PASO 1: Usa la tool WaitForMcpServers con servers=['gmail-luismi'] y timeoutMs=15000…"
  }
]
```

**El PASO 1 manual del prompt actual es REDUNDANTE** ahora que el executor lo prepende automático. No molesta (claude lo procesará dos veces, sin coste). Si quieres limpiarlo, edita el prompt a mano y deja solo el contenido real (sin PASO 1). Pero NO es urgente.

---

## TIMELINE DE LA SESIÓN HOY (commits)

1. `d981394` — inbox persistence + session-links + IPC reset-session (Agente A)
2. `b49d04e` — UI tasks inbox bell en topbar (Agente B)
3. `38858db` — session info en editor + linked sessions lock (Agente C)
4. `67601b8 / 63d27d4 / e6d743a` — merges de A/B/C
5. `38d8aa5` — resolve cwd desde JSONL cuando task.cwd vacío
6. `ac8e58a` — Telegram sink wire to sendMessageTo
7. `7644c2d / d95b1e4` — popup window xterm `task-session.html`
8. `ad88fec` — editor refresh on run-finished
9. `9227fa7` — bundle task-session + default cwd a homedir
10. `626d50c / a5a3af3` — chat burbujas (luego eliminado)
11. `6bca3c0 / dfda037` — agente-first refactor (luego revertido)
12. `9ab7026` — telegram sink handles Set/Array/object allowedUsers
13. `710267b / c173c56` — **simplificación final**: quitar agente, restaurar form, añadir 📌, auto WaitForMcpServers

Total: ~30 commits.

---

## BUGS DESCUBIERTOS EN ESTA SESIÓN — para no repetirlos

1. **`bridge.config.allowedUsers` es `Set`, no array.** Cualquier sink/IPC que lo lea debe manejar los 3 tipos: `Set`, `Array`, `object`.
2. **Claude headless con MCPs locales (`gmail-luismi`, etc.)**: los MCPs tardan 2-5s en arrancar (`status:"pending"`). Si Haiku responde en 2s, ve "MCP no disponible". Fix: `WaitForMcpServers` tool. Ya está automático en el executor.
3. **`task.cwd: ""`** + spawn sin `cwd` explícito → claude hereda cwd del proceso main (cambia entre runs) → JSONL en carpetas distintas → `--resume` falla. Fix: executor pone `cwd = task.cwd || os.homedir()` siempre.
4. **`sessionId` huérfano**: si por alguna razón la sesión apuntada no existe en disco, claude devuelve `is_error:true` → scheduler marca run como ERROR y sigue intentando con el mismo sessionId roto. Solución: en el editor de tarea, **eliminar el `sessionId`** (manualmente vía JSON o vía `tasks:reset-session` IPC) — siguiente run lo recapturará limpio.
5. **`package.json build.files`** es allowlist explícita. Si añades archivo nuevo (html/js/preload) y olvidas meterlo aquí, **electron-builder no lo bundlea** y la app empaquetada no lo carga. Ya pasó hoy con `task-session.*` — costó debugging.
6. **Worktrees stale**: cuando dispatch agent con `isolation: worktree`, el worktree se crea desde el HEAD que tenía main al momento de despacho. Si haces más merges en main durante la ejecución del agente, el worktree no los ve. Patrón observado: el agente al final MERGE main en su worktree antes de aplicar cambios para tener árbol fresco. Funciona pero genera merges raros.
7. **Helpers de Electron sobreviven al deploy**: tras `npm run deploy`, los procesos `POWER-AGENT Helper` pueden seguir vivos con código viejo. Si feature nuevo no aparece, `pkill -9 -f "POWER-AGENT Helper"` antes de relanzar. Regla ya en CLAUDE.md.

---

## QUÉ ESTÁ DEPLOYADO

- **App**: `/Applications/POWER-AGENT.app/Contents/Resources/app.asar` (timestamp 22 may ~19:5x post-último deploy).
- **Versión**: `package.json` dice `1.3.0`. No bumpeado en esta sesión.
- **Git**: `main == origin/main` en `c173c56`.

---

## PROTOCOLO PARA SIGUIENTE SESIÓN

1. **Antes de tocar nada**, leer:
   - `HANDOFF-CODEX-2026-05-22-WHATSAPP-GRUPOS-AUTO-GLOBAL.md` (cierre WhatsApp grupos).
   - `HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md` (release 1.3.0, base arquitectónica).
   - **ESTE archivo** (cambios de hoy tarde/noche).

2. **Para probar la app**:
   ```bash
   pkill -9 -f "POWER-AGENT.app/Contents/MacOS/POWER-AGENT"
   pkill -9 -f "POWER-AGENT Helper"
   sleep 2
   osascript -e 'tell application "Finder" to open POSIX file "/Applications/POWER-AGENT.app"'
   ```

3. **Para desplegar cambios**:
   ```bash
   npm run deploy
   ```
   Mata instancias, compila zip x64, copia a `/Applications`, abre vía Finder.

4. **Para verificar tests**: `npm test` (125 tests, 119 pass, 6 skip, 0 fail).

---

## PENDIENTES (no urgentes — Luismi no los pidió, pero conviene tenerlos en mapa)

- **Limpiar prompt redundante** de "Revisión correo cada 3h": el `PASO 1: WaitForMcpServers` ya lo hace el executor. Editar a mano y dejar solo el cuerpo. Cosmético.
- **Borrar `automation-chat.*`** (legacy): el chat de burbujas de automatizaciones. No se usa. Comprobar con grep que ningún botón lo invoca → borrar `automation-chat.html`, renderer, preload, `automations/chat.js`, `main/automation-chat-ipc.js`, entries en `package.json build.files`.
- **Borrar código muerto en `main/agent-pty-proposal.js`**: las funciones `extractTaskBlock`, `parseTaskJson`, `sanitizeTask`, `taskBlocksEqual`, `createTaskProposalFiles` ya no se usan (el agente de creación de tareas se ha eliminado). Conservadas por seguridad — borrar tras verificar con grep que no se importan en ningún lado.
- **Cron `0 */4 * * *`** de la tarea GMAIL existente (si aún existe en JSON) — fíjate si está duplicada con "Revisión correo cada 3h". Decidir cuál sobrevive.
- **Test unitario** para `scheduler/executor.js._internal.buildPromptWithMcpWait` (cobertura: claude vs codex, lista vacía, MCP local detectado, archivo `~/.claude.json` ausente).
- **Bandeja 🔔 — auto-marca como leída** al abrir el "Hablar con el agente" desde dropdown (ahora hace `markRead(runId)` pero conviene verificar end-to-end).
- **`📌 Programar este prompt`** UX: si pulsa el botón sin haber escrito nada en xterm, el textarea queda vacío. Aceptable, pero un placeholder "Escribe tu prompt aquí…" ayudaría.

---

## REGLAS OPERATIVAS (recordatorio para próximo claude)

- **Luismi es ingeniero de producto, NO programador.** Habla en cristiano, prueba en vivo, no quiere ver código a menos que pida.
- **Modo AL GRANO DURO** activo en CLAUDE.md global. Respuestas cortas, sin "claro", sin "perfecto", sin resúmenes al final.
- **Antes de cambios amplios**: plan en 5 líneas + esperar OK explícito.
- **Verificar antes de afirmar**: tras Write/Edit, comprobar con `ls`, `find`, `cat`. No decir "guardado" sin haberlo verificado.
- **Worktrees + agentes Opus** para tareas grandes (>200 LOC). Foreground para feedback inmediato, background si trabajo paralelo.
- **Confirmar antes de operaciones destructivas** (`rm -rf`, `git reset --hard`, borrar tareas, modificar `.env`/keychain).
- **Bug pattern recurrente**: olvidar archivos nuevos en `package.json build.files`. **NO REPETIR**.

---

## ESTADO MENTAL DE LUISMI AL CIERRE

Frustrado por la sobreingeniería del refactor agente-first ("vaya mierda"). Su flujo natural es: **escribir en pestaña PTY normal → iterar con Claude → copiar prompt a tarea**. Por eso pidió el botón 📌. Esto es lo que mejor le encaja.

Apreció el debugging del Telegram y del MCP "pending". Entendió por qué pasaba. Quedó satisfecho con el `WaitForMcpServers` auto.

**No le sugieras nuevos refactors mañana a no ser que él lo pida.** Lo de hoy le ha agotado. Si abre la app y dice "esto no va", solo arregla ESO. Sin añadir features.

---

🟢 **Cerrado. Buenas noches.**
