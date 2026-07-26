# Hooks

8 defensive runtime hooks that enforce safety invariants at the shell level.
Claude Code executes these automatically at specific lifecycle events, as wired
in `settings.json`.

## Shared Library

`lib/detect-layout.sh` — sourced by all hooks that need the ecosystem path.
Sets `$ECO` (`.claude` or `.`) and `$PROJECT_DIR`.

## Hook Inventory

| Hook | Event | Behavior | Exit |
|---|---|---|---|
| `sessionstart-context.sh` | SessionStart | Injects git branch, active plan, loop state | 0 always |
| `userpromptsubmit-inject.sh` | UserPromptSubmit | Injects active plan excerpt + SHA256 attestation check | 0 always |
| `validate-command.sh` | PreToolUse (Bash) | Blocks destructive git ops, rm -rf on system paths, read-only boundary | 0=allow, 2=block |
| `boundary-check.sh` | PreToolUse (Edit/Write) | Blocks writes to knowledge-base/references/ and knowledge-base/tools/ | 0=allow, 2=block |
| `post-edit-check.sh` | PostToolUse (Edit/Write) | Multi-language linter feedback | 0 always |
| `public-copy-lint.sh` | PostToolUse (Edit/Write) | Bans unverified production claims in README | 0 always (advisory) |
| `stop-validation.sh` | Stop | CHANGELOG gate (HARD), secret leak gate (HARD), TDD gate (warn) | 0=clean, 2=block |
| `precompact-preserve.sh` | PreCompact | Snapshots plan + progress before context compaction | 0 always |

## Design Principles

- Every hook uses `set -euo pipefail` (fail-fast)
- Hard gates exit 2; advisory gates exit 0 with stderr output
- JSON output follows `hookSpecificOutput.additionalContext` convention
- Each hook has **single responsibility** (SRP)

## Adding a New Hook

1. Create `hooks/{name}.sh` with `#!/bin/bash` and `set -euo pipefail`
2. Source `lib/detect-layout.sh` for ecosystem detection
3. Wire in `settings.json` under the appropriate event
4. Add tests in `tests/hooks/test_{name}.sh`
5. Document exit codes in the script header
