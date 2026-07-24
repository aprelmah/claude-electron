#!/usr/bin/env bash
# Install POWER-AGENT git hooks into .git/hooks.
# Idempotent: rerunning overwrites the hook symlink.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.git" ]; then
  echo "ERROR: this directory is not a git repository (no .git/ found)." >&2
  echo "Run this script from inside the POWER-AGENT repo." >&2
  exit 1
fi

cd "$REPO_ROOT"

HOOK_SRC="scripts/pre-commit.sh"
HOOK_DST=".git/hooks/pre-commit"

if [ ! -f "$HOOK_SRC" ]; then
  echo "ERROR: $HOOK_SRC not found." >&2
  exit 1
fi

chmod +x "$HOOK_SRC"

# Backup any existing hook that is not already our symlink.
if [ -e "$HOOK_DST" ] && [ ! -L "$HOOK_DST" ]; then
  BACKUP="${HOOK_DST}.backup.$(date +%Y%m%d-%H%M%S)"
  echo "Backing up existing hook: $HOOK_DST -> $BACKUP"
  mv "$HOOK_DST" "$BACKUP"
fi

# Use a relative symlink so the repo stays portable.
ln -sf "../../$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST" 2>/dev/null || true

echo ""
echo "[OK] Pre-commit hook installed."
echo "     $HOOK_DST -> ../../$HOOK_SRC"
echo ""
echo "What it does:"
echo "  - node --check on staged JS files (root level, excludes node_modules/dist/automations)"
echo "  - node --test tests/*.test.js (timeout: 5 min, override with PRE_COMMIT_TEST_TIMEOUT=secs)"
echo ""
echo "To bypass for a single commit:"
echo "  git commit --no-verify"
echo ""
echo "To uninstall:"
echo "  rm $HOOK_DST"
