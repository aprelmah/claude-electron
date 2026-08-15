# Lo que decide dentro de `ipcMain.handle` no lo cubre nadie

**Fecha**: 2026-08-15 · **Commit**: `0c3d5b0` · **Ejemplo resuelto**: `main/lan-server-action.js`

## El agujero estructural

La suite de este proyecto (`node --test tests/*.test.js`) corre **Node pelado, sin Electron**. Todo lo
que vive dentro de un `ipcMain.handle(...)` de `main.js` es, por construcción, **invisible para CI**.

Eso no es un detalle: los handlers son justo donde se toman las decisiones con consecuencias
externas. `save-app-config` decidía si reiniciar el servidor LAN — y `start()` para el servidor antes
de rebindear, con lo que `stop()` cerraba todas las sesiones remotas vivas y vaciaba los invites
repartidos. Un guardado de configuración cualquiera cortaba la conversación de un cliente.

Se puede probar la allowlist. Se puede probar `buildClientUrl`. Se puede probar el normalizador de
URLs. Nada de eso prueba **el pegamento**: en qué orden se llaman, bajo qué condición, con qué efecto.

## El patrón

Cuando un handler tome una decisión con consecuencias, la decisión sale a una función pura y el
handler se queda de fontanero:

```js
// main/lan-server-action.js — sin dependencias, sin Electron
function decideLanServerAction({ enabled, running, previousPort, nextPort }) {
  … return { action: 'none' | 'start' | 'stop', reason: '…' }
}
```

```js
// main.js — el handler solo ejecuta
const { action } = decideLanServerAction({ … })
if (action === 'stop') await stopLanServer(…)
else if (action === 'start') await startLanServer(…)
```

Devolver `reason` junto a `action` sale gratis y hace que los tests documenten el porqué, no solo el
qué.

## Qué queda cubierto y qué no

Cubierto en CI para siempre: la decisión (10 tests en `tests/lan-server-action.test.js`, incluido el
caso exacto del bug — *corriendo + activo + mismo puerto → no tocar nada* — y el del puerto que llega
como texto desde un `<input>`).

**Sigue sin cubrir**: que el handler llame a las piezas en el orden correcto. Eso necesita Electron y
hoy solo se verifica conduciendo la app por CDP (ver skill `verify`). Es una limitación conocida, no
un descuido.

## Señal para reconocerlo

Si al revisar un cambio piensas *"esto solo puedo comprobarlo abriendo la app"*, ahí hay lógica que
debería estar fuera del handler. Extraerla cuesta minutos; descubrir el fallo en producción le cuesta
la sesión a un cliente.

## Precedente en el mismo proyecto

Mover una lista a su módulo **no** arregla el mecanismo. `4ff868b` extrajo las allowlists `SAFE_*` a
`main/app-config-allowlists.js` y les puso 8 tests, pero `pick` seguía descartando en silencio: el
modo de fallo original quedó intacto. Lo que lo cerró (2026-08-15, `95e93fb`) fue `pickDropped` +
avisos en `warnings` + un test que lee el payload real de `renderer.js` y exige que sus claves estén
en las allowlists. Extraer ≠ cubrir.
