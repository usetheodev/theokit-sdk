---
"@theokit/sdk-budget": minor
---

M1-6 — multi-round usage aggregation is honest-null (plan `m1-usage-honest-null`).

Fixes a cost-honesty bug: `computeUsdCost` returned `0` for an unknown model, so a per-round cost that is genuinely UNKNOWN was silently summed as `$0`, making `createUsdBudgetTracker.getTotalUsd()` report a dishonest cheap/complete total and a `maxUsd` cap evaluate against an under-counted spend.

- `computeUsdCost(...)` now returns `number | undefined` — `undefined` for an unknown model (a known model with zero tokens still returns a real `0`). Aligns with the cost contract (`D377-cost-status-closed-enum.md`: amount-unknown ≠ `$0`), matching `@theokit/sdk/messages`' `costAmountUsd`.
- `createUsdBudgetTracker` POISONS the aggregate: once any round's cost is unknown, `getTotalUsd()` returns `undefined` (and stays undefined — a later known round does not resurrect it). Tokens are always known and still counted.
- `check()` FAILS CLOSED on a `maxUsd` cap when cost is unknown (returns `cost_limit` — it cannot prove the run is under budget). The `maxTokens` cap is unaffected.

**Type change:** `computeUsdCost` and `getTotalUsd()` now return `number | undefined` (was `number`). Consumers must branch on `undefined` (the point of the honest-null contract).
