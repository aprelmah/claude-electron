# Decisión — cuál es el kill switch del bot de WhatsApp y dónde vive

_2026-08-02, noche. Commit `63c695a`._

## La pregunta que lo originó

Luismi: "el botón de AUTO TODO solo conecta a todos en auto pero no desconecta a todos de auto, ¿es así su funcionamiento? ¿debe ser así?"

## Los tres controles y qué hace cada uno

| Control | Dónde | Efecto |
|---|---|---|
| **BOT ON/OFF** | cabecera, `#wa-btn-autoreply` | Sigues recibiendo y puedes escribir tú; el bot calla. **Es el kill switch real.** |
| **STOP** | cabecera, `#wa-btn-bridge-toggle` | `launchctl` sobre `com.luismi.whatsapp-bridge`: desconecta WhatsApp entero. Ni recibes ni envías, y puede pedir QR al volver. Botón de pánico duro. **Desde 2026-08-17 es PERSISTENTE** (deshabilita el servicio: no vuelve en el próximo login) → [[runbook_whatsapp_bridge_ciclo_vida]]. |
| **AUTO TODO** | cabecera, `#wa-btn-all-auto` | Reengancha el bot en todos los chats individuales (y fuerza MANUAL en grupos). |

## Por qué AUTO TODO es one-way — y se queda así

`setAllIndividualChatsAuto()` (`whatsapp/whatsapp-client.js`) solo activa. No hay inverso y no hace falta:

1. Un "MANUAL TODO" sería peor que `autoReply:false`: no invalidaría las colas pendientes (`autoReplyEpoch`) ni apagaría el typing.
2. Los chats nuevos nacen en `auto` (`whatsapp-client.js:546`), así que un "MANUAL TODO" no cubriría a un entrante nuevo — el bot le contestaría igual.

El único hueco que deja: apagar el bot para los conocidos pero dejarlo vivo para entrantes nuevos. Caso raro. Si algún día hace falta, la solución no es "MANUAL TODO" sino **cambiar el default de chats nuevos a MANUAL** (allowlist en vez de allow-all), que además tapa el riesgo de las fichas sin validar. Ver [[kb-fichas-ejemplo-turbo-2026-08-02]].

## Por qué el toggle salió del modal

Estaba en Configuración → General → check + Guardar: **4 clics para lo que se usa en una urgencia**. Ahora es un clic en la cabecera.

Consecuencias que hay que respetar:

- **El modal ya no manda `autoReply` en su partial de Guardar.** A propósito: `saveConfig` hace merge en el backend, así que guardar Configuración no puede pisar el estado del bot. Volver a añadirlo reintroduce el bug.
- `openCfgModal` sigue leyendo el valor para sincronizar el botón de la cabecera, pero no pinta ningún control propio.

## El kill switch funciona — evidencia

Auditado en `whatsapp/whatsapp-client.js`:

- Gate de entrada (`:779`): con OFF el mensaje entrante ni se encola.
- `canAutoReplyNow` (`:819`) comprobado en **9 puntos** del pipeline (KB, smalltalk, aclaración, fallback).
- `autoReplyEpoch` (`:382`, `:1394`): al pasar de ON a OFF sube el epoch y los turnos ya en vuelo se cancelan.

Verificado conduciendo la app: el `config.json` cambia ~205 ms tras el clic, 5 clics seguidos producen **un** solo cambio (guard `autoReplyBusy`), y guardar el modal deja `autoReply` intacto.

No hay test automatizado: `whatsapp-client.js` tiene las rutas cableadas a `~/.claude/whatsapp-bridge/`, así que instanciarlo en un test escribiría sobre el `state.json` real de Luismi. Si algún día hace falta cubrirlo, primero hay que inyectar rutas en `createWhatsAppClient`.

## Limitación conocida

Las dos ventanas que montan el panel (principal y ventana WhatsApp) solo se sincronizan por el `setInterval` de 15 s. Tras togglear en una, la otra miente hasta 12-15 s. En un botón de emergencia es feo. Arreglo pendiente: broadcast por IPC al cambiar la config, en vez de esperar al polling.
