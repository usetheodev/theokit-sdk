# D216 — Full conversation history is passed to the receiver by default

**Date:** 2026-05-22
**Status:** Accepted

## Decision

When a handoff fires, the receiver receives the FULL conversation history of
the sender by default. Use `Handoff.create(target, { inputFilter })` to filter
or summarize.

## Rationale

- Conversational continuity: the user typed something; the receiver needs
  context to respond coherently.
- Privacy-sensitive cases use `inputFilter` (D219); the default biases toward
  "works out of the box."
- Matches OpenAI Agents default.

## Consequences

- Enables coherent multi-agent conversations with no extra config.
- Constrains: full history is expensive in tokens for long sessions;
  `inputFilter` is the cost-control escape hatch.
