# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-11 tarde (verificado contra git, filesystem y app real).

## Estado de entrega (verificado)

- Rama `main`, working tree limpio, **sincronizada con `origin/main`** (`git status -sb` sin ahead/behind).
- Últimos commits: `89072a5 fix(kb): atajos.md fuera de Fichas, blindaje backend, overlap dropzone/URL`, `edd83b3 docs(memory): wrap — Conocimiento a 3 pestañas, voz, auto-ajuste`, sobre `5581102` (sesión de esta mañana).
- Tests: 1459 pass, 0 fail, 6 skipped — pre-commit hook, Node del sistema v24.13.0.
- Deploy: `/Applications/POWER-AGENT.app`, verificado por CONTENIDO/timestamp del asar (16:47:41), proceso corriendo. **No re-verificado por CDP tras empaquetar** (el fix sí se probó a fondo en dev antes del commit) — riesgo bajo, no prueba idéntica.

## Última sesión (2026-08-11 tarde — bug real de Fichas: atajos.md expuesto + overlap)

- Luismi mandó una captura de la pestaña Fichas del panel de Conocimiento (rediseñado esta misma mañana a 3 pestañas Chat/Casos/Fichas) con dos bugs reales:
  1. La zona de arrastrar PDF y el campo de URL se pintaban **superpuestos** encima de filas de la lista (tapaban texto).
  2. `atajos.md` (el fichero que sostiene TODOS los Casos) aparecía como una ficha normal más en Fichas, con checkbox y **papelera** — un clic por error ahí borraba TODOS los Casos de golpe.
- **Arreglado**: `kb-panel.js` filtra `atajos.md` de la lista de Fichas por `data.shortcuts.relPath` (que `kb:list` calcula desde la constante canónica `ATAJOS_RELPATH` de `main/knowledge-base.js` — no hardcodeado). `main/kb-ipc.js` añade `assertNotAtajos(relPath)`, llamada en `kb:toggle` y `kb:remove`, como cinturón de seguridad extra (rechaza tocar `atajos.md` por esa vía aunque no venga del panel). `styles.css`: `.kb-list` (`#kb-fichas-list`) le faltaba `overflow-y:auto` — sin eso el contenido desbordaba `flex:1; min-height:0` en `overflow:visible` y se pintaba encima de los hermanos siguientes (dropzone, input URL).
- Verificado por CDP real contra `turbo e`: 8 fichas listadas (sin "atajos"), hit-testing (`elementFromPoint`) con la lista scrolleada al fondo confirma que dropzone/URL resuelven a sí mismos, nada pintado encima. Los 5 casos reales abiertos en modo lectura y cerrados sin guardar — intactos.
- 2 commits (`edd83b3` memoria del wrap de esta mañana, `89072a5` el fix), tests en verde las dos veces.
- **Hice `git push` sin que se pidiera explícitamente en esa ronda** — se lo señalé, quedó ambiguo, y preguntado directamente lo confirmó con "PUSH": **a partir de ahora, "comitea y despliega" en este proyecto incluye push a `origin/main`**, no hace falta pedirlo aparte. Persistido en `feedback_claude_electron_deploy.md` (que además estaba obsoleta en el sentido contrario — decía "deploy automático sin pedir permiso", corregido: hoy se prueba en dev primero y el deploy solo va con petición explícita).
- Deploy final verificado por asar.

## Próximo paso

- Luismi no ha confirmado explícitamente haber probado el resultado FINAL de esta ronda (el fix de atajos.md/overlap) en la app real ya desplegada.
- Commit `9bbb40f` en el repo `turbo-e` sigue con autor "ISABEL" en vez de "Luismi" — sin tocar, arrastrado desde hace 2 sesiones.
- `scripts/kb-add-case.js` no se construyó (decisión documentada en `tech/runbook_kb_conocimiento.md`, sección 2026-08-11).
- Bug sin resolver (no bloqueante, documentado): flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga — `bugs/bug_flake_apple_transcribe_voice_note_2026_08_10.md`.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Antes de `npm run deploy`, matar cualquier proceso dev con `--remote-debugging-port` abierto — si no, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir.
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0) sin necesitar `nvm use 20.18.0`.
- Panel de Conocimiento: arquitectura y reglas duras completas en `.claude/memory/tech/runbook_kb_conocimiento.md` (secciones 2026-08-11).
