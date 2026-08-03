# El QR no aparece nunca tras un `loggedOut` de WhatsApp

_2026-08-03. Bridge Baileys._

## Síntoma

El modal "Vincular WhatsApp" dice *"No hay QR activo ahora. Pulsa Reintentar…"* y **Reintentar tampoco sirve**. `GET /status` → `disconnected`, `GET /qr` → `{qr: null, qrAscii: null}`. El proceso del bridge está vivo y launchd lo mantiene.

En el log, este par repitiéndose:

```
[bridge] Cargando sesión...
[bridge] Sesión cerrada. Re-escanea QR.
```

## Causa

WhatsApp cerró la sesión (`DisconnectReason.loggedOut`) y el manejador **no hacía nada**:

```js
} else {
  clientStatus = 'disconnected';
  console.log('[bridge] Sesión cerrada. Re-escanea QR.');
}
```

Ni borraba las credenciales ni relanzaba. Y como `useMultiFileAuthState` recarga esas mismas credenciales ya invalidadas, cada arranque repite el ciclo: cargar → WhatsApp rechaza → "Sesión cerrada" → **nunca se llega a emitir un QR**. Por eso reiniciar el servicio no arregla nada: el estado muerto sigue en disco.

## Regla

**Un `loggedOut` no se arregla reiniciando el bridge.** Hay que borrar `.baileys_auth/` o no habrá QR nuevo jamás.

## Fix

En `whatsapp-bridge/index.js` (ya en git), la rama `loggedOut` borra `AUTH_DIR` y relanza `startBridge()`, con:

- **Guard anti-bucle** `deadCredsWiped`: limpia una sola vez por ciclo, se rearma en `connection === 'open'`. Si tras limpiar sigue sin conectar, avisa y para.
- **`AUTH_DIR` absoluto** derivado de `import.meta.url`, no `'./.baileys_auth'`. La ruta relativa dependía del cwd del proceso; hoy coincide porque el plist fija `WorkingDirectory`, pero un borrado no puede depender de eso.

## Diagnóstico rápido la próxima vez

```bash
curl -s -H "X-Auth-Token: $(cat ~/.claude/whatsapp-bridge/.auth-token)" http://127.0.0.1:3031/status
tail -40 ~/.claude/whatsapp-bridge/bridge.log
```

`disconnected` + "Sesión cerrada" repetido = este bug. Las credenciales muertas del incidente quedaron en `~/.claude/whatsapp-bridge/.baileys_auth.dead.20260803` (no sirven; borrables).

## Contexto

Este bug fue el detonante de meter el bridge en git — ver `decisions/bridge_en_git_2026_08_03.md`. Hasta entonces cada arreglo se hacía a mano sobre el fichero en producción.
