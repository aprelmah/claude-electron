# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-13 mañana (verificado contra git, filesystem y app real por CDP).

## Estado de entrega (verificado)

- Rama `main`, working tree limpio, **sincronizada con `origin/main`** (`git status -sb` sin ahead/behind).
- Último commit: `98ecd11 feat(picker): elegir personalidad al arrancar sesión`, sobre `a98dfa5` (wrap del 2026-08-11).
- Tests: 1459 pass, 0 fail, 6 skipped — suite completa, pre-commit hook, Node del sistema v24.13.0.
- Deploy: `/Applications/POWER-AGENT.app`, asar del 2026-08-13 09:02 verificado por CONTENIDO (`index.html`, `project-picker.js` y `styles.css` extraídos del asar contienen el selector). App abierta por el propio `deploy.sh`.

## Última sesión (2026-08-13 mañana — elegir personalidad en la pantalla de arranque)

- Petición de Luismi: poder elegir la personalidad (perfil) en la pantalla "Elige proyecto" y que quede como la de por defecto al abrir. Preguntado el alcance (¿saltar el picker?, ¿perfil por proyecto?), lo acotó a **solo elegir la personalidad ahí**.
- Implementado en 4 archivos: `index.html` (fila PERSONALIDAD con `#picker-profile-selector` en la cabecera del picker, visible en las dos vistas), `styles.css` (`.picker-profile-bar` + select + su propio `.hidden` — en este proyecto NO existe un `.hidden` global), `project-picker.js` (`refreshProfiles()` / `selectProfile()` llamando a `window.api.listProfiles` / `setActiveProfile`), `renderer.js` (resincroniza barra superior y recordatorio).
- Verificado en dev real por CDP: las 3 personalidades listadas con la activa preseleccionada; cambio desde el picker → persiste en `claude-novak.config.json` y la barra superior se actualiza; cambio desde la barra → el picker se entera. Perfil devuelto a su valor original (`nuevo-perfil-2` / TECNICO SAT) al terminar.
- Commit `98ecd11` con la suite en verde en el pre-commit, pusheado a `origin/main`; deploy verificado por asar.
- Detalle técnico (dónde se lee el perfil en el spawn, sincronización por CustomEvent, nombre real del fichero de config): `tech/tech_perfiles_persona_invisible.md`, sección 2026-08-13.

## Próximo paso

- Luismi aún no ha probado la feature en la app ya desplegada (verificada por mí en dev por CDP + asar por contenido).
- Sin cobertura automática: la suite es solo de `main/`, no hay ningún test que cargue renderer/HTML. Si se toca el picker, verificar por CDP (skill `verify`).
- Arrastrados: commit `9bbb40f` en el repo `turbo-e` con autor "ISABEL" en vez de "Luismi"; flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga (`bugs/bug_flake_apple_transcribe_voice_note_2026_08_10.md`).
- `scripts/kb-add-case.js` no se construyó (decisión documentada en `tech/runbook_kb_conocimiento.md`, sección 2026-08-11).

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Antes de `npm run deploy`, matar cualquier proceso dev con `--remote-debugging-port` abierto — si no, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir.
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0) sin necesitar `nvm use 20.18.0`.
- "Comitea y despliega" en este proyecto **incluye push** a `origin/main` (confirmado el 2026-08-11).
- Panel de Conocimiento: arquitectura y reglas duras completas en `.claude/memory/tech/runbook_kb_conocimiento.md` (secciones 2026-08-11).
