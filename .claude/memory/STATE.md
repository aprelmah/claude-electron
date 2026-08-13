# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-13 noche (verificado contra git, filesystem y red en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **2 commits por delante de `origin/main`** (`git status -sb`). Working tree limpio salvo los cambios de memoria de este wrap.
- Últimos commits: `18dfe81 docs(spec): soporte a cliente por enlace autorizador` sobre `4ff868b fix(lan): las URLs públicas del túnel dejan de perderse al guardar`, sobre `789e560` (wrap del conocimiento zombi).
- Tests: **1484 pass, 0 fail, 6 skipped** (1490 totales) — suite completa, pre-commit hook en los dos commits, Node del sistema v24.13.0. (+8 tests nuevos.)
- Deploy: `/Applications/POWER-AGENT.app` con asar del **2026-08-13 10:17**, es decir **SIN el fix de esta sesión**. La app de desarrollo está cerrada.
- `cloudflared` 2026.7.3 instalado por brew. Los dos Quick Tunnels de la prueba están **apagados** (verificado: 530 desde fuera).

## Última sesión (2026-08-13 noche — soporte a cliente por enlace + fix de la allowlist LAN)

- Diseñada la feature "dar soporte a un cliente por enlace autorizador": spec en `docs/superpowers/specs/2026-08-13-soporte-cliente-enlace-design.md`. Decisiones de Luismi: el enlace lo recibe el CLIENTE final; moderación mixta elegible por sesión; el cliente ve chat limpio; fotos sí; el agente que atiende solo conversa, sin herramientas de escritura.
- Restricción de diseño que manda sobre el resto: **Cloudflare Access no sirve para un cliente externo** (no tiene identidad), así que el hostname de soporte va público y la única llave es el invite. De ahí que la superficie deba ser un **listener aparte** (`support-server.js`), no el `ws-server` LAN, que sirve el panel de operador con terminal.
- **Bug arreglado** (`4ff868b`): `SAFE_LAN` era `['enabled','port']` y `save-app-config` descartaba en silencio `publicClientUrl`/`publicWsUrl`. Roto desde el 07-ago, invisible porque nunca se había usado un túnel. Allowlists extraídas a `main/app-config-allowlists.js` con 8 tests. Ficha: `bugs/bug_lan_allowlist_urls_publicas_2026_08_13.md`.
- **Validado end-to-end en real**: Quick Tunnel + WebSocket `101 Switching Protocols` + Luismi hablando con su agente desde el móvil con datos, sin abrir puertos del router. El pendiente "probar LAN + Cloudflare Tunnel" del 07-ago queda cerrado.

## Próximo paso

- **Push de los 2 commits** y **deploy** — `/Applications` sigue con el bug de la allowlist.
- **Rotar el `authToken` del servidor LAN**: quedó expuesto en una captura compartida en el chat y en el contexto de la sesión. Es la llave del panel de operador; mientras no se rote, cualquiera que lo tenga entra si se vuelve a levantar un túnel.
- La feature de soporte está diseñada y commiteada, **sin implementar**. El plan de implementación no se ha escrito.
- Sin probar: con **modo empresa activo**, la invitación exige que la carpeta de la sesión caiga dentro de las raíces autorizadas del rol.
- Menor: "QR no disponible (librería `qrcode` no instalada)" — compartir invitación depende de copiar y pegar.
- Arrastrados: commit `9bbb40f` en `turbo-e` con autor "ISABEL"; flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga; una sesión YA abierta en worktree no ve borrados posteriores del conocimiento.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Antes de `npm run deploy`, matar cualquier proceso dev con `--remote-debugging-port` abierto — si no, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir.
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0) sin necesitar `nvm use 20.18.0`.
- "Comitea y despliega" en este proyecto **incluye push** a `origin/main` (confirmado 2026-08-11 y 2026-08-13).
- **Campo de config nuevo enviado por el renderer → añadirlo a la allowlist `SAFE_*` de `main/app-config-allowlists.js`, o se descarta sin error.**
- Túnel para probar acceso externo: `cloudflared tunnel --url http://127.0.0.1:<puerto>`, uno por puerto (cliente y WS). Verificar el WebSocket con `curl --http1.1`; con HTTP/2 devuelve 426 y parece que el túnel no soporta WS.
- El botón "Copiar invitación de la sesión actual" exige una sesión que ya haya hablado (`semanticSessionId`, `main.js:863`). Si falla, **no copia nada** y el portapapeles conserva lo anterior: parece que copió mal cuando en realidad no copió.
- El explorador de archivos rechaza rutas fuera de `allowedFsRoots()` (`main.js:511`).
- Panel de Conocimiento: reglas duras completas en `.claude/memory/tech/runbook_kb_conocimiento.md`.
