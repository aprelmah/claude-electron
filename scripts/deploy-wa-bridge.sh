#!/usr/bin/env bash
# Despliega el código del bridge de WhatsApp desde el repo al runtime.
#
# El bridge corre desde ~/.claude/whatsapp-bridge/, que no es un repo. Este
# script copia SOLO el código; el estado (credenciales, config, historial,
# fichas, media) se queda donde está y nunca se toca.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/whatsapp-bridge"
DST="$HOME/.claude/whatsapp-bridge"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILES=(index.js auth.js package.json package-lock.json whatsapp-bridge-cli.sh wa-send.cjs)

[ -d "$DST" ] || { echo "✗ no existe $DST — ¿está instalado el bridge?" >&2; exit 1; }

echo "▶ backup de los ficheros que se van a pisar"
for f in "${FILES[@]}"; do
  [ -f "$DST/$f" ] && cp "$DST/$f" "$DST/$f.bak.$STAMP"
done

echo "▶ copiando código"
for f in "${FILES[@]}"; do
  cp "$SRC/$f" "$DST/$f"
  echo "   $f"
done
chmod +x "$DST/whatsapp-bridge-cli.sh"

echo "▶ comprobando sintaxis"
node --check "$DST/auth.js"

echo "▶ reiniciando servicio"
launchctl kickstart -k "gui/$(id -u)/com.luismi.whatsapp-bridge"
sleep 8

TOKEN_FILE="$DST/.auth-token"
if [ -f "$TOKEN_FILE" ]; then
  STATUS="$(curl -s --max-time 8 -H "X-Auth-Token: $(cat "$TOKEN_FILE")" http://127.0.0.1:3031/status || true)"
  echo "▶ /status → ${STATUS:-sin respuesta}"
else
  echo "▶ sin .auth-token todavía; comprueba el estado a mano"
fi

echo "✅ bridge desplegado (backups .bak.$STAMP en $DST)"
