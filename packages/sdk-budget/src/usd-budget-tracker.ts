/**
 * `createUsdBudgetTracker` — USD-cost-aware `BudgetTracker` impl shipped
 * in `@theokit/sdk-budget` (SDK 2.0 Phase 2 / T2.X).
 *
 * Extends the counter pattern from `createCounterBudgetTracker`
 * (sdk-core reference impl) with per-model USD cost computation via
 * the `BUILTIN_PRICING` table.
 *
 * Use cases:
 *   - Cap total spend per agent run (`maxUsd`).
 *   - Cap total tokens (`maxTokens`) AND USD ceiling simultaneously.
 *   - Observe cumulative USD from outside (`getTotalUsd()`).
 *
 * Tracker.check() returns `allowed: false` when ANY of the configured
 * caps is exceeded. `reason` is one of:
 *   - `"token_limit"` — `maxTokens` reached
 *   - `"cost_limit"`  — `maxUsd` reached
 *
 * Layered design (mirrors counter impl):
 *   - `track()` is sync + non-throwing (clamps invalid values).
 *   - `check()` is sync (allowed: true unless a cap is exceeded).
 *   - `getTotal()` returns the SDK-required token + iteration totals
 *     ONLY (USD is exposed via the bonus `getTotalUsd()` method).
 *
 * @public
 */

import type { BudgetCheck, BudgetTotal, BudgetTracker, BudgetUsageEvent } from "@theokit/sdk";
import { BUILTIN_PRICING, computeUsdCost, type ModelPricing } from "./usd-pricing.js";

/** Options for `createUsdBudgetTracker`. */
export interface UsdBudgetTrackerOptions {
  /** Hard ceiling on total tokens (input + output combined). */
  readonly maxTokens?: number;
  /** Hard ceiling on cumulative USD spend. */
  readonly maxUsd?: number;
  /** Optional override map — model id → pricing entry. Merged onto BUILTIN_PRICING. */
  readonly pricing?: Readonly<Record<string, ModelPricing>>;
}

/**
 * Build a fresh USD-aware tracker. The returned object exposes the
 * `BudgetTracker` contract PLUS `getTotalUsd()` + `nextIteration()`
 * helpers for explicit iteration counting.
 */
export function createUsdBudgetTracker(
  options: UsdBudgetTrackerOptions = {},
): BudgetTracker & { nextIteration(): void; getTotalUsd(): number } {
  let totalTokens = 0;
  let iterations = 0;
  let totalUsd = 0;
  const maxTokens = options.maxTokens;
  const maxUsd = options.maxUsd;
  const pricing: Readonly<Record<string, ModelPricing>> =
    options.pricing !== undefined ? { ...BUILTIN_PRICING, ...options.pricing } : BUILTIN_PRICING;

  return {
    track(event: BudgetUsageEvent): void {
      // Sync + non-throwing per contract. Invalid events silently clamped.
      const t = Number.isFinite(event.tokens) && event.tokens > 0 ? event.tokens : 0;
      if (t === 0) return;
      totalTokens += t;
      totalUsd += computeUsdCost(pricing, event.model, event.type, t);
    },

    check(): BudgetCheck {
      if (maxUsd !== undefined && totalUsd >= maxUsd) {
        return {
          allowed: false,
          reason: "cost_limit",
          detail: `USD ${totalUsd.toFixed(6)} >= maxUsd ${maxUsd}`,
        };
      }
      if (maxTokens !== undefined && totalTokens >= maxTokens) {
        return {
          allowed: false,
          reason: "token_limit",
          detail: `${totalTokens} >= maxTokens ${maxTokens}`,
        };
      }
      return { allowed: true };
    },

    getTotal(): BudgetTotal {
      return { tokens: totalTokens, iterations };
    },

    getTotalUsd(): number {
      return totalUsd;
    },

    nextIteration(): void {
      iterations += 1;
    },
  };
}
