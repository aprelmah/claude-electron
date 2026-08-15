# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-15 tarde (verificado contra git, filesystem y el asar en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`a88f887`+`ba4bc92` pusheados). Working tree limpio salvo la memoria de este cierre.
- Últimos commits: `ba4bc92 feat(kb): no todos los proyectos llevan Casos y Fichas — se elige por carpeta`, sobre `a88f887 feat(ui): los tres controles de la barra caben en un boton que dice AGENTE`, sobre `f98443f docs(memory): wrap`.
- Tests: **1544 pass, 0 fail, 6 skipped** (1550 totales) — suite completa, pre-commit hook en los dos commits, Node del sistema v24.13.0. (+14 tests nuevos: 8 de `kb-prefs`, 6 de `kb-tabs-state`.)
- Deploy: `/Applications/POWER-AGENT.app`, asar del **2026-08-15 10:35** verificado por CONTENIDO (`main/kb-prefs.js` y `kb-tabs-state.js` dentro; `main.js` del asar con los handlers `kb-prefs:get`/`kb-prefs:set`; `index.html` del asar con el botón AGENTE y ambas casillas).
- `authToken` del servidor LAN rotado el 2026-08-15 por la mañana; sin túneles levantados.

## Última sesión (2026-08-15 tarde — el botón AGENTE y el conocimiento opcional)

- **Los tres controles de la tira se unifican en un botón `AGENTE`** (`a88f887`) con el perfil activo como subtexto. Los dos `<select>` (CLI y personalidad) se mudan DENTRO del popover que ya existía conservando sus IDs: ningún listener de `renderer.js` cambió. El popover se alinea al botón y se cierra al abrir el gestor de perfiles o al cambiar de CLI.
- **El conocimiento (Casos/Fichas) deja de ser universal** (`ba4bc92`): casilla CONOCIMIENTO en el picker y en el popover AGENTE. Apagada → no hay pestañas Casos ni Fichas ni botón "Aplicar a sesión". La pref se ata al **cwd** (el conocimiento vive en la carpeta), en `userData/kb-prefs.json`, default ON. Detalle en `tech/runbook_kb_conocimiento.md` § 2026-08-15.
- Dos bugs cazados **probando la app real**, no leyendo código: la pref iba a guardarse contra el HOME (`resolveProjectCwd()` → `ptyCwd()`), y un `<label for>` que además contenía el input hacía doble toggle (clicar el texto no cambiaba nada). Ficha: `bugs/bug_pref_proyecto_cwd_home_2026_08_15.md`.
- La decisión "qué pestañas se ven" salió del renderer a `kb-tabs-state.js` (módulo puro, `build.files` actualizado): la suite corre sin Electron y lo que decide un script de renderer no lo cubre nadie. Misma doctrina que `main/lan-server-action.js` de la sesión anterior.
- Verificado conduciendo la app por CDP con clics reales en las dos casillas y en las dos direcciones (apagar y encender), comprobando el fichero en disco en cada paso.

## Próximo paso

- **Luismi no ha probado a mano** ni el botón AGENTE ni el conocimiento opcional en la app desplegada.
- La feature de soporte a cliente por enlace (spec `18dfe81`) sigue **diseñada y sin implementar**.
- El picker y `kb-panel.js` siguen sin cobertura automática (la suite es solo de `main/` y de los módulos puros de raíz); solo la decisión extraída tiene tests.
- El popover AGENTE no escucha `poweragent:kb-pref-changed` del picker: hoy no hace falta (se refresca al abrirse y el picker lo tapa), pero si algún día conviven en pantalla hay que engancharlo.
- El **pegamento IPC** sigue sin test: que `save-app-config` llame a las piezas en orden solo está verificado por CDP. Necesita Electron.
- `publicUrlWarning` no aparece con el servidor LAN parado. Sin probar: invitación con **modo empresa activo**. Menor: "QR no disponible (librería `qrcode` no instalada)".
- Arrastrados: commit `9bbb40f` en `turbo-e` con autor "ISABEL"; flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga; una sesión YA abierta en worktree no ve borrados posteriores del conocimiento.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Antes de `npm run deploy`, matar cualquier proceso dev con `--remote-debugging-port` abierto — si no, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir.
- **Un CDP que responde en 9222 no prueba que hables con el proceso que acabas de lanzar.** Si una medición contradice a la anterior, confirmar la identidad de la instancia antes de teorizar.
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0) sin necesitar `nvm use 20.18.0`.
- "Comitea y despliega" en este proyecto **incluye push** a `origin/main` (confirmado 2026-08-11, 2026-08-13 y 2026-08-15).
- **Campo de config nuevo enviado por el renderer → añadirlo a la allowlist `SAFE_*` de `main/app-config-allowlists.js`.** Ya no desaparece mudo: sale en `warnings`, y un test compara el payload del renderer contra las allowlists.
- **Fichero nuevo en la RAÍZ → añadirlo a `build.files` de `package.json`** (es whitelist): si no, existe en dev y desaparece en el empaquetado.
- **Ningún enlace que pueda salir a internet lleva credencial persistente. Solo invites.**
- **Al verificar, enmascarar antes de imprimir**: imprimir el booleano (`/[?&]token=/.test(url)`), nunca la URL con token.
- El clasificador de permisos **bloquea** que el agente escriba en `claude-novak.config.json`. Rotar el token lo ejecuta Luismi, con la app cerrada.
- Túnel para probar acceso externo: `cloudflared tunnel --url http://127.0.0.1:<puerto>`, uno por puerto. Verificar el WebSocket con `curl --http1.1`.
- El botón "Copiar invitación de la sesión actual" exige una sesión que ya haya hablado (`semanticSessionId`, `main.js:863`). Si falla, **no copia nada**: parece que copió mal cuando en realidad no copió.
- El explorador de archivos rechaza rutas fuera de `allowedFsRoots()` (`main.js:511`).
- Panel de Conocimiento: reglas duras completas en `.claude/memory/tech/runbook_kb_conocimiento.md`.
