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

---

## § 2026-08-21 — Reincidencia: la misma trampa, otra forma sintáctica

**Commit del arreglo:** `88bdbe8` · **Lo introdujo:** `925af4f` (auto-refresco del QR del espejo)

### El síntoma, otra vez distinto

Luismi abrió la app recién desplegada y el **picker salió vacío**: sin proyectos recientes y con el selector de PERSONALIDAD sin ninguna opción. Ni error ni aviso. La ventana se pintaba entera, el proceso vivo, `--type=renderer` presente.

Su primera reacción fue la lógica: *"¿y mis personalidades y sesiones?"* — parecía pérdida de datos. **No lo era**: los 9 recientes seguían en `userData/recent-cwds.json` y los 3 perfiles en `claude-novak.config.json`. Comprobarlo primero, antes de tocar nada, evitó "arreglar" lo que no estaba roto.

### La causa

`main/mirror-connection-status.js` se añadió como `<script src>` en `index.html` y declara `function computeQrRefreshDelay` y `function formatQrCountdown` a nivel superior. En `renderer.js` se escribió:

```js
const { computeQrRefreshDelay, formatQrCountdown } = window.MirrorConnectionStatus || {}
```

Mismo ámbito global compartido → `SyntaxError: Identifier 'computeQrRefreshDelay' has already been declared` → **`renderer.js` entero sin ejecutar**, que es quien rellena el selector de perfiles y arranca el picker.

Confirmado por CDP sobre la empaquetada, no por lectura:

```
[EXC] SyntaxError: Identifier 'computeQrRefreshDelay' has already been declared
typeof showShareInternetBar  →  undefined     (renderer.js muerto)
typeof computeQrRefreshDelay →  function      (el módulo sí cargó)
```

### Por qué no lo cazó nadie

1. **La comprobación previa miraba la forma equivocada.** Antes de commitear se buscaron colisiones con `grep -E "^(const|let|var|function) <id>"`. El destructuring `const { X } = ...` no casa con ese patrón, así que dio limpio.
2. **`npm run verify` no ve una página muerta.** Reportó "proceso con ventana · 1 renderer" con la UI rota: mide que el proceso existe, no que el JS se ejecutara.
3. **Probar en dev tampoco bastó**, porque "probar" fue comprobar que arrancaba con ventana. **Arrancar ≠ funcionar**: nadie abrió el picker.

### El arreglo

El módulo se usa **cualificado**, sin introducir ningún nombre nuevo en el global:

```js
const delay = window.MirrorConnectionStatus?.computeQrRefreshDelay({ expiresAt, now: Date.now() })
```

### El mecanismo (lo que faltaba desde 2026-08-05)

La regla llevaba desde agosto escrita en el runbook —"un `const` duplicado mata la página entera y los tests no lo ven"— y **sin nada debajo que la hiciera cumplir**. Ahora sí: `tests/renderer-global-scope-collisions.test.js` recorre los `<script src>` de `index.html`, extrae las declaraciones léxicas de nivel superior de cada uno —`const`/`let`/`class`/`function` **y destructuring**, que es justo la forma que se coló— y falla si dos ficheros declaran el mismo nombre.

Verificado que distingue el caso bueno del malo (regla del proyecto: una verificación no vale hasta demostrar que falla cuando debe). Reintroduciendo la línea:

```
AssertionError: Redeclaración en el ámbito global compartido:
  computeQrRefreshDelay: main/mirror-connection-status.js vs renderer.js
```

### Lecciones

- **Escribir la regla no la hace cumplir.** Esta ya estaba escrita, citada en el propio commit que la violó, y aun así se incumplió. Solo el test lo impide.
- Una comprobación ad-hoc que solo cubre una forma sintáctica da falsa tranquilidad: cubrir el caso general o no molestarse.
- Ante un síntoma que parece pérdida de datos, **verificar el disco antes de tocar nada**.
