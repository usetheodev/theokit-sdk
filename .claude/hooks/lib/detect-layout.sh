# shellcheck shell=bash
# Shared ecosystem-layout detection for .claude hooks.
#
# Sourced by hooks that need to resolve paths relative to the ecosystem root.
# Sets PROJECT_DIR (cwd anchored to CLAUDE_PROJECT_DIR) and ECO (the ecosystem
# root: "." for a standalone install, ".claude" for a plugin install).
#
# Canonical detection block — mirrors the inline logic in sessionstart-context.sh,
# precompact-preserve.sh, stop-validation.sh, and public-copy-lint.sh. Extracted so
# userpromptsubmit-inject.sh (and future hooks) share one authoritative copy.
#
# On an unrecognized layout the sourcing hook exits 0 (nothing to inject / check).

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

if [ -d ".claude/skills" ] && [ -d ".claude/rules" ] && [ -d ".claude/hooks" ]; then
  ECO=".claude"
elif [ -d "skills" ] && [ -d "rules" ] && [ -d "hooks" ]; then
  ECO="."
else
  exit 0
fi
