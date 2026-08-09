# Handoff — LAN session selector + locks por carpeta
Fecha: 2026-05-21
Autor: Codex (GPT-5)

## Objetivo implementado
Se implementó en LAN un flujo de selección de sesión reutilizable por carpeta (`cwd`) con lock por `sessionId` para evitar colisiones entre clientes/bots.

## Diseño del lock manager (servidor WS)
Archivo: `main/ws-server.js`

### Modelo
- Estructura en memoria: `sessionLocks: Map<"<cwd>::<sessionId>", lock>`
- `lock` contiene:
  - `sessionId`
  - `cwd`
  - `ownerSessionId` (id interno de conexión WS)
  - `ownerLabel` (username/operator/ip)
  - `acquiredAt`
  - `lastHeartbeatAt`
  - `expiresAt`

### Reglas
- Acquire:
  - Solo en `session:start` con `sessionId` válido.
  - Si ya está ocupado por otro owner => `SESSION_LOCKED`.
  - Si el mismo owner relanza => refresh del lock.
- Heartbeat:
  - Mensaje cliente: `session:heartbeat`.
  - Renueva `expiresAt`.
- Timeout:
  - TTL por defecto: 9s.
  - Sweep cada 1s (`setInterval`) para stale locks.
- Release:
  - Al cerrar socket (`close`/`error`).
  - Al cambiar a `Nueva sesión` (sin resume) antes de iniciar.
  - Al cambiar de sesión objetivo antes de iniciar (release+acquire nuevo).
  - Por timeout stale.

### Protocolo WS añadido
- `session:list`:
  - Devuelve catálogo filtrado por `cwd` de conexión LAN.
  - Cada item incluye `status: free|occupied` y `lock.owner` cuando aplica.
- `session:start`:
  - Arranca sesión `Nueva` o `resume` (si `sessionId` y lock OK).
  - Si lock falla: error claro + catálogo actualizado.
- `session:heartbeat`:
  - Mantiene lock vivo en sesión reanudada.

### Compatibilidad
- Se añadió modo selector activado por query `lanSessionMode=select`.
- En modo selector, no hay auto-arranque hasta `session:start`.
- Sin ese query, el flujo legacy sigue arrancando como antes.

## Integración en main
Archivo: `main.js`

- `createLanWsServer(...)` ahora recibe `listReusableSessions`.
- Se extrajo helper `listClaudeSessionsForCwd(...)` (reutilizable) con saneo de `sessionId`.
- `listLanReusableSessions(...)` filtra por CLI (actualmente sessions Claude) y `cwd`.
- `ipcMain.handle('list-sessions')` reutiliza el mismo helper para consistencia.

## UI/UX LAN
Archivo: `lan-client.html`

### Cambios
- Nuevo bloque visible en onboarding:
  - Select `Sesión reutilizable` con opción fija `Nueva sesión (sin reanudar)`.
  - Estado por ítem:
    - Libre: seleccionable.
    - Ocupada: texto `ocupada por X` y opción deshabilitada.
  - Botón `Refrescar sesiones`.
  - Línea de estado contextual (carpeta + conteo libres/ocupadas + errores claros).

### Flujo
1. Conectar abre canal WS en modo selector (`lanSessionMode=select`).
2. Cliente pide `session:list`.
3. Usuario elige `Nueva sesión` o una reusable libre.
4. `Entrar` envía `session:start`.
5. Si sesión reanudada: heartbeat periódico (`session:heartbeat`) para mantener lock.

### Mensajería clara (español)
- Errores de lock (`SESSION_LOCKED`) y sesión inexistente (`SESSION_NOT_FOUND`) se presentan con texto explícito.

## Tests
Nuevo archivo: `tests/ws-server-session-lock.test.js`

Casos cubiertos:
1. Colisión entre dos clientes en misma carpeta:
  - A toma `session-s`.
  - B la ve ocupada y no puede tomarla (`SESSION_LOCKED`).
2. Liberación tras desconexión:
  - A cierra conexión.
  - B observa `session-s` libre dentro de ventana esperada.
3. Lock stale sin heartbeat:
  - Timeout libera lock automáticamente.

## Estado final
- `Path not allowed`, chat simple, terminal raw y ACL no se rompieron (tests existentes pasan).
- `deploy` ejecutado y completado con éxito.

## Notas de continuidad
- Para soporte de sesiones reutilizables Codex, añadir proveedor equivalente en `listLanReusableSessions(...)`.
- Si se quiere cambio de sesión “hot” sin reconectar socket, extender `session:start` cuando `initialized=true` para restart controlado de PTY en misma conexión.

## Pendiente para mañana (reportado por usuario)
- El sistema no está respetando correctamente la sesión seleccionada en el selector.
- UX requerida del selector:
  - Debe estar visible en la vista previa/antes de abrir conexión.
  - Debe seguir visible dentro de la sesión una vez abierta.
  - Debe mantenerse también en modo móvil.

## Ajuste inmediato posterior (misma fecha)
- Se movió el selector de sesiones a un bloque persistente (`session-dock`) fuera del onboarding para que se vea:
  - antes de conectar,
  - con sesión abierta,
  - y en modo móvil/focus.
- Se añadió botón dedicado `Abrir sesión` / `Cambiar sesión` en ese bloque persistente.
- Se ajustó la persistencia de sesión elegida (`stickyResumeSessionId`) para no perder selección al reconectar/cambiar sesión.
