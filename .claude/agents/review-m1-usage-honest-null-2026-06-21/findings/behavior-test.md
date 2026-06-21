# behavior + test-auditor — m1-usage-honest-null
Verdict: 0 BLOCKER, 0 HIGH. Rebuilt + 42/42 green, typecheck clean.
- INFO: undefined-vs-0 distinction exactly right (unknown model→undefined; known+zero→real 0; entry lookup before token guard). Poison sticky (costKnown never reset; later known round gated by `if(costKnown)`). check() fail-closed + cost precedence correct. No NaN path (guard before `totalUsd +=`). Aligned with D377 + compute-cost.ts.
- INFO: pre-existing tests not broken (fresh/invalid → costKnown=true → getTotalUsd()===0, honest). 2 bug tests genuinely FLIPPED (git-confirmed), not deleted. Regression tests non-vacuous (kill the still-add-0, removed-fail-closed, and precedence mutants).
- INFO: no in-repo consumer breaks from the number|undefined widening (only caller is the tracker; getTotalUsd is on the object's extra type, not the BudgetTracker contract).
