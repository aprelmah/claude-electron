# Auditoría senior + limpieza — 2026-08-15 (noche)

Encargo de Luismi: "verifica, limpia y arregla este código — producto fiable, seguro, ligero — saca los agentes que necesites", ejecutado con `/loop` autónomo. 3 auditorías de solo-lectura en paralelo (renderer/seguridad · proceso main · peso muerto), ~20 hallazgos accionables, todos arreglados. 9 commits `2c52da3..17ae15a`, tests 1544 → **1610 (1604/0/6)**, deploy verificado por asar.

## Mapa de módulos nuevos (dónde vive cada verdad ahora)

- `main/graph-worker.js` — entry del worker_thread que corre `computeProjectGraph` fuera del hilo main. Con guard `if (parentPort)`: el smoke test lo carga en el main thread.
- `main/graph-worker-client.js` — `computeProjectGraphAsync`: worker persistente, `ref()` solo con builds en vuelo, reintentos con `MAX_WORKER_FAILURES=3` y **fallback al cálculo síncrono** si el worker no arranca (p.ej. asar sin soporte). Consumidores: `computeProjectGraphForSession` (main.js, con coalescing por sesión vía `graphBuildPromise`) y `graph-window:fetch-graph` (viewer-graph-ipc).
- `main/fs-watch-poll.js` — decisión pura `resolveFsWatchPollAction({nativeAttached, pollRunning})`: el poll de 2,2s (walk de hasta 2500 lstat + sha1) solo corre como FALLBACK sin watcher nativo.
- `main/shell-quote.js` — el ÚNICO quoting de shell (antes duplicado byte a byte en main.js y ws-server.js, ambos alimentando `bash -c`).
- `main/retitle-transcript.js` — reescritura del JSONL al renombrar sesión (antes inline en el handler `update-session-title`, sin ningún test).
- `main/extract-runner.js` — matriz de fallback claude↔codex del extractor headless.
- `main/whatsapp-bridge-control.js` — escalera launchctl bootout→bootstrap→kickstart con clasificación de fallos benignos, `exec` inyectado (24 tests).
- `stripAnsi` único: `codex-resume-watch.js` importa el completo de `agent-pty-proposal.js` (el local débil dejaba residuos ESC/C0 en la comparación de TUI normalizado).

## Decisiones técnicas

- **Worker + fallback, no worker a secas**: asar + worker_threads en Electron 43 no está verificado en runtime; si el worker muere 3 veces, se degrada al síncrono de siempre — el grafo nunca deja de funcionar, como mucho vuelve a ser lento.
- **Coalescing en el caller** (main.js), no en el client: la caché/throttle por sesión ya vivía ahí; el client solo decide DÓNDE corre el build.
- **Memoización de `commandExists` solo de ÉXITOS** (TTL 60s, clave bin+PATH): un fallo se reprueba siempre para que instalar el CLI surta efecto al momento.
- **Endurecimiento de navegación global** (`app.on('web-contents-created')`): válido porque la app es 100% `loadFile` (verificado: cero `loadURL`, cero webviews). `window.open` → `shell.openExternal`; `will-navigate` fuera de `file://` → bloqueado.
- **Degradación de prepare avisa SIEMPRE** (reason `prepare-error`), y prepare comparte la cola por repo de finalize (`repoQueues`): dos ventanas a la vez sobre el mismo repo ya no compiten por index.lock.
- Commits troceados con `main.js` compartido: `git diff` → hunks → 3 parches temáticos aplicados con `git apply --cached --recount` (el hunk de requires partido a mano en h1a/h1b). Árbol final byte-exacto (`git status` limpio tras el último commit).

## Lecciones operativas (mordieron hoy)

1. **La dev sobrevive al kill del deploy**: el `npm run deploy` mató lo suyo pero la dev lanzada por osascript siguió viva → retuvo el `SingletonLock` → la empaquetada arrancó y se suicidó EN SILENCIO. El script dijo "✅ instalado y abierto" igual. Verificar deploy = asar por contenido + **proceso con ventana** (`ps` con `--type=renderer`).
2. **"OK" tras instrucciones multi-paso ≠ OK al último paso**: dije "1) te lanzo la app 2) prueba 3) di OK commitea"; su "OK" era al paso 1 y yo arranqué el 3. Me paró a tiempo (nada commiteado). Ante ambigüedad de autorización: ejecutar el paso conservador, preguntar el irreversible.
3. El smoke test carga TODO `main/*.js` en el main thread: un módulo pensado para worker necesita guard de `parentPort` o revienta la suite.
4. El fixture de un test también se equivoca: `<system-reminder>x</system-reminder>` NO es un turno vacío para `retitleTranscript` (al quitar etiquetas queda la `x`). El código estaba bien; el test no.

## Descartado a propósito (no reabrír sin motivo)

- Check de Origin/Host en el WS: pospuesto por Luismi-decisión pendiente — riesgo de romper el acceso por túnel (Bearer + invites ya cubren).
- Poda masiva de ~45 exports sin consumidores: churn en 10+ ficheros con valor ínfimo.
- `claude-session-listing` a fs.promises: acotado y con caché; "solo si crece".
- La auditoría de peso muerto confirmó: **0 dependencias muertas, 0 ficheros muertos** — build.files está al día; no buscar ahí.
