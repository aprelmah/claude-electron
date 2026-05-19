# HANDOFF — WhatsApp Features + Grupos (2026-05-19, tarde)

## Estado al cerrar esta sesión

- Rama: `main`
- Último commit: `2853145` (después de este handoff, habrá uno más con el fix de grupos)
- App desplegada en `/Applications/POWER-AGENT.app`
- Bridge reiniciado con los nuevos cambios

---

## Qué se implementó en esta sesión

### 1. Identificación Luismi vs Claude en burbujas (`fromMe`)
- **Antes**: todos los mensajes propios salían iguales (verde, sin etiqueta)
- **Ahora**:
  - `source: 'claude'` → burbuja verde más claro + etiqueta "🤖 Claude"
  - `source: 'luismi'` → burbuja verde oscuro + etiqueta "👤 Tú" (solo cuando el chat está en modo AUTO, para evitar ruido en chats manuales)
- El `source` se setea en el cliente: auto-reply = `'claude'`, envío manual desde panel = `'luismi'`

### 2. Grupos (`@g.us`)
- **Antes**: los grupos no aparecían en la lista; si escribías, aparecía como chat del último participante
- **Ahora**:
  - Grupos pasan `isAuthorized` siempre (no tienen número de teléfono, no aplica allowlist individual)
  - Grupos siempre en modo `manual` (nunca auto-reply)
  - Nombre de participante visible en cada burbuja "them" de grupo
  - Icono 👥 en la lista de chats para grupos
  - Bridge NO sobreescribe el nombre del grupo con el pushName del participante
  - Bridge escucha `groups.upsert/update` para capturar el nombre real del grupo
  - `getChats()` ahora expone `isGroup: boolean`

### 3. Reply / Quote (responder citando mensaje)
- Hover sobre cualquier burbuja → botón ↩️ aparece (top-right)
- Click → banner en el footer con autor + preview del mensaje citado
- Al enviar: incluye `quotedId` que va al bridge → Baileys lo envía como reply nativo de WhatsApp
- Mensajes entrantes que ya traen cita muestran preview sobre el texto
- `replyTo` se limpia al cambiar de chat

### 4. Emoji picker
- Botón 😊 junto al textarea
- Popover con 5 categorías: Caras, Gestos, Corazones, Celebración, Objetos
- Click en emoji → inserta en cursor del textarea
- Click fuera → cierra el picker

---

## Archivos modificados

| Archivo | Qué cambió |
|---|---|
| `~/.claude/whatsapp-bridge/index.js` | parseIncoming: `isGroup`, `participant`, `participantName`, `quotedMsg`; NO actualiza nombre de grupo con pushName del participante; listeners `groups.upsert/update`; `/send/text` acepta `quotedId` para Baileys quoted replies; guarda `_raw` en inbox |
| `whatsapp/whatsapp-client.js` | `isAuthorized` bypass para `@g.us`; `handleIncoming` para grupos (modo siempre manual, no auto-reply); `source: 'claude'/'luismi'` en todos los fromMe; `quotedId` en `sendText`; `getChats()` expone `isGroup`; NO sobreescribe `displayName` del grupo |
| `whatsapp/whatsapp-panel.js` | Identificación Luismi/Claude en burbujas; nombre participante en grupos; reply button + banner + preview en burbujas; emoji picker; `injectExtraStyles()` para CSS adicional |
| `main.js` | `whatsapp:send-text` IPC acepta `opts` (con `quotedId`) |
| `preload.js` | `sendText(jid, text, opts)` — pasa opts al IPC |

---

## Reglas nuevas para la siguiente sesión

- **`source` en mensajes**: todos los `fromMe` tienen `source: 'claude'|'luismi'|null`. El panel usa esto para distinguir quién envió.
- **Grupos `@g.us`**: siempre modo manual, nunca auto-reply. El nombre del grupo viene de `groups.upsert`, NO del `pushName` de mensajes.
- **Bridge `_raw`**: cada entrada del inbox tiene `_raw` = objeto Baileys original, necesario para `quoted` en replies.
- **`quotedId`**: flujo completo panel → IPC → cliente → bridge → Baileys. Funciona para chats individuales y grupos.
- **`injectExtraStyles()`**: el panel inyecta un `<style id="wa-panel-extra-styles">` en `<head>`. Si hay bugs de CSS visual en WhatsApp, buscar ahí primero.

---

## Pendiente / Mejoras futuras opcionales

- **Nombre de grupo al arrancar**: si el grupo no ha recibido ningún mensaje en esta sesión, el evento `groups.upsert` puede no haber disparado aún y el nombre aparece vacío. Fix: llamar `sock.groupFetchAllParticipating()` al arrancar el bridge y guardar nombres.
- **Limpieza media**: rotación automática de `~/.claude/whatsapp-bridge/media/` por fecha.
- **Paginación historial**: `getHistory` capado a 200 mensajes por chat.
- **Tests unitarios**: `sanitizeAutoReplyText`, `escapeForXmlData`, `messageSignature`.
- **Notificación nativa con nombre**: JIDs `@lid` no muestran nombre en notificaciones nativas.

---

## Cómo probar

1. Abrir POWER-AGENT → panel WhatsApp (botón verde)
2. Verificar que el grupo aparece en la lista con icono 👥
3. Enviar mensaje desde el panel al grupo → debe llegar correctamente
4. Recibir mensaje en el grupo → debe aparecer con nombre del participante
5. Hover sobre cualquier burbuja → botón ↩️ debe aparecer
6. Click reply → banner en footer → enviar → llega como reply en WhatsApp
7. Botón 😊 → picker de emojis
8. En chat con auto-reply activo: respuestas de Claude en verde claro "🤖 Claude", las tuyas en verde oscuro "👤 Tú"
