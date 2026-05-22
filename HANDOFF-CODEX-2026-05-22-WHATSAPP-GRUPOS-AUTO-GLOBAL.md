# HANDOFF CODEX · 2026-05-22 · WhatsApp grupos MANUAL + botón AUTO global

## Estado de cierre
- Fecha: 2026-05-22
- Rama: `main`
- Commit: `2d83a00` (`feat(whatsapp): force manual in groups and add global all-auto control`)
- Push: `origin/main` actualizado
- App desplegada: `/Applications/POWER-AGENT.app`
- `app.asar` desplegado: `May 22 14:30:44 2026`
- Tests: `npm test` => 107 total / 94 pass / 0 fail / 13 skip

## Qué se cambió

### 1) Grupos siempre MANUAL (coherencia backend + UI)
Antes: el backend no auto-respondía en grupos, pero algunos grupos podían aparecer/togglearse en AUTO en UI.

Ahora:
- `whatsapp-client` fuerza grupos a `mode='manual'` en:
  - carga de estado (`loadState`)
  - creación de chat (`ensureChat`)
  - ingestión de mensajes de grupo (`handleIncoming`)
  - cambios de modo (`setMode`)
- Si se intenta `setMode(..., 'auto')` en grupo, devuelve `ok` pero aplica `manual` (`fixed: true`).
- En UI, el switch de modo de grupos se ve deshabilitado y con nota explícita:
  - "Grupo: siempre MANUAL (Claude no auto-responde en grupos)".

Archivos:
- `whatsapp/whatsapp-client.js`
- `whatsapp/whatsapp-panel.js`

### 2) Botón global "AUTO TODO" (solo chats individuales)
Se añadió un control en cabecera que pone en AUTO todos los chats no-grupo, independientemente de su toggle local.

Comportamiento:
- Recorre todos los chats:
  - grupos: se mantienen/normalizan en MANUAL
  - individuales: fuerza `mode='auto'` y limpia escalados
- Devuelve resumen (`changed`, `totalIndividual`) y la UI muestra confirmación.

Archivos:
- `whatsapp/whatsapp-client.js` (`setAllIndividualChatsAuto`)
- `main/whatsapp-ipc.js` (`whatsapp:set-mode-all-auto`)
- `preload.js` + `whatsapp-window-preload.js` (`wa.setAllAuto()`)
- `whatsapp/whatsapp-panel.js` (botón `#wa-btn-all-auto` + handler)

## Verificación funcional rápida
1. Abrir panel WA y entrar en un grupo.
2. Confirmar que el switch aparece bloqueado y la nota dice que en grupos siempre es MANUAL.
3. Poner varios chats individuales en MANUAL.
4. Pulsar `AUTO TODO` en cabecera.
5. Confirmar que los individuales pasan a AUTO y los grupos siguen en MANUAL.

## Comandos ejecutados
```bash
node --check whatsapp/whatsapp-client.js
node --check whatsapp/whatsapp-panel.js
node --check main/whatsapp-ipc.js
node --check preload.js
node --check whatsapp-window-preload.js
npm test
npm run deploy
```

## Riesgos conocidos
- No se añadieron tests unitarios específicos del nuevo endpoint bulk (`setAllIndividualChatsAuto`) por acoplamiento de estado en `createWhatsAppClient`; validación hecha vía smoke + tests globales.

## Pendiente (modo empresa)
- Definir e implementar modelo de políticas jerárquicas para auto-respuesta orientado a operación empresarial:
  - Kill switch global (ON/OFF) con prioridad máxima.
  - Política por tipo de chat (individual/grupo) y segmentos (VIP, incidencias, etc.).
  - Override por chat con trazabilidad y expiración opcional.
  - `AUTO TODO` acotado por política y no por fuerza bruta sobre todo.
  - Auditoría de cambios (quién/cuándo/por qué) para soporte y cumplimiento.
