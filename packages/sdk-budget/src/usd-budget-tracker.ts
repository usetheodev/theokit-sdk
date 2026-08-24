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

/**
 * Options for {@link createUsdBudgetTracker}. Omitting all of them builds a tracker that counts and
 * never denies.
 *
 * @public
 */
export interface UsdBudgetTrackerOptions {
  /**
   * Ceiling on total tokens, input and output combined. `check()` denies with
   * `reason: "token_limit"` once the running total REACHES it (`>=`, not `>`).
   */
  readonly maxTokens?: number;
  /**
   * Ceiling on cumulative USD. `check()` denies with `reason: "cost_limit"` once the total reaches
   * it.
   *
   * TRAP — setting this makes an UNPRICED MODEL DENY EVERYTHING. If any tracked event names a model
   * absent from the pricing table, the total cost becomes permanently unknown, and a cap that
   * cannot be verified fails CLOSED: every subsequent `check()` returns
   * `{ allowed: false, reason: "cost_limit", detail: "cost unknown — …" }`. This is intentional
   * (better than spending unbounded), but it means a model id that merely differs in spelling from
   * a {@link BUILTIN_PRICING} key halts the agent. Supply `pricing` for anything not in that table,
   * or leave `maxUsd` unset and gate on `maxTokens`.
   */
  readonly maxUsd?: number;
  /**
   * Per-model prices, spread OVER {@link BUILTIN_PRICING} — so an entry here replaces a built-in of
   * the same key, and built-ins you do not name are kept.
   *
   * Keys are matched EXACTLY against `BudgetUsageEvent.model`. There is no prefix, alias or
   * provider-stripping logic: `"gpt-4o"` does not match the built-in `"openai/gpt-4o"`. Use the
   * same id string you pass to `Agent.create({ model })`.
   */
  readonly pricing?: Readonly<Record<string, ModelPricing>>;
}

/** The cost-cap denial for the current state, or `null` if the cost cap is satisfied. */
function evaluateCostCap(
  maxUsd: number | undefined,
  costKnown: boolean,
  totalUsd: number,
): BudgetCheck | null {
  if (maxUsd === undefined) return null;
  if (!costKnown) {
    // Fail closed: a spend cap is set but cost is unknown — we cannot prove the
    // run is under budget, so deny rather than allow unbounded spend.
    return {
      allowed: false,
      reason: "cost_limit",
      detail: `cost unknown — cannot verify maxUsd ${maxUsd}`,
    };
  }
  if (totalUsd >= maxUsd) {
    return {
      allowed: false,
      reason: "cost_limit",
      detail: `USD ${totalUsd.toFixed(6)} >= maxUsd ${maxUsd}`,
    };
  }
  return null;
}

/** The token-cap denial for the current state, or `null` if the token cap is satisfied. */
function evaluateTokenCap(maxTokens: number | undefined, totalTokens: number): BudgetCheck | null {
  if (maxTokens !== undefined && totalTokens >= maxTokens) {
    return {
      allowed: false,
      reason: "token_limit",
      detail: `${totalTokens} >= maxTokens ${maxTokens}`,
    };
  }
  return null;
}

/**
 * Build a `BudgetTracker` that caps an agent run on tokens, on USD, or on both.
 *
 * ```ts
 * const agent = await Agent.create({
 *   model: { id: "openai/gpt-4o-mini" },
 *   budgetTracker: createUsdBudgetTracker({ maxUsd: 0.5 }),
 * });
 * ```
 *
 * The agent loop drives it: `track()` on every usage event, `nextIteration()` once per turn, and
 * `check()` before each turn — a denial halts the loop. Everything is per-instance and in-memory,
 * so one tracker is one run; reuse it across runs and the caps carry over.
 *
 * Three things a caller gets wrong here:
 *
 * - **`getTotal()` has no cost in it.** It returns `{ tokens, iterations }` only, and
 *   `BudgetTotal.costUsd` is always `undefined` however much was spent. USD comes from the extra
 *   `getTotalUsd()` on the returned object, which is `number | undefined` — `undefined` meaning
 *   UNKNOWN, never zero.
 * - **Unknown cost is a one-way door.** The first event naming a model outside the pricing table
 *   makes `getTotalUsd()` `undefined` for the rest of the run; a later priced event does not
 *   restore it. Combined with `maxUsd`, that also denies every later `check()` — see
 *   {@link UsdBudgetTrackerOptions.maxUsd}.
 * - **There is no iteration cap.** `iterations` is counted and reported, and nothing ever gates on
 *   it. Use `createCounterBudgetTracker` from `@theokit/sdk` when you need `maxIterations`.
 *
 * `check()` evaluates the cost cap first, so a run breaching both caps reports `"cost_limit"`.
 * `track()` never throws and never rejects input — a non-finite or non-positive `tokens` is
 * discarded, silently.
 */
export function createUsdBudgetTracker(
  options: UsdBudgetTrackerOptions = {},
): BudgetTracker & { nextIteration(): void; getTotalUsd(): number | undefined } {
  let totalTokens = 0;
  let iterations = 0;
  let totalUsd = 0;
  // Honest-null (D377): once any round's cost is UNKNOWN, the aggregate becomes
  // unknown and STAYS unknown — a later known round does not resurrect it.
  let costKnown = true;
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
      const cost = computeUsdCost(pricing, event.model, event.type, t);
      if (cost === undefined) {
        costKnown = false; // poison — do NOT add 0 (that would be a dishonest $0)
        return;
      }
      if (costKnown) totalUsd += cost;
    },

    check(): BudgetCheck {
      // Cost cap is evaluated first (USD is the higher-signal denial for a human).
      return (
        evaluateCostCap(maxUsd, costKnown, totalUsd) ??
        evaluateTokenCap(maxTokens, totalTokens) ?? { allowed: true }
      );
    },

    getTotal(): BudgetTotal {
      return { tokens: totalTokens, iterations };
    },

    getTotalUsd(): number | undefined {
      return costKnown ? totalUsd : undefined;
    },

    nextIteration(): void {
      iterations += 1;
    },
  };
}
