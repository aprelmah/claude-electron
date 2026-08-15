# Bug — una pref "por proyecto" a punto de guardarse contra el HOME (2026-08-15)

Cazados los dos probando la app real, no leyendo el código. Ninguno habría salido en la
suite: los dos viven en el renderer.

## 1. `resolveProjectCwd()` no vale para ESCRIBIR

Al implementar el conocimiento opcional por carpeta (commit `ba4bc92`), el toggle del
popover AGENTE resolvía el proyecto con `resolveProjectCwd()` (`renderer.js`), que es la
resolución oficial para LEER en el panel:

```js
async function resolveProjectCwd() {
  const uiCwd = (cwdValue?.title || '').trim()
  if (uiCwd) return uiCwd
  try { return await window.api.ptyCwd() } catch { return '' }   // ← sin sesión: el HOME
}
```

Verificando por CDP con la app **sin sesión abierta**, el toggle devolvió
`cwd = /Users/isabel`. Un clic más y `kb-prefs.json` habría guardado la preferencia
contra el home del usuario — invisible, permanente y aplicable a cualquier proyecto que
resolviese vacío después.

**Regla**: el fallback a `ptyCwd()` es aceptable para PINTAR, jamás para PERSISTIR. Para
escribir una pref de proyecto solo sirve `cwdValue.title` (la barra), y sin él el control
se deshabilita. Es la misma familia que la regla ya escrita en
`tech/runbook_kb_conocimiento.md` ("el cwd del panel sale del PROYECTO del picker, jamás
de `ptyCwd()`"), extendida al caso de escritura — que es el que hace daño duradero.

Mismo patrón que `bug_sessionid_envenenado_meta_2026_08_07.md`: **un valor adivinado no
se persiste**. Aquí el valor adivinado era el cwd.

## 2. `<label for="x">` que además contiene el input → doble toggle

```html
<label class="picker-kb-row" for="picker-kb-toggle">
  <input type="checkbox" id="picker-kb-toggle" checked />   <!-- dentro Y referenciado -->
  <span>Conocimiento</span>
</label>
```

Con la asociación por partida doble (implícita por contención + explícita por `for`), un
clic sobre el texto activaba el control dos veces: la casilla volvía a su estado original
y `change` se disparaba en falso. Síntoma: "clico y no pasa nada".

**Regla**: si el `<input>` va dentro del `<label>`, el `for` sobra — y hace daño.
Detectado con clic REAL por CDP (`Input.dispatchMouseEvent` sobre el texto, no sobre el
input). Un `el.click()` desde JS no lo habría reproducido.

## 3. Trampa de método: el CDP hablaba con una instancia vieja

Una comprobación dio "el popover aparece abierto al arrancar" y otra, minutos después,
"nace oculto". La contradicción era real: el relanzamiento no había matado la instancia
anterior, y el puerto 9222 seguía sirviendo al proceso viejo (con el popover que yo mismo
había abierto en la prueba previa).

**Regla**: un CDP que responde en 9222 NO prueba que estés hablando con el proceso que
acabas de lanzar. Ante un resultado que contradice al anterior, confirmar la identidad de
la instancia (`Page.reload` + estado inicial reproducible) antes de teorizar. Emparenta
con la lección de `pty-start` es idempotente (`bug_kb_conocimiento_zombi_2026_08_13.md`):
un A/B sin controlar el estado previo no prueba nada.

## Verificación

Los dos arreglos comprobados en la app real por CDP con clics reales: la pref solo se
escribe con el cwd de la barra (`agent-kb-toggle.dataset.cwd`), y clicar el texto de
ambas casillas (picker y popover) cambia el estado una sola vez. `kb-prefs.json` en
`userData` con la entrada correcta del proyecto, y borrada al volver al default.
