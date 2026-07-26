#!/bin/bash
# PreToolUse hook for Bash: blocks destructive commands.
# Mirrors the universal git/safety rules from CLAUDE.md (Inquebrável Rule 4).
# Exit 0 = allow, Exit 2 = block (stderr is shown to Claude).
#
# Design note: this hook fails CLOSED. Any inability to inspect the command
# safely (missing jq, unparseable input) results in a BLOCK, never a silent
# allow. Detection is normalized so git global options cannot smuggle a
# forbidden subcommand past the guards.

set -euo pipefail

INPUT=$(cat)

# Nothing on stdin => no command to inspect => allow (there is nothing to run).
if [ -z "${INPUT//[[:space:]]/}" ]; then
  exit 0
fi

# F5: fail CLOSED if jq is unavailable. Without jq we cannot parse the command,
# and a fail-open here would let every command through.
if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq unavailable — cannot validate command safely (fail-closed)." >&2
  exit 2
fi

# F5: a parse error must never become a silent allow. jq failing (bad JSON)
# would otherwise abort the script with a non-2 exit under set -e/pipefail,
# which Claude treats as allow. Capture the failure and block explicitly.
if ! COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null); then
  echo "BLOCKED: could not parse hook input as JSON (fail-closed)." >&2
  exit 2
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# F3: strip leading git global options so `git <globals> <subcommand>` can never
# bypass the subcommand guards. Globals normalized: -C DIR, -c K=V,
# --git-dir=..., --work-tree=..., -p, --paginate. Applied repeatedly (a git
# invocation may carry several) and to every git occurrence in a compound.
strip_git_globals() {
  local cmd="$1" prev=""
  while [ "$cmd" != "$prev" ]; do
    prev="$cmd"
    cmd=$(printf '%s' "$cmd" | sed -E 's/(^|[^[:alnum:]_.])git[[:space:]]+(--git-dir=[^[:space:]]+|--work-tree=[^[:space:]]+|-[cC][[:space:]]+[^[:space:]]+|--paginate|-p)[[:space:]]+/\1git /g')
  done
  printf '%s' "$cmd"
}

# CMD is the normalized command used for all git subcommand matching.
CMD=$(strip_git_globals "$COMMAND")

# --- Inquebrável git rules (CLAUDE.md §4) ---
if echo "$CMD" | grep -qE 'git[[:space:]]+checkout([[:space:]]|$)'; then
  echo "BLOCKED: 'git checkout' is forbidden by Inquebrável Rule 4. Use 'git switch' or 'git restore' instead." >&2
  exit 2
fi

if echo "$CMD" | grep -qE 'git[[:space:]]+revert([[:space:]]|$)'; then
  echo "BLOCKED: 'git revert' is forbidden by Inquebrável Rule 4. Create a new commit that reverses the change explicitly." >&2
  exit 2
fi

# F2: force-push guard. The forcing token may appear ANYWHERE in the push args
# (not just right after `push`), and a leading `+` refspec (`+main`) also forces.
# `--force-with-lease` is explicitly allowed.
if echo "$CMD" | grep -qE 'git[[:space:]]+push([[:space:]]|$)'; then
  if echo "$CMD" | grep -qE '(--force([[:space:]]|$)|(^|[[:space:]])-[a-z]*f([[:space:]]|$)|[[:space:]]\+[^[:space:]-][^[:space:]]*)'; then
    echo "BLOCKED: force push is forbidden. Use --force-with-lease only when explicitly authorized." >&2
    exit 2
  fi
fi

if echo "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  echo "BLOCKED: 'git reset --hard' is forbidden. Use 'git stash' or create a branch instead." >&2
  exit 2
fi

# --- No work directly on main (CLAUDE.md §4) ---
# main receives release merges ONLY. Block every local command that mutates the
# main ref: commit, plus merge/rebase/reset/cherry-pick.
# F4: apply main-protection when EITHER the current branch is main OR the command
# text itself switches to main inline (e.g. `git switch main && git commit ...`),
# since reading the live branch alone is bypassable in a compound command.
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
INLINE_MAIN=no
if echo "$CMD" | grep -qE 'git[[:space:]]+switch[[:space:]]+(-[cC][[:space:]]+)?main([[:space:]]|$)' \
   || echo "$CMD" | grep -qE 'git[[:space:]]+checkout[[:space:]]+(-b[[:space:]]+)?main([[:space:]]|$)'; then
  INLINE_MAIN=yes
fi

if [ "$BRANCH" = "main" ] || [ "$INLINE_MAIN" = "yes" ]; then
  if echo "$CMD" | grep -qE 'git[[:space:]]+commit([[:space:]]|$)'; then
    echo "BLOCKED: never commit directly to main (Inquebrável Rule 4). Work on 'develop' (single-trunk) or a feature branch." >&2
    exit 2
  fi
  if echo "$CMD" | grep -qE 'git[[:space:]]+(merge|rebase|reset|cherry-pick)([[:space:]]|$)'; then
    echo "BLOCKED: never mutate 'main' directly (Inquebrável Rule 4). main receives release merges only, via a develop→main PR. Switch to 'develop' first." >&2
    exit 2
  fi
fi

# --- rm -rf on dangerous system paths ---
# F1: detect recursive intent in ANY flag order/spelling (-rf, -fr, -Rf, -f -r,
#     --recursive) BEFORE checking the path. Force alone cannot delete a
#     directory, so recursive intent is the destructive signal.
# F8: /home only blocks bare roots (/home, /home/<user>, /home/<user>/, $HOME, ~)
#     — legitimate deep project paths under /home are allowed. Other system dirs
#     (/etc /usr /var /bin /lib /opt /boot /root) and / stay fully blocked.
RM_RECURSIVE_RE='(^|[[:space:]])(-[a-zA-Z]*[rR][a-zA-Z]*([[:space:]]|$)|--recursive([[:space:]]|=|$))'
RM_INVOCATION_RE='(^|[[:space:]]|;|&&|\|\||\||\()[[:space:]]*rm([[:space:]])'
DANGEROUS_PATH_RE='(/([[:space:]]|$)|/\*|~/?([[:space:]]|$)|\$HOME/?([[:space:]]|$)|/home([[:space:]]|$)|/home/([[:space:]]|$)|/home/[^/[:space:]]+/?([[:space:]]|$)|(/etc|/usr|/var|/bin|/lib|/opt|/boot|/root)([[:space:]]|/|$))'
if echo "$CMD" | grep -qE "$RM_INVOCATION_RE" \
   && echo "$CMD" | grep -qE "$RM_RECURSIVE_RE" \
   && echo "$CMD" | grep -qE "$DANGEROUS_PATH_RE"; then
  echo "BLOCKED: 'rm -r' on a system/home-root path. Scope recursive deletions to project-relative paths, deep project subdirectories, or /tmp/." >&2
  exit 2
fi

# --- knowledge-base/references/ and knowledge-base/tools/ are read-only study material ---
# Escape hatch: a `.references-bootstrap` marker file at project root unblocks WRITE ops
# to references/ AND tools/. Use ONLY for initial population; delete it right after.
if [ ! -f "$PROJECT_DIR/.references-bootstrap" ]; then
  if echo "$COMMAND" | grep -qE '(^|[[:space:]]|;|&&|\|\||\||\()[[:space:]]*((rm|mv|cp|sed[[:space:]]+-i|tee)[[:space:]]+[^;&|]*(\./)?(\.claude/)?knowledge-base/(references|tools)/|>{1,2}[[:space:]]+(\./)?(\.claude/)?knowledge-base/(references|tools)/)'; then
    echo "BLOCKED: 'knowledge-base/references/' and 'knowledge-base/tools/' are read-only study material. Capture findings in 'knowledge-base/discoveries/blueprints/'. For initial bootstrap, create '.references-bootstrap' at project root AND cite the source in CHANGELOG.md; remove the marker when done." >&2
    exit 2
  fi
fi

# --- No Co-Authored-By trailers in commit messages (user policy) ---
if echo "$CMD" | grep -qE 'git[[:space:]]+commit' && echo "$COMMAND" | grep -qiE 'co-authored-by'; then
  echo "BLOCKED: 'Co-Authored-By:' trailers are forbidden on this project's commits (user policy). Remove the trailer from the commit message body." >&2
  exit 2
fi

# --- No dependency install inside read-only references/ ---
if echo "$COMMAND" | grep -qE '(pip|poetry|uv|npm|pnpm|yarn|cargo|go[[:space:]]+(get|mod))[[:space:]]+(install|add|tidy|download)' && pwd | grep -qE '(\.claude/)?knowledge-base/references/'; then
  echo "BLOCKED: never install dependencies inside knowledge-base/references/. Those are read-only clones." >&2
  exit 2
fi

exit 0
