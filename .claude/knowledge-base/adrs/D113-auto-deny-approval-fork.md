# D113 — Forks effectively auto-deny approval-requiring tools

**Date:** 2026-05-19
**Status:** Accepted

## Decision

Tools that would require user approval (interactive `pre_tool_call` flow)
are not granted to forks via `ForkOptions.allowedTools`. The whitelist
gate fires first in `tool-dispatch.ts` — if the tool isn't whitelisted,
no plugin hook runs, no file hook runs, no approval prompt is presented.
The fork sees a benign `tool_result` saying "Tool blocked by fork
whitelist" and continues with the next narrative choice.

## Rationale

Hermes issue #15216 — background forks invoking `shell` with `rm -rf`
would trigger the approval dialog → TUI deadlock (parent waits for fork
to finish; fork waits for user input on parent's TUI). The fix in Hermes
is `install_approval_callback(_bg_review_auto_deny)`. The SDK avoids
this entirely by making the whitelist the strictest contract: if the
tool isn't allowlisted, it can't even reach the approval flow.

## Consequences

- **Enables:** fork can be used safely from non-interactive contexts
  (cron jobs, telegram-pro `/goal` command, web handlers). No deadlock.
- **Constrains:** forks that legitimately need risky tools must be
  granted them explicitly. There's no "auto-grant" option.
