# Runbook — Conocimiento por proyecto (panel 📚)

Creado 2026-08-09 (sesión panel 📚). Subsistema: cada proyecto lleva su conocimiento
precargado vía imports `@` en su CLAUDE.md; el panel 📚 de la app lo gestiona.

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
- IPC (`main/kb-ipc.js`): `kb:list/toggle/add-file/remove/distill/apply-to-session`.
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

## Coste medido (piloto turbo e, 2026-08-09)

Precarga ~70 KB (≈20k tokens): 1ª consulta 0,10 $ (crea caché), siguientes ~0,017 $
(caché 67k), 1 turno, 0 búsquedas. Destilado YouTube 10 min → ficha en 35 s.
