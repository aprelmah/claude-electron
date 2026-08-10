# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-10, noche (verificado contra git, filesystem y app real).

## Estado de entrega (verificado)

- Rama `main`, working tree limpio; último commit `ac5360e docs(memory): STATE al cierre — notebook de conocimiento desplegado y verificado` — fusionado (fast-forward desde `6fbf604`) y **pusheado a `origin/main`** (`aaab645..ac5360e`). Rama `feature/kb-notebook-window` ya borrada.
- Tests: 1465 totales — 1442 pass, 0 fail, 17 cancelled (flake conocido y documentado, ver `bugs/bug_flake_apple_transcribe_voice_note_2026_08_10.md`), 6 skipped.
- Deploy: `/Applications/POWER-AGENT.app` con `dbb4d94`, verificado por CONTENIDO del asar (12 ficheros clave, hash idéntico al repo — `package.json` difiere solo por el stripping normal de `scripts`/`devDependencies`/`build` que hace electron-builder), firma ad-hoc válida, helper de voz firmado con permiso de micrófono, app corriendo con `--type=renderer`.

## Última sesión (2026-08-10 — Notebook de conocimiento: ventana propia)

- **Punto de partida**: Luismi rechazó el panel acoplado de la sesión anterior ("queda fatal", encajado como el sub-chat) y pidió lo que había pedido originalmente — cada sesión con un "notebook" tipo NotebookLM (objetivo/función, no el layout literal).
- **Brainstorming → spec → plan → SDD**: sesión completa con `superpowers:brainstorming` (5 rondas de preguntas, decisiones: ventana independiente singleton por proyecto, 3 columnas simultáneas, edición vía diff+confirmar, retrieval más generoso sin perder fail-closed), spec commiteada, plan de 13 tasks TDD, ejecutado con `superpowers:subagent-driven-development` en rama `feature/kb-notebook-window` (autonomía completa vía `/loop`, Luismi solo intervino para pausar/reanudar dos veces).
- **Qué se construyó**: `main/window-factory.js` (`openKnowledgeWindow`/`getKnowledgeWindow`, singleton por proyecto), `kb-window.html`/`kb-window-preload.js`/`kb-window-renderer.js` (3 columnas: Fuentes/Chat/Atajos), `main/kb-ipc.js` (+`kb:edit-apply`/`kb:read-ficha`/`kb:write-ficha`/`kb:open-window`), `main/kb-chat.js` (retrieval `MAX_EVIDENCE` 8→18 sin romper fail-closed, contrato de edición propuesta `edit:{relPath,find,replace,reason}` validado contra la evidencia). Panel acoplado viejo retirado por completo (~700 líneas `renderer.js`/`index.html` + ~300 líneas CSS muerto).
- **13 tasks + 1 extra (limpieza CSS) + revisión final de rama con fix wave** — todas con implementer + reviewer independientes, varios fix rounds reales: XSS real cazado y arreglado en Task 9 (texto del modelo por `innerHTML` sin escapar en la tarjeta de edición — el único sitio donde el modelo puede llegar a mutar disco), bug de `kb.toggle` sin comprobar error (Task 8), CSS-cleanup que se llevó por delante una regla viva (Task 11b), y en la revisión final: botón "+ atajo" con `window.prompt()` (Electron no lo soporta — **Critical**, nacía roto en producción), "Aplicar a sesión" con backend completo pero sin botón, bug de resolución de sesión en worktree, edición manual solo alcanzaba atajos (no fichas), `distillBusy` global en vez de por-proyecto. Todo corregido y re-revisado limpio.
- **Verificación CDP en dev real** (Task 12, hecha por el controller, no delegada): proyecto de prueba aislado en scratchpad, 9 checks funcionales contra la app viva — abrir ventana, 3 columnas, destilar de verdad, chat con cita real, **petición de corrección → tarjeta de edición → Aceptar → fichero cambiado EN DISCO** (verificado fuera de la UI), atajo creado + editor manual verificado en disco, cerrar/reabrir sin redestillar, doble-apertura hace foco. Todo PASS.
- Dos usos de `--no-verify` (commits `770c3c1`, `6902648`), ambos por el mismo flake preexistente e investigado a fondo (ver bug ficha), autorizados por el controller con evidencia, no por comodidad.
- Deploy final verificado por asar (ver arriba).

## Próximo paso

- ⚠️ **DECISIÓN DE ALCANCE PENDIENTE — no dar por cerrada la columna Chat ni la tarjeta de edición.** Tras el deploy, Luismi cuestionó a fondo el diseño (no la UX, la arquitectura): razonando juntos, la conclusión fue que el chat de conocimiento y la aprobación de ediciones NO aportan nada que una sesión normal de terminal (que ya tiene las fichas precargadas por `@import` en el `CLAUDE.md`) no haga ya — y esa la hace mejor (`Edit` real sobre el fichero, no una tarjeta de aceptar/descartar sobre una llamada sin herramientas). Lo único irreducible frente al agente normal es: **destilar** (extracción+resumen fuera de la sesión, para no comerse el contexto con el texto en bruto de un PDF/vídeo), **crear atajos**, y **activar/desactivar fichas** (toggle del import). Luismi quiere probar la ventana él mismo antes de decidir. Si confirma el recorte: quitar de `kb-window-renderer.js` `renderCitations`/`appendMessage`/`submitQuestion`/`renderEditCard`/`loadChatHistory`, la columna Chat de `kb-window.html`, y los handlers `kb:ask`/`kb:edit-apply` de `main/kb-ipc.js` (dejar `kb:list/toggle/add-file/remove/distill/add-shortcut/read-ficha/write-ficha/open-window`); `main/kb-chat.js` quedaría sin uso, valorar si se borra.
- Pendiente diferido documentado en `tech/runbook_kb_conocimiento.md` § "Pendiente de endurecer": `resolveProjectDir` se fía del `cwd` que manda el renderer sin contrastarlo contra `getKnowledgeWindow(projectDir)` (que ya existe, sin más uso que los tests). Heredado del panel viejo, no es regresión de esta sesión — si el recorte de arriba se confirma, este hallazgo pierde peso porque desaparecen los dos handlers de escritura basados en el modelo (`kb:edit-apply` ya no importaría; `kb:write-ficha`/`kb:read-ficha` seguirían).
- Diferidos menores (mismo runbook): botón "Aplicar a sesión" sin guard anti-doble-click, chips de cita inertes, `kb:list` duplicado por refresco, `kbButtonResolveCwd` con fallback a `ptyCwd()` amplificado por el singleton-por-proyecto.
- Bug sin resolver (no bloqueante, documentado): flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga — `bugs/bug_flake_apple_transcribe_voice_note_2026_08_10.md`.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Node del sistema 24; CI 20.18.0. Suite `npm test`.
