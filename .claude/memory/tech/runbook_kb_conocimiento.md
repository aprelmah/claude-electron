# Runbook — Conocimiento por proyecto (panel 📚 → ventana 📚 → pestañas 📚)

Creado 2026-08-09 (sesión panel 📚). Subsistema: cada proyecto lleva su conocimiento
precargado vía imports `@` en su CLAUDE.md. **2026-08-10: el panel acoplado (rechazado
en UX) se sustituyó por una ventana Electron independiente, singleton por proyecto**
(`main/window-factory.js` `openKnowledgeWindow`/`getKnowledgeWindow`,
`kb-window.html`/`kb-window-preload.js`/`kb-window-renderer.js`). **2026-08-11: esa
ventana también se retiró — ahora es `kb-panel.js`, 3 pestañas hermanas Chat/Casos/
Fichas dentro de la ventana principal.** Ver sección "2026-08-11" al final de esta
ficha para la arquitectura vigente; las secciones "2026-08-10" que siguen son
arqueología (documentan por qué se llegó hasta ahí, no el estado actual). El resto de
esta ficha (extractores, formato de fichas/atajos, reglas de seguridad de escritura)
sigue vigente tal cual.

## Arquitectura

- **Estado = el CLAUDE.md del proyecto.** No hay almacén propio: una línea `@ruta`
  por ficha activa; la misma ruta entre backticks = desactivada (los imports dentro
  de code spans no se evalúan). Módulo: `main/knowledge-base.js`.
- Fichas destiladas en `<proyecto>/kb/fichas/`, originales en `<proyecto>/kb/fuentes/`.
- Extractores (`main/kb-extract.js`): PDF vía `swiftc`+PDFKit (binario cacheado en
  `userData/kb-tools/pdftxt`), web fetch+strip HTML, YouTube SOLO subtítulos con
  yt-dlp (VTT con dedupe de cues rodantes y marcas `[mm:ss]`; resolución del binario:
  PATH → `~/Library/Python/*/bin` → `python3 -m yt_dlp`). Sin subtítulos → error claro
  (fallback Whisper = v2, el transcriber existe en `main/whisper-transcribe.js`).
- IPC (`main/kb-ipc.js`): `kb:list/toggle/add-file/remove/distill/apply-to-session/
  add-shortcut/update-shortcut/delete-shortcut/read-ficha/write-ficha`. **`kb:ask`/
  `kb:edit-apply`/`kb:chat-history`/`kb:chat-clear` retirados el 2026-08-10 noche**
  (ver esa sección) — no hay chat ni edición por IA, solo gestión de fichas/casos.
  **`kb:open-window` retirado el 2026-08-11** (ya no hay ventana, ver esa sección).
  Cada escritura (`toggle`/`distill`/`add-shortcut`/`update-shortcut`/
  `delete-shortcut`/`write-ficha`/`remove`) dispara `commitKbChanges` (`main/kb-git.js`).
- Atajos: `kb/fichas/atajos.md`, entradas `## N · título` = respuestas preparadas
  (pregunta→respuesta, formato libre — corrección de Luismi: NO solo problema→
  soluciones). La cabecera del fichero lleva las instrucciones de uso Y de añadido:
  el agente de sesión también puede crearlos.

## Reglas duras

- **El cwd del panel sale del PROYECTO del picker**, jamás de `ptyCwd()`: sin sesión
  el PTY devuelve el home (panel "vacío", bug real reportado por Luismi) y en
  worktree devolvería la copia aislada — fichas escritas ahí se pierden de la vista
  del panel. Desde 2026-08-11, la función canónica es `window.__resolveProjectCwd()`
  (`renderer.js`), reutilizada por `kb-panel.js` — no reinventarla.
- **El destilado headless corre en cwd NEUTRO** (`userData/kb-distill`): en el cwd
  del proyecto cargaría su propio CLAUDE.md con todas las fichas y pagaría ese
  contexto en cada destilado.
- **Texto de web/YouTube es NO CONFIABLE**: pasa por `sanitizeChannelText` y va
  delimitado (`<<<FUENTE>>>…<<<FIN>>>`) con instrucción anti-inyección; `risky` se
  destila igual pero se avisa en warnings.
- **La Papelera solo para `kb/fichas/`** (`isPanelFicha`): un import que apunte fuera
  (p. ej. `.claude/memory/`) solo pierde su línea, el archivo JAMÁS se toca.
- **"Aplicar a la sesión abierta" usa rutas ABSOLUTAS** del proyecto real (una sesión
  worktree no tiene las fichas nuevas en su copia) y pasa por `writePromptThenEnter`.
  Desactivar fichas NO se puede aplicar en vivo: del contexto cargado no se des-sabe.
- **Worktree + conocimiento sin commitear = experto invisible**: la sesión 🌿 clona
  del último commit. **Mitigado desde 2026-08-10 noche**: cada escritura del panel
  comitea sola (`commitKbChanges`, ver esa sección) — pero si el proyecto NO es un
  repo git, o el commit falla por lo que sea, sigue siendo responsabilidad de
  Luismi commitear a mano.

## Patrón: verificar UI de Electron por CDP (lo que cazó el bug del cwd)

1. Lanzar dev con `npm start -- --remote-debugging-port=9333` (vía osascript).
2. `curl 127.0.0.1:9333/json` → `webSocketDebuggerUrl` de la página POWER-AGENT.
3. Desde Node con el `ws` de node_modules: `Runtime.evaluate` (con `awaitPromise` y
   IIFE async si hay await) para clicar botones reales, leer DOM e invocar
   `window.api.*` — verifica el wiring IPC de verdad, no solo los módulos.
4. Ojo: un script que peta a mitad deja estado sucio en la página (modal abierto);
   re-ejecutar antes de concluir que hay bug.

## YouTube: 429 y curl_cffi (añadido 2026-08-09 al cierre)

- YouTube limita las descargas de subtítulos (HTTP 429) con llamadas seguidas desde
  la misma IP. Mitigado en `extractYoutube`: español primero e inglés SOLO de reserva
  (pedir todos los idiomas a la vez multiplica peticiones), `--sleep-subtitles 1`, y
  el 429 se traduce a error legible ("espera unos minutos") vía `isYoutubeRateLimit`.
- **`curl_cffi` 0.11.4 clavada** en el user-site de Python 3.14 (`pip install --user
  --break-system-packages`): da a yt-dlp impersonation de Chrome (29 targets) y
  esquiva la mayoría de bloqueos. NO subir a 0.16+ (no carga en Monterey: símbolo
  `_SCDynamicStoreCopyProxies` ausente) ni bajar a 0.7.x (yt-dlp 2026.03 la rechaza:
  targets "unavailable"). Si yt-dlp se actualiza, revalidar la pareja de versiones.
- Verificado con vídeo real que daba 429: tras instalar 0.11.4, subtítulos es a la
  primera con los args nuevos.

## 2026-08-10 (noche) — Chat y edición IA retirados; auto-commit del conocimiento

Tras cuestionar el diseño (no la UX, la arquitectura), Luismi decidió cortar la
columna Chat y la tarjeta de edición por IA de la sección "2026-08-10" de abajo:
una sesión de terminal normal con `@import` ya carga el texto COMPLETO de la
ficha (no snippets de retrieval) y edita con `Edit` real (exige match exacto,
guardarraíl más duro que la validación a medida del chat) — mejor en ambos
frentes. Lo irreducible frente al agente normal: **destilar** (extracción fuera
de la sesión, para no comerse el contexto), **atajos**, **toggle**. Eso se queda.

- Borrado `main/kb-chat.js` entero (376 líneas) + su test. Quitados de
  `kb-ipc.js`/preload: `kb:ask`, `kb:edit-apply`, `kb:chat-history`,
  `kb:chat-clear`. Ventana a 2 columnas: Fuentes | Atajos. Commit `34a7d4d`.
- **Causa raíz real de "el agente no se entera de nada"** (bug reportado por
  Luismi, reproducido con su proyecto real `turbo-e`): NO es el toggle ni el
  mecanismo `@import` — ambos funcionan bien (probado con `claude -p` real,
  responde exacto). Es que **un worktree de sesión es una copia congelada del
  último commit**: si `kb:toggle`/`kb:distill`/atajos escriben en disco pero
  nadie commitea, cualquier worktree nuevo (o existente) no lo ve — turbo-e
  tenía 8 ficheros de `kb/`+`CLAUDE.md` sin commitear, la sesión del worktree
  solo veía 1 de 4 atajos reales. Esto YA estaba anotado como riesgo teórico
  arriba ("Worktree + conocimiento sin commitear = experto invisible") —
  ahora tiene mitigación automática, ver siguiente punto.
- **`main/kb-git.js` — `commitKbChanges(projectDir, message)`**: auto-commit
  acotado a `CLAUDE.md` + `kb/` (nunca `-A`, nunca push, best-effort: si git
  falla, la operación del panel que lo llamó ya se guardó en disco igual, no
  se bloquea). Enganchado en los 5 puntos de escritura: `kb:toggle`,
  `kb:distill`, `kb:add-shortcut`, `kb:write-ficha`, `kb:remove`. Mensajes de
  commit por operación (`kb: activa/desactiva <relPath>`, `kb: destila
  <título>`, etc.), fáciles de leer en `git log -- kb/`. Commit `5d22916`.
  TDD: 5 tests unitarios (`tests/kb-git.test.js`) + 2 de integración con git
  real (`tests/kb-ipc.test.js`).
- **Bug real cazado en el camino**: `git add -- CLAUDE.md kb` falla ENTERO
  (exit 128, nada se stagea) si UNO de los dos paths no existe en disco (p.
  ej. proyecto nuevo sin `kb/` aún creado). Fix: filtrar a los paths que
  `fs.existsSync` antes de pasarlos a `git add`.
- **UX pendiente, sin arreglar**: el toggle (checkbox nativo pequeño) es poco
  visible — Luismi no lo encontraba a simple vista. Los modales de "editar
  ficha a mano" y "+ nuevo atajo" (`position:fixed` sin backdrop/overlay) se
  ven flotando sobre el panel, no leen como modal real. El botón "Agente
  conocimiento" en la barra del terminal debería perder la palabra "Agente"
  (ya no hay IA conversacional detrás) — discutido, no ejecutado.
- Verificado en dev real por CDP (no solo tests): clic real en el checkbox del
  toggle → `CLAUDE.md` cambia en disco Y se genera el commit solo, `git
  status` queda limpio. Deploy verificado por contenido del asar.

## 2026-08-10 — Ventana propia (sustituye al panel acoplado)

**Parte de esta sección ya NO aplica** — la columna Chat y `kb:edit-apply` se
retiraron la misma noche (ver sección de arriba). El resto (destilado, fichas,
atajos, "Aplicar a sesión", reglas de seguridad de escritura) sigue vigente.

Diseño completo en `docs/superpowers/specs/2026-08-10-notebook-conocimiento-design.md`,
plan en `docs/superpowers/plans/2026-08-10-notebook-conocimiento.md` (13 tasks + 1 extra
+ fix wave de revisión final, todo con reviews limpias — commit final `dbb4d94`).

- **Una ventana por proyecto** (`Map<projectDir, win>` en `window-factory.js`), no
  multi-instancia libre: reabrir sobre el mismo proyecto hace foco, no duplica.
- **3 columnas simultáneas** en la ventana (Fuentes | Chat | Atajos), sin pestañas —
  la queja original era justo eso: fichas/atajos eran pantallas aparte.
- **El chat puede proponer ediciones**: si Luismi pide una corrección, `kb:ask`
  devuelve `edit: {relPath, find, replace, reason}` (validado server-side: `relPath`
  SOLO puede ser una ficha que ya estaba en la evidencia de esa respuesta — allowlist
  estricta, no puede inventarse un fichero). La UI la muestra como tarjeta con
  Aceptar/Descartar; solo al aceptar se llama a `kb:edit-apply`, que sustituye el
  fragmento (`find` debe aparecer EXACTAMENTE una vez, si no rechaza sin escribir) vía
  `atomicWriteFileSync`. Dos puertas independientes (contrato del modelo + reescritura
  server-side) antes de que nada mute disco.
- **Edición manual** (`kb:read-ficha`/`kb:write-ficha`, reescritura completa, no
  fragmento): doble-click en una ficha de Fuentes O en un atajo abre un editor inline.
  Mismo límite de seguridad que `kb:edit-apply` (`kb.isPanelFicha`, solo `kb/fichas/`).
- **"Aplicar a sesión" SÍ está cableado** (botón en la cabecera de la columna Fuentes,
  aplica las fichas activas) — estuvo a punto de quedarse huérfano entre tasks (backend
  completo, sin botón) hasta que la revisión final de rama lo cazó.
- **Retrieval del chat más generoso sin perder el fail-closed**: `MAX_EVIDENCE` 8→18,
  se retiró el fallback que volcaba fichas al azar en preguntas de orientación
  ("resumen", "de qué va"...) — ese fallback era la causa real de "vomita lo que
  encuentra". El umbral `score > 0` se mantiene: sin coincidencia real, sigue sin
  llamar al modelo.
- **`distillBusy` es por proyecto** (`Map`), no un booleano global — con panel único
  bastaba, con N ventanas bloqueaba proyectos entre sí con un mensaje que no decía
  cuál era el culpable.
- **`kb:apply-to-session` resuelve por `projectDir`, no por `event.sender`** (roto en
  cuanto el panel dejó de vivir en la ventana del terminal). `findSessionByProjectDir`
  en `main.js` compara contra `session.gitWorkspace?.realCwd || session.cwd` — un
  descuido inicial comparaba solo `session.cwd`, que en sesiones con aislamiento
  worktree es la copia, no el proyecto real; nunca habría encontrado sesión.

### Pendiente de endurecer (diferido, NO regresión de esta sesión)

`resolveProjectDir` en `main/kb-ipc.js` se fía del `cwd` que manda el renderer de la
ventana; main ya tiene el auténtico (es la clave del `Map` de `window-factory` y el
query param que él mismo puso al abrir). Nada los contrasta hoy — heredado del panel
acoplado, no lo introdujo esta sesión, pero ahora es barato de cerrar:
`window-factory` ya exporta `getKnowledgeWindow(projectDir)` sin más uso que los
tests. Si se compromete el renderer de esta ventana, `kb:write-ficha`/`kb:edit-apply`
escriben en `<cualquier dir existente>/kb/fichas/*`, no solo en el proyecto de esa
ventana. Property de "próximo paso" antes de tocar más esta feature.

### Otros diferidos (menores, en el ledger de la sesión, no en disco)

Botón "Aplicar a sesión" sin guard anti-doble-click; chips de cita `.citation-chip`
inertes (sin listener); `kb:list` se pide dos veces por refresco (Fuentes + Atajos
por separado); `kbButtonResolveCwd` conserva el fallback a `ptyCwd()` (heredado,
no regresión — amplificado por el singleton por proyecto: un cwd de worktree abriría
una ventana cacheada sobre la copia).

## Coste medido (piloto turbo e, 2026-08-09)

Precarga ~70 KB (≈20k tokens): 1ª consulta 0,10 $ (crea caché), siguientes ~0,017 $
(caché 67k), 1 turno, 0 búsquedas. Destilado YouTube 10 min → ficha en 35 s.

## 2026-08-11 — Ventana retirada; 3 pestañas hermanas Chat/Casos/Fichas (arquitectura vigente)

Petición de Luismi: quitar el botón "Agente conocimiento", separar Atajos→**Casos**
(editables con resolución) y **Fichas** (editables) como dos acciones de creación
distintas, y sacar el panel de la ventana modal a **pestañas dentro del IDE** — no
una caja lateral. Ejecutado con `/loop` (4 fases con agentes en background) y una
corrección en vivo tras el primer deploy.

- **No existe sistema de tabs tipo VS Code en la app** (cada sesión es una
  `BrowserWindow` independiente) — no se tocó ese modelo. Primer intento: panel
  lateral dockeado (patrón sub-chat) con mini-pestañas internas Casos/Fichas.
  Luismi lo probó desplegado y lo **rechazó**: quería pestañas hermanas al mismo
  nivel que el terminal, no una caja aparte que le quitara ancho.
- **Arquitectura final**: `kb-panel.js` (nuevo fichero, IIFE — los `<script>` sueltos
  del renderer comparten ámbito global, ver `bugs/bug_scripts_renderer_ambito_global.md`)
  monta 3 vistas dentro de `#terminal-row`: `#tab-view-chat` (el terminal de siempre)
  más las vistas de Casos y Fichas, cada una a `flex:1`, conmutadas con `display:none`
  — solo una visible a la vez, ocupando TODO el ancho disponible (ya no ~700px de
  caja lateral). El terminal **nunca se destruye/reinicia** al cambiar de pestaña,
  solo se oculta; al volver a Chat se dispara `scheduleTerminalRefit()` por si el
  layout cambió mientras estaba oculto. API pública: `window.__contentTabs.setActiveTab()`
  (sustituye a `window.__kbPanel.toggle()`, que ya no existe).
- **Ventana modal retirada del todo**: `kb-window.html`, `kb-window-renderer.js`,
  `kb-window-preload.js`, `openKnowledgeWindow`/`getKnowledgeWindow` en
  `window-factory.js`, canal `kb:open-window`, y `tests/window-factory.test.js`
  (solo testeaba la función retirada). Botón `#btn-kb` y su grupo "PROYECTO"
  eliminados de `index.html` — ya no hace falta un botón que abra/cierre nada,
  las 3 pestañas están siempre visibles.
- **Casos editables/borrables individualmente** (antes solo se podía añadir al
  final de `atajos.md` o editar el fichero entero a mano): `updateShortcut(projectDir,
  id, {title, body, related})` y `deleteShortcut(projectDir, id)` en
  `knowledge-base.js`, canales `kb:update-shortcut`/`kb:delete-shortcut`.
  `parseShortcuts` ahora extrae el cuerpo completo de cada entrada (antes solo el
  título). `deleteShortcut` NO renumera el resto — huecos tolerados, igual que
  `addShortcut` ya usaba `max(nums)+1`, no `length+1`.
- **El agente de sesión puede crear un caso por chat** ("esto ponlo como caso"):
  `ATAJOS_HEADER` (cabecera de `atajos.md`, se carga vía `@import` cuando el fichero
  está activo) le instruye el formato exacto (`## <n+1> · <título>` + cuerpo) y que
  comitee él mismo (`git add CLAUDE.md kb/ && git commit -m "..."`, ya tiene
  git-por-sesión). **Decidido NO construir un script auxiliar** (`kb-add-case.js`):
  el agente trabaja en el cwd del proyecto DEL USUARIO (p. ej. turbo-e), no en el
  de POWER-AGENT — un script en `scripts/` de este repo no sería alcanzable sin
  plumbear una ruta de recursos nueva (`main/cli-resolver.js` no expone hoy ningún
  env var así). Calcular el número siguiente leyendo el fichero es trivial para
  cualquier agente con Read/Grep; no compensaba la complejidad de distribución.
- **Voz en el editor de Caso**: `insertTranscribedText(el, text)` en `kb-panel.js`,
  desacoplada de `injectToPty`/`writePty` (esas siguen sirviendo solo al terminal —
  NO tocarlas para esto). Botones `#kb-case-title-mic`/`#kb-case-body-mic`, mismo
  motor de transcripción (Apple Speech/whisper.cpp) que `#btn-mic`. Bug real cazado
  en la revisión estética: el SVG de estos botones no llevaba `stroke`/`fill` (se
  pintaba mal) — corregido para usar exactamente el mismo lenguaje visual que
  `#btn-mic` (24×24, trazo `currentColor` 2.2px, mismo hover/estado de grabación).
- **Auto-ajuste al redimensionar la ventana** (pedido tras probar el segundo
  deploy): la `BrowserWindow` principal no tenía `minWidth`/`minHeight` — a tamaños
  patológicos el sidebar (ancho persistido en px) se comía todo el hueco. Fix:
  `main.js` con `minWidth:640/minHeight:420`; `renderer.js` con
  `clampSidebarToWindow()` enganchada al listener de `resize`, recorta el ancho/alto
  persistido del sidebar contra el hueco real disponible (no toca el arrastre a mano
  del `#divider`). `.kb-col-list` tenía `flex: 0 0 340px` (`shrink:0`, nunca encogía
  — en ventana estrecha dejaba el editor a 0px de ancho real) → `flex: 0 1 340px` +
  `min-width:220px`. `container-type: inline-size` en `#terminal-row` (el ANCESTRO,
  no las pestañas mismas — Chromium no aplica `@container` al propio contenedor) +
  `@container (max-width:640px)`: Casos/Fichas pasan de 2 columnas a apiladas
  verticalmente cuando el hueco real cae por debajo de ese umbral.
- **Nota técnica de verificación**: el CDP que expone Electron NO tiene
  `Browser.setWindowBounds`/`Browser.getWindowForTarget` (error `-32601`, confirmado
  con la app real) — para redimensionar la ventana de verdad desde un script CDP hay
  que usar `window.resizeTo()` vía `Runtime.evaluate` (Electron sí lo reenvía a la
  ventana nativa; confirmable leyendo `outerWidth`/`outerHeight` antes/después). Ver
  también `tech_pilotar_app_por_cdp.md`.
- 2 commits (`a0d1c6f` backend, `5581102` UI+voz+auto-ajuste), pre-commit hook con
  la suite completa en verde las dos veces (Node del sistema v24.13.0, sin
  `nvm use 20.18.0`), pusheados a `origin/main`, deploy final verificado por asar.

### 2026-08-11 (tarde) — atajos.md fuera de Fichas + blindaje + overlap dropzone/URL

`atajos.md` (sostiene todos los Casos) aparecía también como ficha normal en la
pestaña Fichas, con papelera — un clic de más borraba TODOS los Casos. Arreglado:

- `kb-panel.js` filtra `atajos.md` de la lista de Fichas por
  `data.shortcuts.relPath` (viene de `kb:list`, calculado desde `ATAJOS_RELPATH` en
  `knowledge-base.js` — no hardcodear la ruta por nombre en ningún sitio nuevo).
- `main/kb-ipc.js`: `assertNotAtajos(relPath)` rechaza `kb:toggle`/`kb:remove`
  sobre `ATAJOS_RELPATH`, cinturón de seguridad además del filtro de UI (cubre
  cualquier otra vía de llamada a esos canales, no solo el clic en el panel).
- Bug de overlap (dropzone/URL pintados encima de filas de la lista): `.kb-list`
  (`#kb-fichas-list`) tenía `flex:1; min-height:0` sin `overflow`, así que
  desbordaba en `overflow:visible` (default) sobre sus hermanos siguientes. Fix:
  `overflow-y:auto` en `.kb-list`.
- Commits `edd83b3` (memoria) + `89072a5` (fix), tests 1459/0 fail, verificado por
  CDP real (hit-testing con la lista scrolleada al fondo, 5 casos reales intactos).

### 2026-08-13 — INVARIANTE: ninguna sesión arranca con conocimiento retirado

Bug crítico: fichas y casos borrados por Luismi seguían precargados en la sesión
siguiente (el experto SAT respondía con conocimiento derogado sobre instalaciones
reales). Detalle completo, evidencia y lecciones de método en
`bugs/bug_kb_conocimiento_zombi_2026_08_13.md`.

Causa: el worktree de sesión nace de `HEAD` (`git worktree add … HEAD`), así que un
borrado que no llega a un commit es **inmortal** — la cara letal de la regla ya
conocida "worktree + conocimiento sin commitear = experto invisible".

Reglas duras que salen de aquí:

- **El invariante se garantiza donde NACE el worktree** (`prepareSessionWorkspace` en
  `main/session-git.js`), no en cada escritura. Hay al menos tres vías de borrar
  conocimiento — panel, agente de sesión (`rm` + `Edit` del CLAUDE.md), Finder/terminal
  — y parchear rutas nunca las cubre todas. En el bug real, el borrado NO pasó por el
  panel.
- `main/kb-git.js` gana `hasPendingKbChanges()` y `ensureKbCommitted()`. Éste, a
  diferencia del best-effort de `commitKbChanges`, devuelve `ok:false` cuando lo
  pendiente no llega a HEAD: el que llama tiene que reaccionar.
- **Si el conocimiento no se puede commitear, NO se crea worktree**: la sesión arranca
  en el cwd real, donde el disco es la verdad, con aviso al usuario
  (`onDegraded` → `notifyKbNotCommitted`). Un worktree obsoleto miente; sin aislamiento
  el agente al menos lee lo que hay.
- `commitKbChanges` comitea con `--no-verify`. El conocimiento no es código: un
  pre-commit del proyecto destino (lint/tests) bloqueando el commit dejaría el borrado
  fuera de HEAD, que es exactamente el fallo que se está evitando.
- Sigue acotado a `CLAUDE.md` + `kb/`, **nunca `-A`**: el código a medias del usuario no
  se toca jamás (verificado en la app real).
- **El auto-commit del panel deja de ser mudo**: las 7 rutas de `main/kb-ipc.js`
  propagan `commitWarning` y `kb-panel.js` lo canta (`reportKbResult`). Un borrado que
  el usuario da por hecho y que git no registró es el bug entero; callarlo lo esconde.
  Toda ruta nueva del panel que escriba conocimiento pasa por `commitKb(...)`, no por
  `commitKbChanges` a pelo.
- El CLAUDE.md de un proyecto experto que instruya "si trabajas en worktree, escribe en
  la ruta REAL" es correcto (si no, el cambio se pierde) pero deja el repo real sucio;
  con este invariante ya no es peligroso, y conviene saberlo al escribir esas instrucciones.

Commits `7da86fe` (invariante) + `6563cc2` (fin del fallo mudo), tests 1475/0/6, deploy
verificado por asar. Estado de turbo e reparado con `fada081`.
