---
"@theokit/sdk": minor
---

M1-3 — `buildReplayHistory(base, events, options)` pure stateless continuation-history rebuild (plan `m1-continuation-history`).

The stateless complement to M1 Phase 3's `runToCompletion` (which covers the stateful-session path). For a server / serverless handler that re-runs an agent on a fresh request and must reconstruct working memory from persisted stream events, `buildReplayHistory` serializes a round's `SDKMessage[]` into a bounded `StoredMessage[]` you can replay as prior history:

- maps assistant text → `assistant`; tool `running` → `tool_call` (args); tool `completed`/`error` → `tool_result` (carrying the result content the continued model needs);
- drops the oldest turns — pair-safe (a `tool_call` and its `tool_result` are never split) — until the total fits a context-window-derived char budget, keeping ≥ 1;
- truncates an oversized single turn (reusing the SDK's `truncateWithMarker`) rather than dropping it;
- pure, synchronous, dependency-free; a non-finite `contextWindowTokens` collapses to budget 0 (never returns an unbounded history).

Exported from `@theokit/sdk` with `ReplayHistoryOptions`. Replaces the outer-loop history rebuild a code-assistant server otherwise hand-rolls.
