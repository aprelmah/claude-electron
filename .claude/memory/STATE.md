# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-09, noche (verificado contra git y filesystem).

## Estado de entrega (verificado)

- Rama `main`, working tree limpio; últimos commits `23e848a` (módulos kb + tests) y `309be0e` (panel 📚 UI) **pusheados** a origin.
- Tests: 1.439 totales — 1.433 pass, 0 fail, 6 skipped (suite completa en el pre-commit de `309be0e`).
- Deploy: `/Applications/POWER-AGENT.app`, 6 deploys esta sesión; el último con atajos "respuestas preparadas". Verificado por CONTENIDO del asar (`kb:remove`, `kbResolveCwd`, "respuestas preparadas" presentes) y app corriendo con `--type=renderer`.

## Última sesión (2026-08-09 noche — panel 📚 Conocimiento por proyecto)

- **Piloto turbo e**: `~/Desktop/turbo e/CLAUDE.md` con persona experta + imports `@` de fichas → conocimiento PRECARGADO al abrir sesión, cero búsquedas, prompt caching (probado headless: 1 turno, respuestas correctas, 2ª consulta 0,017 $). Luismi lo usó en real: destiló una tarifa PDF y una ficha de autoconsumo, podó imports con 🗑 y creó atajos. Repo turbo e: `b0c8331..20423bd` pusheados.
- **Panel 📚** (botón en la toolbar del terminal): fichas con checkbox activar/desactivar (backticks en el import = desactivada), 🗑 (quita import; Papelera SOLO para `kb/fichas/`), tamaños y total ~tokens, fuentes, drag&drop + destilar por enlace (YouTube por subtítulos yt-dlp con marcas [mm:ss]; web fetch+strip), atajos = respuestas preparadas (formulario y/o el agente de sesión los escribe en `kb/fichas/atajos.md`), botón "Aplicar a la sesión abierta" (writePromptThenEnter con rutas ABSOLUTAS — worktree-safe).
- **Módulos**: `main/knowledge-base.js` (estado = imports del CLAUDE.md del proyecto), `main/kb-extract.js` (PDF vía swiftc+PDFKit cacheado en userData/kb-tools; yt-dlp con fallback `~/Library/Python/*/bin` y `python3 -m yt_dlp`), `main/kb-ipc.js` (destilado claude headless en **cwd neutro** userData/kb-distill para no pagar el contexto del proyecto; texto externo por `sanitizeChannelText` + delimitadores anti-inyección).
- **Regla dura nueva**: el cwd del panel sale del PROYECTO del picker (`#cwd-value`.title), no de `ptyCwd()` — sin sesión el PTY devuelve el home (panel "vacío", bug real de Luismi) y en worktree escribiría fichas en la copia.
- **Reincidencia**: deploy con el dev vivo → la empaquetada se suicida por SingletonLock (2 veces esta sesión). El deploy.sh NO mata el dev.

## Próximo paso

- **YouTube end-to-end VERIFICADO** (2026-08-09 noche, al cierre): vídeo real de 10 min ("Configurar Baterías en Inversores DEYE"), subtítulos → ficha con [mm:ss], tablas e import, 35 s, usando el handler real `kb:distill` (runner headless sustituido por `claude -p` directo, mismo contrato; la vía IPC ya estaba probada con PDF por CDP).
- v2 posibles: fallback Whisper para vídeos sin subtítulos (el transcriber existe, `main/whisper-transcribe.js`, un solo pase — ojo timeouts), editor de fichas en el panel, cola de destilados (hoy 1 a la vez).
- `/wrap` de esta sesión queda pendiente si Luismi lo quiere.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Node del sistema 24; CI 20.18.0. Suite `npm test`.
