# D96 — Strip `<think>` blocks before appending to message history

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D86, D94, plan `agent-core-loop-completion-plan.md`

## Decision

`stripThinkBlocks(content)` runs in `streamLlmTurn` (the agent-loop's
LLM-turn handler) BEFORE the visible text is appended to:

- `ctx.events` (assistant message event)
- `ctx.conversation` (structured turn record)
- `ctx.finalText` (the run's accumulated final answer)
- `ctx.messages` (the LLM-facing history sent on next iteration)

Unclosed `<think>` blocks (no matching `</think>`) are preserved in
visible — fail-open semantics.

## Rationale

DeepSeek-R1, Qwen-QwQ, and similar reasoning models emit `<think>...
</think>` chain-of-thought in the `content` field. If they enter the
message history:

- Each turn adds 5k+ thinking tokens.
- Prompt cache hashes the prefix → cache invalidates every turn.
- 10x cost regression invisible until the invoice arrives (Hermes v0.2
  #174).

Stripping at the LLM-turn handler is the single canonical chokepoint —
applies before ALL downstream consumers see the text.

## Consequences

- **Enables:** DeepSeek/Qwen providers usable without cache regression.
- **Constrains:** `<think>` in legitimate prose (rare; the token is by
  convention reserved for CoT) is lost. Provider-convention scope,
  documented in module JSDoc.
