---
"@theokit/sdk": minor
---

M1 Reliable harness — make the agent loop's iteration ceiling real (plan `m1-reliable-harness`).

- **M1-1:** the agent loop now calls `BudgetTracker.nextIteration?.()` once per completed turn, and `nextIteration?()` is an optional member of the `BudgetTracker` interface. `createCounterBudgetTracker({ maxIterations: N })` now actually halts the loop after N turns (it was dead — nothing called it). Additive and backward-compatible: trackers that only gate on tokens/USD omit the method.
- **M1-2 (knob):** `SendOptions.maxIterations` lets a builder raise/lower the loop's default 8-turn cap per `agent.send` call. Validated at the boundary (positive integer; invalid throws `ConfigurationError`). Default of 8 preserved when unset.
- **M1-2 (truncation signal):** `RunResult.stoppedAtIterationLimit` is `true` when the loop stopped at its iteration ceiling with tool work still pending (silent truncation) vs a clean `done` finish. Lets a caller/continuation driver detect and recover.
