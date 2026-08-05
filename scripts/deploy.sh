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

# ── Micrófono: bundle del helper + firma ad-hoc ────────────────────────────
# Sin esto el modo voz se queda sin micro en CADA deploy, y hasta el 2026-08-05
# había que rehacerlo a mano. Dos requisitos de macOS, los dos innegociables:
#
#  1. Los entitlements solo se aplican AL FIRMAR, y no hay certificado de Apple
#     → firma ad-hoc (`--sign -`). Sin ella, TCC dice "requires entitlement
#     com.apple.security.device.audio-input but it is missing".
#  2. macOS no enseña el diálogo del micrófono a un ejecutable suelto: hace
#     falta un bundle .app con CFBundleIdentifier y las NS…UsageDescription.
#     Por eso el binario se envuelve en VoiceHelper.app y `voice-helper` queda
#     como symlink relativo, para no tocar VOICE_HELPER_PATH.
#
# Detalle completo del diagnóstico: .claude/memory/tech/tech_modo_voz_permisos_macos.md
RES="$APP_DEST/Contents/Resources"
if [ -f "$RES/voice-helper" ] && [ ! -L "$RES/voice-helper" ]; then
  echo "▶ empaquetando y firmando el helper de voz..."
  VH="$RES/VoiceHelper.app"
  rm -rf "$VH"
  mkdir -p "$VH/Contents/MacOS"
  cp build/VoiceHelper-Info.plist "$VH/Contents/Info.plist"
  mv "$RES/voice-helper" "$VH/Contents/MacOS/VoiceHelper"
  chmod +x "$VH/Contents/MacOS/VoiceHelper"
  # Relativo a Resources: sobrevive a instalar en ~/Applications en vez de /Applications.
  ln -sf "VoiceHelper.app/Contents/MacOS/VoiceHelper" "$RES/voice-helper"

  # El orden importa: primero lo de dentro con SUS entitlements, después la app
  # entera. Al revés, tocar el helper invalidaría el sello de la app.
  codesign --force --sign - --entitlements build/entitlements.voice-helper.plist "$VH" \
    || { echo "❌ no se pudo firmar VoiceHelper.app"; exit 1; }
  codesign --force --deep --sign - --options runtime --entitlements build/entitlements.mac.plist "$APP_DEST" \
    || { echo "❌ no se pudo firmar la app"; exit 1; }

  # Verificación real, no confianza: si --deep se comió los entitlements del
  # helper, el micro no funcionará y el fallo solo se vería hablándole a la app.
  if ! codesign -d --entitlements - "$VH/Contents/MacOS/VoiceHelper" 2>&1 | grep -q "com.apple.security.device.audio-input"; then
    echo "⚠️  el helper de voz quedó SIN el entitlement de micrófono: el modo voz no podrá escuchar."
  else
    echo "   ✓ helper firmado con permiso de micrófono"
  fi
  codesign --verify "$APP_DEST" && echo "   ✓ firma de la app válida"
elif [ -L "$RES/voice-helper" ]; then
  echo "   ✓ helper de voz ya empaquetado"
else
  echo "⚠️  no hay binario de voz en Resources: el modo voz saldrá como no disponible."
fi

echo "▶ 4/4 lanzando..."
osascript -e "tell application \"Finder\" to open POSIX file \"$APP_DEST\""

echo "✅ POWER-AGENT instalado y abierto desde: $APP_DEST"
