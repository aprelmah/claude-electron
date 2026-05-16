# HANDOFF — Agente PTY de automatizaciones

Fecha del handoff: 2026-05-16
Estado: **NO FUNCIONAL end-to-end**. Funciona la ventana, el PTY, la conversación con claude/codex. **NO funciona** el paso de "aplicar la propuesta del agente al borrador". El usuario (Luismi) está harto. El siguiente agente debe leerlo entero antes de tocar nada.

---

## QUÉ SE PEDÍA

Luismi tiene una feature "Automatizaciones" en POWER-AGENT (Electron + node-pty + xterm.js). Cada automatización es un script bash + plist launchd. Antes había un "chat de burbujas" para hablar con un LLM headless sobre cada automatización. Luismi pidió sustituirlo por una ventana terminal (PTY) con `claude` o `codex` vivo, porque le iba más rápido y veía qué hacía el agente.

Flujo deseado:
1. Tasks → Nueva (o ya existente) → botón "💬 Hablar con el agente".
2. Se abre ventana xterm con `claude` (o `codex`) en interactivo.
3. POWER-AGENT inyecta un bootstrap prompt con contexto de la automatización.
4. Luismi conversa, claude refina.
5. Cuando claude tiene la propuesta lista → en POWER-AGENT debe aparecer un botón **"Aplicar al borrador"** que aplique `description`, `scriptText`, `plistText` al automation.

Lo que FUNCIONA:
- Ventana se abre, PTY arranca, bootstrap se inyecta (bracketed paste OK), conversación fluye.
- Selector claude/codex (pill dropdown).
- Botón restart (↻).
- IPC `automation-pty:apply-blocks` ya conectado a `automationManager.updateDraft({ scriptText, plistText, description })` que sí persiste correctamente cuando se invoca.

Lo que NO FUNCIONA:
- Detectar de manera fiable cuándo claude emite la propuesta para mostrar el botón.

---

## ANÁLISIS TÉCNICO DEL PROBLEMA

Claude Code v2.1.x renderiza su salida como TUI complejo:
- Pliega / colapsa bloques largos en pantalla. Solo muestra "Worked for 7s", "Cogitated for 4s".
- Repinta histórico con ANSI codes, line wrapping, cursor positioning.
- Cuando emite respuestas largas (script bash + plist xml) NO aparecen literalmente en el stream — claude las procesa como tool_use internas y solo te muestra un resumen.

Resultado: el stream PTY que llega al renderer no contiene los bloques completos parseables. El usuario VE en pantalla algo como:
```
> venga, genera
* Worked for 7s
> No lo he escrito al disco. Los tres bloques (DESCRIPCION, SCRIPT, PLIST) que acabo de emitir aparecen en tu UI...
```

…pero los bloques en sí NO aparecen en stdout. Claude DICE que los emitió pero literalmente no están en el buffer del PTY.

---

## INTENTOS REALIZADOS (todos fallidos)

1. **Parser sobre stream PTY** (`extractAgentBlocks` en `main.js`): regex sobre buffer limpio de ANSI. Resultado: o falsos positivos (matchea placeholders del propio bootstrap echo) o no matchea nada (bloques no están en buffer).

2. **Offset desde boot** (`session.detectFromOffset`): retrasar detección 4.5s tras inyección del bootstrap. Resultado: claude code repinta histórico al recibir input → placeholders del bootstrap vuelven a entrar al buffer DESPUÉS del offset → falsos positivos.

3. **Endurecer parser**: requerir shebang + saltos + descartar `...` literal. Resultado: bloques reales tampoco pasan porque CLAUDE NUNCA LOS EMITE LITERALMENTE.

4. **Reescribir bootstrap** sin literales `<SCRIPT>` `<PLIST>` etc. Resultado: bien para evitar falsos positivos del propio bootstrap, pero sigue sin haber bloques reales emitidos por claude.

5. **Botón "Extraer propuesta"** (headless claude/codex como extractor): el botón llama a `runClaudeHeadless` con el buffer del PTY y pide JSON. Resultado: headless contesta "no veo propuesta completa" porque el buffer no contiene los bloques (claude code los oculta).

6. **Botón "Pegar a mano"**: modal con textareas vacíos. Funciona pero Luismi tiene que copiar/pegar a mano lo que casi NO ve en pantalla. Inútil porque los bloques no son visibles.

7. **Panel verde automático**: igual que (1) — depende del parser stream, que no detecta nada real.

---

## LO QUE PROPUSE Y NO HE IMPLEMENTADO POR FALTA DE OK

**Solución por filesystem** (la única que tiene pinta de funcionar al 100% según mi análisis):

- POWER-AGENT crea por cada sesión un directorio `/tmp/poweragent-proposal/{automationId}/`.
- Bootstrap dice a claude: "cuando tengas la propuesta, ESCRIBE estos archivos con Write tool:
  - `/tmp/poweragent-proposal/{ID}/script.sh`
  - `/tmp/poweragent-proposal/{ID}/plist.plist`
  - `/tmp/poweragent-proposal/{ID}/description.txt`
  - Y al final, crea un fichero vacío `/tmp/poweragent-proposal/{ID}/READY` como señal."
- POWER-AGENT pollea cada 1.5s ese directorio (o `fs.watch`). En cuanto los 3 ficheros + READY existen → lee, valida (shebang + `</plist>`), emite `blocks-detected` al renderer.
- Botón "Extraer propuesta" lee del filesystem directamente, no hace headless.

Por qué creo que funcionaría:
- Claude Code v2 usa Write tool nativamente con `bypass permissions on` (lo tiene activado por defecto en el setup de Luismi).
- Los Write tool calls SÍ se ejecutan aunque el TUI no muestre el contenido.
- El filesystem es source of truth, no depende del stream visual.

Hay quasi código escrito ya en `main.js` (lo intenté insertar y el linter del editor lo bloqueó porque el fichero se había modificado entre Read y Edit). Tendrá que reescribirse desde cero. Los hooks: `AGENT_PROPOSAL_BASE`, `proposalPaths()`, `ensureProposalDir()`, `readProposalFromDisk()`. Quedaron como abortados.

---

## ARCHIVOS RELEVANTES (estado actual)

- `main.js`
  - `openAutomationPtyWindow(automationId)` — abre BrowserWindow, crea session.
  - `startAgentPty(session)` — spawn pty con `claude` o `codex`. Inyecta bootstrap con bracketed paste 3.5s después de spawn.
  - `buildAgentBootstrapPrompt(automation)` — texto del bootstrap. **Aquí hay que cambiar para añadir las instrucciones de "escribe estos archivos"** si se va por la solución filesystem.
  - `extractAgentBlocks(buffer)` — parser actual. Tirar o conservar como fallback.
  - `proc.onData` dentro de `startAgentPty` — donde se hace la detección. **Aquí o en un setInterval aparte hay que añadir la lectura del filesystem.**
  - IPCs: `automation-pty:open/init/start/write/resize/restart/set-cli/apply-blocks/extract/close-self/minimize-self`.

- `automation-pty.html` — UI con header (selector cli, badges, botones), terminal-wrap, blocks-panel verde, modal de preview.

- `automation-pty-preload.js` — APIs: `init/start/write/resize/restart/applyBlocks/extract/setCli/closeSelf/minimizeSelf` y listeners `onData/onExit/onError/onBlocks/onStatus`.

- `automation-pty-renderer.js` — xterm init, eventos PTY, panel blocks-panel, modal preview, botones header.

- `automations/index.js`
  - `createDraftShell({name, description, schedule})` — crea automation vacío para que el agente trabaje.
  - `updateDraft(id, { scriptText, plistText, description })` — aplica la propuesta. Acepta `description`.

- `tasks-manager-renderer.js` — botón "💬 Hablar con el agente". Línea ~1130 (draft) y ~1416 (installed). Si no hay id, llama a `automationsCreateDraftShell` antes de abrir el agente.

- `tasks-manager-preload.js` — expone `automationsCreateDraftShell` y `openAutomationChat` (que abre la ventana PTY, no la de burbujas).

- `package.json` — `build.files` ya incluye `automation-pty*.{html,js}`.

NO TOCAR (no relevante al problema):
- `headless-runners.js`
- `telegram-bridge.js`
- `scheduler/**`
- `viewer*.{html,js}`

---

## QUÉ DEBE HACER EL SIGUIENTE AGENTE

Implementar la solución filesystem. Sin tocar lo que ya va.

Pasos:
1. En `main.js`, añadir:
   - Constantes `AGENT_PROPOSAL_BASE = '/tmp/poweragent-proposal'`, `AGENT_PROPOSAL_POLL_MS = 1500`.
   - `proposalPaths(automationId)`, `ensureProposalDir(automationId)` (crea dir y limpia residuos).
   - `readProposalFromDisk(automationId)` con validación shebang + `</plist>`.
2. En `openAutomationPtyWindow`: llamar `ensureProposalDir(automationId)` ANTES de spawnear PTY. Guardar paths en `session.proposalPaths`.
3. En `startAgentPty`: arrancar un `setInterval(AGENT_PROPOSAL_POLL_MS)` que chequea si existe `READY` en el dir. Si existe Y los 3 archivos están, leer, validar, emitir `automation-pty:blocks-detected` al renderer. Comparar con `session.lastBlocks` para no spamear. Limpiar interval en `proc.onExit` y en `win.on('closed')`.
4. En `buildAgentBootstrapPrompt`: añadir un bloque claro tipo:
   ```
   IMPORTANTE — cómo entregar la propuesta:
   Cuando tengas la propuesta lista, ESCRIBE los archivos con tu herramienta Write:
   1. {scriptPath}     ← script bash completo (empezando por #!/bin/bash)
   2. {plistPath}      ← plist launchd completo (empezando por <?xml)
   3. {descPath}       ← descripción refinada en texto plano
   4. {readyPath}      ← fichero vacío como señal de "ya está"
   POWER-AGENT los detectará automáticamente y aparecerá el botón "Aplicar al borrador".
   NO necesitas pegar el contenido en el chat — solo escribe los archivos.
   ```
5. En el IPC `automation-pty:extract` y en `applyBlocks`: si `readProposalFromDisk(automationId)` devuelve algo, usar eso preferentemente; si no, fallback al método actual.
6. Cuando se aplique al borrador con éxito, borrar los archivos `/tmp/poweragent-proposal/{ID}/` para que la siguiente propuesta empiece limpia.

Limitaciones a vigilar:
- El nombre `description.txt` es opcional. Algunos automations no necesitan cambiarla.
- Si claude escribe el archivo y luego cambia de idea, mtime se actualiza. Comparar contenidos, no mtime.
- Si el directorio `/tmp/poweragent-proposal` no existe, crearlo con `recursive: true`.

---

## CONTEXTO DE USUARIO

- Luismi (no Isabel — Isabel es el nombre de cuenta del Mac).
- Trabaja en español de España.
- Modelo Haiku por defecto pero esta tarea requiere Sonnet u Opus mínimo.
- Tiene `bypassPermissions: true` y `skipDangerousModePermissionPrompt: true` en settings.json → Claude no pide permiso para nada.
- Sus CLI están en `/Users/isabel/.local/bin/claude` y `/Users/isabel/.local/bin/codex` (también probable que en `~/.nvm/...`). `ensureCliAvailable` en `main.js` ya los detecta.
- Está cansado de ver "lo arreglé" y luego no funcionar. Antes de decir que algo funciona, VERIFICAR. Si no se puede verificar end-to-end, decirlo crudo.

## REGLAS DE TRABAJO (de Luismi, no negociables)

- No mentir. Si algo no funciona, decirlo.
- No commitear sin OK explícito.
- No tocar `~/.claude/settings.json`, hooks, `~/Library/LaunchAgents/`.
- Si una decisión es técnica (libs, patrones), decidir y reportar — no preguntar lo obvio.

---

## LOG DE INTENTOS POR ORDEN

1. Burbujas → cambiado a PTY xterm porque era más visible.
2. Parser regex stream → falsos positivos.
3. Offset 4500ms → seguía con falsos positivos por repintado.
4. Endurecer validación (shebang, plist, ...) → no detecta los reales porque NO están en el stream.
5. Subagente Opus → añadió "Extraer propuesta" (headless extractor) y "Pegar a mano" (manual). El primero no encuentra nada porque el buffer no tiene los bloques; el segundo es inútil porque no hay nada visible que pegar.
6. PROPUESTO pero NO implementado: solución filesystem.

---

Fin. El siguiente agente: lee esto, propón la solución filesystem a Luismi, espera OK, implementa, probad UNA vez juntos.
