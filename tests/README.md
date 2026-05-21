# Tests — POWER-AGENT

Suite mínima de tests para funciones puras críticas. Framework: **`node:test`**
(built-in en Node 16+, cero dependencias). Auditoría 2026-05-19 Fase 1.

## Cómo correr

Desde la **raíz del repo** (no desde el worktree, porque necesitamos los
`node_modules` instalados con `npm install`):

```bash
# Toda la suite
node --test --test-reporter=spec tests/*.test.js

# Un archivo concreto
node --test --test-reporter=spec tests/whatsapp-pure.test.js
node --test --test-reporter=spec tests/scheduler-cron.test.js
node --test --test-reporter=spec tests/path-sandbox.test.js
node --test --test-reporter=spec tests/ws-server-pure.test.js
node --test --test-reporter=spec tests/ws-server-session-acl.test.js
node --test --test-reporter=spec tests/semantic-logger.test.js
node --test --test-reporter=spec tests/enterprise-policy.test.js

# Sólo verificar sintaxis sin ejecutar
node --check tests/whatsapp-pure.test.js
node --check tests/scheduler-cron.test.js
node --check tests/path-sandbox.test.js
node --check tests/ws-server-pure.test.js
node --check tests/ws-server-session-acl.test.js
node --check tests/semantic-logger.test.js
node --check tests/enterprise-policy.test.js
```

> Nota Node 24+: `node --test tests/` (pasar un directorio) falla con
> `MODULE_NOT_FOUND`. Usar el glob `tests/*.test.js` o un archivo concreto.
> Node 16-22: ambas formas funcionan.

## Qué cubre

### `whatsapp-pure.test.js`

Tests directos:

- **`buildPrompt`** (`whatsapp/whatsapp-auto-reply.js:81`) — 9 tests.
  Cubre indirectamente `escapeForXmlData` (función no exportada), ya que
  `buildPrompt` la aplica a `body` y a cada turno del historial. Valida:
  - Escapado de `<` y `>` para neutralizar cierres de etiqueta.
  - `&` NO se escapa (contrato actual; el test fallará si cambia).
  - Unicode (acentos, ñ, emoji) intacto.
  - Historial escapado igual que el mensaje actual.
  - Intentos de prompt-injection (cerrar `<mensaje_cliente_actual>` para
    inyectar `<instruccion>`) quedan neutralizados.
  - Respeta `maxHistory`.
  - Incluye la instrucción anti-inyección fija al modelo.

### `scheduler-cron.test.js`

- **`TaskScheduler.validateCron`** (`scheduler/index.js:48`) — 23 tests.
  Instancia el scheduler con persistence/executor mockeados (`validateCron`
  no toca nada externo) y valida:
  - 7 expresiones cron válidas comunes.
  - 7 expresiones inválidas (rangos fuera, texto, formato incorrecto).
  - 6 tipos de entrada no-string (vacío, null, undefined, número, objeto).
  - Preview de próximas 3 ejecuciones en ISO 8601 ordenado.
  - No muta el estado interno del scheduler.

### `path-sandbox.test.js`

- **`isPathSafe`** (`main/path-sandbox.js`) — ACL de rutas:
  - Ruta dentro de root permitido.
  - Root exacto permitido.
  - Rechazo sin `allowedRoots`.
  - Rechazo de path traversal (`..`) fuera de root.
  - Prioridad de `DENY_ROOTS` sobre allowlist amplia.
  - TODO explícito para hardening de symlink-escape vía `realpath`.
- **`isValidSessionId`**:
  - UUID válido (minúsculas/mayúsculas).
  - IDs inválidos (mal formato/falsy).

### `ws-server-pure.test.js`

- **`clampLanPort`** (`main/ws-server.js`):
  - Default en inputs inválidos.
  - Clamp min (1024) y max (65534).
  - Aceptación de puertos válidos.
- **`pickLanIPv4`**:
  - Prioriza privada sobre pública.
  - Fallback a pública si no hay privada.
  - Ignora IPv6/internal.
  - Fallback final `127.0.0.1`.

### `ws-server-session-acl.test.js`

- Levanta `createLanWsServer` real con policy enterprise mock por sesión.
- Verifica handshake + contexto efectivo (`operatorId/roleId/profileId/MCP`).
- Verifica enforcement ACL:
  - `fs:list` dentro de root permitido => OK.
  - `fs:read` dentro de root permitido => OK.
  - `fs:read` fuera de roots => `PATH_OUTSIDE_ALLOWED_ROOTS`.
  - `fs:write` fuera de roots => `PATH_OUTSIDE_ALLOWED_ROOTS`.
- Si el entorno no permite abrir sockets locales (sandbox), se marca `skip`.

### `semantic-logger.test.js`

- **`createSemanticLogger`** (`main/semantic-logger.js`):
  - Normalización de eventos de auditoría empresa.
  - Sanitizado (`detail` sin saltos de línea).
  - Recorte de longitudes (`action/detail/session`).
  - Orden y límite en `readRecent`.
  - Escape CSV correcto para comillas/comas.

### `enterprise-policy.test.js`

- **`normalizeEnterpriseConfig`** (`main/enterprise-policy.js`):
  - Inyección de rol por defecto.
  - Saneado de ids/usernames.
  - Dedupe de roots/MCPs.
  - Filtro de `readOnlyRoots` fuera de `allowedRoots`.
- **`normalizeRemoteContext`**:
  - Normalización de aliases (`operator/profile/role/login`).
  - Parse robusto de `enterpriseEnabled`.
- **`resolveEffectiveSessionContext`**:
  - Fallback legacy cuando enterprise está apagado.
  - Compatibilidad legacy cuando no llega contexto remoto.
  - Resolución enterprise por operador/rol/perfil.
  - Precedencia de persona (operador > perfil).
  - Intersección MCP rol+perfil.
  - Fallback controlado de roots.

## Pendientes de export para testear

Las siguientes funciones puras NO están exportadas. Como este worktree NO
modifica `whatsapp/whatsapp-client.js` (otro agente puede estar tocándolo),
los tests quedan en `test.skip(...)` con la motivación documentada en el
archivo. Cuando se decida exponerlas, basta con quitar el `skip` y añadir
el `require`.

| Función                  | Archivo                              | Línea | Motivo de exposición                   |
| ------------------------ | ------------------------------------ | ----- | -------------------------------------- |
| `escapeForXmlData`       | `whatsapp/whatsapp-auto-reply.js`    | 75    | Cubierto indirectamente vía `buildPrompt`. Exponerla si se quiere test directo. |
| `sanitizeAutoReplyText`  | `whatsapp/whatsapp-client.js`        | 135   | Crítica seguridad: filtra insultos `TOXIC_REPLY_PATTERNS` antes de enviar.       |
| `numberToJid`            | `whatsapp/whatsapp-client.js`        | 143   | Conversión teléfono → JID. Idempotente con JIDs ya formados.                     |
| `messageSignature`       | `whatsapp/whatsapp-client.js`        | 160   | Firma de dedupe — granularidad 1s. Cubrir antes de tocar el algoritmo.           |
| `isAuthorized`           | `whatsapp/whatsapp-client.js`        | 373   | Vive dentro del closure de `createWhatsAppClient`. Refactor a función pura con `(jid, config)`. |
| `jidToNumber`            | `whatsapp/whatsapp-client.js`        | 99    | JID → número, devuelve '' para `@lid`.                                            |
| `normalizeForModeration` | `whatsapp/whatsapp-client.js`        | 126   | Quita diacríticos, lowercase, trim. Soporta `sanitizeAutoReplyText`.             |

### Propuesta de export (no aplicada en este worktree)

```js
// whatsapp/whatsapp-client.js — al final del archivo
module.exports = {
  createWhatsAppClient,
  // pure helpers expuestos para testing:
  sanitizeAutoReplyText,
  numberToJid,
  messageSignature,
  jidToNumber,
  normalizeForModeration,
  // constantes
  MEDIA_DIR,
  MEDIA_PROTOCOL,
  BRIDGE_DIR,
  CONFIG_PATH,
  STATE_PATH
}
```

Para `isAuthorized` hace falta sacarla del closure:

```js
// Antes (línea 373, dentro de createWhatsAppClient):
function isAuthorized(jid) {
  if (jid && String(jid).endsWith('@g.us')) return true
  if (!config.authorizedNumbers || !config.authorizedNumbers.length) return true
  const num = jidToNumber(jid)
  const lidDigits = digitsOnly(jidLocalId(jid))
  return (num && config.authorizedNumbers.includes(num))
      || (lidDigits && config.authorizedNumbers.includes(lidDigits))
}

// Después (función pura a nivel módulo):
function isAuthorized(jid, authorizedNumbers) {
  if (jid && String(jid).endsWith('@g.us')) return true
  if (!authorizedNumbers || !authorizedNumbers.length) return true
  const num = jidToNumber(jid)
  const lidDigits = digitsOnly(jidLocalId(jid))
  return (num && authorizedNumbers.includes(num))
      || (lidDigits && authorizedNumbers.includes(lidDigits))
}

// Dentro de createWhatsAppClient:
function isAuthorizedHere(jid) {
  return isAuthorized(jid, config.authorizedNumbers)
}
```

## Cómo añadir nuevos tests

1. Crear `tests/<nombre>.test.js`.
2. Usar el patrón:

```js
const { test, describe } = require('node:test')
const assert = require('node:assert')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const { funcUnderTest } = require(path.join(REPO_ROOT, 'modulo', 'archivo.js'))

describe('funcUnderTest', () => {
  test('descripción del caso', () => {
    assert.strictEqual(funcUnderTest('input'), 'output esperado')
  })
})
```

> El `REPO_ROOT` con 4 niveles `..` es porque estos tests viven en un
> worktree (`.claude/worktrees/<agent>/tests/`). Cuando se mergeen a `main`
> y vivan en `<repo>/tests/`, cambiar a `path.resolve(__dirname, '..')`.

3. Reglas:
   - Sin dependencias externas. Sólo `node:test` y `node:assert`.
   - Tests deterministas: no dependas de Date.now/red/filesystem real.
   - Si una función llama a IO, mockéala mínimamente o expón un wrapper con DI.
   - Mensajes de assert en español de España.

## Estado actual (2026-05-19)

```
Tests: 66 totales
  Pass:    60
  Skip:     6  (funciones pendientes de export + TODO symlink hardening + sandbox socket)
  Fail:     0
```

Cobertura: **tier-1** (funciones puras críticas de seguridad WhatsApp +
validación cron). No exhaustiva. Mejor 5 funciones bien cubiertas que 20
con un test cada una.
