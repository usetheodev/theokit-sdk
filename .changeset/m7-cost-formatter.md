---
"@theokit/sdk-budget": minor
---

M7 (Tema F) — `formatCostUsd(cost, opts?)`: honest-null cost render helper. An unknown cost (`undefined`, from `computeUsdCost`/`getTotalUsd`) renders as `"—"` (never a dishonest `"$0"`); a real number renders as `"$X.XX"`. A known-zero `0` is distinct and renders `"$0.00"`.
