---
name: whatsapp-bridge-relay
description: Relay para usar el WhatsApp bridge de Luismi. Usar cuando un proyecto necesite enviar o recibir mensajes de WhatsApp, enviar notificaciones, o leer respuestas de clientes.
---

# WhatsApp Bridge Relay

Bridge local en `http://127.0.0.1:3031`. Usa el número de WhatsApp de Luismi.
Solo accesible desde localhost — no expuesto al exterior.

## Número de Luismi
`34695020606`

## Endpoints

### Estado
```
GET http://127.0.0.1:3031/status
→ { "status": "ready" | "qr" | "disconnected" | "reconnecting" }
```
Verificar SIEMPRE antes de enviar.

### Enviar texto
```
POST http://127.0.0.1:3031/send/text
Body: { "to": "34XXXXXXXXX", "message": "texto" }
→ { "ok": true, "id": "..." }
```

### Enviar imagen
```
POST http://127.0.0.1:3031/send/image
Body: { "to": "34XXXXXXXXX", "base64": "<base64>", "mimetype": "image/jpeg", "caption": "texto opcional" }
```

### Enviar audio
```
POST http://127.0.0.1:3031/send/audio
Body: { "to": "34XXXXXXXXX", "base64": "<base64>", "ptt": false }
```

### Enviar vídeo
```
POST http://127.0.0.1:3031/send/video
Body: { "to": "34XXXXXXXXX", "base64": "<base64>", "caption": "texto opcional" }
```

### Enviar documento
```
POST http://127.0.0.1:3031/send/document
Body: { "to": "34XXXXXXXXX", "base64": "<base64>", "filename": "archivo.pdf", "mimetype": "application/pdf" }
```

### Leer mensajes recibidos
```
GET http://127.0.0.1:3031/messages?unreadOnly=true&limit=50
→ { "messages": [{ "id", "from", "fromMe", "timestamp", "type", "body", "mediaPath" }] }
```
- `type`: "text" | "image" | "audio" | "video" | "document" | "sticker"
- `mediaPath`: ruta local al archivo descargado (para imágenes, audio, etc.)
- Los mensajes se marcan como leídos al consultarlos

### Vaciar inbox
```
DELETE http://127.0.0.1:3031/messages
```

## Notas importantes
- El número `to` en formato internacional sin `+`: `34612345678`
- Si status != "ready": no enviar, avisar a Luismi: "El bridge está desconectado, ejecuta `whatsapp-bridge qr` en terminal"
- El bridge arranca automáticamente con el Mac (LaunchAgent)
- Sesión persistente en `~/.claude/whatsapp-bridge/.baileys_auth`
- Media entrante guardada en `~/.claude/whatsapp-bridge/media/`
- No auto-responde — la lógica de negocio la decide cada proyecto
