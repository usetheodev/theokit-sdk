---
"@theokit/sdk": minor
---

M1 Reliable harness — make the agent loop's iteration ceiling real (plan `m1-reliable-harness`).

- **M1-1:** the agent loop now calls `BudgetTracker.nextIteration?.()` once per completed turn, and `nextIteration?()` is an optional member of the `BudgetTracker` interface. `createCounterBudgetTracker({ maxIterations: N })` now actually halts the loop after N turns (it was dead — nothing called it). Additive and backward-compatible: trackers that only gate on tokens/USD omit the method.
