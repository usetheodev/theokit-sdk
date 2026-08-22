/**
 * Budget enforcement (ADRs D383, D386, EC-7/8/9).
 *
 * - `preflightCheck(name, estimatedUsd)` — em `block` mode, throw
 *   `BudgetExceededError` before the LLM call if any limit would be
 *   exceeded (EC-9 — the caller invokes it inside the mutex section).
 * - `chargeAndCheckThresholds(name, actualUsd)` — apply charge ao
 *   ledger + invokes onThreshold/onExceed callbacks isolated in
 *   try/catch (EC-8).
 *
 * @internal
 */

import { BudgetExceededError, type BudgetMode, type BudgetOptions } from "@theokit/sdk";
import { charge, spentIn } from "./ledger.js";
import { defaultMode, getBudgetOptionsRaw } from "./registry.js";

const THRESHOLDS = [0.8, 0.95] as const;
type Threshold = (typeof THRESHOLDS)[number];

/**
 * Refuse an upcoming call that would push a `"block"`-mode budget past one of its limits. Call it
 * BEFORE the LLM request, with your cost estimate for that request.
 *
 * Throws `BudgetExceededError` (carrying `budgetName`, `window`, the projected `spentUsd`, the
 * `limitUsd` and `mode: "block"`) for the FIRST limit where `alreadySpent + estimatedUsd` exceeds
 * the limit. The comparison is strict, so landing exactly on the limit is allowed through — while
 * the post-charge `onExceed` callback fires at `>=`. The two boundaries do not agree.
 *
 * SILENTLY DOES NOTHING in three cases, and none of them is distinguishable from "you are within
 * budget" at the call site:
 *
 * - `name` is not registered — a typo, or a budget deleted since. Nothing is enforced.
 * - the budget's mode is `"warn"` or `"audit"` — those never block by design.
 * - the estimate is low. Enforcement is only as good as `estimatedUsd`; passing 0 disables it.
 */
export function preflightCheck(name: string, estimatedUsd: number): void {
  const opts = getBudgetOptionsRaw(name);
  if (opts === undefined) return; // EC-20: budget deleted; charge becomes no-op
  if (defaultMode(opts) !== "block") return;
  for (const lim of opts.limits) {
    const currentSpent = spentIn(opts.name, lim.window);
    if (currentSpent + estimatedUsd > lim.limitUsd) {
      throw new BudgetExceededError({
        budgetName: opts.name,
        window: lim.window,
        spentUsd: currentSpent + estimatedUsd,
        limitUsd: lim.limitUsd,
        mode: "block",
      });
    }
  }
}

/**
 * Record the ACTUAL cost of a completed call against a budget and fire its callbacks. Call it after
 * the LLM request, paired with `preflightCheck` before it.
 *
 * NEVER THROWS on budget state — including when the charge tips a limit. Enforcement happens on the
 * next `preflightCheck`; this one only records and notifies. A callback that throws is caught and
 * logged to stderr, so your `onThreshold` / `onExceed` cannot break the run either.
 *
 * Per mode:
 *
 * - `"audit"` — charge only, no callbacks.
 * - `"warn"` — charge, then `onThreshold` at 80% or 95%, then `onExceed` at 100%. With no
 *   `onExceed` handler it writes a line to stderr instead.
 *
 * Per limit, exactly ONE callback fires per call: the highest matched threshold, or `onExceed`,
 * never both. But there is NO de-duplication across calls — a budget sitting at 90% fires
 * `onThreshold(0.8)` again on every single charge, and one past its limit fires `onExceed` on
 * every charge forever. Debounce inside your handler if it pages anyone. A budget with three
 * limits evaluates all three, so one call can fire three callbacks.
 * - `"block"` — same callbacks as `"warn"`, still no throw. Concurrent sends each pass their own
 *   preflight, so the last to charge can legitimately tip a limit that preflight had cleared.
 *
 * A DELETED OR UNKNOWN BUDGET LOSES THE CHARGE. The function writes a warning to stderr and
 * returns — the spend is not recorded anywhere, so a budget removed mid-flight under-reports rather
 * than over-reports. This is the one path where the ledger and reality diverge on purpose.
 */
export async function chargeAndCheckThresholds(name: string, actualUsd: number): Promise<void> {
  const opts = getBudgetOptionsRaw(name);
  if (opts === undefined) {
    // EC-20: budget deleted during in-flight call. Charge is silent no-op.
    process.stderr.write(
      `[budget] charge for deleted budget "${name}" is a no-op (was the budget removed during in-flight send?)\n`,
    );
    return;
  }
  const mode = defaultMode(opts);

  await charge(opts.name, actualUsd);

  if (mode === "audit") return;
  await dispatchCallbacksFor(opts, mode);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 3-mode × 3-threshold dispatch table inherently branchy; pulling out helpers loses local context.
async function dispatchCallbacksFor(opts: BudgetOptions, mode: BudgetMode): Promise<void> {
  for (const lim of opts.limits) {
    const spent = spentIn(opts.name, lim.window);
    if (lim.limitUsd <= 0) {
      if (spent > 0) await dispatchExceed(opts, lim.window, spent, lim.limitUsd, mode);
      continue;
    }
    const ratio = spent / lim.limitUsd;
    if (ratio >= 1) {
      await dispatchExceed(opts, lim.window, spent, lim.limitUsd, mode);
    } else {
      // Iterate descending so the HIGHEST matched threshold fires (0.95 not 0.8)
      for (const t of [...THRESHOLDS].reverse() as Threshold[]) {
        if (ratio >= t) {
          await dispatchThreshold(opts, lim.window, spent, lim.limitUsd, t);
          break;
        }
      }
    }
  }
}

async function dispatchThreshold(
  opts: BudgetOptions,
  window: BudgetOptions["limits"][number]["window"],
  spentUsd: number,
  limitUsd: number,
  threshold: Threshold,
): Promise<void> {
  if (opts.onThreshold === undefined) return;
  try {
    await opts.onThreshold({
      budgetName: opts.name,
      window,
      threshold,
      spentUsd,
      limitUsd,
    });
  } catch (err) {
    // EC-8: callback throw isolated
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[budget] onThreshold callback threw: ${msg}\n`);
  }
}

async function dispatchExceed(
  opts: BudgetOptions,
  window: BudgetOptions["limits"][number]["window"],
  spentUsd: number,
  limitUsd: number,
  mode: BudgetMode,
): Promise<void> {
  if (opts.onExceed === undefined) {
    if (mode === "warn") {
      process.stderr.write(
        `[budget] "${opts.name}" exceeded ${window} limit: $${spentUsd.toFixed(4)} > $${limitUsd.toFixed(4)}\n`,
      );
    }
    return;
  }
  try {
    await opts.onExceed({
      budgetName: opts.name,
      window,
      spentUsd,
      limitUsd,
      mode,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[budget] onExceed callback threw: ${msg}\n`);
  }
}
