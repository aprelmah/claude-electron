# Auditoría de seguridad POWER-AGENT — 2026-06-01

Revisión del `app.asar` instalado (`/Applications/POWER-AGENT.app`) contra los riesgos típicos de "agente remoto". Verificado contra código y puertos en ejecución.

## Estado por riesgo

1. **Lista blanca de remitentes — 🔴 FAIL-OPEN (grave)**
   - WhatsApp SÍ tiene allowlist: campo `authorizedNumbers` en `~/.claude/whatsapp-bridge/config.json`. PERO la lógica es fail-open:
     ```js
     if (isGroupJid(jid)) return true                                   // grupos: SIEMPRE autorizados
     if (!config.authorizedNumbers || !config.authorizedNumbers.length) // lista vacía...
         return true                                                    // ...autoriza a TODOS
     ```
   - **Config real vacía (`{}`)** → `authorizedNumbers` undefined → **autoriza a cualquier remitente**. Y los grupos están siempre autorizados aunque se rellene la lista.
   - Mitigación: poblar `authorizedNumbers` (con el/los números permitidos) en `config.json` o vía UI. Aun así, ojo grupos.
   - Telegram: campo `telegram.allowedUsers` (default `[]`); config real en la store de la app. Verificar en UI que solo tenga el id de Luismi.

2. **bypassPermissions — ⚠️ crítico (confirmado)**
   - Cada sesión se lanza con `--permission-mode bypassPermissions`. El agente remoto puede ejecutar cualquier cosa en el Mac sin pedir permiso. La seguridad depende ENTERA de la allowlist (riesgo 1).

3. **Login vs API key — ✓ bien**
   - Usa OAuth Max (NO `--bare`). Consume del plan, no de API key.

4. **Mensajes largos — ⚠️ menor**
   - Sin troceo a 4096 visible; respuestas largas pueden truncarse en Telegram.

5. **Exposición de red**
   - Bridge WhatsApp `:3031` → solo `127.0.0.1`. ✓
   - LAN server `:9999` (WS, responde `426`) y `:10000` (responde `401`) → en `0.0.0.0` PERO con auth (`isAuthorizedReq`, token Bearer `appConfig.lanServer.authToken`). Aceptable en red de confianza.
   - ⚠️ Ajeno al agente: dev server **Next.js en `:3000`, `0.0.0.0`, SIN auth** (devuelve la web). Probablemente otro proyecto (¿DMWEB?). Atar a `localhost` si no se usa en LAN.

## Auto-reply (responde a la pregunta "¿envía sin avisar?")

- Módulo `whatsapp-auto-reply.js`. Toggle global `autoReply` (`isAutoReplyEnabled` = true salvo `status.autoReply === false`; botón header WhatsApp / `setAllAuto`). Modo por chat `chat.mode` ∈ {`auto`,`manual`}.
- **En modo `auto`, el agente RESPONDE automáticamente a mensajes entrantes SIN avisar ni confirmar.** Solo responde (no inicia conversaciones con terceros por su cuenta).
- Salvaguardas: si Luismi escribe manualmente en un chat → ese chat pasa a `manual` (`changeModeToManual=true` por defecto en `sendText`), dejando de auto-responder. Filtro `TOXIC_REPLY_PATTERNS` (no manda lo que matchee). Si el CLI claude no está disponible, avisa y no responde.
- **Riesgo combinado (1+2+auto)**: sin allowlist, si el auto-reply global está ON, cualquiera que escriba a WhatsApp recibiría respuesta de un agente con `bypassPermissions`. Mitigación: mantener auto-reply OFF salvo en chats concretos, o añadir allowlist de remitentes.

## Nota sobre Claude en sesión (este agente)
- El bridge `POST /send/text` es una tubería tonta: envía a cualquier número, sin filtro de destinatario. La restricción "no enviar sin OK de Luismi" la impone el CLAUDE.md de Claude, NO el bridge. El auto-reply de POWER-AGENT es otro consumidor del bridge que sí envía solo.

## Acciones recomendadas (prioridad)
1. Confirmar Telegram `allowedUsers` = solo Luismi; revisar/limitar a quién auto-responde WhatsApp (o auto-reply OFF por defecto).
2. (Opcional) cerrar `:3000` a `127.0.0.1`.
