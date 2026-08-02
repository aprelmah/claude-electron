# Bug: cliente sin respuesta cuando el mensaje coincide con una reconexión del bridge (2026-08-02)

## Síntoma
Isabel reportó: "tengo un problema con mi bateria" → "escribiendo…" colgado, el bot nunca contestó, y el chat pasó solo a MANUAL.

## Diagnóstico (bridge.log, `kb-audit.jsonl`, `state.json`)
- El mensaje se descifró bien (`[bridge] ← 188480479092877@lid [text]`) — la sesión Signal con ese contacto funciona, no es una sesión rota.
- `kb-audit.jsonl` confirma que el pipeline corrió entero: selector → `sin_ficha` (correcto: "tengo un problema con mi bateria" es demasiado vago para ninguna ficha, la regla "ante la duda, sin_ficha" hizo su trabajo) → `escalateToHuman` (correcto: pasar a MANUAL y avisar es el comportamiento esperado sin ficha).
- El fallo real: justo después del mensaje entrante, el bridge logueó `Reconectando... → Cargando sesión... → Conectado y listo` (reconexión normal de Baileys, sin relación con el contenido). El `POST /send/text` de la escalada cayó en esa ventana con `clientStatus !== 'ready'` → **503 "No listo"**.
- `sendText` no tenía reintento: `bridgeFetch` lanzaba, se capturaba, `{ok:false}`, y como el catch no hace `pushHistory`, el mensaje de escalada **nunca se guardó ni se envió**. El cliente se quedó sin nada.
- El "escribiendo…" del panel no se queda colgado para siempre: `TYPING_TIMEOUT_MS = 60000` lo limpia solo, pero eso no soluciona que el cliente real quedó sin respuesta.

## Fix (`whatsapp/whatsapp-client.js`)
- `isTransientBridgeError(err)`: sin `status` (red/timeout) o `status >= 500` → transitorio; 401/400/429 → no (reintentar no los arregla).
- `bridgeFetchWithRetry(method, path, body, {retries:2, delaysMs:[4000,8000]})`: hasta 2 reintentos con backoff, solo para errores transitorios.
- `sendText` usa `bridgeFetchWithRetry` **solo si `opts.internal === true`** (envíos automáticos del bot: auto-reply, escalada KB, smalltalk). Los envíos manuales de Luismi desde el panel siguen sin reintento — si fallan, él lo ve al momento y reintenta a mano; no tiene sentido hacerle esperar 12s de más por una decisión que puede tomar él mismo.

## Validación
- 6 tests nuevos (`tests/whatsapp-bridge-retry.test.js`) sobre `isTransientBridgeError` — sigue el mismo patrón que ya usa el repo para esto (probar la lógica pura exportada en `__private`, sin montar un servidor falso en el puerto 3031 del bridge real).
- **Validación en vivo real**: paré el bridge (`launchctl bootout`), lancé `bridgeFetchWithRetry('GET','/status', ...)` contra el bridge caído, y lo levanté a mitad de la primera espera. El reintento recuperó `{"status":"ready"}` en vez de morir en el primer intento — reproduce exactamente la ventana del incidente real.
- Suite completa: 606 tests (600 pass / 0 fail). Redeploy hecho.

## Nota sobre el chat afectado
Corrección de Luismi: el mensaje fue de **Noa**, no de Isabel. Confirmado también por Luismi: el chat volvió a AUTO porque **él mismo** lo tocó investigando — no fue el sistema, tal como se sospechaba. El mensaje "tengo un problema con mi bateria" sigue sin respuesta en el historial — no se reintenta retroactivamente, hay que responderlo a mano o esperar a que reescriba.

## Seguimiento: "tengo un problema con mi batería" es vago PERO va a ser muy común
Feedback de Luismi tras el incidente: mensajes vagos-pero-relacionados con un tema de las fichas van a ser el pan de cada día, no una excepción. Escalar directo sin preguntar nada pierde el caso más frecuente. Ver [[kb_whatsapp_2026_08_02]] para el diseño del paso de aclaración añadido a raíz de esto.

## Regla dura derivada
Cualquier envío automático nuevo del bot (no iniciado por Luismi) debe pasar por `bridgeFetchWithRetry`, no por `bridgeFetch` a pelo — el bridge Baileys reconecta solo periódicamente y esa ventana es inevitable.
