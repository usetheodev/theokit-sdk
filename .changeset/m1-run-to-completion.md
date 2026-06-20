---
"@theokit/sdk": minor
---

M1 Phase 3 — `agent.runToCompletion()` continuation driver (plan `m1-run-to-completion`).

Builds on M1-2's `RunResult.stoppedAtIterationLimit` signal: a single `agent.send()` truncates when the model still wants tools at the loop's iteration ceiling. `runToCompletion(message, options?)` re-sends a short continuation prompt — the agent's stateful session preserves the conversation — until a genuine terminal:

- `done` — a round finished without truncating.
- `step_limit` — `maxRounds` (default 5) exhausted, or aborted via `signal`, while still truncating.
- `no_progress` — two consecutive rounds produced empty output.

Returns `{ terminal, rounds, lastResult, usage }` with token usage summed across rounds. Options: `maxRounds`, `continuationPrompt`, `onTruncated`, `signal`, `sendOptions`. Local agents only — cloud agents throw `UnsupportedRunOperationError` (the cloud runtime manages continuation server-side). This replaces the outer continuation loop a code-assistant builder would otherwise hand-roll.
