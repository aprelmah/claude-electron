# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-11 (verificado contra git, filesystem y app real).

## Estado de entrega (verificado)

- Rama `main`, working tree limpio, **sincronizada con `origin/main`** (push hecho: `3c39ee9..5581102`).
- 2 commits de esta sesión: `a0d1c6f feat(kb): casos editables y borrables individualmente (backend)` y `5581102 feat(kb): panel Conocimiento como pestañas Chat/Casos/Fichas, voz y auto-ajuste`.
- Tests: 1459 pass, 0 fail, 6 skipped — corrida dos veces por el pre-commit hook (Node del sistema, v24.13.0), ambas limpias.
- Deploy: `/Applications/POWER-AGENT.app`, verificado por CONTENIDO/timestamp del asar (22:23:17, `kb-panel.js` presente, sin restos de `kb-window*`), proceso corriendo con `--type=renderer`.

## Última sesión (2026-08-10/11 — Conocimiento: de ventana modal a 3 pestañas hermanas + voz + auto-ajuste)

- **Petición**: quitar el botón "Agente conocimiento", separar Atajos→"Casos" (editables con resolución) y Fichas (editables) como dos acciones de creación, sacar el panel de la ventana modal a pestañas dentro del IDE, voz en Casos, y que el agente pueda crear un caso por chat ("esto ponlo como caso").
- **Investigación previa**: no existe sistema de tabs tipo VS Code en la app (cada sesión es una `BrowserWindow` independiente) — descartado reescribir ese modelo. Luismi dio luz verde con "usa todos los agentes que necesites, hazlo en /loop".
- **Backend** (`main/knowledge-base.js`, `main/kb-ipc.js`): `updateShortcut(projectDir, id, {title, body, related})` y `deleteShortcut(projectDir, id)` — editan/borran una entrada de `kb/fichas/atajos.md` sin tocar el resto (antes solo se podía añadir al final o editar el fichero entero a mano). Canales `kb:update-shortcut`/`kb:delete-shortcut`. `parseShortcuts` ahora extrae el cuerpo completo de cada entrada, no solo el título. `ATAJOS_HEADER` instruye al agente de sesión a añadir un caso directamente al fichero (formato `## <n+1> · <título>` + cuerpo) y comitear, cuando el usuario lo pida por chat. Decidido NO construir `scripts/kb-add-case.js`: no es alcanzable desde el cwd de un proyecto ajeno a POWER-AGENT sin plumbing de env nuevo — calcular `max(nums)+1` leyendo el fichero es trivial para cualquier agente con Read/Grep.
- **UI, dos iteraciones**:
  1. Panel lateral dockeado (patrón sub-chat) con mini-pestañas internas Casos/Fichas — retirada `kb-window.html`/`kb-window-renderer.js`/`kb-window-preload.js`, `openKnowledgeWindow`, canal `kb:open-window`. Deploy 1 probado por Luismi en real: **rechazado** — quería 3 pestañas hermanas (Chat/Casos/Fichas) reemplazando el área del terminal, no una caja lateral; scrollbars y botón de micro "feos".
  2. Reescrito: `kb-panel.js` (nuevo, IIFE) monta 3 pestañas dentro de `#terminal-row` (`#tab-view-chat` + Casos/Fichas, cada una `flex:1`, `display:none` en las inactivas — el terminal xterm.js NUNCA se destruye al cambiar de pestaña, solo se oculta, con `scheduleTerminalRefit()` al volver a Chat). Quitado `#btn-kb` y el grupo "PROYECTO" (huérfano sin él). `cwd` promovido a `window.__resolveProjectCwd()` en `renderer.js` (misma lógica que evitaba el bug histórico de `ptyCwd()`), reutilizada tal cual — se re-resuelve cada vez que se entra en Casos/Fichas. `preload.js` expone ahora `api.kb.*` completo (antes solo `openWindow`).
- **Voz**: `insertTranscribedText(el, text)` en `kb-panel.js`, desacoplada de `injectToPty`/`writePty` (esas siguen sirviendo solo al terminal). Botones `#kb-case-title-mic`/`#kb-case-body-mic`, mismo motor de transcripción (Apple Speech/whisper.cpp) que el dictado del terminal. Probado con grabación real end-to-end.
- **Bug real cazado y arreglado en la revisión estética**: el SVG de los botones de micro no llevaba `stroke`/`fill` (se pintaba mal) — ahora usan exactamente el mismo lenguaje visual que `#btn-mic` del terminal. Además: `kb-panel.js` le faltaba declarar `fichaEditorView` (rompía `refreshFichas()` en silencio) y faltaban reglas CSS `.kb-editor.hidden`/`.kb-mini-btn.hidden` (formulario superpuesto al estado vacío).
- **Auto-ajuste al redimensionar** (pedido tras el deploy 2): `main.js` con `minWidth:640/minHeight:420` en la ventana principal (no tenía, el sidebar podía comerse todo el hueco). `renderer.js`: `clampSidebarToWindow()` enganchada al listener de `resize` — recorta el ancho/alto persistido del sidebar contra el hueco real. `styles.css`: `.kb-col-list` tenía `flex: 0 0 340px` (nunca encogía, podía dejar el editor a 0px de ancho) → `flex: 0 1 340px` + `min-width:220px`; `min-width:0` en contenedores clave; `@container` en `#terminal-row` para que Casos/Fichas se apilen verticalmente por debajo de ~640px de hueco disponible. Verificado con `window.resizeTo()` vía CDP en 6 tamaños (640×420 a 1440×850) — **nota técnica: el CDP de Electron NO expone `Browser.setWindowBounds`/`getWindowForTarget` (error `-32601`)**, hay que usar `window.resizeTo()`.
- 2 commits, pre-commit hook con la suite completa en verde las dos veces, push a `origin/main`, deploy final verificado por asar.
- Detectado (no tocado, no relacionado): `turbo e/kb/fichas/fallo-...md` cambió en disco durante la sesión — probablemente Luismi editando en paralelo en VS Code.

## Próximo paso

- Luismi no ha confirmado explícitamente haber probado el resultado FINAL post-push; sí probó y corrigió dos builds intermedios en vivo durante la sesión (ambas correcciones ya incorporadas).
- El "UX pendiente" de la sesión anterior (modales flotantes sin backdrop, toggle poco visible, botón "Agente conocimiento" con nombre desfasado) queda **superado de facto**: ya no hay modales `position:fixed` sueltos ni checkbox de apertura, ni botón "Agente conocimiento".
- Commit `9bbb40f` en el repo `turbo-e` sigue con autor "ISABEL" en vez de "Luismi" — ofrecido corregir hace 2 sesiones, sin respuesta, no tocado.
- `scripts/kb-add-case.js` no se construyó (ver arriba) — si se quiere más adelante que el agente cree casos de forma más fiable en un proyecto ajeno a POWER-AGENT, hace falta exponerle una ruta de recursos (no hay env var hoy).
- Bug sin resolver (no bloqueante, documentado): flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga — `bugs/bug_flake_apple_transcribe_voice_note_2026_08_10.md`.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Antes de `npm run deploy`, matar cualquier proceso dev con `--remote-debugging-port` abierto — si no, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir.
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0) sin necesitar `nvm use 20.18.0` — dato empírico de esta sesión, no cambia la guía documentada para pruebas manuales.
- Panel de Conocimiento: arquitectura y reglas duras completas en `.claude/memory/tech/runbook_kb_conocimiento.md` (sección 2026-08-11 al final).
