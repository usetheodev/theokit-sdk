# D234 — State between steps is explicit input/output, NOT a state-machine global

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Each step receives the prior step's `output` as `input`. `.parallel` produces an array; `.branch` propagates the matched branch's output. There is NO workflow-global state, NO `Annotation.Root + reducers` (LangGraph), and NO implicit context bag.

## Rationale

Pipeline-shape covers ~90% of real workflows. State-machine model (LangGraph) is more expressive but adds a learning curve (typed dicts, reducer composition) that pays off only at large scale. KISS first; ship state-machine in v1.x if real demand emerges.

## Consequences

- Step functions are purely functional in signature: `(input, ctx) => output`.
- Workflow-wide config (provider keys, agent refs) flows via closure in the `Workflow.create` scope.
- Cross-step state requires explicit threading (output of step A passed to step C via input of step B), or accumulating into the final output structure.
- Easier to reason about; harder to express convergent flows where N branches feed a reducer.
