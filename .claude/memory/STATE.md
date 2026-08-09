# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-09, tarde (verificado contra git y filesystem).

## Estado de entrega (verificado)

- Rama `main`, sincronizada con `origin/main` (0 por delante / 0 por detrás), working tree limpio antes de este cierre.
- Último commit: `147a829 refactor(whatsapp): fuera el botón 👤 y el modal viejo de persona` — pusheado, junto con los 4 anteriores de la sesión (`a1e8134..147a829`).
- Tests: 1.415 totales — 1.409 pass, 0 fail, 6 skipped (suite completa en el pre-commit de `147a829`).
- Deploy: `/Applications/POWER-AGENT.app`, asar del 2026-08-09 18:18, verificado por CONTENIDO (0 restos del botón 👤; `--append-system-prompt` presente en main.js empaquetado).

## Última sesión (2026-08-09 tarde — perfiles de encargo y persona invisible)

- **Perfiles simplificados** (`a1e8134`): fuera "Ruta a CLAUDE.md" y "Directorio de trabajo" (redundantes con el project picker). Un perfil = nombre + persona + MCPs (checkboxes; lista fija `AVAILABLE_MCP_SERVERS` en renderer.js). Cambiar de perfil ya no reinicia la sesión.
- **Persona invisible** (`a30d6af` + `0495d47`): la persona del perfil activo viaja como `--append-system-prompt` en el spawn de claude (`buildClaudeLocalArgs`; spawn de tareas unificado; LAN con `personaResolved` de operador/perfil). Invisible en el terminal, aditiva al CLAUDE.md, se fija al arrancar sesión. Solo claude — codex no admite el flag. PROHIBIDO volver a escribir la persona como mensaje en el PTY (así nació el bug).
- **WhatsApp** (`e05c558` + `147a829`): editor del `persona.md` en Configuración → General (IPC `getPersona`/`savePersona` ya existente); eliminado el botón 👤 de la cabecera y su modal duplicado con su CSS. La persona de WhatsApp es OTRO sistema: fichero + `--system-prompt` que reemplaza todo + hot-reload por mensaje.
- Detalle completo del diseño: `tech/tech_perfiles_persona_invisible.md`.
- Sesión anterior del mismo día (mañana): seguridad, skills y delegaciones (`747a69d`) — ver historial de git para su detalle; sus pendientes de prueba siguen vivos.

## Próximo paso

- **Probar la persona end-to-end**: perfil con persona → sesión nueva → preguntar "¿cómo es tu carácter?" y comprobar que aplica sin verse en pantalla. Luismi aún no lo confirmó tras el último deploy.
- **Verificar si los MCPs del perfil tienen efecto real en sesiones locales**: en LAN/enterprise gatean (`allowedMcpServers`); el spawn local no pasa `--mcp-config` ni restringe — los checkboxes podrían ser decorativos en local. Si no gatean, cablearlo o decirlo en la UI.
- Decidir si la persona debe llegar también a sub-chat y a las sesiones headless/pool de Telegram (hoy no llega).
- Pendientes heredados de la sesión de la mañana: probar tarea programada con skill `frontend-design` y delegación contra repo Git desde la app empaquetada.

## Notas operativas

- Node local v24.15.0 (20.18.0 no instalado; CI fija 20.18.0). Tests pasan en 24.
- Los deploys se verifican por contenido del asar y SIEMPRE extrayendo desde el scratchpad — hoy un extract con cwd en la raíz del repo borró `main.js` (recuperado de git al instante).
