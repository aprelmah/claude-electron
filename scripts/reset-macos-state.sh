#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${HOME}/Library/Saved Application State"
STAMP="$(date +%Y%m%d-%H%M%S)"

APP_IDS=(
  "com.github.Electron"
  "com.luismi.claude-electron"
  "com.luismi.claude-novak"
)

echo "State root: ${STATE_ROOT}"

for app_id in "${APP_IDS[@]}"; do
  src="${STATE_ROOT}/${app_id}.savedState"
  if [[ -d "${src}" ]]; then
    dst="${src}.bak-${STAMP}"
    mv "${src}" "${dst}"
    echo "Backed up: ${dst}"
  else
    echo "Skip (not found): ${src}"
  fi
done

echo "Done."
