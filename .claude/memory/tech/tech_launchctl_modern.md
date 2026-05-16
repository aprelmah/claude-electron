---
name: tech-launchctl-modern
description: "launchctl moderno (bootstrap/bootout/kickstart/print) en vez del legacy load/unload, con uid=501"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2e9c12d6-032c-4786-b2bc-824f09b1e89f
---

# launchctl moderno en macOS

A partir de macOS 10.10 (Yosemite, 2014), Apple introdujo la "domains API" de launchctl. **Los comandos viejos** (`launchctl load`, `unload`, `start`, `stop`) están **deprecados** y dan resultados impredecibles en macOS moderno.

## Usar SIEMPRE la API moderna

```bash
UID=$(id -u)        # 501 para Luismi

# Cargar un plist al daemon launchd del usuario
launchctl bootstrap gui/$UID /path/to/com.luismi.poweragent.<slug>.plist

# Descargar
launchctl bootout gui/$UID /path/to/...plist
# O equivalente:
launchctl bootout gui/$UID/com.luismi.poweragent.<slug>

# Ejecutar AHORA (saltarse el cron, útil para test):
launchctl kickstart -k gui/$UID/com.luismi.poweragent.<slug>

# Ver estado:
launchctl print gui/$UID/com.luismi.poweragent.<slug>
# (busca "state = running" / "state = not running" / "last exit code")

# Parar una ejecución en curso (SIGTERM):
launchctl kill SIGTERM gui/$UID/com.luismi.poweragent.<slug>
```

## NO usar (legacy)

- `launchctl load -w plist.plist`
- `launchctl unload plist.plist`
- `launchctl start <label>` / `launchctl stop <label>`

Estos pueden funcionar pero el comportamiento es inconsistente, sobre todo si hay errores. La domains API da exit codes claros y mensajes de error útiles.

## Errores comunes

- **`Bootstrap failed: 5: Input/output error`** — generalmente plist mal formado (`plutil -lint` primero) o archivo inexistente cuando intenta cargar.
- **`Bad request`** — el label no existe en el domain target. Comprueba que `gui/$UID/...` apunta a algo cargado.
- **`Could not find service`** — la automation fue boot-out, plist borrado o nunca cargado.

## Doble bootout defensivo

Antes de bootstrap, hacer un bootout silencioso por si quedaba residuo:

```bash
launchctl bootout gui/$UID "$PLIST" 2>/dev/null
launchctl bootout gui/$UID/$LABEL 2>/dev/null
launchctl bootstrap gui/$UID "$PLIST" || exit 1
```

## Permisos

- `gui/<uid>` → user agent. NO necesita root.
- `system/` → daemon. SÍ necesita root con `sudo`.
- Para POWER-AGENT siempre usar `gui/$(id -u)` (Luismi nunca root).

## Verificación tras bootstrap

```bash
launchctl print gui/$UID/$LABEL | grep -q "path = $PLIST_PATH" && echo "OK" || echo "FAIL"
```
