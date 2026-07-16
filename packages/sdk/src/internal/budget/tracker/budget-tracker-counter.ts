/**
 * Reference `BudgetTracker` impl — pure token + iteration counter
 * (SDK 2.0 Phase 2 / T2.1 — ADR D1 reference implementation).
 *
 * Counts tokens per type (input/output) + iteration count. Enforces
 * optional `maxTokens` / `maxIterations` ceilings via `check()`.
 *
 * Does NOT compute USD cost — leaves that to richer impls in
 * `@theokit/sdk-budget` (post-Phase-2). This file is intentionally
 * minimal so consumers can:
 *   - use it as-is for simple guard-rails;
 *   - read it as a worked example before authoring a custom tracker;
 *   - rely on it as a fallback before sdk-budget ships.
 *
 * @public — surface-level reference impl.
 */

import type {
  BudgetCheck,
  BudgetTotal,
  BudgetTracker,
  BudgetUsageEvent,
} from "./budget-tracker.js";

/** Options for `createCounterBudgetTracker`. */
export interface CounterBudgetTrackerOptions {
  /** Hard ceiling on total tokens (input + output). When reached, `check()` returns `allowed: false`. */
  readonly maxTokens?: number;
  /** Hard ceiling on iterations counted by `nextIteration()`. */
  readonly maxIterations?: number;
}

/**
 * Build a fresh tracker. The returned object is independent — call
 * `createCounterBudgetTracker()` per Agent instance.
 *
 * The tracker exposes the `BudgetTracker` contract PLUS a `nextIteration()`
 * helper for impls that want explicit iteration counting (the agent loop
 * calls it once per turn). Without `nextIteration()` calls, the iteration
 * cap is never reached.
 */
export function createCounterBudgetTracker(
  options: CounterBudgetTrackerOptions = {},
): BudgetTracker & { nextIteration(): void } {
  let totalTokens = 0;
  let iterations = 0;
  const maxTokens = options.maxTokens;
  const maxIterations = options.maxIterations;

  return {
    track(event: BudgetUsageEvent): void {
      // `track()` MUST be synchronous and non-throwing per the contract.
      // Invalid events (negative tokens) are silently clamped.
      const t = Number.isFinite(event.tokens) && event.tokens > 0 ? event.tokens : 0;
      totalTokens += t;
    },

    check(): BudgetCheck {
      if (maxTokens !== undefined && totalTokens >= maxTokens) {
        return {
          allowed: false,
          reason: "token_limit",
          detail: `${totalTokens} >= maxTokens ${maxTokens}`,
        };
      }
      if (maxIterations !== undefined && iterations >= maxIterations) {
        return {
          allowed: false,
          reason: "iteration_limit",
          detail: `${iterations} >= maxIterations ${maxIterations}`,
        };
      }
      return { allowed: true };
    },

    getTotal(): BudgetTotal {
      return { tokens: totalTokens, iterations };
    },

    nextIteration(): void {
      iterations += 1;
    },
  };
}
