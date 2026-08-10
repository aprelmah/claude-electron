# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-10, noche (verificado contra git, filesystem y app real).

## Estado de entrega (verificado)

- Rama `main`, working tree limpio; 2 commits nuevos **sin pushear**: `5d22916 feat(kb): auto-commit del conocimiento tras cada cambio del panel` y `34a7d4d refactor(kb): corta el chat y la edición por IA del notebook de conocimiento` (sobre `11d7921`, el wrap de la sesión anterior).
- Tests: 1451 pass, 0 fail, 6 skipped (última corrida antes del segundo commit; el flake conocido de `apple-transcribe`/`voice-note` bajo carga, ver `bugs/bug_flake_apple_transcribe_voice_note_2026_08_10.md`, no salió esta vez).
- Deploy: `/Applications/POWER-AGENT.app`, verificado por CONTENIDO del asar (`main/kb-git.js` presente, `main/kb-chat.js` ausente, `kb-ipc.js` sin restos de `kb:ask`/`kb:edit-apply`/`kb-chat` y con 6 referencias a `commitKbChanges`, `kb-window.html` sin columna chat), app corriendo con `--type=renderer`.

## Última sesión (2026-08-10 noche — Chat/edición IA retirados + auto-commit del conocimiento)

- **Punto de partida**: decisión de alcance pendiente de la sesión anterior — si cortar la columna Chat y la tarjeta de edición por IA del notebook de conocimiento. Confirmada tras razonar coste (no es API de pago, es cuota de suscripción vía CLI `claude`, pero sigue sumando llamadas headless que compiten con el trabajo real) y precarga (el toggle actual ya resuelve el control por sesión; no compensa construir un selector "con/sin conocimiento" al lanzar).
- **Recorte ejecutado** (commit `34a7d4d`): borrado `main/kb-chat.js` (376 líneas) + su test; quitados `kb:ask`/`kb:edit-apply`/`kb:chat-history`/`kb:chat-clear` de `kb-ipc.js` y el preload; ventana de conocimiento a 2 columnas (Fuentes | Atajos). Razonamiento: una sesión de terminal normal con `@import` carga la ficha COMPLETA (no snippets de retrieval) y edita con `Edit` real (exige match exacto — guardarraíl más duro que la validación a medida del chat). Lo irreducible: destilar, atajos, toggle — eso se queda.
- **Bug real reportado por Luismi ("el agente no se entera de nada") diagnosticado con evidencia real, no solo teoría**: probado con `claude -p` (misma llamada que una sesión al arrancar) en el proyecto ficticio de prueba Y en el proyecto real de Luismi `turbo-e` — el mecanismo `@import`/toggle funciona perfecto en ambos. La causa real, confirmada con un screenshot suyo de una sesión en worktree que solo veía 1 de 4 atajos: **un worktree de sesión es una copia congelada del último commit** — `turbo-e` tenía 8 ficheros de `kb/`+`CLAUDE.md` sin commitear. Commiteado a petición explícita (`9bbb40f` en el repo de `turbo-e`, autor quedó como "ISABEL" en vez de "Luismi", pendiente de corregir con `--amend --reset-author` si lo pide).
- **Auto-commit del conocimiento implementado con TDD** (commit `5d22916`): `main/kb-git.js` → `commitKbChanges(projectDir, message)`, acotado a `CLAUDE.md`+`kb/` (nunca `-A`, nunca push, best-effort — si git falla, la operación del panel ya se guardó en disco igual). Enganchado en los 5 puntos de escritura del panel (`toggle`/`distill`/`add-shortcut`/`write-ficha`/`remove`). 5 tests unitarios + 2 de integración con git real. Bug real cazado en el proceso: `git add -- CLAUDE.md kb` falla ENTERO si uno de los dos paths no existe en disco — fix: filtrar a los que `fs.existsSync`.
- **Verificado en dev real por CDP** (no solo tests): clic real en el checkbox del toggle → `CLAUDE.md` cambia en disco Y se genera el commit solo, `git status` queda limpio después.
- **2 bugs operacionales propios encontrados y corregidos en el camino**: el script de lanzamiento dev vía osascript no hacía `cd` al proyecto (nueva Terminal abre en `$HOME`, comando relativo falla en silencio, log viejo no se sobrescribe — despistó un buen rato); el proceso dev con CDP que dejé corriendo retenía el `SingletonLock` y la app empaquetada del deploy se suicidó en silencio al abrir — mismo síntoma que "dev y empaquetada nunca conviven", pero en la dirección dev→empaquetada en vez de la habitual.
- Deploy final verificado por asar (ver arriba).

## Próximo paso

- **Sin pushear** — los 2 commits de hoy en POWER-AGENT están solo en local `main`.
- UX pendiente del panel, identificada pero sin arreglar: el toggle (checkbox nativo) es poco visible/fácil de pasar por alto; los modales de "editar ficha a mano" y "+ nuevo atajo" (`position:fixed` sin backdrop) se ven flotando, no leen como modal real; el botón "Agente conocimiento" en la barra del terminal debería perder la palabra "Agente" (ya no hay IA conversacional detrás) — discutido, no ejecutado, sin decisión de prioridad.
- Commit `9bbb40f` en el repo de `turbo-e` quedó con autor "ISABEL" en vez de "Luismi" — ofrecido corregir, sin respuesta.
- Luismi aún no ha probado él mismo en real la app deployada de hoy (chat/edición cortados + auto-commit).
- Bug sin resolver (no bloqueante, documentado): flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga — `bugs/bug_flake_apple_transcribe_voice_note_2026_08_10.md`.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Antes de `npm run deploy`, matar cualquier proceso dev con `--remote-debugging-port` abierto — si no, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir.
- El script de lanzamiento dev por osascript SIEMPRE necesita `cd <projectPath> &&` explícito antes del comando — si no, la nueva ventana de Terminal abre en `$HOME`.
- Node del sistema 24; CI 20.18.0. Suite `npm test`.
