# HANDOFF — Sesión 2026-05-18 (WhatsApp end-to-end)

## Lo que se montó

Feature **WhatsApp dentro de POWER-AGENT**: cliente, ventana standalone, autorespuesta con persona, panel UI con switch AUTO/MANUAL, hand-over cuando Luismi escribe desde otro dispositivo. Triángulo cliente ↔ Claude (como asistente de Luismi) ↔ Luismi supervisor.

End-to-end funcional: cliente manda mensaje → Claude responde como asistente → llega al móvil del cliente.

## Arquitectura

```
[Móvil cliente] ──WA── [Bridge Baileys daemon] ──HTTP 127.0.0.1:3031── [Cliente Electron main process]
                       ~/.claude/whatsapp-bridge/                       whatsapp/whatsapp-client.js
                       launchd com.luismi.whatsapp-bridge                       │
                                                                                ▼
                                                                  spawn `claude -p` con persona
                                                                  whatsapp/whatsapp-auto-reply.js
                                                                                │
                                                                                ▼
                                                                  POST /send/text al bridge
                                                                                │
                                                                                ▼
                                                                  [Móvil cliente]
```

Renderer:
- Ventana **standalone** independiente (980×720, bounds persistidos en `userData/whatsapp-window-bounds.json`).
- HTML: `whatsapp-window.html` carga `whatsapp/whatsapp-panel.js` con `window.WA_STANDALONE = true`.
- Preload propio: `whatsapp-window-preload.js`.
- Botón verde en titlebar de la ventana principal abre la standalone (Cmd+Shift+W también).
- Drawer embebido queda como fallback si `openWhatsappWindow` falla.

## Archivos clave (en este repo)

| Archivo | Rol |
|---|---|
| `main.js` | IPC handlers `whatsapp:*`, IPC `whatsapp-window:open`, registro protocolo `wa-media://`, arranque cliente con retry de 10s si bridge no responde |
| `preload.js` | Expone `window.api.whatsapp.*` con alias (`status`/`getStatus`, `getQr`/`getQR`) + `openWhatsappWindow` |
| `whatsapp/whatsapp-client.js` | Cliente HTTP del bridge (con `http.request` nativo Node 16, NO fetch), poll 1.5s, estado en memoria + `state.json`, allowlist (vacía = abierta), hand-over `fromMe`, escalado por multimedia |
| `whatsapp/whatsapp-auto-reply.js` | Spawn `claude -p` con persona como `--system-prompt`, sin `--resume` |
| `whatsapp/whatsapp-panel.js` | Panel UI (IIFE) que sirve tanto al drawer como a la ventana standalone. Soporta multimedia, grabador audio, switch AUTO/MANUAL, modales QR/config |
| `whatsapp-window.html` | HTML de la ventana standalone. `body class="dark"`, var(--bg) |
| `whatsapp-window-preload.js` | Preload de la ventana standalone (mismo `window.api.whatsapp`) |
| `styles.css` | Bloque WhatsApp ~1327+. `.wa-panel.wa-standalone` con `!important` en layout |

## Archivos fuera del repo

- `~/.claude/whatsapp-bridge/index.js` — daemon Baileys (autoarrancado por launchd `com.luismi.whatsapp-bridge`).
- `~/.claude/whatsapp-bridge/config.json` — `{ autoReply, authorizedNumbers, claudePath, ownerNumber, personaPath }`.
- `~/.claude/whatsapp-bridge/persona.md` — system prompt "asistente de Luismi", editable.
- `~/.claude/whatsapp-bridge/state.json` — historial de chats persistido por el cliente.
- `~/.claude/whatsapp-bridge/media/` — adjuntos descargados (servidos al renderer vía protocolo `wa-media://`).

## Decisiones técnicas validadas

1. **Bridge ya estaba montado** (Luismi lo dejó hecho con Baileys). No se vuelve a montar — solo se consume vía HTTP local.
2. **Allowlist abierta**: `authorizedNumbers: []` significa aceptar a TODOS. Si la lista tiene entradas, solo esas. Decidido tras la primera prueba.
3. **Hand-over automático**: si llega un mensaje `fromMe===true` (Luismi escribe desde el móvil/WA Web), el chat pasa a `manual` y Claude se calla. Luismi reactiva con el switch.
4. **Escalado por multimedia**: imagen/vídeo/documento/sticker → chat a `manual` durante 5 min (no autorespuesta).
5. **Audio entrante**: descargado por el bridge, transcrito con Whisper (`transcribeAudioFile`), inyectado como texto al prompt de Claude.
6. **JID `@lid` se envía tal cual** al bridge (preserva identidad enmascarada). NO se convierte a `@s.whatsapp.net` (eso rompía el envío).
7. **`http.request` nativo, NO `fetch`**: Electron 20.3.12 incluye Node 16, sin fetch nativo. Tanto el cliente como el ping inicial de main.js usan `http.request`.
8. **Identidad legible**: bridge enriquece cada mensaje con `displayName` (libreta + pushName) y `phoneNumber` (resuelto del JID o del cross-mapping lid↔jid). Cliente y panel persisten/muestran ese orden de preferencia.
9. **Push events**: cliente emite `new-message({jid, message})`, `chat-updated(chat-completo)`, `status-changed(status)`. Main broadcasta a todas las ventanas. Standalone consume vía preload.
10. **Ventana standalone con `!important`** en layout: defensa contra residuos inline del modo drawer (LS de width).

## Configuración del comportamiento

- Persona editable en `~/.claude/whatsapp-bridge/persona.md`. Recarga: `reloadPersona: true` en config provoca relectura por turno.
- AutoReply global: toggle en config o desde modal de la UI.
- Allowlist editable: vacía = abierta; con entradas = restrictiva.

## Bugs resueltos en esta sesión

1. `fetch is not defined` (Node 16) → `http.request` en cliente y main.
2. Send a `@lid` → preservar JID completo, no normalizar.
3. Allowlist bloqueaba todo cuando estaba vacía → al revés: vacía = abierta.
4. Alias preload faltantes (`getStatus`, `getQR`) → añadidos.
5. Status emitido como string → cliente acepta ambos (string y objeto).
6. Burbujas no refrescaban en vivo → listener corregido (payload `{ jid, message }`, dedupe por id).
7. JID `@lid` sin nombre legible → bridge enriquece con `pushName` + mapping lid↔jid.
8. Ventana standalone con fondo negro y panel oculto → `body class="dark"` + `!important` en `.wa-standalone` + limpieza inline.

## Pendiente / TODO

- DevTools auto eliminado de la ventana standalone (solo era para diagnóstico).
- Algunos `@lid` sin `phoneNumber` resoluble — Baileys 6.7.21 no siempre expone el mapping; fallback `displayName` (pushName) o JID enmascarado.
- Chats antiguos en `state.json` no tendrán `displayName`/`phoneNumber` hasta nuevo mensaje del remitente.
- El drawer embebido sigue accesible como fallback. Si se quiere quitar del todo, borrar el `togglePanel()` del catch en el handler del botón.
- Worktrees temporales en `.claude/worktrees/` (locked, no se borran limpios). No afectan al runtime.

## Commits clave de esta sesión

- `f8b8243` ui(titlebar): bolt icon + responsive layout for small windows
- `46bace1` wa(backend): bridge client + IPC + auto-reply + wa-media protocol
- `02435c6` wa(ui): drawer panel + chats list + bubbles + media + audio recorder
- `26424c5` merge: wa backend
- `fb9bba6` merge: wa ui
- `5f9e398` wa(ux): standalone window + live bubbles + readable contact name
- `64b18a1` wa(fix): http.request instead of fetch, send @lid raw, accept all by default
- `e2dab5f` merge: wa ux refinement
- `ca3ade7` wa(window): force standalone layout

## Despliegue

Build x64 actual:
- `/Applications/POWER-AGENT.app`
- Empaquetada con `npm run deploy`.
- Modo dev disponible con `osascript /tmp/launch_poweragent.scpt`.

## Cómo probarlo

1. Bridge ya arranca solo en login (launchd). Verifica: `curl -s http://127.0.0.1:3031/status` → `{"status":"ready"}`.
2. Abre POWER-AGENT.
3. Click en botón verde de WhatsApp en titlebar (o Cmd+Shift+W).
4. Se abre ventana standalone con lista de chats y conversación.
5. Manda un wasap desde cualquier número.
6. Aparece chat en la lista. Si está en AUTO, Claude responde como asistente. Si tú escribes desde el input del panel o desde el móvil/WA Web, pasa a MANUAL automáticamente.
