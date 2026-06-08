// Public API surface for @theokit/sdk-budget (SDK 2.0 Phase 2 / T2.X).
//
// USD-cost-aware BudgetTracker impls consuming the kernel-facing port
// from `@theokit/sdk`. Today: a built-in pricing table covering common
// OpenAI / Anthropic / Google models. Next iters add per-provider
// pluggable pricing sources + ledger persistence.

export {
  BUILTIN_PRICING,
  computeUsdCost,
  type ModelPricing,
} from "./usd-pricing.js";
export {
  createUsdBudgetTracker,
  type UsdBudgetTrackerOptions,
} from "./usd-budget-tracker.js";
