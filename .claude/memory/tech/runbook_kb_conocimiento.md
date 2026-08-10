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
  open-window/edit-apply/read-ficha/write-ficha`. No existe `kb:edit-propose` — el
  chat devuelve la propuesta de edición INLINE en la respuesta de `kb:ask` (campo
  `edit`), no como llamada aparte; una spec antigua lo nombraba distinto, ver sección
  2026-08-10.
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
  del último commit. Commitear el CLAUDE.md y `kb/` del proyecto es parte del feature,
  no un extra.

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

## 2026-08-10 — Ventana propia (sustituye al panel acoplado)

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
