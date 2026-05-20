#!/bin/bash
# Idempotent setup for telegram-pro-dogfood skill.
# Ensures `ws` lib is reachable from the lib/ scripts via node_modules symlink.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$HERE/lib"
NM_LINK="$LIB_DIR/node_modules"

if [ -L "$NM_LINK" ] || [ -d "$NM_LINK" ]; then
  echo "✅ node_modules already present at $NM_LINK"
  exit 0
fi

# Find a directory with `ws` we can reuse (no install needed).
CANDIDATE=""
for d in \
  "/home/paulo/Projetos/usetheo/theokit-sdk/examples/telegram-pro/node_modules" \
  "/home/paulo/.npm/_npx/668c188756b835f3/node_modules"; do
  if [ -d "$d/ws" ]; then
    CANDIDATE="$d"
    break
  fi
done

if [ -z "$CANDIDATE" ]; then
  # Last resort: find any
  CANDIDATE=$(find /home/paulo -maxdepth 7 -path "*/node_modules/ws/package.json" 2>/dev/null | head -1 | xargs -I{} dirname {} | xargs dirname || true)
fi

if [ -z "$CANDIDATE" ] || [ ! -d "$CANDIDATE/ws" ]; then
  echo "❌ Could not find a node_modules dir containing 'ws'."
  echo "   Run: cd $LIB_DIR && npm init -y && npm install ws"
  exit 1
fi

ln -sf "$CANDIDATE" "$NM_LINK"
echo "✅ Linked $NM_LINK → $CANDIDATE"
