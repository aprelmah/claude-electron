# HANDOFF · 2026-05-18 · Chat latency + Telegram relay + deploy

## Contexto
- Usuario reportó:
  - Interacción del chat confusa/con retraso.
  - No quería `headless` ni perder flujo de interfaz.
  - Duplicación visual al hacer scroll en terminal (banner repetido).
- Además había confusión de binario activo: se estaba abriendo una build antigua con botón `RAW`.

## Objetivo de esta ronda
- Mantener UI completa (sin modo RAW).
- Mantener relay Telegram sin romper flujo local.
- Reducir carga periódica del renderer/main.
- Dejar app desplegada y trazabilidad clara para siguiente agente.

## Cambios aplicados

### 1) PTY local siempre visible durante relay Telegram
- Archivo: `main.js`
- Cambio: en `proc.onData`, ahora siempre se envía `pty-data` a la ventana local aunque Telegram esté en relay activo.
- Motivo: evitar “terminal ciego” mientras Telegram está enlazado.

### 2) Aviso de bloqueo cuando Telegram tiene la sesión ocupada
- Archivos: `main.js`, `preload.js`, `renderer.js`
- Cambio:
  - `ipcMain.on('pty-input')` bloquea input local si `relayActive` y emite evento `pty-busy` con throttle.
  - `preload` expone `onPtyBusy`.
  - `renderer` muestra status warning breve.
- Motivo: feedback claro al usuario cuando Telegram controla la PTY.

### 3) Menos carga por polling y metadata de sesión
- Archivos: `main.js`, `renderer.js`
- Cambio:
  - Caché LRU simple para títulos Claude en `readClaudeSessionTitle`:
    - `claudeSessionTitleCache`
    - invalidación al borrar sesión
    - actualización al editar título
  - Helper `resolveSessionIdForRelay(session)` para evitar cálculos más pesados en checks de Telegram.
  - Polling más espaciado:
    - `refreshSendTelegramButton`: `4000ms -> 6500ms`
    - `refreshSessionStrip`: `3500ms -> 6000ms`
- Motivo: reducir trabajo síncrono frecuente en hot path de UI.

### 4) Fix de duplicado por scroll
- Archivo: `renderer.js`
- Se probó un buffer de render PTY temporal y se revirtió.
- Estado final: `window.api.onPtyData((chunk) => term.write(chunk))` (render directo).
- Motivo: el buffer introducía duplicación visual del contenido al scrollear.

## Estado RAW
- El modo RAW fue retirado del código activo.
- Verificado en app instalada (`app.asar`): no aparecen `RAW PTY`, `btn-raw-pty`, `setRawPtyMode`.

## Deploy realizado
- Fecha: **2026-05-18** (Europe/Madrid), ~15:59.
- Comando: `npm run deploy`
- Destino: `/Applications/POWER-AGENT.app`
- Verificación:
  - `/Users/isabel/Desktop/POWER-AGENT.app` es symlink a `/Applications/POWER-AGENT.app`.
  - `stat` de `app.asar` coincide en Desktop/Applications.
- Arranque limpio realizado:
  - cierre de instancias previas
  - apertura de `/Applications/POWER-AGENT.app`

## Validación ejecutada
- `node --check main.js preload.js renderer.js` OK.
- Deploy finalizado con éxito (`✅ POWER-AGENT instalado y abierto...`).

## Estado actual reportado por usuario
- Duplicación por scroll: **resuelta** tras revertir buffer PTY.
- Rendimiento: usuario indica que aún se siente **lento** (“lentísimo”), en observación.

## Riesgo / hipótesis de lentitud restante
- Posible latencia residual por:
  - carga del grafo/árbol cuando hay muchos eventos FS,
  - trabajo síncrono de filesystem en `main` bajo proyectos grandes,
  - coste del propio CLI (Claude Code) y su output.

## Próximo plan recomendado (siguiente agente)
1. Instrumentar latencia end-to-end de input->echo->output en PTY (timestamps en `main` y `renderer`).
2. Medir frecuencia real de `tree-changed`/`graph:file-active` en sesión típica.
3. Añadir sampling de duración en:
   - `buildCurrentSessionMeta`
   - `readClaudeSessionTitle`
   - `sidebar:get-graph` (si vista grafo activa).
4. Si hay picos:
   - mover lecturas caras a cache con invalidación por mtime,
   - bajar aún más polling no crítico,
   - degradar refresco de grafo cuando terminal tiene actividad intensa.

## Archivos tocados en esta ronda
- `main.js`
- `preload.js`
- `renderer.js`
- `HANDOFF-CLAUDE-2026-05-18-CHAT-LATENCY.md` (este archivo)

