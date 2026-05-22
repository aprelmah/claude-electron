# Hardening WhatsApp Bridge — auth token + rate limit + media sandbox

Fecha: 2026-05-22
Autor: agente (Opus 1M)
Worktree: `worktree-agent-ad5ab45a4eca134cd`

## Modelo de amenaza

Antes de este cambio, el bridge WhatsApp (`~/.claude/whatsapp-bridge/index.js`)
ejecutaba un servidor HTTP en `127.0.0.1:3031` **sin autenticación**. Cualquier
proceso local con acceso a loopback podía:

1. **Suplantar al usuario**: `POST /send/text` para enviar WhatsApp a contactos
   reales sin que Luismi lo viera.
2. **Exfiltrar conversaciones**: `GET /messages` devuelve el inbox con texto,
   metadatos y rutas a media descargada.
3. **Borrar la cola**: `DELETE /messages` vacía el inbox sin notificación.
4. **Provocar denegación**: spam de `POST /send/*` (Baileys puede tirar la
   sesión por rate limit de WhatsApp).
5. **Re-emparejar dispositivo**: `GET /qr` expone el QR de pairing.

Vector real: cualquier proceso del usuario en `127.0.0.1` (otra app Electron
local, script malicioso descargado, una pestaña con `fetch('http://127.0.0.1:3031/messages')`
sortendo CORS si el bridge lo permite, etc.). Localhost ≠ confianza.

Además, los handlers IPC `whatsapp:send-image|audio|document` aceptaban un
`filePath` arbitrario del renderer. Un XSS en el panel WhatsApp permitía
exfiltrar archivos sensibles del disco enviándolos como adjunto WhatsApp a un
número controlado por el atacante (p.ej. `~/.ssh/id_rsa`).

## Diseño del token

### Generación y persistencia
- Archivo: `~/.claude/whatsapp-bridge/.auth-token`
- Contenido: 32 bytes aleatorios → hex (64 chars), validados con `/^[a-f0-9]+$/i`.
- Permisos: `0o600` (solo usuario). Atomic write (`tmp + rename`).
- Generación: al arrancar el bridge (`auth.js` → `ensureToken()`).
  - Si el archivo no existe → genera nuevo.
  - Si existe y es válido → reutiliza (idempotente).
  - Si existe pero está corrupto/corto → regenera.

### Validación
- Header: `X-Auth-Token: <token>` en **todas** las peticiones HTTP del cliente.
- Bridge: middleware Express (`makeAuthMiddleware`) valida:
  - **Sin header** → `401 Missing X-Auth-Token`.
  - **Header mismatch** → `401 Invalid X-Auth-Token` + log enmascarado.
  - **Server sin token cargado** → `503 Bridge auth not initialized`.
- Comparación con `crypto.timingSafeEqual` (paranoia: localhost, pero coste cero).

### Migración suave (cliente legacy ↔ bridge nuevo, bridge legacy ↔ cliente nuevo)
- **Cliente nuevo, bridge legacy**: el bridge legacy ignora `X-Auth-Token` y
  responde 200. Sin pérdida de funcionalidad.
- **Cliente legacy, bridge nuevo**: el bridge responde 401. El cliente legacy
  no se recupera, pero un `pkill` + relanzar la app instala el cliente nuevo.
  En la práctica, ambos cambios se despliegan juntos.
- **Cliente nuevo, bridge nuevo, primer arranque**:
  1. Bridge arranca → genera token en disco.
  2. Cliente arranca → lee token en `start()`.
  3. Si el cliente arranca antes que el bridge, su primer fetch falla con
     conexión rehusada (no 401) y entra en backoff hasta que el bridge sube.
  4. Si el bridge regenera el token mientras el cliente corre (poco común),
     el cliente recibe 401, relee el archivo y reintenta una sola vez.

## Rate limit

Sliding window in-memory, agrupado por ruta:

| Bucket       | Límite (req/min) | Justificación                                  |
|--------------|------------------|------------------------------------------------|
| `/send/*`    | 30               | Envíos reales caros en Baileys                 |
| `/messages`  | 600              | Polling cliente 1.5s ⇒ 40 req/min con holgura  |
| resto        | 60               | `/status`, `/qr`, etc.                         |

Al exceder: `429 Rate limit exceeded` + header `Retry-After` en segundos.
Defensa local: procesos en bucle, no ataques distribuidos (no aplica).

## Sandbox IPC restante en cliente

Añadido `isMediaInputSafe()` en `main.js` para `whatsapp:send-image|audio|document`:
- Acepta `data:` URLs (base64 inline, no toca FS).
- Para rutas reales, exige `isPathSafe(p, allowedFsRoots())`.
- Roots permitidos ya incluyen: cwd activo, `userData`, `~/.claude`, `~/.codex`,
  `TMP_DIR`, `WA_MEDIA_DIR`.
- Deny: `~/.ssh`, `~/Library/Keychains`, `~/Library/Cookies`.

`whatsapp:save-config` sigue restringiendo a `WA_SAFE_CONFIG_FIELDS`
(`autoReply`, `authorizedNumbers`, `ownerNumber`, `maxHistory`, `model`,
`effort`, `handoverOnFromMe`). `claudePath` y `personaPath` siguen bloqueados.

## Logging

`makeAuthMiddleware` y `makeRateLimiter` loguean a `logger.warn` (por defecto
`console`). El token NUNCA se loguea completo:

```
[bridge-auth] token mismatch (got tok=abcd...wxyz, want tok=1234...5678) on POST /send/text
```

`maskToken()` muestra primeros y últimos 4 chars; nunca el cuerpo central.

## Cómo verificar manualmente

Requiere que el bridge esté corriendo (`launchctl list | grep whatsapp`).

```bash
# 1. Sin token → 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3031/status
# Esperado: 401

# 2. Token incorrecto → 401
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Auth-Token: badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad" \
  http://127.0.0.1:3031/status
# Esperado: 401

# 3. Token correcto → 200
TOKEN=$(cat ~/.claude/whatsapp-bridge/.auth-token)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Auth-Token: $TOKEN" \
  http://127.0.0.1:3031/status
# Esperado: 200

# 4. Rate limit en /send/* (30/min) — manda 35
TOKEN=$(cat ~/.claude/whatsapp-bridge/.auth-token)
for i in $(seq 1 35); do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST -H "X-Auth-Token: $TOKEN" -H "Content-Type: application/json" \
    -d '{"to":"34000000000@s.whatsapp.net","message":"test"}' \
    http://127.0.0.1:3031/send/text)
  echo "$i: $code"
done
# Esperado: primeras ~30 con 503 (no listo) o 200, luego 429.

# 5. Permisos del archivo de token
stat -f "%Sp %N" ~/.claude/whatsapp-bridge/.auth-token
# Esperado: -rw-------

# 6. Probar regeneración: borrar y reiniciar bridge
rm ~/.claude/whatsapp-bridge/.auth-token
launchctl kickstart -k gui/$(id -u)/com.luismi.whatsapp-bridge  # o equivalente
cat ~/.claude/whatsapp-bridge/.auth-token  # debe existir y ser hex 64
```

## Test plan

- [x] Test unitario: `ensureToken` genera/respeta token, fija 0600.
- [x] Test unitario: `readToken` devuelve null si no existe o es inválido.
- [x] Test unitario: middleware 401 sin header, 401 mismatch, next() OK, 503 sin server token.
- [x] Test unitario: rate limit deja pasar bajo límite, 429 al exceder, buckets independientes.
- [x] Test unitario: rotación de token + middleware acepta el nuevo.
- [x] Test integración: cliente `bridgeFetch` reintenta tras 401 releyendo disco
      (cubierto vía contrato del módulo).
- [ ] Test manual con bridge en vivo: pendiente despliegue.

## Riesgos

1. **Bridge no se reinicia con el cliente nuevo**: si Luismi tiene un bridge
   legacy corriendo y arranca POWER-AGENT con el cliente nuevo, el bridge
   responderá 200 a cualquier petición (sin token). El cliente nuevo enviará el
   header, pero el bridge lo ignorará: funciona, pero sin protección. Migración:
   `launchctl kickstart -k gui/$(id -u)/com.luismi.whatsapp-bridge` tras
   desplegar para que cargue `auth.js`.

2. **Token leakeado a procesos del mismo usuario**: cualquier proceso con UID
   del usuario puede leer `~/.claude/whatsapp-bridge/.auth-token`. Esto es
   inherente al modelo (no es un secreto del sistema, es un secreto del
   usuario). Mitigación: 0600 evita lectura por otros usuarios, y el sandbox
   de Electron del propio main process no expone el token al renderer (la
   API renderer→main pasa por IPC y nunca devuelve el token).

3. **Token persistido sin TTL ni rotación automática**: rotación manual
   requiere borrar el archivo y reiniciar bridge + cliente. Aceptable para el
   modelo actual; si en futuro se quiere rotación automática, basta con
   añadir un timer en el bridge que llame `ensureToken({ forceRegenerate: true })`
   y el cliente lo descubrirá en su siguiente 401 retry.

## Archivos modificados

### En el repo (`/Users/isabel/Desktop/LUISMI/claude-electron/.claude/worktrees/agent-ad5ab45a4eca134cd/`)
- `whatsapp/whatsapp-auth.js` (NUEVO, 164 LOC)
- `whatsapp/whatsapp-client.js` (+71 / −13 LOC aprox)
- `main.js` (+9 / −3 LOC aprox)
- `tests/whatsapp-auth-token.test.js` (NUEVO, 28 tests)
- `HARDENING-WA-AUTH.md` (este archivo)

### En el bridge externo (`~/.claude/whatsapp-bridge/`)
- `auth.js` (NUEVO, 120 LOC, ESM — gemelo del módulo CJS del repo)
- `index.js` (+18 / −0 LOC aprox; import + middleware)

El bridge no es repo git → cambios se aplican in-place. Backup automático del
`index.js` original ya existe (`index.js.bak.20260521-152744`).
</content>
</invoke>