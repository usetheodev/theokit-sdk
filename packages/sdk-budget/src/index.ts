// Public API surface for @theokit/sdk-budget (SDK 2.0 Phase 2).
//
// USD-cost-aware BudgetTracker impls consuming the kernel-facing port
// from `@theokit/sdk`. Today: a built-in pricing table covering common
// OpenAI / Anthropic / Google models, PLUS the physical extraction of
// Budget facade internals (registry, ledger, enforcement, normalize-
// usage, calendar-window) — ~568 LOC moved out of sdk-core into this
// package per ADR-008.

// USD pricing helpers
export {
  BUILTIN_PRICING,
  computeUsdCost,
  type ModelPricing,
} from "./usd-pricing.js";
export {
  createUsdBudgetTracker,
  type UsdBudgetTrackerOptions,
} from "./usd-budget-tracker.js";

// Budget registry — manages named Budget instances + their options.
export {
  createBudget,
  defaultMode,
  deleteBudget,
  getBudget,
  getBudgetOptionsRaw,
  listBudgets,
  snapshotAll,
} from "./internal/registry.js";

// Budget enforcement — preflight check + threshold callbacks.
export { chargeAndCheckThresholds, preflightCheck } from "./internal/enforcement.js";

// Usage normalization — converts provider-shaped raw `usage` into canonical TokenUsage.
export { inferApiMode, normalizeUsage } from "./internal/normalize-usage.js";

// Calendar window helpers — UTC-aligned 1h/1d/1w/30d/365d.
export { startOfDayUtc, startOfWeekUtc, windowStartMs } from "./internal/calendar-window.js";

// Low-level ledger — exposed for consumers needing direct ledger access.
export { charge, spentIn } from "./internal/ledger.js";
