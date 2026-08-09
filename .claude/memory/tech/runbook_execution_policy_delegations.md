# Runbook: política de ejecución, skills y delegaciones

Fecha de alta: 2026-08-09.

## Política de ejecución

- El modo por defecto es Seguro.
- Seguro limita Claude a edits aprobados y Codex al workspace con permisos controlados; además ejecuta un preflight antes de crear una tarea programada.
- Confiado solo se activa de forma explícita desde la configuración y está reservado a prompts y carpetas bajo control del usuario.
- Telegram no hereda confianza automáticamente: solo puede usar el modo Confiado cuando la configuración de Telegram lo declara explícitamente.
- La política se persiste con la configuración de la aplicación y también queda registrada en cada tarea programada.

## Skills

- El registro unifica skills del proyecto, userData, ~/.claude/skills y ~/.agents/skills, por ese orden de prioridad.
- La tarea guarda las skills seleccionadas y el selector permite seleccionar, quitar individualmente y limpiar skills antiguas que ya no estén disponibles.
- El selector usa opciones personalizadas en lugar del select HTML multiple nativo, porque este último era difícil de manejar en macOS sin modificadores de teclado.
- La skill elegida debe estar instalada y ser legible; la existencia se comprueba antes de ejecutar la tarea.

## Delegaciones

- La pestaña Delegaciones permite crear, pausar, cancelar y limpiar ejecuciones.
- Hay como máximo tres delegaciones concurrentes; las adicionales quedan en cola.
- Cada delegación persiste su estado en delegations.json dentro de userData y conserva prompt, CLI, seguridad, skills, timestamps, salida y error.
- Si el workspace es un repositorio Git y la sesión lo permite, se prepara un worktree aislado para la delegación. Si no hay Git, la delegación sigue funcionando sin worktree y se informa de esa limitación.
- Las delegaciones no se auto-mezclan por defecto. Un conflicto o un finalize fallido deja la rama de sesión para revisión manual.
- Las delegaciones hijas no pueden crear delegaciones anidadas.

## Verificación de esta entrega

- Suite Node: 1.415 tests totales, 1.409 correctos, 0 fallos y 6 omitidos; el hook de pre-commit volvió a pasarla.
- Se verificó el paquete activo en /Applications/POWER-AGENT.app y su proceso renderer usando el app.asar desplegado.
- Commit de la implementación: 747a69d. Rama main sincronizada con origin/main.
