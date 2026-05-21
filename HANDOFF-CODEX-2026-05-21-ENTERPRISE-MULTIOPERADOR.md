# HANDOFF-CODEX-2026-05-21-ENTERPRISE-MULTIOPERADOR

## Resumen ejecutivo

Se implementó modo empresa **opt-in** para sesiones LAN remotas con:

- resolución por sesión de `operator/profile/role`;
- ACL real de filesystem en servidor WS (no solo UI);
- persona efectiva por sesión (`operator > profile > legacy`) inyectada al inicio del PTY remoto;
- política MCP efectiva por sesión expuesta en contexto/capabilities;
- auditoría semántica de eventos `empresa_*`;
- panel de gestión empresa en app principal (roles/operadores/persona);
- cliente LAN extendido con explorador de archivos remoto (listar/abrir/guardar) respetando permisos.

Compatibilidad: cuando no hay contexto remoto explícito o `enterprise.enabled=false`, se mantiene flujo legacy (herencia de perfil global activo del host).

## Arquitectura final

### 1) Modelo persistente

`appConfig` ahora incluye:

- `enterprise.enabled`
- `enterprise.roles[]`
  - `id`, `name`
  - `permissions`:
    - `pty.execute`
    - `fs.read`, `fs.write`, `fs.list`, `fs.delete`, `fs.rename`
    - `viewer.open`
    - `automations.manage`
  - `allowedRoots[]`
  - `readOnlyRoots[]`
  - `allowedMcpServers[]`
- `enterprise.operators[]`
  - `id`, `name`, `username`, `enabled`
  - `roleId`
  - `defaultProfileId`
  - `personaPrompt`

`profiles[]` añade `personaPrompt` (fallback de persona).

Módulo nuevo: `main/enterprise-policy.js` con normalización y resolución de contexto efectivo.

### 2) Resolución de sesión LAN por operador

`main/ws-server.js` soporta metadata por querystring y handshake (`type: "handshake"` etc.).

`main.js` resuelve contexto efectivo por conexión:

1. intenta aplicar operador/perfil/rol solicitado (si válido);
2. aplica fallback controlado cuando falta o no es válido;
3. conserva modo legacy por defecto si no hay contexto explícito.

Cada sesión remota queda aislada con su propio:

- `operatorId`, `roleId`, `profileId`
- `personaResolved` (+ `personaSource`)
- `allowedRoots`, `readOnlyRoots`
- `allowedMcpServers`
- `permissions`

### 3) ACL real FS en servidor (hard enforcement)

En `main/ws-server.js` se añadieron operaciones WS `fs:*` con validación server-side:

- `fs:list` / `fs:tree`
- `fs:read` / `fs:open`
- `fs:write` / `fs:save`
- `fs:rename`
- `fs:delete`

Controles de seguridad:

- normalización absoluta de paths;
- bloqueo de path traversal;
- validación por `allowedRoots` por sesión;
- validación por `realpath` para evitar escape por symlink;
- soporte de `readOnlyRoots`;
- denegación explícita por permiso faltante.

Errores devueltos con código (`PERMISSION_DENIED`, `PATH_OUTSIDE_ALLOWED_ROOTS`, `PATH_SYMLINK_ESCAPE`, `READ_ONLY_ROOT`, etc.).

### 4) Cliente LAN remoto con visor/explorador ACL

`lan-client.html` ahora incluye:

- campos de identidad remota (`operatorId`, `profileId`, `username`);
- handshake al conectar;
- panel de contexto/capabilities de sesión;
- explorador remoto con roots permitidas;
- abrir archivo texto;
- guardar archivo (si `fs.write`);
- UX clara de permiso denegado y degradación para servidor legacy sin API FS.

### 5) Persona efectiva por sesión

Resolución implementada:

- `operator.personaPrompt`
- `profile.personaPrompt`
- comportamiento legacy (contenido de `claudeMdPath` del perfil)

Se inyecta al inicio del PTY remoto vía `bootstrapMessage`.

### 6) Auditoría

Se registran eventos semánticos empresa en `power-agent-log.jsonl`:

- `empresa_login_operador`
- `empresa_sesion_iniciada`
- `empresa_perfil_aplicado`
- `empresa_persona_aplicada`
- `empresa_mcp_policy_aplicada`
- `empresa_permiso_denegado_fs`

Con detalles operativos (sin secretos): operador, rol, perfil, acción FS, path y código de denegación.

## Matriz de roles ejemplo

### Secretaria

- `pty.execute`: true
- `fs.list`: true
- `fs.read`: true
- `fs.write`: true (acotado)
- `fs.delete`: false
- `fs.rename`: false
- `viewer.open`: true
- `automations.manage`: false
- `allowedRoots`: `/srv/empresa/clientes`, `/srv/empresa/plantillas`
- `readOnlyRoots`: `/srv/empresa/clientes/historico`
- `allowedMcpServers`: `gmail`, `calendar`

### Gerente

- `pty.execute`: true
- `fs.list`: true
- `fs.read`: true
- `fs.write`: true
- `fs.delete`: true
- `fs.rename`: true
- `viewer.open`: true
- `automations.manage`: true
- `allowedRoots`: `/srv/empresa`, `/Users/shared/reportes`
- `readOnlyRoots`: (vacío u opcional)
- `allowedMcpServers`: `gmail`, `calendar`, `drive`, `notion`

## Riesgos residuales

1. No hay auth/token en LAN WS todavía (sigue siendo red confiable).
2. Política MCP está aplicada a nivel de contexto/policy interna y UI; falta enforcement nativo por runtime de toolchain (siguiente fase).
3. No se implementó en esta ronda un flujo de aprobación de acciones destructivas remotas (solo ACL + permisos).
4. Falta smoke manual completo multioperador en entorno gráfico con 2 clientes reales concurrentes.

## Siguiente fase recomendada

1. Añadir auth de sesión LAN (token rotativo + optional IP allowlist).
2. Añadir política opcional `enterprise.requireOperatorContext` para forzar modo estricto.
3. Ampliar UI remota con rename/delete condicionados por permisos y confirmaciones fuertes.
4. Conectar allowlist MCP a runtime efectivo de herramientas para enforcement completo end-to-end.
5. Export de auditoría por sesión/operador para compliance.

## Archivos clave de esta entrega

- `main/enterprise-policy.js`
- `main/ws-server.js`
- `main.js`
- `lan-client.html`
- `index.html`
- `renderer.js`
- `preload.js`
- `styles.css`
- `tests/enterprise-policy.test.js`
- `tests/path-sandbox.test.js`
- `tests/semantic-logger.test.js`
- `tests/ws-server-pure.test.js`
