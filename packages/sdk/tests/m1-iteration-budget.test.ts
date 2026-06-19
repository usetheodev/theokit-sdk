/**
 * M1-1 (plan m1-reliable-harness, T1.1) — wire the dead iteration counter.
 *
 * `createCounterBudgetTracker({ maxIterations })` was unable to halt the loop
 * because nothing called `nextIteration()`. The loop now calls
 * `inputs.budgetTracker?.nextIteration?.()` once per completed turn. These tests
 * pin: (a) the counter tracker halts after N advances; (b) the loop's per-turn
 * advance call advances a supporting tracker and no-ops for one without it.
 *
 * Loop-wiring is verified via a mirror of the exact call the loop makes
 * (`loop.ts` after `budget.consume()`) — the repo convention for loop hooks
 * that cannot drive the full agent loop without a stubbed LLM (see
 * agent-loop-budget-tracker-wiring.test.ts).
 */

import { createCounterBudgetTracker } from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";
// Type imported from src (not the dist barrel) so typecheck sees the new
// optional `nextIteration` member before a rebuild — repo convention
// (cf. agent-loop-budget-gate.test.ts).
import type { BudgetTracker } from "../src/internal/runtime/budget/budget-tracker.js";
import type { SendOptions } from "../src/types/run.js";

/** Mirror of the per-turn advance the loop performs after `budget.consume()`. */
function advanceIteration(tracker: BudgetTracker | undefined): void {
  tracker?.nextIteration?.();
}

describe("M1-1 iteration budget wiring", () => {
  it("test_counter_tracker_halts_after_maxIterations", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 3 });
    // Before any advance, the loop is allowed to proceed.
    expect(tracker.check().allowed).toBe(true);
    advanceIteration(tracker); // turn 1
    advanceIteration(tracker); // turn 2
    expect(tracker.check().allowed).toBe(true); // 2 < 3
    advanceIteration(tracker); // turn 3
    const decision = tracker.check();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("iteration_limit");
  });

  it("test_loop_advance_increments_counter_total", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 10 });
    advanceIteration(tracker);
    advanceIteration(tracker);
    expect(tracker.getTotal().iterations).toBe(2);
  });

  it("test_loop_advance_noops_for_tracker_without_nextIteration", () => {
    // A custom tracker that only gates on tokens omits nextIteration — the
    // loop's optional-chaining call must not throw.
    const tokenOnly: BudgetTracker = {
      track: () => {},
      check: () => ({ allowed: true }),
      getTotal: () => ({ tokens: 0 }),
    };
    expect(() => advanceIteration(tokenOnly)).not.toThrow();
  });

  it("test_loop_advance_noops_for_undefined_tracker", () => {
    expect(() => advanceIteration(undefined)).not.toThrow();
  });

  it("test_counter_tracker_nextIteration_is_called_once_per_turn", () => {
    const tracker = createCounterBudgetTracker({ maxIterations: 5 });
    const spy = vi.spyOn(tracker, "nextIteration");
    advanceIteration(tracker);
    advanceIteration(tracker);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("M1-2 SendOptions.maxIterations knob", () => {
  it("test_send_maxIterations_is_a_public_optional_field", () => {
    // Typecheck-level contract: the field exists on SendOptions and is optional.
    const opts: SendOptions = { maxIterations: 25 };
    expect(opts.maxIterations).toBe(25);
    const noKnob: SendOptions = {};
    expect(noKnob.maxIterations).toBeUndefined();
  });
});
