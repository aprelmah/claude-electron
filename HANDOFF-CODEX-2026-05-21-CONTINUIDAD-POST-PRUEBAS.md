# HANDOFF-CODEX-2026-05-21-CONTINUIDAD-POST-PRUEBAS

## Objetivo de este documento

Este handoff existe para que mañana Claude, Codex CLI o cualquier agente nuevo pueda continuar el proyecto sin depender de la conversación previa.

Estado mental correcto: **no reimplementar desde cero**. El modo empresa ya está metido, testeado y commiteado. La siguiente fase es pulir UX, movilidad, archivos adjuntos/visor y cerrar las incidencias detectadas por Luis en pruebas reales.

## Contexto rápido

- Repo: `/Users/isabel/Desktop/LUISMI/claude-electron`
- App: POWER-AGENT Electron
- Fecha de continuidad: 2026-05-21
- Rama actual: revisar con `git branch --show-current`
- Estado esperado del árbol tras este handoff: limpio
- Comando para abrir Codex CLI aquí:

```bash
cd /Users/isabel/Desktop/LUISMI/claude-electron && codex
```

## Lectura obligatoria para el siguiente agente

Leer en este orden:

1. `CLAUDE.md`
2. `HANDOFF-CODEX-2026-05-21-ENTERPRISE-MULTIOPERADOR.md`
3. `HANDOFF-CODEX-2026-05-21-CONTINUIDAD-POST-PRUEBAS.md`
4. `HANDOFF-CODEX-2026-05-20-LAN-REMOTE-OPERATIONS.md`
5. `HANDOFF-AGENT-PTY.md`
6. `HANDOFF-CLAUDE-2026-05-18-CHAT-LATENCY.md`
7. `HANDOFF-CLAUDE-2026-05-19-WHATSAPP-HARDENING.md`
8. `HANDOFF-CLAUDE-2026-05-19-WHATSAPP-AUDIO-FIX.md`

## Estado implementado y commiteado

Commits clave que deben existir en `git log --oneline`:

- `503cef6 feat(enterprise): add multioperator model and management UI`
- `9e3d81c feat(lan): enforce per-session ACL and add remote file explorer`
- `f28b17a test+docs(enterprise): add policy tests and multioperator handoff`
- `643c07e fix(lan-client): display effective MCP allowlist in session context`
- `393996f test(lan): add ws session ACL integration coverage`
- `b92f478 fix(lan): ignore post-connect handshake to avoid unsupported_message noise`

Qué hay ya hecho:

- Modo empresa opt-in persistente en config.
- Roles con permisos: PTY, FS, visor, automatizaciones y MCP allowlist.
- Operadores con rol, perfil por defecto y persona propia.
- `profiles[].personaPrompt` como fallback de persona.
- Sesión LAN resuelta por operador/perfil/rol, aislada por conexión.
- Fallback legacy intacto cuando `enterprise.enabled=false` o no hay contexto explícito.
- ACL real en `main/ws-server.js` para listado, lectura, escritura, rename y delete.
- Protección contra path traversal y escape por symlink usando normalización/realpath.
- Cliente remoto `lan-client.html` con explorador básico y contexto de sesión.
- Auditoría semántica `empresa_*`.
- Tests de policy y ACL.

Archivos principales tocados:

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
- `tests/ws-server-pure.test.js`
- `tests/ws-server-session-acl.test.js`
- `tests/semantic-logger.test.js`

## Validaciones ya ejecutadas en la entrega anterior

Ejecutado y OK:

```bash
node --check main.js renderer.js
node --check preload.js main/ws-server.js
npm test
```

Resultado conocido de `npm test` en esa entrega:

- 66 tests totales
- 60 pass
- 0 fail
- 6 skip esperados por limitaciones de socket/sandbox

También se ejecutó deploy final con éxito y se observó:

```text
POWER-AGENT instalado y abierto desde: /Applications/POWER-AGENT.app
```

Antes de confiar en producción mañana, repetir pruebas en el entorno gráfico real.

## Incidencias reales apuntadas por Luis tras probar

Estas son las cosas que Luis dijo que hay que mirar después. No tratarlas como ideas sueltas: son backlog real.

1. Labels técnicos en permisos

En la UI de roles aparecen textos tipo:

- `pty.execute`
- `fs.read`
- `fs.write`
- `fs.delete`
- `viewer.open`
- `automations.manage`

Luis pidió ponerlo "en cristiano". Debe mostrarse con etiquetas claras:

- Ejecutar terminal
- Ver archivos
- Listar carpetas
- Editar/guardar archivos
- Borrar archivos
- Renombrar/mover
- Abrir visor
- Gestionar automatizaciones

Mantener internamente las keys técnicas; solo cambiar display/tooltip.

2. Perfil activo y MCP

Luis vio que el bloque de perfil activo seguía mostrando `MCP 0` / `Sin recordatorios MCP` aunque el perfil tenía MCP o faltaba conexión visual clara.

Hay que revisar:

- `renderer.js`: render del selector/perfil activo/popover.
- `index.html`: `profile-reminder`, `profile-popover-*`.
- `main.js`: payload de `profiles:list`.
- Que `mcpServers[]` se guarde, se liste y se vea igual en selector, popover y modo empresa.

3. UI remota en móvil

Luis dijo que la UI remota actual es mala en móvil y que los selectores son feos. Hay que rediseñar `lan-client.html` pensando en uso real desde móvil:

- navegación por pestañas o bottom bar;
- terminal, archivos, sesión, adjuntos como secciones claras;
- controles compactos;
- selectores bonitos y táctiles;
- layout preparado para añadir más cosas en el futuro;
- sin romper desktop.

4. Explorador remoto no refresca solo

Si desde el servidor central se mete un archivo nuevo en el directorio seleccionado, el cliente remoto no lo ve hasta recargar manualmente.

Opciones razonables:

- polling ligero del root abierto cada N segundos;
- botón de recarga visible;
- ideal: evento servidor por `fs.watch` por sesión/root, con límites y limpieza al cerrar socket.

Para fase rápida: polling controlado y no invasivo.

5. Visor de archivos insuficiente y límite de PNG

Luis probó un `.png` de 2,4 MB y dio límite superado. Falta visor para más tipos.

Implementar mínimo:

- imágenes: png/jpg/jpeg/webp/gif con preview;
- PDF: abrir/embeber si se puede;
- texto/código: editor actual;
- binarios/desconocidos: mostrar metadata y opción de descarga/apertura si permiso.

Revisar límites actuales en `main/ws-server.js` (`MAX_*`) y ajustar con seguridad. No permitir lecturas gigantes sin control.

6. Formulario remoto pide demasiada identidad

Luis dijo que no tiene sentido tener que poner `operatorId`, `profileId` y `username`.

Diseño esperado:

- modo simple: un único campo "Usuario" o selector de operador si el servidor expone lista autorizada;
- `profileId` avanzado/oculto;
- `username` puede resolver operador;
- `operatorId` debe ser interno o avanzado;
- si no se pone nada, legacy debe seguir funcionando.

7. Fotos desde móvil al chat

Caso real: operador en almacén manda foto de una etiqueta desde móvil y el agente debe reconocerla o usarla para una acción, por ejemplo meter algo en un pedido.

Hay que añadir a UI remota:

- botón adjuntar foto/archivo;
- input `capture="environment"` para cámara móvil;
- subida al servidor con límites;
- mensaje al PTY/chat con referencia segura al archivo subido;
- guardado en carpeta temporal por sesión o root permitido;
- auditoría del upload.

No meter base64 gigante en el terminal. Mejor guardar archivo y enviar ruta/contexto.

8. Handshake `UNSUPPORTED_MESSAGE`

Luis vio en indicador de sesión:

```text
UNSUPPORTED_MESSAGE: tipo no soportado: handshake
```

Se añadió commit `b92f478` para ignorar handshakes post-connect en `main/ws-server.js`. Aun así, mañana hay que comprobar en app desplegada que:

- el build instalado contiene ese commit;
- el cliente remoto no muestra el error al conectar con usuario;
- el prompt/persona se inyecta y el agente contesta;
- no se duplican handshakes ni se mezclan sesiones.

## Reglas críticas de compatibilidad

- Legacy debe seguir intacto.
- Si `enterprise.enabled=false`, sesión remota hereda perfil global activo como antes.
- Si no llega operador/perfil explícito, no forzar modo empresa salvo que se añada una política nueva opt-in.
- No mezclar contextos entre sesiones.
- No confiar en validación del cliente para permisos FS.
- No tocar WhatsApp/Telegram salvo necesidad real y leyendo handoffs.

Archivos sensibles:

- `telegram-bridge.js`
- `whatsapp/whatsapp-auto-reply.js`
- `whatsapp/whatsapp-client.js`

## Regla de deploy obligatoria

Si se modifica `main.js` o `whatsapp/*.js`, ejecutar antes del deploy:

```bash
pkill -9 -f "POWER-AGENT.app/Contents/MacOS/POWER-AGENT"
pkill -9 -f "POWER-AGENT Helper"
sleep 2
```

Después:

```bash
npm run deploy
```

## Pruebas mínimas antes de entregar otra fase

Siempre:

```bash
node --check main.js renderer.js
node --check preload.js main/ws-server.js
npm test
```

Si se toca UI remota:

- abrir app desplegada;
- abrir cliente LAN desde desktop;
- abrir cliente LAN desde móvil real;
- conectar legacy sin usuario;
- conectar operador secretaria;
- conectar operador gerente;
- comprobar dos sesiones simultáneas;
- comprobar que cada una conserva su perfil/persona/MCP.

Si se toca explorador/visor/upload:

- secretaria puede listar/leer dentro de root permitido;
- secretaria no puede salir por `../`;
- secretaria no puede escapar por symlink;
- secretaria no puede escribir si root es read-only;
- gerente puede ver root más amplio;
- archivo creado desde central aparece en remoto;
- PNG de al menos 2,4 MB se previsualiza o da error claro y justificado;
- foto desde móvil se sube y se inyecta al chat como ruta/contexto.

## Prompt recomendado para un Codex nuevo

Usar este prompt si se abre una sesión nueva:

```text
Eres Codex en /Users/isabel/Desktop/LUISMI/claude-electron. Continúa POWER-AGENT desde los handoffs, sin reimplementar modo empresa desde cero.

Lee primero:
1. CLAUDE.md
2. HANDOFF-CODEX-2026-05-21-ENTERPRISE-MULTIOPERADOR.md
3. HANDOFF-CODEX-2026-05-21-CONTINUIDAD-POST-PRUEBAS.md

Estado actual: modo empresa multioperador ya implementado y commiteado. Legacy debe seguir intacto. Hay ACL real FS por sesión remota, persona por operador/perfil, MCP allowlist básica y cliente LAN con explorador mínimo.

Backlog prioritario:
1. Cambiar labels técnicos de permisos a castellano claro sin cambiar keys internas.
2. Conectar/normalizar indicador MCP del perfil activo y popover.
3. Rediseñar lan-client.html para móvil: navegación clara, terminal/archivos/sesión/adjuntos, selectores dignos y escalable.
4. Auto-refresh del explorador remoto cuando cambian archivos en el root seleccionado.
5. Visor remoto para imágenes/PDF/texto y ajustar límite de PNG 2,4 MB con seguridad.
6. Simplificar conexión remota: un campo usuario o selector; operatorId/profileId como avanzado; legacy sin campos sigue funcionando.
7. Añadir adjuntar foto desde móvil al chat: cámara/galería, subida segura, ruta temporal por sesión, inyección al PTY sin base64 gigante, auditoría.
8. Verificar que el fix de handshake b92f478 elimina UNSUPPORTED_MESSAGE al conectar con usuario.

Restricciones:
- No romper Telegram, WhatsApp, automations, scheduler, grafo, updater ni propuestas.
- No tocar whatsapp/*.js ni telegram-bridge.js salvo necesidad real y leyendo handoffs.
- No confiar en la UI para permisos FS.
- Mantener todo opt-in para empresa.
- Hacer commits limpios por bloque lógico.

Pruebas obligatorias:
node --check main.js renderer.js
node --check preload.js main/ws-server.js
npm test
Smoke real en app y móvil si se toca lan-client.html.
Si se modifica main.js o whatsapp/*.js, ejecutar pkill obligatorio antes de npm run deploy.

Entrega final:
- código funcionando;
- commits separados;
- tests ejecutados;
- lista de archivos tocados;
- validaciones manuales;
- pendientes exactos si queda algo.
```

## Orden recomendado de trabajo mañana

1. Verificar app desplegada contra `b92f478` y reproducir/no reproducir handshake.
2. Hacer cambios pequeños de texto en permisos y MCP del perfil activo.
3. Rediseñar UI móvil de `lan-client.html` antes de añadir upload, porque si no se acumula deuda visual.
4. Añadir visor de imágenes/PDF y ajustar límites.
5. Añadir auto-refresh del explorador.
6. Añadir upload de fotos al chat.
7. Repetir tests y deploy.

## Nota final de continuidad

Luis quiere un producto usable para empresa real: Mac mini central, operadores remotos, perfiles/personas/permisos por operador y uso móvil en almacén. La prioridad ya no es demostrar que el modo empresa existe; la prioridad es que sea cómodo, claro y robusto en uso diario.
