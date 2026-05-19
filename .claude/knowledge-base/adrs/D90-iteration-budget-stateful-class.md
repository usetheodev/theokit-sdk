# D90 — `IterationBudget` is a stateful class, not a POJO

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D91, plan `agent-core-loop-completion-plan.md`

## Decision

`IterationBudget` is a TypeScript class with private fields (`#remaining`,
`#compressionAttempts`, `#graceCallUsed`) and explicit setters
(`consume()`, `recordCompression()`, `useGraceCall()`). The state is NOT
exposed as a plain object that callers can mutate.

## Rationale

Hermes v0.4 #1723 shipped a bug where `compression_attempts` lived as a
plain int in module scope — counters leaked across sessions, causing
infinite compression. A class encapsulates state per-instance: each
`Agent.send` constructs a fresh budget, and there's no global counter to
leak.

Explicit setters (vs property assignment) document intent in the call
site. `budget.consume()` reads like the cost it represents; `budget.
remaining = budget.remaining - 1` would not.

## Consequences

- **Enables:** per-send state isolation; the 4 Hermes spirals (v0.4 #1723,
  v0.7 #4750, v0.11 #10065, v0.11 #10472) all fixable by unit test
  against the class.
- **Constrains:** minor overhead vs POJO (irrelevant at LLM-loop scale).
