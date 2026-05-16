# Graph View — Vista de grafo para el sidebar

**Fecha:** 2026-05-16  
**Proyecto:** POWER-AGENT (claude-electron)  
**Estado:** Aprobado, pendiente de implementación

---

## Resumen

Vista conmutable en el sidebar de la app: el usuario puede alternar entre el árbol de archivos existente y una vista de grafo interactivo que muestra las conexiones entre archivos del proyecto activo. Estética "cerebro conectado", más impactante que Obsidian, con glassmorphism, glow SVG real y partículas animadas en las aristas.

---

## Arquitectura

### Archivos a crear
- `graph-renderer.js` — toda la lógica D3 + SVG + animaciones (~300 líneas)

### Archivos a modificar
- `main.js` — añadir IPC handler `sidebar:get-graph`
- `preload.js` — exponer `window.api.sidebarGetGraph()`
- `index.html` — añadir `#graph-canvas`, botones toggle vista
- `renderer.js` — lógica del toggle árbol/grafo + llamada a graph-renderer
- `styles.css` — estilos del grafo, fondo, toggle buttons

### Dependencias
- D3.js vía CDN (sin npm install). Sin dependencias nuevas.

---

## Toggle de vista

Dos botones nuevos en `#sidebar-header`, junto a los existentes:

```
[ ▶ ] [ 📁 ] [ ↺ ]   [ ⋮≡ ] [ ◉ ]
                       árbol  grafo
```

- Al activar grafo: `#tree` se oculta, `#graph-canvas` (SVG) aparece.
- Al volver a árbol: viceversa.
- Estado persistido en `localStorage` (key: `poweragent.sidebar.view`).

---

## Parsing de conexiones (main process)

IPC handler `sidebar:get-graph`:

1. Recibe `rootPath` (el cwd actual del proyecto).
2. Recorre el árbol con `fs.readdirSync` recursivo.
3. Excluye: `node_modules/`, `dist/`, `.git/`, `*.png`, `*.jpg`, `*.dmg`, `*.app`.
4. Para cada `.md`: extrae `[[wikilinks]]` con regex `\[\[([^\]]+)\]\]`.
5. Para cada `.js`/`.ts`: extrae imports con regex sobre `import ... from '...'` y `require('...')`.
6. Resuelve rutas relativas a rutas absolutas para identificar nodos correctamente.
7. Devuelve `{ nodes: [{ id, label, type, connections }], edges: [{ source, target }] }`.

Regeneración: al cambiar carpeta (evento existente) o al pulsar el botón refresh del sidebar.

---

## Flujo de datos

```
renderer                main.js                 filesystem
   │                       │                         │
   │─ sidebar:get-graph ──▶│                         │
   │                       │─ find archivos ────────▶│
   │                       │◀─ lista paths ──────────│
   │                       │─ parsear referencias     │
   │◀─ { nodes, edges } ───│                         │
   │                       │
   │─ D3 renderiza SVG
   │─ inicia simulación física
   │─ arranca animación partículas en aristas
```

---

## Motor de grafo: D3 force simulation

- `d3.forceSimulation()` con:
  - `forceLink` — atracción por aristas, distance 80
  - `forceManyBody` — repulsión fuerte entre nodos (-200)
  - `forceCenter` — centrado en el SVG
  - `forceCollide` — evita solapamiento de nodos
- Al hacer drag de un nodo: se fija (`fx`, `fy`) en esa posición. Botón de reset libera todos.
- Zoom/pan: `d3.zoom()` sobre el SVG raíz.

---

## Estética visual

### Fondo
- Color: `#050508`
- Radial gradient sutil en el centro: `radial-gradient(ellipse at center, #0d0d1a 0%, #050508 70%)`

### Nodos — por tipo de archivo
| Tipo        | Color base | Glow      |
|-------------|-----------|-----------|
| `.md`       | `#a78bfa` | violeta   |
| `.js`       | `#fbbf24` | ámbar     |
| `.ts`       | `#38bdf8` | azul      |
| `.json`     | `#34d399` | verde     |
| resto       | `#6b7280` | gris      |

- Forma: círculo glassmorphism — `fill` semitransparente (~20% opacidad del color base), borde 1px del color base al 80%.
- Tamaño: proporcional al número de conexiones (min 6px, max 18px radio).
- Glow: SVG filter `feGaussianBlur` + `feMerge` aplicado al nodo.

### Labels
- Texto: nombre del archivo sin ruta, `font-size: 9px`, color blanco al 60%.
- Visibles siempre en nodos con ≥3 conexiones.
- En el resto: visibles solo con zoom ≥1.5× o en hover.

### Aristas
- Línea: `stroke-width: 1px`, color del nodo origen al 25% opacidad.
- Animación partículas: círculo de `r:2` que viaja de source a target con `animateMotion` SVG, duration proporcional a la longitud de la arista, loop infinito.
- Color partícula: color del nodo origen al 80%.

### Hover
- Nodo crece: `transform scale(1.3)`, transición 150ms.
- Glow aumenta (stdDeviation × 2).
- Label aparece aunque no cumpla condición de zoom/conexiones.
- Aristas conectadas al 100% opacidad.

### Selección (click simple)
- Todo el grafo baja a 5% opacidad.
- El nodo seleccionado + sus vecinos directos: 100% opacidad + glow máximo.
- Transición 200ms.
- Click en fondo vacío: deselecciona.

---

## Interacción

| Acción | Resultado |
|--------|-----------|
| Click simple en nodo | Selecciona nodo, atenúa el resto |
| Doble click en nodo | Inyecta ruta del archivo al PTY (igual que drag-drop existente) |
| Drag de nodo | Mueve el nodo, queda fijo en esa posición |
| Drag en fondo vacío | Pan del grafo |
| Rueda del ratón | Zoom in/out |
| Click en fondo vacío | Deselecciona |
| Botón refresh sidebar | Regenera el grafo desde filesystem |

---

## Consideraciones técnicas

- El parsing es síncrono en main process para proyectos normales (<1000 archivos). Para proyectos muy grandes, limitar a `maxDepth: 5` y excluir carpetas de build adicionales.
- Las posiciones de los nodos NO se persisten entre sesiones (la simulación arranca desde cero). Se puede añadir en iteraciones futuras.
- El grafo solo se activa cuando hay un `rootPath` definido. Si no hay carpeta abierta, el botón de grafo está deshabilitado.
- Compatibilidad: Electron ≥ la versión actual del proyecto. Sin polyfills necesarios.
