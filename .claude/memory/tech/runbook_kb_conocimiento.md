# Runbook — Conocimiento por proyecto (panel 📚 → ventana 📚)

Creado 2026-08-09 (sesión panel 📚). Subsistema: cada proyecto lleva su conocimiento
precargado vía imports `@` en su CLAUDE.md. **2026-08-10: el panel acoplado (rechazado
en UX) se sustituyó por una ventana Electron independiente, singleton por proyecto**
(`main/window-factory.js` `openKnowledgeWindow`/`getKnowledgeWindow`,
`kb-window.html`/`kb-window-preload.js`/`kb-window-renderer.js`). Ver sección
"2026-08-10" más abajo para lo que cambió; el resto de esta ficha (extractores,
formato de fichas/atajos, reglas de seguridad de escritura) sigue vigente tal cual.

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
  open-window/add-shortcut/read-ficha/write-ficha`. **`kb:ask`/`kb:edit-apply`/
  `kb:chat-history`/`kb:chat-clear` retirados el 2026-08-10 noche** (ver esa
  sección) — no hay chat ni edición por IA, solo gestión de fichas/atajos.
  Cada escritura (`toggle`/`distill`/`add-shortcut`/`write-ficha`/`remove`)
  dispara `commitKbChanges` (`main/kb-git.js`).
- Atajos: `kb/fichas/atajos.md`, entradas `## N · título` = respuestas preparadas
  (pregunta→respuesta, formato libre — corrección de Luismi: NO solo problema→
  soluciones). La cabecera del fichero lleva las instrucciones de uso Y de añadido:
  el agente de sesión también puede crearlos.

## Reglas duras

- **El cwd del panel sale del PROYECTO del picker** (`#cwd-value`.title), jamás de
  `ptyCwd()`: sin sesión el PTY devuelve el home (panel "vacío", bug real reportado
  por Luismi) y en worktree devolvería la copia aislada — fichas escritas ahí se
  pierden de la vista del panel.
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
