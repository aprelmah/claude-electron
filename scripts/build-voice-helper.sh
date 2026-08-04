#!/bin/bash
# Compila el helper de voz (Swift) a resources/voice-helper.
# Se ejecuta antes de empaquetar y también a mano durante el desarrollo.
set -e
cd "$(dirname "$0")/.."

if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "✖ swiftc no disponible. Instala las Command Line Tools: xcode-select --install"
  exit 1
fi

mkdir -p resources
swiftc -O voice-helper/VoiceHelper.swift -o resources/voice-helper
echo "✔ resources/voice-helper compilado"
