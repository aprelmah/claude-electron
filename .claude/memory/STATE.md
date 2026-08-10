# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-10, mañana (verificado contra git y filesystem).

## ⚠️ AVISO AL AGENTE ENTRANTE (2026-08-10)

- **Luismi NO está satisfecho con la UX del panel 📚** ("cada vez peor") y ha parado la iteración pidiendo cambio de agente. El trabajo está commiteado en `e10c0c6` y desplegado, pero la UX NO está validada.
- Historia del contenedor en un día: modal centrado → lámina fija a la derecha (rediseño "Agente conocimiento" con chat RAG local en `main/kb-chat.js` + fuentes de audio) → panel ACOPLADO en `#terminal-row` estilo sub-chat con divisor + modo flotante. Técnicamente verificado por CDP (10 checks); estéticamente rechazado.
- Lección para el siguiente: NO iterar más el contenedor a ciegas. Sentarse con Luismi con la app delante (o maquetas) y que él marque la dirección de UX antes de tocar código.

## Estado de entrega (verificado)

- Rama `main`, working tree limpio; último commit `e10c0c6 feat(kb): agente de conocimiento (chat RAG local + audio) y panel acoplado — UX SIN VALIDAR` **pusheado**.
- Tests: 1.448 totales — 1.442 pass, 0 fail, 6 skipped (pre-commit de `e10c0c6`).
- Deploy: `/Applications/POWER-AGENT.app` con `e10c0c6` (panel acoplado), verificado por asar (`kb-divider` presente) y app corriendo con `--type=renderer`.
- Nuevo en `e10c0c6`: `main/kb-chat.js` (chat RAG local por proyecto: chunks de fichas activas, evidencia con citas validadas, historial JSONL en `userData/kb-chats`, sin evidencia no llama al modelo; IPC `kb:ask`/`kb:chat-history`/`kb:chat-clear`), fuentes de AUDIO en el destilador (transcriptor común), y el panel acoplado con divisor + "Desacoplar" flotante.
- **Entorno**: `curl_cffi` **0.11.4 clavada** en user-site de Python 3.14 (impersonation Chrome para yt-dlp, 29 targets). La 0.16 NO carga en Monterey (símbolo `_SCDynamicStoreCopyProxies`) y la 0.7.4 la rechaza yt-dlp 2026.03. Verificado con el vídeo real que daba 429; Luismi destiló su primera ficha de YouTube en real (turbo e `da38ba7`).

## Última sesión (2026-08-09 noche — panel 📚 Conocimiento por proyecto)

- **Piloto turbo e**: `~/Desktop/turbo e/CLAUDE.md` con persona experta + imports `@` de fichas → conocimiento PRECARGADO al abrir sesión, cero búsquedas, prompt caching (probado headless: 1 turno, respuestas correctas, 2ª consulta 0,017 $). Luismi lo usó en real: destiló una tarifa PDF y una ficha de autoconsumo, podó imports con 🗑 y creó atajos. Repo turbo e: `b0c8331..20423bd` pusheados.
- **Panel 📚** (botón en la toolbar del terminal): fichas con checkbox activar/desactivar (backticks en el import = desactivada), 🗑 (quita import; Papelera SOLO para `kb/fichas/`), tamaños y total ~tokens, fuentes, drag&drop + destilar por enlace (YouTube por subtítulos yt-dlp con marcas [mm:ss]; web fetch+strip), atajos = respuestas preparadas (formulario y/o el agente de sesión los escribe en `kb/fichas/atajos.md`), botón "Aplicar a la sesión abierta" (writePromptThenEnter con rutas ABSOLUTAS — worktree-safe).
- **Módulos**: `main/knowledge-base.js` (estado = imports del CLAUDE.md del proyecto), `main/kb-extract.js` (PDF vía swiftc+PDFKit cacheado en userData/kb-tools; yt-dlp con fallback `~/Library/Python/*/bin` y `python3 -m yt_dlp`), `main/kb-ipc.js` (destilado claude headless en **cwd neutro** userData/kb-distill para no pagar el contexto del proyecto; texto externo por `sanitizeChannelText` + delimitadores anti-inyección).
- **Regla dura nueva**: el cwd del panel sale del PROYECTO del picker (`#cwd-value`.title), no de `ptyCwd()` — sin sesión el PTY devuelve el home (panel "vacío", bug real de Luismi) y en worktree escribiría fichas en la copia.
- **Reincidencia**: deploy con el dev vivo → la empaquetada se suicida por SingletonLock (2 veces esta sesión). El deploy.sh NO mata el dev.

## Próximo paso

- **YouTube end-to-end VERIFICADO** (2026-08-09 noche, al cierre): vídeo real de 10 min ("Configurar Baterías en Inversores DEYE"), subtítulos → ficha con [mm:ss], tablas e import, 35 s, usando el handler real `kb:distill` (runner headless sustituido por `claude -p` directo, mismo contrato; la vía IPC ya estaba probada con PDF por CDP).
- v2 posibles: fallback Whisper para vídeos sin subtítulos (el transcriber existe, `main/whisper-transcribe.js`, un solo pase — ojo timeouts), editor de fichas en el panel, cola de destilados (hoy 1 a la vez).
- Propuesta sin ejecutar (pide OK aparte, es código): `scripts/deploy.sh` debe matar también el dev (`pkill -f "claude-electron/node_modules/electron"`) — hoy la empaquetada se suicidó ×2 por su SingletonLock.
- `/wrap` de esta sesión queda pendiente si Luismi lo quiere.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Node del sistema 24; CI 20.18.0. Suite `npm test`.
