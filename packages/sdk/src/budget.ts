/**
 * `Budget` — token cost enforcement primitive (Adoption Roadmap #1
 * post-Tasks, ADRs D375-D388).
 *
 * Static facade delegating to the in-process registry + ledger.
 * 3 modes: `audit` (log-only), `warn` (callbacks + log), `block`
 * (preflight throw before LLM call).
 *
 * @public
 */

import { computeCost } from "./internal/budget/compute-cost.js";
import { chargeAndCheckThresholds, preflightCheck } from "./internal/budget/enforcement.js";
import { inferApiMode, normalizeUsage } from "./internal/budget/normalize-usage.js";
import { getPricingEntry } from "./internal/budget/pricing-registry.js";
import {
  createBudget,
  deleteBudget,
  getBudget,
  listBudgets,
  snapshotAll,
} from "./internal/budget/registry.js";
import { UsageAccumulator } from "./internal/budget/usage-accumulator.js";
import type { BudgetHandle, BudgetOptions, BudgetSnapshot } from "./types/budget.js";

// Re-exports for caller-side composition until auto-wire-up in v0.2 (T4.2 deferred).
export {
  chargeAndCheckThresholds,
  computeCost,
  getPricingEntry,
  inferApiMode,
  normalizeUsage,
  preflightCheck,
  UsageAccumulator,
};

export class Budget {
  // D375 — static class with private constructor.
  private constructor() {
    throw new Error("Budget is static; do not instantiate");
  }

  /**
   * Create a budget. `name` must match `^[a-z0-9][a-z0-9_-]*$` (EC-7).
   * Throws `ConfigurationError` if name is invalid OR already exists
   * (EC-16: duplicate surface caller bug).
   *
   * `limits` is stacked (D384) — ANY exceeded triggers enforcement.
   * Empty `limits[]` is valid: pure tracking, no thresholds/exceed
   * callbacks fire (EC-19).
   *
   * Default `mode` is `"warn"` (D383). For emergency stop, use
   * `mode: "block", limits: [{ window: "1d", limitUsd: 0 }]` (EC-18).
   */
  static create(options: BudgetOptions): BudgetHandle {
    return createBudget(options);
  }

  /** Returns the handle for an active budget, or `undefined`. */
  static get(name: string): BudgetHandle | undefined {
    return getBudget(name);
  }

  /** Returns all active budgets. */
  static list(): readonly BudgetHandle[] {
    return listBudgets();
  }

  /**
   * Deletes a budget from the registry. Returns `true` if it existed.
   * In-flight `agent.send` calls referencing the name treat the
   * subsequent charge as a silent no-op + stderr warn (EC-20).
   */
  static delete(name: string): boolean {
    return deleteBudget(name);
  }

  /**
   * Returns per-window spend snapshot for all active budgets. Each
   * entry has `{ name, window, spentUsd, limitUsd, ratio }`.
   */
  static snapshot(): readonly BudgetSnapshot[] {
    return snapshotAll();
  }
}
