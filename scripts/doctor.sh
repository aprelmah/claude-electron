#!/usr/bin/env bash
set -euo pipefail

fail=0
warn=0

ok() { echo "[ok]   $*"; }
ko() { echo "[fail] $*"; fail=1; }
wa() { echo "[warn] $*"; warn=1; }

check_path_or_cmd() {
  local label="$1"
  local preferred="$2"
  local fallback_cmd="$3"

  if [[ -x "${preferred}" ]]; then
    ok "${label}: ${preferred}"
    return
  fi

  if command -v "${fallback_cmd}" >/dev/null 2>&1; then
    ok "${label}: $(command -v "${fallback_cmd}")"
    return
  fi

  ko "${label}: not found (${preferred} or ${fallback_cmd} in PATH)"
}

check_optional_path_or_cmd() {
  local label="$1"
  local preferred="$2"
  local fallback_cmd="$3"

  if [[ -x "${preferred}" ]]; then
    ok "${label}: ${preferred}"
    return
  fi

  if command -v "${fallback_cmd}" >/dev/null 2>&1; then
    ok "${label}: $(command -v "${fallback_cmd}")"
    return
  fi

  wa "${label}: not found (voice dictation will fail)"
}

echo "== CLAUDE-NOVAK doctor =="
echo "Project: $(pwd)"

if command -v node >/dev/null 2>&1; then
  ok "node: $(node -v)"
else
  ko "node: not found"
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm: $(npm -v)"
else
  ko "npm: not found"
fi

check_path_or_cmd "claude CLI" "${HOME}/.local/bin/claude" "claude"
check_path_or_cmd "codex CLI" "${HOME}/.local/bin/codex" "codex"
check_optional_path_or_cmd "whisper CLI" "${HOME}/Library/Python/3.9/bin/whisper" "whisper"

if node -e "const p=require('./package.json'); process.exit(p?.build?.mac?.extendInfo?.NSApplicationSupportsSecureRestorableState===true?0:1)" >/dev/null 2>&1; then
  ok "NSApplicationSupportsSecureRestorableState=true"
else
  ko "Missing NSApplicationSupportsSecureRestorableState=true in package.json"
fi

if npm ls electron node-pty --depth=0 >/dev/null 2>&1; then
  ok "electron + node-pty dependencies resolved"
else
  ko "electron/node-pty dependency issue (run npm install)"
fi

STATE_ROOT="${HOME}/Library/Saved Application State"
APP_IDS=(
  "com.github.Electron"
  "com.luismi.claude-electron"
  "com.luismi.claude-novak"
)

for app_id in "${APP_IDS[@]}"; do
  state_dir="${STATE_ROOT}/${app_id}.savedState"
  if [[ -d "${state_dir}" ]]; then
    wa "Found saved state: ${state_dir} (if startup crashes, run: npm run reset:state)"
  fi
done

if [[ "${fail}" -ne 0 ]]; then
  echo "Doctor result: FAIL"
  exit 1
fi

if [[ "${warn}" -ne 0 ]]; then
  echo "Doctor result: OK with warnings"
  exit 0
fi

echo "Doctor result: OK"
