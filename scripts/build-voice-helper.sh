#!/bin/bash
# Compila el helper de voz (Swift) a resources/voice-helper.
# Se ejecuta antes de empaquetar y también a mano durante el desarrollo.
set -e
cd "$(dirname "$0")/.."

# Fail-open a propósito: este script cuelga de los hooks pre* de npm, así que
# un `exit 1` aquí tumba build:zip, dist y deploy enteros. Quien no use el modo
# voz no puede quedarse sin poder empaquetar la app por no tener las Command
# Line Tools instaladas: se avisa y se sigue. La app arranca igual; el modo voz
# es lo único que no funcionará, y lo dice con su motivo al pulsar el botón.
if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "⚠ swiftc no disponible: el modo voz quedará sin helper."
  echo "  Instala las Command Line Tools (xcode-select --install) y repite si lo quieres."
  exit 0
fi

mkdir -p resources
swiftc -O voice-helper/VoiceHelper.swift -o resources/voice-helper
echo "✔ resources/voice-helper compilado"
