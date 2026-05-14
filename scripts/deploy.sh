#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "▶ 1/3 matando instancias activas..."
pkill -f "CLAUDE-NOVAK" 2>/dev/null || true
pkill -f "electron \." 2>/dev/null || true
sleep 1

echo "▶ 2/3 compilando build x64..."
npx electron-builder --mac zip --x64 >/tmp/deploy-build.log 2>&1

echo "▶ 3/3 abriendo dist/mac/CLAUDE-NOVAK.app..."
open "dist/mac/CLAUDE-NOVAK.app"

echo "✅ Listo. App lanzada desde dist/mac (no /Applications)."
