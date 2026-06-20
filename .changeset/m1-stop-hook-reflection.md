---
"@theokit/sdk": minor
---

M1-4 — fire the `stop` file-based hook + honor `feedback` as a bounded re-prompt (plan `m1-stop-hook-reflection`).

The `HookEvent "stop"` was declared but never dispatched. A local agent now fires `stop` once when it finishes a turn cleanly (not on an errored run or an iteration-ceiling truncation). A `stop` hook returning `{"decision":"feedback","feedback":"…"}` re-prompts the agent with that text and the loop continues — a bounded reflection ladder capped at `MAX_STOP_FEEDBACK_ATTEMPTS` (2), mirroring the existing nudge ceiling, so a hook cannot loop forever. `allow`/no-hook finish normally; `deny` at `stop` finishes (the answer already exists). Reuses the existing `HooksExecutor` — zero new dependencies. Hooks remain file-based (no programmatic callback).
