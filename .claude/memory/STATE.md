# STATE — claude-electron (POWER-AGENT)

> Estado vivo. Lo lee el arranque de Claude y Codex y se actualiza al cierre.

Última actualización: 2026-08-09, tarde (verificado contra git y filesystem).

## Estado de entrega (verificado)

- Rama `main`, working tree limpio; último commit `9de6500 feat(profiles): persona VIVA — cambia en sesiones abiertas vía hook UserPromptSubmit` (los 6 anteriores de la sesión `a1e8134..5be68d9` ya pusheados).
- Tests: 1.415 totales — 1.409 pass, 0 fail, 6 skipped (suite completa en el pre-commit de `9de6500`).
- Deploy: `/Applications/POWER-AGENT.app`, asar del 2026-08-09 19:36, verificado por CONTENIDO (`syncActivePersonaFile` presente) y por comportamiento: la app al arrancar escribió `userData/active-persona.md` con la persona del perfil activo.

## Última sesión (2026-08-09 tarde — perfiles de encargo y persona invisible)

- **Perfiles simplificados** (`a1e8134`): fuera "Ruta a CLAUDE.md" y "Directorio de trabajo" (redundantes con el project picker). Un perfil = nombre + persona + MCPs (checkboxes; lista fija `AVAILABLE_MCP_SERVERS` en renderer.js). Cambiar de perfil ya no reinicia la sesión.
- **Persona VIVA** (`9de6500`, supera a `0495d47`): la persona del perfil activo vive en `userData/active-persona.md` (lo reescribe la app al arrancar y en cada mutación de perfiles) y el hook `~/.claude/hooks/poweragent-persona.sh` (UserPromptSubmit, registrado en `~/.claude/settings.json`, backup `.bak-2026-08-09`) la inyecta como contexto en CADA mensaje de las sesiones con env `POWERAGENT_PERSONA_FILE`. **Cambiar de perfil aplica en el siguiente mensaje, también en sesiones abiertas, sin reiniciar.** Invisible, aditiva al CLAUDE.md. Probado end-to-end con `claude -p` (cita la persona literal; sin env no inyecta). LAN queda fuera del hook (persona de operador por `--append-system-prompt` al spawn); WhatsApp ni carga settings. PROHIBIDO volver a escribir la persona como mensaje en el PTY (así nació el bug).
- **WhatsApp** (`e05c558` + `147a829`): editor del `persona.md` en Configuración → General (IPC `getPersona`/`savePersona` ya existente); eliminado el botón 👤 de la cabecera y su modal duplicado con su CSS. La persona de WhatsApp es OTRO sistema: fichero + `--system-prompt` que reemplaza todo + hot-reload por mensaje.
- Detalle completo del diseño: `tech/tech_perfiles_persona_invisible.md`.
- Sesión anterior del mismo día (mañana): seguridad, skills y delegaciones (`747a69d`) — ver historial de git para su detalle; sus pendientes de prueba siguen vivos.

## Próximo paso

- **Probar la persona viva en la app**: en una sesión ABIERTA, cambiar el perfil en el desplegable y comprobar que el siguiente mensaje ya responde con la persona nueva (headless probado; la app en vivo aún sin confirmar por Luismi).
- **Verificar si los MCPs del perfil tienen efecto real en sesiones locales**: en LAN/enterprise gatean (`allowedMcpServers`); el spawn local no pasa `--mcp-config` ni restringe — los checkboxes podrían ser decorativos en local. Si no gatean, cablearlo o decirlo en la UI.
- Decidir si la persona debe llegar también a sub-chat y a las sesiones headless/pool de Telegram (hoy no llega).
- Pendientes heredados de la sesión de la mañana: probar tarea programada con skill `frontend-design` y delegación contra repo Git desde la app empaquetada.

## Notas operativas

- Node local v24.15.0 (20.18.0 no instalado; CI fija 20.18.0). Tests pasan en 24.
- Los deploys se verifican por contenido del asar y SIEMPRE extrayendo desde el scratchpad — hoy un extract con cwd en la raíz del repo borró `main.js` (recuperado de git al instante).
