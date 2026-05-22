# D214 — Handoffs are tool-shaped (synthetic function tools)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Each `handoffs[]` destination is injected at `Agent.create` time as a synthetic
function tool. The LLM invokes it like any other tool; the runtime intercepts
and reroutes the next turn to the receiver.

```ts
Agent.create({
  handoffs: [billing, support],  // → synthetic tools transfer_to_billing, transfer_to_support
});
```

## Rationale

- Canonical pattern in OpenAI Agents SDK (Python + TS). LLMs across providers
  already know how to invoke function tools — no new mental model.
- The LLM decides via natural-language reasoning, not via runtime introspection
  — fits the conversational model.

Alternatives rejected:

- **Imperative-only `Agent.handoffTo(other)`** — forces callers to do intent
  classification themselves; defeats the point of having handoffs.
- **Decorator / annotation on the agent class** — works in Python; doesn't
  fit our class-instance shape.

## Consequences

- Enables zero new LLM concepts to teach.
- Constrains: receiver MUST be declared at sender's creation time (dynamic
  discovery via factory deferred to v2).
