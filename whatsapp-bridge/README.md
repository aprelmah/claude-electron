# Bridge de WhatsApp (Baileys)

Servidor local que POWER-AGENT usa para hablar con WhatsApp. Corre **fuera de la
app**, como servicio de launchd, y expone una API en `127.0.0.1:3031`.

## Esta carpeta es la fuente de verdad

El bridge se ejecuta desde `~/.claude/whatsapp-bridge/`, que **no** es un repo.
Durante meses el código vivió solo ahí: cada arreglo se hacía a mano sobre el
fichero en producción, con copias `index.js.bak.<fecha>` como único respaldo. Un
borrado accidental o un backup viejo restaurado se llevaba por delante trabajo
que no estaba en ningún sitio.

Lo versionado aquí es únicamente el **código**. Nunca subir a este directorio:

| Fuera de git | Por qué |
|---|---|
| `.auth-token` | secreto compartido con la app |
| `.baileys_auth/` | credenciales de la sesión de WhatsApp |
| `config.json` | lleva `ownerNumber` (teléfono real) |
| `state.json` | historial de conversaciones |
| `kb-audit.jsonl` | mensajes de clientes (PII) |
| `kb/` | fichas del negocio |
| `persona.md` | tono y contenido del negocio |
| `media/` | adjuntos recibidos |

## Desplegar un cambio

Editar aquí, y luego:

```bash
scripts/deploy-wa-bridge.sh
```

Hace backup del `index.js` en producción, copia los ficheros de código y
reinicia el servicio. No toca nada de la tabla de arriba.

## Comprobar que va

```bash
curl -s -H "X-Auth-Token: $(cat ~/.claude/whatsapp-bridge/.auth-token)" \
  http://127.0.0.1:3031/status
# {"status":"ready"}
```

Estados: `initializing` → `qr` (esperando escaneo) → `ready`. `disconnected`
significa que WhatsApp cerró la sesión y hay que re-vincular.

## Trampas conocidas

- **`loggedOut` no se arregla reiniciando.** Si WhatsApp cierra la sesión, las
  credenciales de `.baileys_auth/` quedan muertas; recargarlas hace que WhatsApp
  vuelva a rechazarlas y el bridge nunca emite un QR nuevo. Desde 2026-08-03 esa
  rama las borra y relanza `startBridge()` sola, con un guard para no entrar en
  bucle si tras limpiar sigue sin conectar.
- **`markOnlineOnConnect: false` es deliberado.** Sin eso el dispositivo aparece
  "en línea" 24/7 — señal clarísima de bot para Meta — y además roba las
  notificaciones push del teléfono.
- **`/send/text` no es idempotente.** Un 500 puede llegar con el mensaje ya
  enviado (Baileys lanza `Timed Out` en el ack). Quien llame decide si reintenta;
  la app solo lo hace ante un 503, que sale antes de enviar.
