---
"@theokit/sdk": minor
---

M1-5 — `@theokit/sdk/messages`: pure readers over the `SDKMessage` stream (plan `m1-sdkmessage-readers`).

Consumers reading the `SDKMessage` stream had to hand-roll a wire-event mapper. The SDK now ships three pure readers on a dedicated sub-path, promoting the proven first-party hand-roll onto the SDK's own types:

- `assistantText(msg)` — concatenates an assistant message's `text` blocks; `""` for any non-assistant message (or one with no text). `tool_use` blocks are ignored.
- `extractToolUses(msg)` — returns the assistant message's `ToolUseBlock`s; `[]` for non-assistant. Reads the assistant content blocks, NOT the separate `SDKToolUseMessage` (`type:"tool_call"`) lifecycle event.
- `costAmountUsd(cost)` — reads `RunResult.cost.amountUsd` preserving `number | undefined` verbatim. An unknown cost stays `undefined` (never coerced to `$0`), distinct from a real `$0` subscription-included route — the cost-honesty contract (ADR D377).

All three are pure (no I/O, inputs never mutated). Zero new dependencies.
