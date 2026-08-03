# Revisión multi-agente del pipeline KB: 15 defectos, todos cerrados

_2026-08-03. `/code-review` en xhigh sobre los 4 commits sin pushear del día anterior._

69 candidatos → 61 verificados → 8 refutados → **15 defectos distintos**, todos en el pipeline de la KB de WhatsApp recién escrito. Cerrados en 5 commits. **No reabrir sin leer esto.**

## Los que llegaban al cliente o destruían datos — `4cd89eb`

| # | Defecto | Fix |
|---|---|---|
| 1 | `verifyGroundedReply` quitaba **solo el último** `[KB:id]`; el modelo cita la ficha también inline y ese marcador se enviaba al cliente | Se quitan todos, se limpia la puntuación que dejan |
| 2 | Un alta de ficha **borraba otra**: dos títulos que slugifican al mismo id (o comparten los 64 primeros caracteres) | `saveKbCard` acepta `{overwrite}`; alta no pisa, edición sí |
| 3 | El reintento **duplicaba mensajes**: `/send/text` no es idempotente y se reintentaba ante cualquier 5xx | `isSafeToResend`: solo 503 (el bridge corta antes de enviar) y ECONNREFUSED/EHOSTUNREACH/ENOTFOUND |
| 4 | **Guardar el modal resucitaba el bot** apagado por el kill switch de auth: `saveConfig` mergeaba desde DISCO, no desde memoria | `updateConfig` mergea sobre la config en memoria; `authErrorReported` se rearma al encender |

## Fail-safes que no cumplían su promesa — `3a6a868`

- **`kbMode: strict` fallaba ABIERTO**: con la KB ilegible caía a la persona libre e inventaba. Ahora se distingue "nunca hubo KB" (`kb/` no existe → persona libre) de "la KB se rompió" (`kb/` existe sin fichas → escalar).
- El `catch` del pipeline **enviaba sin mirar el kill switch**. `escalateToHuman` acepta `notifyCustomer:false`.
- `sanitizeAutoReplyText` aplastaba los saltos → los pasos numerados llegaban como parrafada. Ahora colapsa solo espacios dentro de cada línea; la moderación sigue viendo el texto en una línea (un `\n` no cuela un insulto partido).

## Estado y escaladas — `3c5466c`

- Un fallo interno (timeout del selector, spawn caído) dejaba el chat en manual **para siempre**: todo pasaba por `escalationReason:'user'`, que el sweep nunca toca. Nuevo `'error'` con TTL de 10 min que sí se revierte.
- `loadState` tiraba `kbActive`/`kbClarify` al arrancar aunque `persistState` sí los escribía. Se restauran validando forma y TTL.

## Los cinco restantes — `7145789`

Editor que borraba secciones no modeladas al guardar · regex JSON perezosa del selector rota con objetos anidados · fichas con nombre de fichero ≠ id inabribles e imborrables · contador de aclaración gastado sin enviar · `kb-audit.jsonl` sin rotación y en 0644 con PII (ahora rota a 5 MB, 0600, verificado en disco).

## Trade-off de producto — `3913eca`

Ventana de agrupación **4-8 s → 7-12 s**. Con 4 s de suelo, una ráfaga con la pausa normal de redacción se partía en dos turnos y el cliente recibía dos mensajes por una idea. Sigue sin valor fijo: eso fue lo que Luismi detectó como el patrón más delator del pipeline.

## Reglas que salen de aquí

- **El marcador `[KB:id]` es un control de calidad anti-alucinación, NO una barrera de seguridad.** `verifyGroundedReply` comprueba que exista y esté permitido; no compara la respuesta con la ficha. Hoy no expone nada porque las fichas son contenido de cara al cliente. **Si la KB llega a tener notas internas (márgenes, condiciones de proveedor), esa premisa se invierte.**
- `/send/text` **no es idempotente**. Solo se reintenta cuando consta que el mensaje no salió; ante la duda, se abandona: un duplicado al cliente es peor que un mensaje perdido.
- Borrar la última ficha **silencia al bot** (escala todo). Consecuencia buscada de strict fail-closed, pero el texto del confirm al borrar no lo dice.

## Cobertura real

Tests 612 → 657 en estos 5 commits. Lo de flujo (strict fail-closed, TTL de error, kill switch en el catch, contador de aclaración) está verificado **por lectura y por tests de sus primitivas, no por un turno real**. Cuatro arreglos sí se verificaron conduciendo la app por CDP (ver `tech/tech_pilotar_app_por_cdp.md`).
