# HANDOFF-CODEX-2026-05-21-LAN-CLIENT-UX-FINAL

> Continuidad operativa después de la sesión del **2026-05-21 (tarde)** en la que se rediseñó dos veces el cliente LAN remoto (`lan-client.html`). Este documento existe para que cualquier agente (Claude, Codex CLI, un humano nuevo) pueda retomar mañana sin depender de la conversación.

## Estado al cerrar la sesión

- Rama: `main`
- Último commit: `ac501b5 ui(lan-client): industrial refined theme, dark default, PTY UX and mobile keybar`
- Árbol limpio. Push pendiente al cerrar este handoff (se hace después del commit del doc).
- App compilada y desplegada: `/Applications/POWER-AGENT.app` (build x64, `npm run deploy` OK).
- Tests: `node --check` OK en main/renderer/preload/ws-server y en el script embebido de `lan-client.html`. `npm test`: 14 verdes / 1 rojo (`ws-server-session-acl` con timeout 20s). **Ese rojo ya existía en `main` antes de tocar nada** (verificado con `git stash` + reejecución). No es regresión del cliente LAN.

## Qué se hizo hoy (orden cronológico)

### 1) Rediseño UX inicial — commit `9ec9836`

`ux(lan-client): redesign chat-first remote session with single viewer modal`

Objetivo: simplificar la UI remota para que una persona no técnica la entienda en 10 segundos.

Cambios principales:

- Quitadas las 4 pestañas (Terminal/Archivos/Contexto/Acciones). Chat siempre visible y protagonista.
- Onboarding ultra-simple: un solo campo "Usuario" + botón "Entrar". `ws-url`, `operatorId`, `profileId` pasan a `<details>` colapsado bajo "Opciones avanzadas".
- Tres acordeones (Archivos remotos, Detalles de tu sesión, Acciones avanzadas), cerrados por defecto.
- Visor unificado en modal único (texto editable si `fs.write`, imagen, ficha binaria). Antes el editor y el preview duplicaban superficie dentro del panel Archivos.
- Coherencia visual con la app servidor (paleta dark/light con tokens equivalentes, acento violeta, border-radius 12, IBM Plex Sans + Mono, detección por `prefers-color-scheme`).
- Copys en cristiano: "Solo lectura: no puedes enviar fotos", "Conectar al equipo central", etc.

### 2) Refinamiento profesional + dark default + UX móvil — commit `ac501b5`

`ui(lan-client): industrial refined theme, dark default, PTY UX and mobile keybar`

Esto es lo que está vivo ahora. Tono comprometido: **"industrial refined"** (herramienta seria, no juguete; superficie técnica con jerarquía editorial).

#### Sistema visual

- Dark por defecto. Toggle sol/luna en topbar. Persiste en `localStorage.powerAgentLanTheme` (valores `dark` o `light`). El toggle pisa al `prefers-color-scheme` cuando el usuario elige.
- Paleta dark: `--bg-0 #0e0e12`, `--bg-1 #16161c`, `--accent #8470ff`, `--term-bg #0a0a10`.
- Paleta light: `--bg-0 #f6f6fa`, `--accent #5d4cf0`.
- Tipografía: **IBM Plex Sans** (cuerpo) + **IBM Plex Mono** (rutas, código, badges). Letter-spacing `-0.005em` para feel editorial.
- Border-radius escalonado: `--r-xs 6`, `--r-sm 10`, `--r-md 14`, `--r-lg 18`.
- Easing único `cubic-bezier(0.2, 0.8, 0.2, 1)` para todas las transiciones.
- Noise sutil de fondo (SVG inline en CSS, opacidad 0.04 dark / 0.025 light) para evitar planar look. `mix-blend-mode: overlay`.
- Topbar sticky con `backdrop-filter: blur(14px)`. Brand mark "PA" con gradiente, sombra del accent, identidad clara.
- Animaciones cortas (220-480 ms) que respetan `@media (prefers-reduced-motion: reduce)`.

#### Topbar

- Brand `PA` + "POWER-AGENT · Sesión remota".
- Chip de sesión activa con `user · mode · cwd/abreviado` (visible solo si conectado).
- Estado de conexión con dot animado (anillo pulsante en `online` y `connecting`).
- Botón sol/luna y botón rojo de "Cerrar sesión" (visible solo si conectado).

#### Onboarding (visible solo desconectado)

- Título grande "Conectar al equipo central".
- Subtítulo claro en español de España.
- Campo "Usuario" + botones "Entrar" y "Reconexión: ON/OFF".
- `<details>` colapsado con servidor/operator/profile.
- Tira de handshake con badge tonal (en espera/pendiente/enviando/ok/compat/err).

#### Chat (visible solo conectado)

- Header con título "Chat con el agente" y dos botones grandes en escritorio:
  - `Foto al chat` (primario violeta) con icono cámara.
  - `Archivo al chat` (ghost) con icono clip.
- Status de adjunto con dot semaforico suave (gris/verde/amarillo/rojo, no estridente).
- Cuerpo: terminal xterm.js con halo violeta sutil interno, sombra dramática, esquinas redondeadas. Scrollbar custom violeta fino (8px, opacity 0.22 -> 0.45 hover).
- Botón flotante "↓ Ir al final · N" (pill violeta) que aparece cuando el usuario hace scroll hacia arriba y van llegando mensajes. Contador de backlog. Detectado con `xterm-viewport.scroll` listener.
- FABs flotantes (solo móvil) sobre el terminal: foto (primario) y archivo (ghost), abajo a la izquierda.
- Pie del chat: toggle "Pedir confirmación antes de enviar adjuntos" + botón "Limpiar pantalla".

#### Barra de teclas auxiliares (solo móvil)

- Visible bajo el terminal sólo en `@media (max-width: 719px)`.
- Botones: `Esc`, `Tab`, `Ctrl` (sticky toggle, aria-pressed), `Ctrl+C`, flechas (`↑↓←→`), `Enter`.
- Mapeo de teclas en `KEY_SEQUENCES` (función `sendKey`). Envía bytes al PTY vía `sendMessage({ type: 'input', data: <bytes> })`.
- Nota: la sticky de `Ctrl` está implementada como toggle visual pero hoy sólo aplica si pulsas a continuación una tecla mapeada en el rango a-z. Para teclas combinadas más complejas, el atajo dedicado `Ctrl+C` siempre funciona. Si se necesita ampliar, mirar `sendKey()`.

#### Extras (3 acordeones)

1. **Archivos remotos** — selector de root, recargar / ir a la raíz, árbol con badge contador. Polling de respaldo si no llega `fs:event` push.
2. **Detalles de tu sesión** — chips con modo/operador/rol/perfil/carpetas/MCP, chip semáforo de permisos OK o denegados, JSON de contexto formateado.
3. **Acciones avanzadas** — Micrófono, Reenviar identidad, Volver a conectar, Cerrar sesión, log de últimos envíos.

#### Modal único de visor

- Animación `scale(0.96) translateY(8px) -> 1` con overlay fade-in.
- Texto editable si `fs.write`, imagen, o ficha binaria.
- Botón "Guardar cambios" solo si hay write y dirty.
- Estado en footer con tono ok/warn/err.
- Cierra con tecla `Escape`, clic en overlay o cualquiera de los dos botones de cerrar.

#### Toast inline en vez de `window.confirm`

- `confirm()` bloqueante para "¿enviar adjunto al chat?" sustituido por toast inferior con dos botones (Cancelar / Enviar). Animado, no rompe el flujo móvil.

## Contrato WebSocket — INVARIANTE

El cliente solo presenta UI; **no toca seguridad**. Toda la ACL vive server-side en `main/ws-server.js`.

Mensajes que envía el cliente (no cambian respecto a antes):

- `handshake { operatorId?, profileId?, username? }` y los alias del server (`hello`, `session:handshake`, …).
- `input { data: string }` — PTY input.
- `resize { cols, rows }`.
- `audio { data: base64 }` — chunk de audio.
- `fs:list { path, depth, requestId }`.
- `fs:open { path, requestId }` — preferido sobre `fs:read` para preview multi-tipo.
- `fs:read { path, encoding: 'utf8', requestId }` — fallback si servidor antiguo.
- `fs:write { path, content, encoding: 'utf8', requestId }`.
- `fs:upload { name, mimeType, base64, requestId }` — flujo foto/archivo al chat. Servidor responde con `ptyReference` (`@/ruta`) y el cliente lo inyecta en el PTY como `<ref> ` (con espacio final).

Mensajes que recibe el cliente:

- `output { data }`, `transcript { text }`.
- `fs:result { requestId, ok, ... }`.
- `fs:event { state }` — push de cambios remotos.
- `status { state }` con `connected | transcribing | pty-exit | error`.

Errores que el cliente formatea en cristiano:

- `READ_ONLY_ROOT` -> "Tu sesión está en solo lectura..."
- `PERMISSION_DENIED` -> "Tu rol no tiene permiso para esta acción."
- `PATH_OUTSIDE_ALLOWED_ROOTS` -> "Ruta fuera de las carpetas permitidas..."
- `FILE_TOO_LARGE` -> "El archivo supera el límite..."

## Archivos tocados en esta sesión

Solo uno:

- `/Users/isabel/Desktop/LUISMI/claude-electron/lan-client.html` (1888 líneas → 1693 líneas tras refactor final, pasando por dos rediseños).

**No se tocó** ningún backend (`main.js`, `main/ws-server.js`, `preload.js`, `whatsapp/*.js`, `telegram-bridge.js`, etc.). Por tanto:

- No hace falta el `pkill -9` agresivo de Helpers.
- `npm run deploy` es suficiente para servir la nueva UI desde la app empaquetada.
- WhatsApp, Telegram, automations, scheduler, grafo, updater, proposals: **intactos**.

## Cómo retomar mañana

```bash
cd /Users/isabel/Desktop/LUISMI/claude-electron
git pull --rebase origin main
git log --oneline -8
node --check main.js renderer.js
node --check preload.js main/ws-server.js
npm test
npm run dev
```

Para servir el cliente LAN remoto en un móvil real:

1. Asegúrate que la app POWER-AGENT está abierta en el Mac mini central.
2. En el móvil (misma red LAN), abre `http://<ip-del-mac>:9999/lan-client.html`. La IP la ves en la propia app (banner de servidor LAN) o con `ifconfig`.
3. Escribe el usuario y pulsa Entrar. La identidad opcional va por query string (`?operatorId=...&profileId=...&username=...`) o por el `<details>` avanzado.

Si quieres iterar rápido sin empaquetar:

```bash
npm run dev   # arranca Electron sin compilar; el WS LAN sirve el HTML directamente
```

Después de cambiar `lan-client.html`:

```bash
node --check main.js renderer.js
node --check preload.js main/ws-server.js
# parsear el script embebido
awk '/<script>/{p=1;next} /<\/script>/{p=0} p && !/^\s*<script /' lan-client.html > /tmp/lan-script.js
node --check /tmp/lan-script.js
npm test
npm run deploy
```

Si tocas `main.js` o `whatsapp/*.js` (no es el caso de esta sesión, pero queda apuntado):

```bash
pkill -9 -f "POWER-AGENT.app/Contents/MacOS/POWER-AGENT"
pkill -9 -f "POWER-AGENT Helper"
sleep 2
npm run deploy
```

## Backlog conocido (pendiente para el siguiente)

1. **Smoke real en móvil real desde almacén** — yo no tengo cámara/táctil/WindowServer; hay que validar:
   - El terminal cabe bien en pantalla de 360-414px de ancho.
   - La barra de teclas auxiliares no se solapa con el teclado virtual de iOS/Android.
   - El FAB foto abre la cámara nativa (input `capture="environment"`).
   - El toast inline es visible y los botones tienen tap target real.
   - El botón "Ir al final" aparece efectivamente cuando llega backlog mientras estás scrolleado arriba.
2. **`ws-server-session-acl` flaky** — un test backend de sockets que falla con timeout 20s. No es regresión del cliente. Investigar entorno de test (puerto ocupado, timing de handshake en CI/local). Reproducible con: `node --test tests/ws-server-session-acl.test.js`.
3. **Sticky Ctrl en keybar móvil** — ahora solo combina con teclas de un solo carácter del rango a-z (lógica mínima). Para combos como `Ctrl+Z` o `Ctrl+\` hace falta extender `sendKey()`. Si nadie lo pide, no urge.
4. **Polish del visor de archivos** — falta PDF (actualmente cae a binario), descarga directa con `<a download>` para binarios, atajos `Cmd+S` dentro del editor. El handoff anterior (`HANDOFF-CODEX-2026-05-21-ENTERPRISE-UX-REMOTE-PHOTO-FLOW.md`) ya lo apuntaba como fase siguiente.
5. **Autenticación LAN** — token rotativo o allowlist IP opcional. Hoy el servidor LAN sirve a quien llegue a la red. Para producción en cliente, blindar.
6. **Telemetría de latencia** — `fs:event` y `fs:upload` ya están auditados semánticamente; falta dashboard / métricas operativas.

## Notas críticas — NO TOCAR sin leer handoffs

- `telegram-bridge.js`, `whatsapp/whatsapp-auto-reply.js`, `whatsapp/whatsapp-client.js`: sensibles, han costado mucho. Hay un handoff dedicado de cada uno; leer antes.
- `main/enterprise-policy.js` + `main/path-sandbox.js` + ACL de `main/ws-server.js`: lo que protege al cliente real. No relajar.
- Modo empresa es opt-in (`enterprise.enabled=false` = legacy intacto). Mantener.
- Memoria del proyecto: `~/.claude/projects/-Users-isabel-Desktop-LUISMI-claude-electron/memory/MEMORY.md` y compartida en `~/claude-shared/memory/`.

## Lectura obligatoria para el siguiente agente

Leer en este orden si retomas en frío:

1. `CLAUDE.md` (runbook del proyecto)
2. `HANDOFF-CODEX-2026-05-21-LAN-CLIENT-UX-FINAL.md` (este documento)
3. `HANDOFF-CODEX-2026-05-21-REMOTE-SESSION-CONTINUIDAD-CHAT-FIRST.md`
4. `HANDOFF-CODEX-2026-05-21-ENTERPRISE-UX-REMOTE-PHOTO-FLOW.md`
5. `HANDOFF-CODEX-2026-05-21-CONTINUIDAD-POST-PRUEBAS.md`
6. `HANDOFF-CODEX-2026-05-21-ENTERPRISE-MULTIOPERADOR.md`

## Prompt para Codex nuevo

```text
Eres Codex en /Users/isabel/Desktop/LUISMI/claude-electron. Continúa POWER-AGENT sin reimplementar nada desde cero.

Lee primero:
1. CLAUDE.md
2. HANDOFF-CODEX-2026-05-21-LAN-CLIENT-UX-FINAL.md
3. HANDOFF-CODEX-2026-05-21-REMOTE-SESSION-CONTINUIDAD-CHAT-FIRST.md
4. HANDOFF-CODEX-2026-05-21-ENTERPRISE-UX-REMOTE-PHOTO-FLOW.md
5. HANDOFF-CODEX-2026-05-21-CONTINUIDAD-POST-PRUEBAS.md
6. HANDOFF-CODEX-2026-05-21-ENTERPRISE-MULTIOPERADOR.md

Estado actual: cliente LAN remoto rediseñado con tema dark por defecto + toggle, scroll PTY refinado con botón "ir al final", barra de teclas auxiliares en móvil, FABs flotantes para foto/archivo, modal único de visor, toast inline. Backend WS y ACL intactos.

Backlog vivo (ver handoff para detalle):
1. Smoke real en móvil de almacén.
2. Test ws-server-session-acl flaky (no regresión del cliente, pero hay que arreglar entorno).
3. Sticky Ctrl en keybar móvil cubre solo a-z.
4. Visor: PDF, descarga de binarios, atajos.
5. Autenticación LAN.
6. Telemetría de latencia.

Restricciones:
- No tocar whatsapp/*.js ni telegram-bridge.js sin necesidad real.
- ACL siempre server-side.
- Modo empresa opt-in.
- Commits limpios por bloque.

Pruebas obligatorias antes de entregar:
node --check main.js renderer.js
node --check preload.js main/ws-server.js
awk '/<script>/{p=1;next} /<\/script>/{p=0} p && !/^\s*<script /' lan-client.html > /tmp/lan.js && node --check /tmp/lan.js
npm test
Smoke real en app y móvil si tocas lan-client.html.
Si modificas main.js o whatsapp/*.js: pkill obligatorio antes de npm run deploy.
```

## Recordatorio de filosofía (por si se olvida)

- "Al grano duro": el usuario quiere respuestas técnicas exactas en una o dos frases, sin saludos ni resúmenes pomposos.
- En español de España. Sin emojis salvo glifos UI o si el usuario los usa primero.
- Dark por defecto en el cliente LAN remoto, ya zanjado.
- El cliente LAN es chat-first: si propones meter más cosas, asegúrate que no roban espacio al terminal.
- Toda decisión técnica menor (organización de CSS, nombres de variables, easing, fonts) la tomas tú y la informas. Solo se pregunta producto/alcance/riesgo real.
