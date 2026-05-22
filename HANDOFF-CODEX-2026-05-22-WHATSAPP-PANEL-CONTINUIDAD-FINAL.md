# HANDOFF CODEX · 2026-05-22 · WhatsApp Panel Continuidad Final

Documento de continuidad para que cualquier agente (Codex/Claude) y cualquier operador humano pueda retomar mañana sin contexto previo.

---

## 1) Estado al cerrar

- **Fecha cierre:** 2026-05-22 13:56 CEST
- **Rama:** `main`
- **HEAD:** `12abfa8`
- **Remoto:** `origin/main` actualizado
- **Estado git:** limpio (`git status` sin cambios)
- **Versión app:** `1.3.0`
- **App desplegada:** `/Applications/POWER-AGENT.app`
- **`app.asar` desplegado:** `May 22 13:53:15 2026`
- **Bridge WhatsApp HTTP:** `{"status":"ready"}` con `X-Auth-Token`
- **Tests:** `npm test` => 107 total / 94 pass / 0 fail / 13 skip

---

## 2) Commits de esta continuidad WhatsApp (en orden)

1. `6b71e66` · `feat(whatsapp): add bridge emergency control and polish labels`
2. `763faa1` · `fix(whatsapp): live QR refresh, stable bridge toggle, and media download`
3. `12abfa8` · `fix(whatsapp): honor global auto-reply off for queued replies and typing UI`

Base funcional previa importante:
- `9a29473` · `fix(whatsapp): normalize jid identity for groups/lid and harden panel labels`

---

## 3) Qué quedó resuelto exactamente

### A) Botón de emergencia bridge `STOP/START`

Problema reportado: al pulsar `STOP/START` el estado no siempre se reflejaba al momento y parecía exigir refresco de ventana.

Solución:
- IPC nuevo de control/estado bridge con `launchctl`.
- UI con estado visual `STOP/START` y espera activa (settling) post acción.
- Refresco corto automático para no depender de F5.

Archivos:
- `main/whatsapp-ipc.js`
- `whatsapp/whatsapp-panel.js`
- `preload.js`
- `whatsapp-window-preload.js`
- `main.js` (inyección de `dialog`/`winFromEvent` al registro IPC)

### B) Modal QR que “nunca funciona”

Problema reportado: modal mostraba “sin QR pendiente” y se quedaba estático.

Solución:
- Polling del QR cada 2s mientras modal abierto.
- Botón manual `Reintentar`.
- Mensajes de estado explícitos:
  - conectado (no hay QR por diseño),
  - QR pendiente,
  - no hay QR activo.
- Cierre de modal limpia timers.

Archivo principal:
- `whatsapp/whatsapp-panel.js`

### C) Descargar media desde visor

Problema reportado: se podía ampliar imagen pero no descargar.

Solución:
- Botón `Descargar` en visor de imagen.
- IPC `whatsapp:save-media-as` que copia desde `wa-media://` a ruta elegida con `showSaveDialog`.

Archivos:
- `main/whatsapp-ipc.js`
- `preload.js`
- `whatsapp-window-preload.js`
- `whatsapp/whatsapp-panel.js`

### D) Auto-reply global desactivado, pero “Claude lo intenta”

Problema real detectado:
- Había una ventana de carrera: respuestas ya en cola podían terminar saliendo aunque se apagara `autoReply`.
- Además la UI podía mostrar `Claude escribiendo…` en modo `AUTO` aunque el global estuviera OFF.

Solución aplicada:
- **Backend**: control por epoch (`autoReplyEpoch`) para invalidar colas previas al apagar global.
- `respondTo` vuelve a validar condiciones justo antes de generar y justo antes de enviar.
- **UI**: typing indicator solo si `status.autoReply !== false`; limpieza total de typing al apagar global.

Archivos:
- `whatsapp/whatsapp-client.js`
- `whatsapp/whatsapp-panel.js`

---

## 4) Cambios fuera del repo (CRÍTICO)

Además del código versionado, se tocaron archivos del bridge externo (no git del proyecto):

Ruta:
- `~/.claude/whatsapp-bridge/index.js`

Cambios funcionales allí:
- Humanización de menciones (`@id` -> nombre/teléfono cuando posible).
- Mejor resolución de identidad para grupos/LID/PN.
- Fallback de metadata de grupo.
- No filtrar envíos API cuando la app necesita observar `fromMe`.

Backups generados:
- `/Users/isabel/.claude/whatsapp-bridge/index.js.bak.pre-wa-panel-fix.20260522-123609`
- `/Users/isabel/.claude/whatsapp-bridge/index.js.bak.mentions-fix.20260522-125349`
- (y backups previos del mismo directorio)

Migración de estado histórico (menciones):
- Backup de state:
  - `/Users/isabel/.claude/whatsapp-bridge/state.json.bak.mentions-migrate.2026-05-22T110150`

Nota:
- Estos cambios NO viven en el repo `claude-electron`. Si mañana se reinstala/limpia ese bridge externo, habrá que revalidarlos o reaplicarlos.

---

## 5) Validación funcional mínima para mañana

1. **Auto-reply global OFF**
- En config WA, desmarcar `Auto-respuesta global activada` y guardar.
- En un chat en `AUTO`, enviar mensaje desde móvil.
- Esperado:
  - no aparece `Claude escribiendo…`
  - no sale respuesta automática.

2. **Bridge emergency**
- Pulsar `STOP`.
- Esperado: botón cambia a `START` sin refrescar manualmente.
- Pulsar `START`.
- Esperado: vuelve a `STOP`; estado de cabecera se normaliza solo.

3. **QR modal**
- Abrir `Vincular WhatsApp`.
- Esperado:
  - contenido cambia solo cada ~2s,
  - botón `Reintentar` funciona,
  - si está conectado, muestra texto explicativo (sin QR activo por diseño).

4. **Descarga media**
- Abrir imagen en chat -> visor.
- Pulsar `Descargar`.
- Esperado: diálogo de guardar, archivo copiado en ruta elegida.

---

## 6) Comandos útiles de continuidad

```bash
cd /Users/isabel/Desktop/LUISMI/claude-electron

git log --oneline -n 12
npm test
npm run deploy
npm run doctor
```

Bridge status con token:

```bash
TOKEN=$(cat ~/.claude/whatsapp-bridge/.auth-token)
curl -sS -H "X-Auth-Token: $TOKEN" http://127.0.0.1:3031/status
```

---

## 7) Riesgos / notas abiertas

- Si WhatsApp ya está vinculado, no habrá QR pendiente (comportamiento normal). El modal ahora lo explica, pero conviene recordarlo al usuario.
- `launchctl list` desde shells no-GUI puede no reflejar igual que el dominio de usuario gráfico; usar `/status` HTTP autenticado como fuente operativa.
- No hay tests automatizados dedicados aún para:
  - epoch de colas en `autoReply OFF`,
  - flujo UI del modal QR,
  - descarga `save-media-as`.
  Recomendado añadirlos si se vuelve a tocar este módulo.

---

## 8) Archivos modificados en esta continuidad

- `main.js`
- `main/whatsapp-ipc.js`
- `preload.js`
- `whatsapp-window-preload.js`
- `whatsapp/whatsapp-panel.js`
- `whatsapp/whatsapp-client.js`

---

## 9) Decisión operativa

Estado recomendado para mañana:
- Mantener esta base (`12abfa8`) como punto de continuidad.
- Si se abre nueva tanda de cambios WA, empezar por este handoff + `HARDENING-WA-AUTH.md` + `HANDOFF-CLAUDE-2026-05-22-OLA1-2-RELEASE-1.3.0.md`.

