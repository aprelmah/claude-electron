---
name: tech-macos-bash-rsync-landmines
description: Trampas de bash 3.2 + rsync 2.6.9 + utilidades en macOS que SIEMPRE pillan al LLM cuando genera scripts. Documentación de las quemadas reales
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2e9c12d6-032c-4786-b2bc-824f09b1e89f
---

# macOS — trampas en scripts bash de automatización

Recopilación de bugs reales cazados al usar Claude Opus para generar scripts bash para POWER-AGENT. Todos están en [[automation-builder skill]] (`~/.claude/skills/luismi/automation-builder/SKILL.md` y `patterns.md`), pero documento aquí también para que cualquier conversación futura los sepa sin depender de la skill.

## Bash 3.2 (macOS por licencia GPLv3, 2007)

NO usar:
- `mapfile` / `readarray` — bash 4+. Usar `while IFS= read -r line; do arr+=("$line"); done < <(cmd)`.
- `declare -A` — arrays asociativos, bash 4+.
- `${var^^}` / `${var,,}` — bash 4+. Usar `tr '[:lower:]' '[:upper:]'`.
- `${var@U}` y otras transformaciones `@` — no existen.
- `wait -n` — bash 4+.
- Globstar `**` recursivo en patterns — no expande así. Usar `find`.

Trampas con `set -euo pipefail`:
- **Array vacío con `set -u`**: `"${arr[@]}"` revienta con "unbound variable" si el array está vacío. Usar `${arr[@]+"${arr[@]}"}`.
- **`grep` sin match con pipefail**: si forma parte de un pipe (`grep ... | awk ...`), revienta el script entero. Envolver en `set +e` … `set -e`.

## rsync 2.6.9 BSD (macOS de stock, 2006)

NO soporta:
- `-H` (hard links), `-A` (ACLs), `-X` (xattrs). Usar SOLO `-a`.
- `--info=progress2`, `--info=*` en general.
- `--mkpath`, `--no-inc-recursive`.
- **`--contimeout`** — solo existe en rsync 3.x. Si lo usas, falla con "unknown option" al instante.

SÍ soporta:
- `--timeout=N` (timeout de I/O, OBLIGATORIO en operaciones SMB/SSH).
- `-a`, `-v`, `--partial`, `--ignore-errors`, `--stats`, `--delete`, `--exclude`, `--link-dest`.

Si necesitas rsync moderno (xattrs, ACLs, progress2): `brew install rsync` → usar `/opt/homebrew/bin/rsync` o `/usr/local/bin/rsync` con check `command -v` primero. Fallback a `/usr/bin/rsync` con flags básicos si no está.

## Utilidades NO instaladas de stock en macOS

- **`jq`** → NO viene. Usar `python3 -c 'import json,sys; ...'` para parsear JSON (python3 SÍ viene).
- **`flock`** → NO viene. Para lockfiles, usar `mkdir DIR 2>/dev/null` como mutex atómico.
- **`timeout`** → NO viene como builtin. Usar watchdog manual con `( sleep N; kill $$ ) &` o instalar coreutils via brew (`gtimeout`).
- **`shellcheck`** → NO viene. `brew install shellcheck` para validación pre-instalación de scripts.

## Watchdog global en scripts long-running

Cualquier script que toque red/NAS/SSH debe tener watchdog para no quedarse zombie:

```bash
MAX_RUNTIME=2700   # 45 min
( sleep "$MAX_RUNTIME"; kill -TERM $$ 2>/dev/null; sleep 10; kill -KILL $$ 2>/dev/null ) &
WATCHDOG_PID=$!
disown "$WATCHDOG_PID" 2>/dev/null || true
```

Y en `cleanup()`: `[[ -n "${WATCHDOG_PID:-}" ]] && kill "$WATCHDOG_PID" 2>/dev/null`.

## Notas adicionales

- **TCC Full Disk Access** puede requerirse la primera vez que un script lanzado por launchd toque `~/Documents`, `~/Desktop`, etc. macOS pide permiso vía popup.
- **SMB sobre WiFi** es lento para metadatos: verificar 10.000 archivos pequeños puede tardar 5-15 min aunque NO transfiera bytes. Plan tus timeouts en consecuencia.
- **`rsync` exit code 23** = "some files could not be transferred". Es WARNING, no error fatal. Tratar como continuable (`log "rsync WARN"`, no `exit`).
