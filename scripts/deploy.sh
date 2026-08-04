#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "▶ 1/4 matando instancias activas..."
pkill -9 -f "POWER-AGENT.app/Contents/MacOS/POWER-AGENT" 2>/dev/null || true
pkill -9 -f "POWER-AGENT Helper" 2>/dev/null || true
pkill -f "POWER-AGENT" 2>/dev/null || true
pkill -f "electron \." 2>/dev/null || true
sleep 2

echo "▶ compilando helper de voz..."
bash scripts/build-voice-helper.sh

echo "▶ 2/4 compilando build x64 (solo zip, sin dmg)..."
if ! npx electron-builder --mac zip --x64 >/tmp/deploy-build.log 2>&1; then
  echo "❌ Build falló. Últimas líneas de /tmp/deploy-build.log:"
  tail -n 80 /tmp/deploy-build.log || true
  exit 1
fi

INSTALL_DIR="/Applications"
if [ ! -w "/Applications" ]; then
  INSTALL_DIR="$HOME/Applications"
  mkdir -p "$INSTALL_DIR"
fi

APP_DEST="$INSTALL_DIR/POWER-AGENT.app"

echo "▶ 3/4 instalando en $INSTALL_DIR..."
rm -rf "$APP_DEST"
if ! ditto "dist/mac/POWER-AGENT.app" "$APP_DEST"; then
  echo "❌ No se pudo copiar la app en: $APP_DEST"
  exit 1
fi
xattr -cr "$APP_DEST" || true

echo "▶ 4/4 lanzando..."
osascript -e "tell application \"Finder\" to open POSIX file \"$APP_DEST\""

echo "✅ POWER-AGENT instalado y abierto desde: $APP_DEST"
