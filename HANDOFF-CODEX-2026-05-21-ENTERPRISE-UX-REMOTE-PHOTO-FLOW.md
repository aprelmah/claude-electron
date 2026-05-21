# HANDOFF-CODEX-2026-05-21-ENTERPRISE-UX-REMOTE-PHOTO-FLOW

## Resumen ejecutivo

Se cerró el bloque de UX/operativa pendiente de **modo empresa + cliente LAN remoto** con compatibilidad legacy preservada.

Objetivos cubiertos:

1. Permisos enterprise en castellano claro (sin cambiar keys técnicas internas).
2. Resumen MCP consistente entre badge superior y popover, con MCP configurados del perfil + MCP efectivos de sesión enterprise.
3. Rediseño completo de cliente LAN remoto mobile-first y escalable por pestañas.
4. Onboarding remoto simplificado (username principal + opciones avanzadas colapsables).
5. Auto-refresh real del explorador remoto mediante push WS (`fs:event`) con fallback polling.
6. Visor remoto multi-tipo (`fs:open`) con soporte de imágenes grandes (incluyendo PNG 2.4MB) y fallback binario claro.
7. Flujo móvil foto/archivo -> upload seguro servidor -> ruta ACL -> inyección al chat remoto compatible con CLI (`@/ruta`).
8. Auditoría ampliada para upload, ACL denegado y resolución/actualización de contexto de handshake.

## Commits integrados en esta fase

- `9bd2d04` feat(enterprise-ui): humanize role permissions and unify MCP profile summary
- `339f012` feat(lan): add fs watch events, secure upload flow, typed preview, and enterprise audit
- `cad17fb` feat(lan-client): redesign mobile-first remote UX with tabs and photo upload to chat

## Arquitectura final

### 1) UI principal enterprise (index/renderer)

- Se mantienen las keys internas (`pty.execute`, `fs.read`, etc.) para policy.
- En UI se muestran labels en cristiano:
  - `pty.execute` -> **Usar terminal**
  - `fs.read` -> **Leer archivos**
  - `fs.write` -> **Editar y guardar archivos**
  - `fs.list` -> **Ver carpetas y listado**
  - `fs.delete` -> **Borrar archivos/carpetas**
  - `fs.rename` -> **Renombrar/mover archivos**
  - `viewer.open` -> **Abrir visor de archivos**
  - `automations.manage` -> **Gestionar automatizaciones**

- MCP perfil/popover usan fuente única:
  - `MCP configurados` = `profile.mcpServers`
  - `MCP efectivos enterprise` = sesiones LAN activas en modo enterprise (`context.allowedMcpServers`), priorizando sesiones del perfil activo cuando existen.

### 2) Backend WS LAN (main/ws-server.js + main.js)

#### Operaciones nuevas/extendidas

- `fs:watch` / `fs:unwatch` / evento `fs:event`:
  - push con debounce/throttle;
  - polling de respaldo para detectar cambios cuando `fs.watch` no es fiable;
  - auto-watch al usar `fs:list`/`fs:tree` (desactivable con `watch:false`).

- `fs:open` multi-tipo:
  - `previewType: "text"` (utf8, truncado por límite de preview texto),
  - `previewType: "image"` para `png/jpg/jpeg/webp/gif/svg` (base64 + mime),
  - `previewType: "binary"` con mensaje explícito.

- `fs:upload` seguro:
  - recibe base64 + nombre/mime;
  - sanea nombre y valida extensión;
  - respeta ACL server-side (`allowedRoots`, `readOnlyRoots`, symlink guards);
  - guarda en ruta permitida (por defecto `.lan-uploads/<sessionId>` dentro de root escribible);
  - devuelve `ptyReference` compatible (`@/ruta`).

#### Handshake/contexto

- Se toleran contextos parciales y tipos extra de sincronización de contexto:
  - `handshake`, `session:handshake`, `session-handshake`, `hello`, `session:init`,
  - `session:context`, `session-context`, `context`, `identity`, `session:identity`.

- Se elimina ruido de `UNSUPPORTED_MESSAGE` por handshakes tardíos/context sync.

#### Auditoría nueva

- Nuevos eventos semánticos registrados (sin secretos):
  - `empresa_upload_remoto`
  - `empresa_upload_remoto_denegado`
  - `empresa_handshake_contexto_actualizado`
  - `empresa_contexto_resuelto`
  - `empresa_fs_watch_iniciado`
  - `empresa_fs_watch_detenido`
  - `empresa_fs_watch_error`

### 3) Cliente remoto LAN mobile-first (lan-client.html)

- Arquitectura por pestañas:
  - **Terminal**
  - **Archivos**
  - **Contexto**
  - **Acciones**

- Onboarding simplificado:
  - campo principal: `username`
  - avanzadas colapsables: `ws-url`, `operatorId`, `profileId`

- Flujo adjuntos móvil:
  - botón archivo + botón cámara/galería (`capture="environment"`)
  - upload vía `fs:upload`
  - confirmación opcional antes de inyectar referencia
  - inyección al PTY en formato CLI actual: `@/ruta `

- Visor remoto:
  - usa `fs:open`
  - texto editable si hay `fs.write`
  - imagen en preview visual
  - binario con mensaje claro

- Auto-refresh:
  - consume `fs:event` push
  - si no detecta push, activa polling fallback

## Decisiones UX clave

1. **No pedir tres identificadores en onboarding**: `username` como primario y avanzadas colapsadas.
2. **Navegación por secciones estables** para escalar futuras capacidades sin rehacer layout.
3. **Estados visibles pero no ruidosos**: barra handshake y degradación legacy explícita.
4. **Confirmación opcional de inyección chat** para evitar acciones involuntarias en móvil.
5. **Foco/contraste/targets táctiles** mínimos de accesibilidad desde diseño base.

## Protocolo WS final (resumen operativo)

### Entrantes relevantes

- Contexto/handshake: `handshake`, `session:context`, `identity`, etc.
- PTY: `input`, `resize`, `audio`
- FS: `fs:list`, `fs:tree`, `fs:read`, `fs:open`, `fs:write`, `fs:save`, `fs:rename`, `fs:delete`, `fs:watch`, `fs:unwatch`, `fs:upload`

### Salientes relevantes

- `status` (`connected`, `error`, `pty-exit`, ...)
- `fs:result` (ok/error por requestId)
- `fs:event` (`ready`, `changed`, `warning`, `error`, `stopped`)

## Límites / tamaños y rationale

Por defecto (configurable en servidor):

- `maxReadBytes`: **10MB**
- `maxPreviewBytes`: **10MB**
- `maxTextPreviewBytes`: **600KB**
- `maxUploadBytes`: **12MB**

Rationale:

- Permite casos reales de imagen móvil (incluyendo PNG ~2.4MB) sin romper UX.
- Mantiene techo razonable para evitar payloads gigantes en memoria/socket.
- Separa límite de preview texto para proteger render/edición en cliente.

## Validaciones ejecutadas

### Sintaxis (obligatorio)

- `node --check main.js renderer.js` ✅
- `node --check preload.js main/ws-server.js` ✅
- Script embebido en `lan-client.html` parseado con `node` ✅

### Tests (obligatorio)

- `npm test` ✅
  - 67 tests totales
  - 60 pass
  - 0 fail
  - 7 skip esperados por restricciones de socket/sandbox

### Smoke (obligatorio)

- `npm run dev` ejecutado ✅ (en este entorno sin sesión gráfica no hubo validación visual interactiva completa).

### Deploy

Se aplicó la regla crítica al tocar `main.js`:

```bash
pkill -9 -f "POWER-AGENT.app/Contents/MacOS/POWER-AGENT"
pkill -9 -f "POWER-AGENT Helper"
sleep 2
npm run deploy
```

Resultado: ✅ `POWER-AGENT` instalado y abierto desde `/Applications/POWER-AGENT.app`.

## Riesgos residuales

1. **Smoke visual/móvil real** pendiente en sesión gráfica física (este entorno no permite validación UX end-to-end real de cámara/gestos).
2. `fs:upload` usa allowlist de extensiones; puede requerir ampliar lista según casos reales de empresa.
3. `fs:watch` + polling está acotado, pero en trees extremadamente grandes conviene perf tuning adicional por perfil/rol.

## Siguiente fase recomendada

1. Añadir autenticación LAN (token rotativo + allowlist IP opcional).
2. Añadir métrica/telemetría de latencia para `fs:event` y `fs:upload` por sesión.
3. Incorporar acciones ACL de rename/delete en cliente remoto con confirmaciones fuertes y UX de recuperación.
4. Añadir pruebas E2E UI (Playwright) para flujo móvil de adjuntos y preview multi-tipo.

## Archivos tocados en esta fase

- `/Users/isabel/Desktop/LUISMI/claude-electron/index.html`
- `/Users/isabel/Desktop/LUISMI/claude-electron/renderer.js`
- `/Users/isabel/Desktop/LUISMI/claude-electron/main/ws-server.js`
- `/Users/isabel/Desktop/LUISMI/claude-electron/main.js`
- `/Users/isabel/Desktop/LUISMI/claude-electron/lan-client.html`
- `/Users/isabel/Desktop/LUISMI/claude-electron/tests/ws-server-session-acl.test.js`

