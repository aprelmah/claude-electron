# HANDOFF · 2026-05-18 · Grafo: 9 frentes + diagnóstico de latencia

## Contexto
Sesión larga centrada en el grafo D3 del proyecto. Usuario reportó:
- Chat "lentísimo" cuando animación del grafo activa.
- Buscador del grafo sin filtro por directorio ni navegación.
- Modal de edición de archivo que dejó de abrirse.
- Layout del grafo sin lógica de anidamiento (archivos lejos de su carpeta).
- Ventana flotante del grafo sin cwd visible, dependiente de cargar antes el embebido.
- Velocidad de animación marea.
- Chips de extensión fijos (md/js/ts/json/css/html/py/php/go/otros) → no se podían ocultar individualmente `.csv`, `.webp`, `.sql`, etc.

## Diagnóstico de latencia (fase 0)
Telemetría flag-gated (`POWERAGENT_PERF=1` + `localStorage.poweragent_perf`) midió:
- **PTY in→out: 3-10ms** (perfecto). Picos puntuales solo en bootstrap.
- Watchers fs: 0 eventos en uso normal. **Descartada cascada**.
- `readClaudeSessionTitle`/`buildCurrentSessionMeta`: bajo 5ms. **Descartado fs.statSync**.
- **Cuello real**: simulación D3 + render SVG en main thread renderer compitiendo con xterm.

## Cambios principales (commit `2c9dc52`)

### F0 — Web Worker para simulación D3 (commit anterior `0f852a1`)
- `graph-worker.js` con d3-force inline (~26KB, asar-safe).
- Buffer pool zero-copy (Float32Array transferables).
- Wrapper en `graph-renderer.js` mantiene API d3.forceSimulation.

### F1 — Buscador
- Filtro por `scopeDir` (cwd activo).
- Botones ◀ ▶ + contador `idx/total`.
- Auto-pause durante búsqueda, restaura estado anterior al limpiar.

### F2 — Modal editar archivo
- Fix defensivo: cierre limpio de menú contextual zombie, `style.display='flex'` forzado.
- Logging `[graph-ctx]` y `[graph-modal]` para diagnóstico futuro.

### F3 — Jerarquía visual
- Nodes con `parentId/depth`, edges con `kind: 'parent-child'|'reference'`.
- `linkDistance`: parent-child 35, referencias 90 (slider afecta solo refs).
- `forceCluster` custom O(n)/tick agrupa nodos por padre.

### F4 — CWD en ventana flotante
- `cwd` añadido a `graphWindowData`, render en titlebar de `graph-window.html` con formato `claude cwd: …/X`.

### F5 — Standalone con paridad
- Buscador, modal, menú contextual portados a `graph-window-renderer.js`.
- "Pegar ruta" omitida (no hay PTY local en standalone).

### F6 — Slider de velocidad
- Slider 1-10 (default 5 = 0.5x) en embebido y standalone.
- Mapeo `velocityDecay = 0.4 + (1 - factor) * 0.55`.
- Persistencia `localStorage.poweragent_graph_speed`.

### F7 — Filtro de extensiones en modo Estructura
- Mismo patrón que Referencias, estado independiente.
- Carpetas huérfanas se podan al filtrar.

### F8 — Chips dinámicos
- Detección automática de extensiones presentes (`recomputePresentExts`).
- Color determinista por hash para nuevas.
- Persistencia de **inactivas** (no activas): nuevas extensiones siempre arrancan visibles.
- Claves: `poweragent_graph_refs_exts_inactive`, `poweragent_graph_structure_exts_inactive`.
- Chip `sin ext` para `Makefile`/`LICENSE`.

### F9 — Standalone independiente del embebido
- Botón nuevo `#btn-open-graph-window` en top bar (entre ✓ Tareas y ⚙ Settings).
- Handler `graph-window:fetch-graph` permite a la ventana autoservirse.
- `selfFetch: true` en payload cuando viene del atajo directo.
- Botón viejo `btn-graph-fullscreen` del sidebar eliminado.

### Ajuste post-feedback
- Autopause inicial **desactivado** en ambos contextos. El usuario para con ⏸ cuando quiera.

## Telemetría PERF (sigue activa, opt-in)
- `POWERAGENT_PERF=1 npm start` activa en main.
- `localStorage.setItem('poweragent_perf','1')` activa en renderer.
- Logs: `[PERF pty]`, `[PERF watch]`, `[PERF meta]`, `[PERF renderer]`.
- Zero overhead cuando off.

## Estado vigente
- Repo limpio. `main == origin/main`.
- Último commit: `2c9dc52`.
- App desplegada en `/Applications/POWER-AGENT.app` y symlink en Escritorio.
- Telegram relay, PTY hot path, sesiones, watchers: **sin tocar en toda la sesión**.

## Próximos pasos sugeridos
1. Validar empaquetado del Web Worker en build empaquetada (asar):
   - El worker inlinea d3-force, no debería romper, pero confirma con uso real en `/Applications/POWER-AGENT.app`.
2. Si el grafo crece >5k nodos: el `forceCluster` es O(n)/tick; considerar quadtree o sampling.
3. La standalone sin sesión PTY activa cae al cwd de `lastPrimarySnapshot` y de ahí a `~`. Si Luismi abre el botón sin haber tocado ninguna carpeta, calcula sobre `~` (lento).
4. Limpiar logs defensivos `[graph-ctx]`/`[graph-modal]` cuando el modal lleve días sin fallar.
5. Si quieres ver enlaces inter-folder (carpeta hija → carpeta padre) explícitos en modo Estructura, hay que añadirlos al `buildStructureGraph`.

## Archivos clave
- `graph-worker.js` (nuevo desde sesión previa, modificado)
- `graph-renderer.js` (wrapper d3-force, API pública)
- `graph-window-renderer.js` (paridad con embebido)
- `graph-window.html` (UI standalone)
- `main.js` (computeProjectGraph extraído, handlers IPC para standalone autoservible)
- `renderer.js` (UI embebida, sliders, chips, botón top bar)
- `index.html` (botón nuevo top bar, botón viejo eliminado)
