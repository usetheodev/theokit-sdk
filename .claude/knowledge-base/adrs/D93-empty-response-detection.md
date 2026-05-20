# D93 — `validateResponse` detects empty-content + zero-toolCalls

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D91, plan `agent-core-loop-completion-plan.md`

## Decision

`validateResponse({ content, toolCalls })` returns `{ ok: false, reason:
"empty response with no tool calls (model bailout)" }` when both:

- `content.trim() === ""`, AND
- `toolCalls.length === 0`.

Caller (agent loop) is expected to consume a budget unit AND inject a
nudge user-message ("continue or end with a final answer") to recover.

## Rationale

Weak models (Gemini Flash, Mistral 7B) occasionally return `content: ""`
with no tool calls after a tool result. Without detection:

1. Loop sees empty assistant turn.
2. Loop continues — assumes model needs more time.
3. Each empty turn inflates message history (history length +1).
4. Prompt cache invalidates every empty turn.
5. Spiral until budget exhausted (Hermes v0.11 #10472).

Detection consumes budget but injects a nudge giving the model a chance
to recover. If model continues to bail, budget runs out → grace call →
error surfaced.

## Consequences

- **Enables:** weak models stay usable for short conversations without
  silent cost regression.
- **Constrains:** transcript shows an extra `(continue or end with a
  final answer)` user-message in the rare bailout case. Documented.
