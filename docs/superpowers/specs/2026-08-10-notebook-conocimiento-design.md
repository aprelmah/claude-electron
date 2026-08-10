# Notebook de conocimiento (ventana propia) — diseño

**Fecha**: 2026-08-10 · **Estado**: aprobado por Luismi (conversación, misma fecha)

## Contexto

El panel 📚 de `e10c0c6` (chat RAG + fichas + atajos) quedó acoplado a la derecha del
terminal, estilo sub-chat. Técnicamente verificado por CDP, rechazado en UX: "queda
fatal", pelea por el ancho del terminal, y fichas/atajos son pantallas aparte
desconectadas del chat. El pedido original era que cada sesión pudiera tener su
"notebook" (objetivo/función tipo NotebookLM: fuentes + chat con evidencia — no su
layout literal de 3 paneles calcado). Además: el chat debe poder editar fichas/atajos
cuando el destilado se equivoca, y debe responder a la intención real de la pregunta,
no volcar todo lo que encuentra.

## Objetivo

Sustituir el panel acoplado por una ventana propia por proyecto, con fuentes/chat/
atajos siempre visibles a la vez, edición asistida y manual de fichas/atajos, y un
chat que sintetiza en vez de enumerar.

## Arquitectura — ventana independiente

- `openKnowledgeWindow(projectDir, hint)` nueva en `main/window-factory.js`, mismo
  patrón que `openViewerWindow`/`openBitacoraWindow`: frameless, preload propio,
  encajada junto al terminal al abrir (bounds relativos a la ventana principal, como
  ya hace el viewer con `hint`).
- **Una ventana por proyecto**: `Map<projectDir, win>` en vez del `Set` libre del
  viewer. Si ya existe ventana para ese `projectDir` → foco, no duplica. Confirmado
  con Luismi: no hace falta abrir el mismo notebook dos veces a la vez.
- El botón 📚 de la toolbar del terminal pasa de abrir el panel acoplado a llamar
  `window.api.kb.openWindow(cwd)` (resuelve `projectDir` igual que hoy: del picker,
  no de `ptyCwd()` — regla ya vigente, no cambia).
- Backend sin tocar: `knowledge-base.js`, `kb-extract.js` y el grueso de `kb-ipc.js`
  ya están desacoplados del DOM; solo cambia quién los invoca.

### Aplicar a sesión — corrección de resolución de destino

`kb:apply-to-session` hoy resuelve la sesión destino con `getSessionByEvent(event)` →
`sessions.get(event.sender.id)`: funciona porque el panel vive en la MISMA ventana
que el terminal (mismo `webContents.id` que la sesión). Con ventana aparte,
`event.sender` es el `webContents` del notebook, que no está en `sessions` — el
handler actual rompería con "no hay sesión PTY activa en esta ventana".

Fix: `kb:apply-to-session` deja de usar `event.sender` y resuelve por `projectDir`:
recorre `sessions.values()`, filtra por `cwd === projectDir`, y si hay más de una
coge la más reciente por `lastPrimarySnapshot`/orden de foco. Sin sesión viva de ese
proyecto → error claro ("no hay ninguna sesión abierta de este proyecto; ábrela y
reinténtalo"), igual que hoy pero con otro criterio de búsqueda.

## Layout interno (3 columnas, todo visible a la vez)

Sustituye las 3 vistas actuales (`kb-chat-view`/`kb-ficha-view`/`kb-shortcut-view`,
a las que hoy hay que saltar) por columnas simultáneas dentro de `kb-window.html`:

- **Izquierda — Fuentes**: fichas con checkbox activa/inactiva, tamaño/tokens, 🗑,
  doble-click revela en Finder. "+ Añadir fuente" (drag&drop / URL / archivo) destila
  ahí mismo con progreso inline (reusa `kb:distill` y el evento `kb:progress`).
- **Centro — Chat**: igual que hoy (mensajes, composer, citas `[KB1]`), con más
  espacio al tener ventana propia.
- **Derecha — Atajos**: catálogo de respuestas preparadas como columna fija. Click
  en un atajo lo mete en el chat.

## Edición de fichas y atajos

Dos vías, mismo destino (fichero markdown en `kb/fichas/`):

1. **Vía chat**: Luismi pide una corrección → el modelo responde con un diff
   propuesto (antes/después), NO escribe directo. Tarjeta en el chat con
   Aceptar/Descartar; solo al aceptar se escribe.
2. **Manual**: click en una ficha o atajo abre edición inline (textarea) con botón
   Guardar, sin pasar por el chat.

Límite duro (mismo criterio que ya rige la Papelera vía `isPanelFicha`): el agente
solo puede tocar `kb/fichas/*.md` (fichas + `atajos.md`). Nunca `kb/fuentes/`
(originales) ni nada fuera de esa carpeta.

## Chat con más criterio (no "todo lo que encuentre")

Sigue siendo **una llamada por pregunta** (sin reformular la pregunta antes de
buscar — se descarta explícitamente: doblaría coste/latencia por poco beneficio).
Dos cambios en `kb-chat.js`:

1. **Recuperación más generosa**: `selectEvidence` deja de exigir `score > 0` y de
   caer al fallback de "dump de las primeras fichas" para preguntas de orientación;
   pasa a mandar siempre el top ~15-20 candidatos por score (en vez de los ~8
   actuales con corte estricto).
2. **La síntesis decide, no el contador**: `buildAskPrompt` exige explícitamente
   entender la intención real de la pregunta, responder de forma directa y
   editorial, y citar SOLO los fragmentos que de verdad sustentan la respuesta — el
   resto de candidatos se descarta en silencio, sin enumerarlos "por si acaso".

## Módulos nuevos / tocados

- `main/window-factory.js`: + `openKnowledgeWindow`.
- `kb-window.html`, `kb-window-preload.js`, `kb-window-renderer.js` (nuevos —
  convención `bitacora-window-renderer.js`/`whatsapp-window-preload.js`). Contienen
  el bloque `kb*` que hoy vive en `index.html`/`renderer.js`, con CSS propio (deja
  de heredar el estilo del sub-chat).
- `main/kb-ipc.js`: + `kb:open-window`, `kb:edit-propose`, `kb:edit-apply`;
  `kb:apply-to-session` cambia su resolución de destino de `event.sender` a
  `projectDir` (ver "Aplicar a sesión" arriba) — `sendPromptToSession` pasa a
  recibir `projectDir` en vez de `event`.
- `main/kb-chat.js`: cambios en `selectEvidence` y `buildAskPrompt` (sección
  anterior); `normalizeAnswer` no cambia de forma.
- `index.html` / `renderer.js`: se retira `#kb-modal`, `#kb-divider`, las 3 vistas
  `kb-*-view` y su lógica (~700 líneas `kb*`); el botón de la toolbar pasa a invocar
  la apertura de ventana.

## Qué se retira

Panel acoplado completo (`#kb-modal`/`#kb-divider`, modo flotante/"Desacoplar",
las 3 vistas por pestaña) — sustituido por la ventana. No queda código muerto: se
borra, no se deja apagado.

## Casos borde y riesgos asumidos

- Cerrar la ventana a mitad de un destilado: sigue corriendo en el proceso principal
  (headless, no depende de la ventana); la ficha aparece al reabrir.
- Diff de edición propuesto sobre un fichero que cambió mientras tanto: no se pisa a
  ciegas, error visible en el chat.
- Dos sesiones sobre el mismo proyecto abriendo 📚 comparten la misma ventana
  (por diseño: el dato es del proyecto, no de la sesión).

## Fuera de alcance (no en esta iteración)

- Reformular la pregunta antes de buscar (descartado por coste, no solo diferido).
- Fallback Whisper para vídeos de YouTube sin subtítulos (ya documentado como v2,
  no cambia con este diseño).
- Multi-ventana del mismo notebook.

## Tests

- Unit: `openKnowledgeWindow` (factory — reutiliza ventana existente vs crea
  nueva), `kb:edit-apply` (límite de ruta a `kb/fichas/`, escritura atómica,
  rechazo si el fichero cambió), `selectEvidence` con el nuevo umbral/tamaño de
  candidatos, resolución de destino de `kb:apply-to-session` por `projectDir`
  (ninguna sesión / una / varias del mismo proyecto).
- CDP (patrón ya documentado en `runbook_kb_conocimiento.md`): abrir la ventana
  desde la toolbar, verificar las 3 columnas, destilar una fuente, pedir una
  corrección por chat y aceptar el diff, editar un atajo a mano.
