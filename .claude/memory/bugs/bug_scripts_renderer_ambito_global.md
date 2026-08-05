# Bug — un `const api` en un script del renderer mató la página entera

**Fecha:** 2026-08-05 · **Commit del arreglo:** `44da213` · **Rama:** `feat/modo-voz`

## El síntoma

Luismi pulsaba el botón del modo voz y **no pasaba absolutamente nada**. Ni error, ni aviso, ni el HUD. Como si el botón fuera de adorno.

Y no era solo ese botón: **ningún** botón de la topbar tenía su manejador registrado.

## La causa

`voice-ui-state.js` terminaba así:

```js
const api = { VALID_STATES, classNameForVoiceState, ... }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.VoiceUIState = api
```

En el navegador ese fichero **no es un módulo**: es un `<script src="...">` clásico, así que sus `const` de primer nivel caen en el **mismo ámbito** que los de `renderer.js`, que ya tenía su propio `api`. Resultado:

```
Uncaught SyntaxError: Identifier 'api' has already been declared   → voice-ui-state.js
```

El fichero muere al cargarse, la página queda a medias y `renderer.js` nunca llega a registrar los `addEventListener`.

## Por qué los tests no lo vieron (969 en verde)

Porque en los tests ese mismo fichero se carga con `require()` de Node, **en su propio ámbito de módulo**, donde `const api` no choca con nada. La lógica pura estaba cubierta al 100% y el fichero era, en la práctica, imposible de cargar en la app real.

Es el mismo patrón de la sesión del 4-ago: **los tres bugs los cazó Luismi mirando la pantalla, con la suite en verde**.

## Regla dura

- Los `<script>` sueltos del renderer (`voice-ui-state.js`, `project-picker.js`, `graph-renderer.js`) **comparten ámbito global con `renderer.js`**.
- **Nunca un nombre genérico** (`api`, `state`, `config`, `utils`…) en el nivel superior de esos ficheros. Prefijar con el nombre del módulo (`voiceUiState`) o envolver en IIFE.
- Al añadir un fichero nuevo de esos, comprobar colisiones **antes** de darlo por bueno:

```bash
for f in voice-ui-state.js project-picker.js graph-renderer.js; do
  for v in $(grep -oE "^(const|let|var) [A-Za-z_$][A-Za-z0-9_$]*" "$f" | awk '{print $2}'); do
    grep -qE "^(const|let|var) $v\b" renderer.js && echo "COLISION: $v (en $f)"
  done
done
```

## El test que falta

Ninguno de los 969 tests puede detectar esto. Hace falta uno que **cargue los scripts del renderer como los carga el navegador** (concatenados en un mismo ámbito) y falle si hay colisión de nombres de primer nivel. Sin eso, el siguiente fichero suelto reabre el mismo agujero.

## Cómo se diagnosticó

No por lectura del código: **capturando las excepciones del renderer por CDP**. Lanzar la app con `--remote-debugging-port=9222`, conectarse por WebSocket, `Runtime.enable` + `Log.enable`, recargar la página y escuchar `Runtime.exceptionThrown`. El error salió en la primera pasada.

Ver también [[tech-modo-voz-permisos-macos]] y la nota de método en `~/claude-shared/memory/02-feedback.md`.
