#!/usr/bin/env bash
# Wrapper that forces the .nvmrc Node version (via nvm when available) before
# spawning the actual dev command. Used by examples that need native deps
# like better-sqlite3 to load with the matching NODE_MODULE_VERSION.
#
# Usage (in package.json):
#   "dev": "bash ../../tools/dev.sh tsx --env-file=.env src/index.ts"
#
# Behavior:
#   1. Source nvm if installed (~/.nvm/nvm.sh or NVM_DIR)
#   2. If nvm is now in scope and .nvmrc exists, run `nvm use` silently
#   3. Re-validate Node version via tools/check-node.mjs (hard-fails on mismatch)
#   4. exec the passed command with the correct Node in PATH
#
# Works on Linux/macOS/WSL. Windows users without bash should run the example's
# raw command directly (`tsx --env-file=.env src/index.ts`) after `nvm use`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Source nvm if available (zsh/bash compatible).
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
fi

# 2. Switch to .nvmrc version if nvm is now callable. Do NOT use a subshell
# here — nvm use mutates PATH and the change must survive into the exec
# below. Reading .nvmrc explicitly avoids needing to cd.
if command -v nvm >/dev/null 2>&1; then
  NVMRC_VERSION="$(cat "$ROOT_DIR/.nvmrc" 2>/dev/null || echo "")"
  if [ -n "$NVMRC_VERSION" ]; then
    nvm use "$NVMRC_VERSION" --silent >/dev/null 2>&1 || \
      echo "[dev.sh] nvm use $NVMRC_VERSION failed (run 'nvm install $NVMRC_VERSION')" >&2
  fi
fi

# 3. Hard check — bail out with a friendly error if still on wrong Node.
node "$SCRIPT_DIR/check-node.mjs"

# 4. exec the passed command with PATH now pointing at the right Node.
exec "$@"
