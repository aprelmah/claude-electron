# Bug: selector nativo de skills imposible de limpiar

Fecha: 2026-08-09.

## Síntoma

El campo Skills de Tareas programadas mostraba un select HTML multiple. En macOS no era evidente cómo quitar una opción ya seleccionada y podían quedar skills antiguas seleccionadas aunque ya no apareciesen en el catálogo.

## Causa

La interacción dependía del comportamiento nativo de select multiple y de modificadores de teclado. El renderer tampoco ofrecía una acción directa para limpiar selecciones obsoletas.

## Corrección

- Se sustituyó por un selector visual con opciones pulsables y marca de selección.
- Cada skill seleccionada se muestra como chip con acción individual para quitarla.
- Se añadió Limpiar para eliminar todas las skills seleccionadas, incluidas las que ya no estén disponibles.
- La selección conserva el valor guardado de la tarea, pero permite corregirlo antes de guardar.

## Verificación

- Se ejecutaron node --check sobre los entrypoints afectados.
- La suite completa pasó con 1.409 correctos, 0 fallos y 6 omitidos.
- La corrección quedó incluida en 747a69d y se comprobó dentro del app.asar desplegado.
