# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-09 (verificado contra git y filesystem).

## Estado de entrega (verificado)

- Rama `main`, sincronizada con `origin/main` (0 commits por delante y 0 por detrás); working tree limpio antes de actualizar esta memoria.
- Último commit de código: `747a69d feat: añadir seguridad, skills y delegaciones`, ya pusheado.
- Tests: 1.415 totales, 1.409 correctos, 0 fallos y 6 omitidos. El hook de pre-commit volvió a ejecutar la suite y pasó.
- Entorno de verificación: Node `v24.15.0`; Node `20.18.0` no está instalado localmente. La CI sigue fijada a Node 20.18.0.
- Deploy verificado: `/Applications/POWER-AGENT.app`, app.asar de 16.483.701 bytes con timestamp 2026-08-09 11:26; el proceso empaquetado muestra renderer y carga ese app.asar.

## Última sesión (2026-08-09 — seguridad, skills y delegaciones)

- Se añadió política de ejecución con modo Seguro por defecto, selector explícito de Confiado y preflight para tareas programadas.
- Se añadió el registro de skills con selección persistente por tarea, búsqueda por raíces y validación antes de ejecutar.
- Se añadió el gestor de delegaciones con cola, límite de tres ejecuciones, persistencia, cancelación/pausa y worktrees aislados cuando el workspace es Git.
- Se corrigió el selector de skills: dejó de usar `select multiple` nativo y ahora permite quitar skills individualmente, limpiar y eliminar selecciones antiguas.
- La implementación está en `747a69d` y está desplegada en `/Applications/POWER-AGENT.app`.

## Próximo paso

- Probar desde la aplicación empaquetada una tarea programada con la skill `frontend-design` y una delegación contra un repositorio Git.
- Confirmar en uso real el comportamiento esperado cuando el workspace no es Git: delegación sin worktree y aviso visible.
- Si se necesita reproducibilidad exacta de CI, instalar o seleccionar Node 20.18.0 de forma explícita; no es necesario para la entrega ya verificada.

## Notas operativas

- Los campos de seguridad y skills forman parte de la configuración persistida de cada tarea.
- Las delegaciones se guardan en `delegations.json` dentro de userData; al reiniciar, los estados en curso requieren revisión y no se auto-mezclan.
- La memoria de detalle de esta entrega está en `tech/runbook_execution_policy_delegations.md` y `bugs/bug_task_manager_skills_multiselect_2026_08_09.md`; ambas fichas están registradas en `INDEX.md`.
- En cada sesión nueva se debe leer primero este archivo y después `AGENTS.md`.
