# HANDOFF — Agente PTY de automatizaciones

Fecha último update: 2026-05-16
Estado: **FUNCIONAL end-to-end**.

Un usuario no técnico puede:
1. Crear una automatización vacía ("+ Nueva").
2. Pulsar "💬 Hablar con el agente" → se abre ventana xterm con `claude` (o `codex`) vivo y un bootstrap rico inyectado.
3. Conversar en lenguaje natural. El agente lee la descripción guardada y solo pregunta lo que falte.
4. Cuando el agente termina, **el botón "Aplicar al borrador" del header se ilumina en verde brillante** (animación pulse) + toast: *"Propuesta lista · pulsa el botón verde de arriba"*.
5. Pulsar el botón → la automation queda creada (o modificada) e instalada en launchd. Toast confirma *"Aplicado y reinstalado en launchd ✓"*.

Sin terminal externo. Sin tocar archivos. Sin XML. Sin copia-pega.

---

## Cómo funciona (resumen técnico)

- **Detección de propuesta = filesystem, no stream.** Claude Code v2 oculta las respuestas largas en su TUI (las procesa como tool_use internas) — el contenido nunca llega al stream del PTY. Solución: el bootstrap instruye al agente a usar su Write tool sobre `/tmp/poweragent-proposal/{automationId}/{script.sh, plist.plist, description.txt, READY}`.
- **UI = pull-based.** El renderer del agente PTY pollea cada 1.5s vía IPC `automation-pty:check-proposal`. Cuando hay archivos en disco + READY, el botón del header se enciende. Más robusto que el push event (que se perdía en algún punto del IPC, causa nunca diagnosticada al 100%).
- **Aplicar = reinstall automático.** `automationManager.updateDraft()` persiste el JSON Y, si la automation estaba `installed`, reescribe `.sh` + `.plist` físicos y rebootea launchd (`launchctl bootout` + `bootstrap`).
- **Bootstrap rico.** Inyecta el system-prompt completo del generador (`automations/system-prompt.js`) + patterns de la skill `~/.claude/skills/luismi/automation-builder/patterns.md`. Cubre Telegram, lockfile, trap, NAS QNAP, plist launchd, idempotencia, sin secrets.
- **Comportamiento conversacional.** El agente lee la descripción guardada y NO pregunta lo obvio. Si es modificación, lee también el script actual con Read tool antes de hablar.

---

## Archivos clave

- `main.js`:
  - Constantes `AGENT_PROPOSAL_BASE`, `AGENT_PROPOSAL_POLL_MS`.
  - Helpers `proposalPaths`, `ensureProposalDir`, `readProposalFromDisk`, `clearProposalFromDisk`.
  - `buildAgentBootstrapPrompt(automation)` — bootstrap inteligente (lee descripción + system-prompt + patterns).
  - `startAgentPty`, `killAgentPty`, `openAutomationPtyWindow`.
  - IPC `automation-pty:check-proposal` (pull), `automation-pty:apply-blocks` (aplica + limpia), `automation-pty:set-cli`, `automation-pty:restart`.
- `automations/index.js`:
  - `updateDraft` con **nuevo contrato**: `{ ok, automation, reinstalled, reinstallError, needsReinstall }`. Reinstala si `current.status === 'installed'` y cambió script/plist.
- `automation-pty.html`:
  - Botón `#btn-apply-top` en el header — gris cuando esperando, verde brillante con animación pulse cuando hay propuesta.
- `automation-pty-preload.js`:
  - Expone `agentPty.checkProposal()`.
- `automation-pty-renderer.js`:
  - `startProposalPolling()`, `setApplyButton(ready)`, `onApplyBlocks()`.

---

## Reglas para futuros agentes que toquen esto

1. **NO** volver a intentar parser regex sobre el stream del PTY. **No funciona** con Claude Code v2+. Cinco intentos previos fallaron.
2. **NO** volver a meter botones "Extraer propuesta" / "Pegar a mano" / panel verde inferior. **Confunden al usuario**. Un solo botón en el header, claro.
3. **SI** cambias el contrato de `updateDraft`, recuerda que devuelve un objeto, no la automation directa. Ajusta los dos callers (`automations:update-draft` y `automation-pty:apply-blocks` en main.js).
4. El bootstrap del PTY NO debe contener referencias hardcoded a "Luismi" — es producto para cualquier usuario.
5. Verificación end-to-end: crea una automation con descripción tonta tipo *"borra .DS_Store del Escritorio cada lunes a las 10"*, habla con el agente. Si pregunta dónde están los .DS_Store → bootstrap mal. Si en 1-2 turnos genera y se ilumina el botón verde → funciona.
6. Si Telegram no llega: revisa `~/Library/Application Support/CLAUDE-NOVAK/claude-novak.config.json` (campos `.telegram.botToken` y `.telegram.allowedUsers[0]`). El script solo incluye Telegram si la descripción lo menciona o el usuario lo pide explícitamente.

---

## Pendientes (no urgentes)

- Parser stream viejo (`extractAgentBlocks`) sigue activo como respaldo inerte. Hace ruido en stdout con `[automation-pty] potential blocks but no match.`. Se puede silenciar.
- IPC `automation-pty:extract` y `buildExtractPrompt`/`parseExtractorJson` siguen vivos en `main.js` (botones eliminados del HTML). Código muerto, no estorba.
- `productName` en config sigue siendo `CLAUDE-NOVAK` para preservar `userData` (línea ~18 `main.js`). Si se rebrandea, migrar config.

---

Memoria del proyecto:
`/Users/isabel/.claude/projects/-Users-isabel-Desktop-LUISMI-claude-electron/memory/project_agent_pty.md`
