#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "▶ 1/4 matando instancias activas..."
pkill -f "POWER-AGENT" 2>/dev/null || true
pkill -f "electron \." 2>/dev/null || true
sleep 1

echo "▶ 2/4 compilando build x64..."
npx electron-builder --mac --x64 >/tmp/deploy-build.log 2>&1

echo "▶ 3/4 instalando en /Applications..."
rm -rf /Applications/POWER-AGENT.app
cp -r dist/mac/POWER-AGENT.app /Applications/POWER-AGENT.app
xattr -cr /Applications/POWER-AGENT.app

echo "▶ 4/4 lanzando..."
osascript -e 'tell application "Finder" to open POSIX file "/Applications/POWER-AGENT.app"'

echo "✅ POWER-AGENT instalado y abierto desde /Applications."
