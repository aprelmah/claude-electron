#!/usr/bin/env bash
# POWER-AGENT pre-commit hook.
# Runs `node --check` on staged JS files at repo root and `node --test`.
# Skip with: git commit --no-verify
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

YELLOW="$(printf '\033[33m')"
RED="$(printf '\033[31m')"
GREEN="$(printf '\033[32m')"
RESET="$(printf '\033[0m')"

echo "${YELLOW}[pre-commit]${RESET} POWER-AGENT checks starting..."

# Resolve node binary. Prefer 20.x via nvm if available.
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  else
    echo "${RED}[pre-commit] node not found in PATH${RESET}" >&2
    exit 1
  fi
fi

NODE_VERSION="$("$NODE_BIN" --version 2>/dev/null || echo unknown)"
echo "${YELLOW}[pre-commit]${RESET} node: $NODE_BIN ($NODE_VERSION)"

# 1) Syntax check on staged JS files at repo root (excluding node_modules, dist, automations).
STAGED_JS="$(git diff --cached --name-only --diff-filter=ACMR | \
  grep -E '\.js$' | \
  grep -v -E '^(node_modules|dist|build|out|automations)/' || true)"

if [ -n "$STAGED_JS" ]; then
  echo "${YELLOW}[pre-commit]${RESET} node --check on staged JS files:"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    echo "  - $f"
    if ! "$NODE_BIN" --check "$f"; then
      echo "${RED}[pre-commit] Syntax check failed: $f${RESET}" >&2
      echo "${RED}[pre-commit] Aborting commit. Use 'git commit --no-verify' to bypass.${RESET}" >&2
      exit 1
    fi
  done <<< "$STAGED_JS"
else
  echo "${YELLOW}[pre-commit]${RESET} no JS files staged for syntax check"
fi

# 2) Run unit tests with a sensible timeout (5 minutes).
#
# Git exports GIT_DIR / GIT_INDEX_FILE / etc. into hooks. Tests that create
# throwaway repos (tests/session-git-*.test.js) inherit them and end up running
# their git commands against THIS repo instead of their temp fixture, which
# fails the suite only under the hook. Scrub the git environment first.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_COMMON_DIR GIT_PREFIX \
      GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
      GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE \
      GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE \
      GIT_EDITOR GIT_EXEC_PATH GIT_REFLOG_ACTION || true

TEST_TIMEOUT="${PRE_COMMIT_TEST_TIMEOUT:-300}"

if ! ls tests/*.test.js >/dev/null 2>&1; then
  echo "${YELLOW}[pre-commit]${RESET} no tests found, skipping test step"
else
  echo "${YELLOW}[pre-commit]${RESET} running node --test (timeout: ${TEST_TIMEOUT}s)"
  TEST_CMD=("$NODE_BIN" --test --test-reporter=spec)
  for f in tests/*.test.js; do
    TEST_CMD+=("$f")
  done

  # Use `gtimeout` if available (brew coreutils), otherwise `timeout`, otherwise run raw.
  if command -v gtimeout >/dev/null 2>&1; then
    if ! gtimeout "${TEST_TIMEOUT}s" "${TEST_CMD[@]}"; then
      echo "${RED}[pre-commit] Tests failed or timed out (${TEST_TIMEOUT}s).${RESET}" >&2
      echo "${RED}[pre-commit] Aborting commit. Use 'git commit --no-verify' to bypass.${RESET}" >&2
      exit 1
    fi
  elif command -v timeout >/dev/null 2>&1; then
    if ! timeout "${TEST_TIMEOUT}s" "${TEST_CMD[@]}"; then
      echo "${RED}[pre-commit] Tests failed or timed out (${TEST_TIMEOUT}s).${RESET}" >&2
      echo "${RED}[pre-commit] Aborting commit. Use 'git commit --no-verify' to bypass.${RESET}" >&2
      exit 1
    fi
  else
    if ! "${TEST_CMD[@]}"; then
      echo "${RED}[pre-commit] Tests failed.${RESET}" >&2
      echo "${RED}[pre-commit] Aborting commit. Use 'git commit --no-verify' to bypass.${RESET}" >&2
      exit 1
    fi
  fi
fi

echo "${GREEN}[pre-commit] OK${RESET}"
exit 0
