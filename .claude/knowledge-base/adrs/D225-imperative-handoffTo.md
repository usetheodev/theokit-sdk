# D225 — `Agent.handoffTo(other, opts?)` imperative API is opt-in

**Date:** 2026-05-22
**Status:** Accepted

## Decision

In addition to declarative `handoffs[]` (D214), `Agent` instances expose an
opt-in imperative method:

```ts
const result = await sender.handoffTo(receiver, {
  inputFilter: (h) => h,
  message: "User explicitly asked to switch.",  // last user message override
});
```

NOT auto-injected into the agent loop — power users (testing, manual
orchestration, programmatic flows) use it explicitly.

## Rationale

- Declarative is the canonical path (D214). Imperative is the escape hatch.
- Useful for: tests (predictable triggering), programmatic flows (CI
  pipelines), debugging (forcing a specific receiver).

## Consequences

- Enables programmatic control flow.
- Constrains: docs MUST clarify "use this only when the declarative path
  doesn't fit"; bypasses the LLM's reasoning.
