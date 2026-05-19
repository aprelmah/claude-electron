# HANDOFF — 2026-05-19 (mañana) — WhatsApp auto-reply roto post update CLI

## Contexto rápido para el siguiente agente

Esta sesión arrancó porque Luismi vio que **WhatsApp respondía "Recibido. Te responde Luismi en breve." a TODOS los mensajes** (audio y texto). Ese es el `AUTO_REPLY_FALLBACK_TEXT` que la app envía cuando el `runClaudePersona` lanza excepción o el sanitizer bloquea por tono tóxico.

**Causa raíz confirmada**: `~/.local/bin/claude` se actualizó hoy 03:01 a `versions/2.1.144`. El flag `--bare` que usábamos en `whatsapp/whatsapp-auto-reply.js` ya no es compatible con OAuth Max de Luismi.

Cita literal del help del CLI:

> `--bare` … Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings` (OAuth and keychain are never read).

Sin API key exportada, `claude -p --bare` devolvía `"Not logged in · Please run /login"` y `exit 1` → catch en `respondTo()` → fallback "Recibido…".

## Fix aplicado

`whatsapp/whatsapp-auto-reply.js`: eliminado `'--bare'` del array de args. Se mantiene la garantía dura de seguridad (`--tools ""` desactiva ejecución de TODOS los tools), más `--system-prompt`, `--output-format text`, `--no-session-persistence`.

Comentario en el código:

```js
// NOTA: NO usar --bare con claude >=2.1.144 — fuerza ANTHROPIC_API_KEY e
// ignora la sesión OAuth (Max). Sin clave de API, sale "Not logged in".
```

Trade-off honesto: pierde aislamiento de hooks/plugins/auto-memory del CLI, pero como `--tools ""` impide ejecutar nada, no es un agujero de seguridad real. Auto-memory podría inyectar contexto extra al prompt, pero la persona fija y los delimitadores XML del `buildPrompt()` siguen blindando contra prompt-injection.

## Segundo problema descubierto en la misma sesión

**Audios entrantes no se transcribían automáticamente.** El botón "Transcribir" del panel sí funcionaba (acción manual del usuario), pero el flujo automático en `respondTo()` caía al placeholder `'[Audio del cliente, sin transcripción disponible]'` y Claude respondía a ciegas.

Después de añadir un log de debug a `/tmp/wa-debug.log` y redeploy LIMPIO, se vio que `transcribeAudio` SÍ funcionaba ("A ver si me escuchas ahora te voy a dar una palabra clave. Cerezas." en 6s).

Conclusión: el deploy anterior **no había recargado el código**. `npm run deploy` mata el proceso principal pero **NO mata los Helpers de Electron**. El proceso WhatsApp vivía en uno de los Helpers con código viejo cargado en memoria.

**Regla nueva validada y guardada en memoria**: antes de cualquier `npm run deploy` que toque `whatsapp/*.js` o `main.js`, ejecutar:

```bash
pkill -9 -f "POWER-AGENT.app/Contents/MacOS/POWER-AGENT"
pkill -9 -f "POWER-AGENT Helper"
sleep 2
```

Solo entonces `npm run deploy`. Sin esto, el código nuevo NO se aplica aunque el `app.asar` cambie de timestamp.

## Estado al cerrar sesión

- `whatsapp/whatsapp-auto-reply.js` modificado (1 archivo, +2/-2).
- App desplegada en `/Applications/POWER-AGENT.app` con app.asar actualizado.
- Verificado por Luismi: el bot responde correctamente a audios (transcripción + persona) y a textos.
- Repo: rama `main`, 2 commits por delante de `origin/main` (los handoffs antiguos + nuevo commit de este fix).
- Branch limpia de cambios no comiteados tras este commit.

## Reglas validadas — añadidas a `MEMORY.md`

1. **NO usar `--bare` con claude CLI >=2.1.144** con cuenta OAuth Max. La regla anterior ("DEBE ir con `--bare`") quedó obsoleta.
2. **`npm run deploy` no recarga el código si los Helpers de Electron siguen vivos**. Matar también con `pkill -9 -f "POWER-AGENT Helper"` antes de redeploy.
3. **`console.error` en Electron empaquetado va a NSLog/syslog**, no a stderr capturado. Para debug, usar `fs.appendFileSync('/tmp/wa-debug.log', ...)` puntualmente.
4. **Hand-over `fromMe → mode='manual'` funciona también con texto desde el panel** (no solo desde móvil). Si un chat para de responder, primero mirar el toggle AUTO|MANUAL del header.

## Pendiente opcional (no urgente)

- Tests unitarios para verificar que `runClaudePersona` invoca claude con flags válidos en runtime (smoke test que detecte regresiones tipo "Not logged in" automáticamente).
- Considerar fallback inteligente: si claude exit ≠ 0, intentar 1 reintento sin `--bare` antes de mandar el `AUTO_REPLY_FALLBACK_TEXT`. Hoy va directo a fallback en cualquier error.
- Errores `MessageCounterError: Key used already or never filled` en `bridge.log` — son ruidosos pero no afectan a la descarga de media. Investigar más adelante si causan pérdida de mensajes.

## Notas para el siguiente agente

- Antes de tocar WhatsApp, lee `MEMORY.md` sección "Update 2026-05-19 — WhatsApp hardening + editor de persona" (ya estaba), MÁS las reglas nuevas que dejo aquí.
- El bridge Baileys está en `~/.claude/whatsapp-bridge/` y lo arranca launchd — NO matar el PID del bridge salvo emergencia.
- La app está empaquetada Intel x64 (este Mac). Para Apple Silicon usar `dist/mac-arm64/`.
- Si Luismi reporta otro fallo de auto-reply, primero leer `/tmp/wa-debug.log` si existe; si no, añadir logging temporal con `fs.appendFileSync` como se hizo en esta sesión.
