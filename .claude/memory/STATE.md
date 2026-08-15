# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-15 mañana (verificado contra git, filesystem y procesos en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (`dfb85f6..0c3d5b0` pusheado). Working tree limpio.
- Últimos commits: `0c3d5b0 test(lan): la decision de reiniciar el servidor sale del handler y entra en CI`, sobre `e4afa28 fix(lan): guardar la config deja de reiniciar el servidor por costumbre`, `95e93fb fix(config): un campo descartado por la allowlist deja de ser invisible`, `501a0b4 fix(lan): pegar la URL del tunel en el campo equivocado deja de borrarla`, `cdc392b fix(lan): el authToken permanente deja de viajar en el enlace público`.
- Tests: **1529 pass, 0 fail, 6 skipped** (1535 totales) — suite completa, pre-commit hook en los cinco commits, Node del sistema v24.13.0. (+45 tests nuevos.)
- Deploy: `/Applications/POWER-AGENT.app`, asar del **2026-08-15 09:33** verificado por CONTENIDO (`main/lan-server-action.js` dentro del asar y `main.js` del propio asar usándolo). App abierta y con ventana (`--type=renderer` presente).
- **`authToken` del servidor LAN ROTADO** (2026-08-15): el expuesto queda inservible. Las dos URLs públicas del túnel, borradas de la config.
- `cloudflared` 2026.7.3 instalado por brew, **sin túneles levantados**. Los puertos 9999/10000 escuchan solo en LAN.

## Última sesión (2026-08-15 mañana — los 12 hallazgos de `/code-review` sobre el fix de la allowlist)

- `/code-review` sobre `4ff868b` devolvió 12 hallazgos; se arreglaron los 12 con 3 agentes en paralelo **agrupados por fichero** (ws-server / config-store / allowlists+renderer) y `main.js` después, por consumir lo de los tres.
- **Crítico**: `buildClientUrl` metía el Bearer permanente en la URL **pública** del túnel. Fix estructural — el `set('token')` vive dentro de la rama LAN, no hay camino para filtrarlo. Ficha: `bugs/bug_lan_token_enlace_publico_2026_08_15.md`.
- **Guardar la config ya no reinicia el servidor LAN** salvo al arrancar o cambiar puerto. Antes, cualquier guardado cerraba las sesiones remotas vivas e invalidaba los invites repartidos.
- `https://…trycloudflare.com` pegado en el campo WS se coerciona a `wss://` en vez de volver vacío; `http:`/`ws:` se rechazan **con mensaje**. `explainLanPublicUrl(raw, kind) → { value, error }`.
- El mecanismo del bug de seis días, cerrado: `pickDropped` + avisos en `warnings`, y un test que lee el payload real de `renderer.js` y exige que sus claves estén en las `SAFE_*` (comprobado que se pone rojo con la allowlist vieja).
- El campo de URL era **invaciable desde la UI** (el poll de 5 s lo rerellenaba): guarda de edición sucia y `??` en vez de `||`.
- La decisión de reiniciar salió del handler a `main/lan-server-action.js` (función pura, 10 tests). Ficha: `tech/tech_logica_en_ipc_handle_sin_cobertura.md`.
- Verificado conduciendo la app real por CDP, no solo con tests: 3 guardados seguidos → **1 arranque LAN**; cambiar el puerto → sí reinicia.

## Próximo paso

- **Luismi no ha probado nada de esto a mano** en la app desplegada.
- La feature de soporte a cliente por enlace (spec `18dfe81`) sigue **diseñada y sin implementar**. El plan de implementación no se ha escrito.
- El **pegamento IPC** sigue sin test: que `save-app-config` llame a las piezas en orden solo está verificado por CDP. Necesita Electron.
- `publicUrlWarning` no aparece con el servidor LAN parado (se calcula dentro del servidor). Con el servidor arrancado —cuando se comparten enlaces— sí sale.
- Sin probar: con **modo empresa activo**, la invitación exige que la carpeta de la sesión caiga dentro de las raíces autorizadas del rol.
- Menor: "QR no disponible (librería `qrcode` no instalada)" — compartir invitación depende de copiar y pegar.
- Arrastrados: commit `9bbb40f` en `turbo-e` con autor "ISABEL"; flake intermitente `cancelledByParent` en `apple-transcribe.test.js`/`voice-note.test.js` bajo carga; una sesión YA abierta en worktree no ve borrados posteriores del conocimiento.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad.
- Antes de `npm run deploy`, matar cualquier proceso dev con `--remote-debugging-port` abierto — si no, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir.
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0) sin necesitar `nvm use 20.18.0`.
- "Comitea y despliega" en este proyecto **incluye push** a `origin/main` (confirmado 2026-08-11, 2026-08-13 y 2026-08-15).
- **Campo de config nuevo enviado por el renderer → añadirlo a la allowlist `SAFE_*` de `main/app-config-allowlists.js`.** Ya no desaparece mudo: sale en `warnings`, y un test compara el payload del renderer contra las allowlists.
- **Ningún enlace que pueda salir a internet lleva credencial persistente. Solo invites.**
- **Al verificar, enmascarar antes de imprimir**: en esta sesión se volcó el `authToken` completo por imprimir un `clientUrl` en una comprobación por CDP. Imprimir el booleano (`/[?&]token=/.test(url)`), nunca la URL.
- El clasificador de permisos **bloquea** que el agente escriba en `claude-novak.config.json`. Rotar el token lo ejecuta Luismi, con la app cerrada.
- Túnel para probar acceso externo: `cloudflared tunnel --url http://127.0.0.1:<puerto>`, uno por puerto (cliente y WS). Verificar el WebSocket con `curl --http1.1`; con HTTP/2 devuelve 426 y parece que el túnel no soporta WS.
- El botón "Copiar invitación de la sesión actual" exige una sesión que ya haya hablado (`semanticSessionId`, `main.js:863`). Si falla, **no copia nada** y el portapapeles conserva lo anterior: parece que copió mal cuando en realidad no copió.
- El explorador de archivos rechaza rutas fuera de `allowedFsRoots()` (`main.js:511`).
- Panel de Conocimiento: reglas duras completas en `.claude/memory/tech/runbook_kb_conocimiento.md`.
