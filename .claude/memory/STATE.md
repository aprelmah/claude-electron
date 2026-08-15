# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-15 noche (verificado contra git, filesystem y el asar en el mismo turno).

## Estado de entrega (verificado)

- Rama `main`, **sincronizada con `origin/main`** (9 commits `2c52da3..17ae15a` pusheados). Working tree limpio salvo la memoria de este cierre.
- Último commit: `17ae15a fix(main): red de arranque, endurecimiento de navegación y backoff del detect`.
- Tests: **1604 pass, 0 fail, 6 skipped** (1610 totales; +60 nuevos) — suite completa en el pre-commit hook de los 9 commits, Node del sistema v24.13.0.
- Deploy: `/Applications/POWER-AGENT.app`, asar del **2026-08-15 19:42** verificado por CONTENIDO (los 6 módulos nuevos dentro; `main.js` del asar con `web-contents-created`, `graph-worker-client` y `retitleTranscript`) y app corriendo con ventana tras relanzarla — el primer arranque se suicidó porque la dev seguía viva con el lock.
- `authToken` del servidor LAN rotado el 2026-08-15 por la mañana; sin túneles levantados.

## Última sesión (2026-08-15 noche — auditoría senior: verificar, limpiar, arreglar)

- Encargo "producto fiable, seguro, ligero" ejecutado con `/loop` autónomo: **3 auditorías en paralelo** (renderer/seguridad, proceso main, peso muerto) → ~20 hallazgos, todos los accionables arreglados en **9 commits temáticos** (`main.js` troceado por hunks con `git apply --cached`, reconstrucción byte-exacta verificada).
- Rendimiento: **grafo a `worker_thread`** (`main/graph-worker*.js`, fallback síncrono + coalescing por sesión) y **poll de fs-watch solo sin watcher nativo** (`main/fs-watch-poll.js`) — los dos únicos hallazgos capaces de congelar PTYs en uso normal. `fs:read`/audio del cliente LAN a I/O async; `commandExists` memoizado (bash de login por spawn); backoff del detect de sessionId.
- Fiabilidad: `prepareSessionWorkspace` AVISA al degradar (cualquier fallo, no solo kb) y comparte cola por repo con finalize (carrera por index.lock demostrada por test antes del fix); red de arranque (`whenReady.catch` con diálogo + `unhandledRejection` global).
- Seguridad: 7 escapes de `innerHTML` (helper global en `renderer.js:7`; viewer con copia local); transcript de audio LAN por `sanitizeChannelText` (cerraba el único hueco del invariante de canal); navegación endurecida global (`web-contents-created`: `window.open` → navegador del sistema, nada navega fuera de `file://`).
- Limpieza: subsistema TASK muerto (~127 líneas), `createLruCache`, PNG huérfano de 582 KB que viajaba en cada build; `shellQuote` y `stripAnsi` únicos; escalera launchctl del bridge y matriz del extractor extraídas a módulos puros con tests.
- Detalle completo y mapa de módulos nuevos: `tech/tech_auditoria_limpieza_2026_08_15.md`.

## Próximo paso

- **3 decisiones de Luismi pospuestas**: check de Origin/Host en el WS (riesgo de romper el acceso por túnel), poda de ~45 exports sin consumidores, `claude-session-listing` async.
- LAN/voz remota sin probar en real tras estos cambios; el worker del grafo en la app EMPAQUETADA sin verificar en runtime (asar + worker_threads; el fallback síncrono cubre si no arranca).
- Flake de puerto 16849 en `ws-server-codex-sessions` (1 de 3 runs de la suite) — vigilar si repite.
- La feature de soporte a cliente por enlace (spec `18dfe81`) sigue diseñada y sin implementar.
- Arrastrados: picker y `kb-panel.js` sin cobertura; pegamento IPC sin test; commit `9bbb40f` en turbo-e con autor "ISABEL"; flake `cancelledByParent` en tests de voz bajo carga; una sesión YA abierta en worktree no ve borrados posteriores del conocimiento.

## Notas operativas

- Dev/deploy vía osascript; Mac Intel → `dist/mac/POWER-AGENT.app`. Verificar deploys por contenido del asar DESDE el scratchpad **y comprobando el PROCESO**: una dev viva (con o sin CDP) puede sobrevivir al kill del deploy, retiene el `SingletonLock` y la empaquetada se suicida en silencio al abrir (mordió el 2026-08-15 noche).
- **El grafo corre en worker** (`computeProjectGraphAsync` de `main/graph-worker-client.js`); jamás llamar `computeProjectGraph` síncrono desde el hilo main.
- **Un CDP que responde en 9222 no prueba que hables con el proceso que acabas de lanzar.** Confirmar identidad de instancia antes de teorizar.
- El pre-commit hook corre la suite completa con el Node del sistema (v24.13.0) sin `nvm use`.
- "Comitea y despliega" en este proyecto **incluye push** a `origin/main`.
- Campo de config nuevo del renderer → allowlist `SAFE_*` (`main/app-config-allowlists.js`). Fichero nuevo en la RAÍZ → `build.files` (whitelist).
- **Ningún enlace público lleva credencial persistente; solo invites.** Al verificar, enmascarar antes de imprimir (el booleano, nunca la URL con token).
- El clasificador bloquea escribir `claude-novak.config.json`; rotar el token lo ejecuta Luismi con la app cerrada.
- Túnel de prueba: `cloudflared tunnel --url http://127.0.0.1:<puerto>`, uno por puerto; WS con `curl --http1.1`.
- "Copiar invitación de la sesión actual" exige sesión que ya haya hablado; si falla, **no copia nada** (el portapapeles conserva lo anterior).
- El explorador rechaza rutas fuera de `allowedFsRoots()` (`main.js:511`). Conocimiento: reglas duras en `tech/runbook_kb_conocimiento.md`.
